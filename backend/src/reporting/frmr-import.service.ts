import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import { parseFrmrXlsx, type FrmrSubdivisionRow } from './frmr-xlsx'

const FRMR_SOURCE_TYPE = 'frmr_activity_type_xlsx'
const FRMR_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 300

export interface FrmrImportResult {
    importId: string
    periodId: string
    sourceName: string
    sheetName: string
    recordCount: number
    organizationCount: number
    matchedOrganizationCount: number
    unmatchedOrganizationOids: string[]
    subdivisionCount: number
    savedSubdivisionCount: number
    subdivisionTypeCount: number
    subdivisionKindCount: number
    warnings: string[]
}

/**
 * ТЗ 6.1.3.2.7 (agent_2026-07-15), п.1.3 — импорт справочника ФРМР как master-data «OID
 * организации → вид деятельности». Как и импортёры 1253/№5пр — только UPDATE поверх уже
 * существующих reporting_organizations (сопоставление по oid), новые МО не создаёт: ФРМР
 * покрывает организации шире текущего справочника МО (работодатели медработников), и создавать
 * записи организаций из этого источника — отдельное решение, не входящее в эту задачу.
 */
@Injectable()
export class FrmrImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async importXlsx(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<FrmrImportResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл ФРМР пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException(
                'Файл превышает максимально допустимый размер',
            )
        }
        await this.ensurePeriodExists(cleanPeriodId)

        const sourceName = this.cleanText(originalFilename, 256) || 'frmr.xlsx'
        const parsed = await parseFrmrXlsx(fileBuffer)

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectFilename = this.buildObjectFilename(sourceName)
        const objectKey =
            `reporting/reference/frmr/${cleanPeriodId}/${importId}/${objectFilename}`

        await this.s3.uploadBuffer(objectKey, fileBuffer, FRMR_CONTENT_TYPE)

        const client = await this.pool.connect()
        let matchedOrganizationCount = 0
        const matchedOrganizationOids = new Set<string>()
        const unmatchedOrganizationOids: string[] = []
        let savedSubdivisionCount = 0
        try {
            await client.query('BEGIN')
            await client.query(
                `INSERT INTO reporting_import_runs (
                    id, period_id, source_type, import_mode,
                    original_filename, object_key, file_sha256, file_size,
                    status, organization_rows, warnings, details, created_by
                )
                VALUES (
                    $1, $2, $3, 'replace',
                    $4, $5, $6, $7,
                    'processing', $8, '[]'::jsonb, '{}'::jsonb, $9
                );`,
                [
                    importId,
                    cleanPeriodId,
                    FRMR_SOURCE_TYPE,
                    sourceName,
                    objectKey,
                    fileSha256,
                    fileBuffer.length,
                    parsed.organizations.length,
                    userId,
                ],
            )

            for (const organization of parsed.organizations) {
                const result = await client.query(
                    `UPDATE reporting_organizations
                     SET activity_type = $2,
                         updated_at = now()
                     WHERE oid = $1
                       AND is_active = TRUE
                     RETURNING oid;`,
                    [organization.organizationOid, organization.activityType],
                )
                if (result.rowCount && result.rowCount > 0) {
                    matchedOrganizationCount += 1
                    matchedOrganizationOids.add(organization.organizationOid)
                } else {
                    unmatchedOrganizationOids.push(organization.organizationOid)
                }
            }

            // Подразделения пишем только для тех МО, что есть в справочнике (matched) —
            // как и activity_type, новые организации из ФРМР не создаём.
            const matchedSubdivisions = parsed.subdivisions.filter(
                (subdivision) => matchedOrganizationOids.has(subdivision.organizationOid),
            )

            // Этап 5 плана 24.07: отличаем «валидное отсутствие» от испорченного источника.
            // Ни одна МО не сопоставилась — это чужой регион или не тот файл.
            if (matchedOrganizationCount === 0) {
                throw new BadRequestException(
                    'Файл ФРМР не сопоставился ни с одной МО справочника: '
                    + `в файле ${parsed.organizations.length} организаций. `
                    + 'Прежние данные сохранены. Сначала загрузите числитель РЭМД (он создаёт '
                    + 'справочник целевых МО) и проверьте, что ФРМР выгружен по этому же региону.',
                )
            }
            // МО сопоставились, но подразделений нет ни у одной — замена стёрла бы структуру
            // подразделений и обрушила знаменатели, поэтому импорт отклоняем.
            if (matchedSubdivisions.length === 0) {
                throw new BadRequestException(
                    'В файле ФРМР не найдено ни одного подразделения для сопоставленных МО '
                    + `(сопоставлено МО: ${matchedOrganizationCount}). Прежние подразделения `
                    + 'сохранены. Проверьте, что выгрузка содержит структурные подразделения.',
                )
            }
            savedSubdivisionCount = await this.replaceSubdivisions(
                client,
                importId,
                Array.from(matchedOrganizationOids),
                matchedSubdivisions,
            )

            const warnings = [...parsed.warnings]
            if (unmatchedOrganizationOids.length > 0) {
                warnings.push(
                    `${unmatchedOrganizationOids.length} организаций из ФРМР не найдено среди активных МО справочника — это ожидаемо, ФРМР покрывает более широкий круг работодателей.`,
                )
            }

            await client.query(
                `UPDATE reporting_import_runs
                 SET status = 'completed',
                     indicator_values_count = $2,
                     organization_values_count = $3,
                     warnings = $4::jsonb,
                     error_message = '',
                     completed_at = now()
                 WHERE id = $1;`,
                [
                    importId,
                    parsed.organizations.length,
                    matchedOrganizationCount,
                    JSON.stringify(warnings),
                ],
            )
            await client.query('COMMIT')

            return {
                importId,
                periodId: cleanPeriodId,
                sourceName,
                sheetName: parsed.sheetName,
                recordCount: parsed.recordCount,
                organizationCount: parsed.organizations.length,
                matchedOrganizationCount,
                unmatchedOrganizationOids,
                subdivisionCount: parsed.subdivisions.length,
                savedSubdivisionCount,
                subdivisionTypeCount: parsed.subdivisionTypeCount,
                subdivisionKindCount: parsed.subdivisionKindCount,
                warnings,
            }
        } catch (err) {
            await client.query('ROLLBACK')
            await this.markImportFailed(importId, err)
            throw err
        } finally {
            client.release()
        }
    }

    /**
     * Перезаписывает подразделения только тех МО, что присутствуют в файле (matched):
     * удаляет их прежние подразделения из справочника и вставляет свежие. МО, которых нет
     * в файле, не трогает. subdivision_oid уникален глобально, поэтому один и тот же OID у
     * двух МО (крайне маловероятно) отсекается ON CONFLICT — берётся первая запись.
     */
    private async replaceSubdivisions(
        client: PoolClient,
        importId: string,
        matchedOrganizationOids: string[],
        subdivisions: FrmrSubdivisionRow[],
    ): Promise<number> {
        if (matchedOrganizationOids.length === 0) return 0

        await client.query(
            `DELETE FROM reporting_organization_subdivisions
             WHERE organization_oid = ANY($1::text[]);`,
            [matchedOrganizationOids],
        )
        if (subdivisions.length === 0) return 0

        let saved = 0
        for (let start = 0; start < subdivisions.length; start += INSERT_BATCH_SIZE) {
            const batch = subdivisions.slice(start, start + INSERT_BATCH_SIZE)
            const values: unknown[] = []
            const placeholders = batch.map((subdivision, index) => {
                const offset = index * 6
                values.push(
                    subdivision.organizationOid,
                    subdivision.subdivisionOid,
                    subdivision.subdivisionType,
                    subdivision.subdivisionKind,
                    subdivision.subdivisionName,
                    importId,
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6}
                )`
            })
            const result = await client.query(
                `INSERT INTO reporting_organization_subdivisions (
                    organization_oid,
                    subdivision_oid,
                    subdivision_type,
                    subdivision_kind,
                    subdivision_name,
                    source_import_id
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (subdivision_oid) DO UPDATE SET
                    organization_oid = EXCLUDED.organization_oid,
                    subdivision_type = EXCLUDED.subdivision_type,
                    subdivision_kind = EXCLUDED.subdivision_kind,
                    subdivision_name = EXCLUDED.subdivision_name,
                    source_import_id = EXCLUDED.source_import_id,
                    is_active = TRUE,
                    updated_at = now();`,
                values,
            )
            saved += result.rowCount ?? 0
        }
        return saved
    }

    private async ensurePeriodExists(periodId: string): Promise<void> {
        const result = await this.pool.query(
            `SELECT 1 FROM reporting_periods WHERE id = $1;`,
            [periodId],
        )
        if (!result.rows[0]) {
            throw new NotFoundException('Отчетный период не найден')
        }
    }

    private async markImportFailed(importId: string, err: unknown): Promise<void> {
        const errorMessage = this.cleanText(
            err instanceof Error ? err.message : String(err),
            2000,
        )
        try {
            await this.pool.query(
                `UPDATE reporting_import_runs
                 SET status = 'failed',
                     error_message = $2,
                     completed_at = now()
                 WHERE id = $1;`,
                [importId, errorMessage],
            )
        } catch {
            // The original import error is more useful to the caller.
        }
    }

    private buildObjectFilename(originalFilename: string): string {
        const fileName = originalFilename.split(/[\\/]/).pop() || 'frmr.xlsx'
        const withoutControlChars = Array.from(fileName)
            .filter((char) => char.charCodeAt(0) > 0x1f)
            .join('')
        const sanitized = withoutControlChars
            .replace(/[<>:"|?*]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
        return sanitized || 'frmr.xlsx'
    }

    private cleanText(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }
}
