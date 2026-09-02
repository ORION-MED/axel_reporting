import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import { parsePerechen5prXlsx } from './perechen-5pr-xlsx'

const PERECHEN_5PR_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024

export interface Perechen5prImportResult {
    importId: string
    periodId: string
    sourceName: string
    rowCount: number
    matchedTypeCount: number
    unmatchedTypeCodes: string[]
    warnings: string[]
}

/**
 * ТЗ 6.1.3.2.7 (agent_2026-07-15), п.1.1 — накладывает официальное наименование вида СЭМД
 * по протоколу №5пр поверх уже существующих reporting_semd_types (сопоставление по
 * nsi_oid = «Вид МД*»). Как и импортёр 1253 — только UPDATE, новые виды не создаёт: перечень
 * №5пр не несёт полных метаданных (формат/даты/OID отдельных версий), они уже есть из 1520.
 */
@Injectable()
export class Perechen5prImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async importXlsx(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<Perechen5prImportResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл перечня видов СЭМД (№5пр) пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException(
                'Файл превышает максимально допустимый размер',
            )
        }
        await this.ensurePeriodExists(cleanPeriodId)

        const sourceName = this.cleanText(originalFilename, 256)
            || 'perechen-5pr.xlsx'
        const parsed = await parsePerechen5prXlsx(fileBuffer)

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectFilename = this.buildObjectFilename(sourceName)
        const objectKey =
            `reporting/reference/perechen-5pr/${cleanPeriodId}/${importId}/${objectFilename}`

        await this.s3.uploadBuffer(objectKey, fileBuffer, PERECHEN_5PR_CONTENT_TYPE)

        const client = await this.pool.connect()
        let matchedTypeCount = 0
        const unmatchedTypeCodes: string[] = []
        try {
            await client.query('BEGIN')
            await client.query(
                `INSERT INTO reporting_import_runs (
                    id, period_id, source_type, import_mode,
                    original_filename, object_key, file_sha256, file_size,
                    status, organization_rows, warnings, details, created_by
                )
                VALUES (
                    $1, $2, 'perechen_5pr_xlsx', 'replace',
                    $3, $4, $5, $6,
                    'processing', 0, '[]'::jsonb, '{}'::jsonb, $7
                );`,
                [
                    importId,
                    cleanPeriodId,
                    sourceName,
                    objectKey,
                    fileSha256,
                    fileBuffer.length,
                    userId,
                ],
            )

            for (const row of parsed.rows) {
                const result = await client.query(
                    `UPDATE reporting_semd_types
                     SET official_name_5pr = $2,
                         updated_at = now()
                     WHERE nsi_oid = $1
                       AND is_active = TRUE
                     RETURNING id;`,
                    [row.typeCode, row.officialName],
                )
                if (result.rowCount && result.rowCount > 0) {
                    matchedTypeCount += 1
                } else {
                    unmatchedTypeCodes.push(row.typeCode)
                }
            }

            const warnings = [...parsed.warnings]
            if (unmatchedTypeCodes.length > 0) {
                warnings.push(
                    `Вид МД (TYPE) ${unmatchedTypeCodes.join(', ')} упомянут в перечне №5пр, но отсутствует среди активных видов СЭМД — сначала загрузите актуальный справочник 1520.`,
                )
            }

            await client.query(
                `UPDATE reporting_import_runs
                 SET status = 'completed',
                     indicator_values_count = 1,
                     organization_values_count = 0,
                     warnings = $2::jsonb,
                     error_message = '',
                     completed_at = now()
                 WHERE id = $1;`,
                [importId, JSON.stringify(warnings)],
            )
            await client.query('COMMIT')

            return {
                importId,
                periodId: cleanPeriodId,
                sourceName,
                rowCount: parsed.rows.length,
                matchedTypeCount,
                unmatchedTypeCodes,
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
        const fileName = originalFilename.split(/[\\/]/).pop()
            || 'perechen-5pr.xlsx'
        const withoutControlChars = Array.from(fileName)
            .filter((char) => char.charCodeAt(0) > 0x1f)
            .join('')
        const sanitized = withoutControlChars
            .replace(/[<>:"|?*]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
        return sanitized || 'perechen-5pr.xlsx'
    }

    private cleanText(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }
}
