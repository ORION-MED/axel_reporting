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
import {
    EPGU_DOC_VISIBILITY_DIRECTORY_OID,
    parseEpguDocVisibilityXlsx,
} from './epgu-doc-visibility-xlsx'
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'

const EPGU_DOC_VISIBILITY_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024

export interface EpguDocVisibilityImportResult {
    importId: string
    periodId: string
    sourceName: string
    directoryOid: string
    sourceVersion: string | null
    rowCount: number
    typeCount: number
    matchedTypeCount: number
    visibleTypeCount: number
    unmatchedTypeCodes: string[]
    warnings: string[]
}

/**
 * Roadmap Пакет A, задача 10 — импорт справочника «Электронные медицинские документы,
 * отображаемые на ЕПГУ» (1.2.643.5.1.13.13.99.2.1253). В отличие от emd-nsi-import.service.ts
 * (1520), этот справочник не создает новые виды СЭМД — он только накладывает на уже
 * существующие reporting_semd_types (сопоставление по nsi_oid = doc_class_id, «Вид МД»)
 * официальный OID и признак видимости на ЕПГУ (doc_visible), который используется как
 * основной флаг для расчета 6.1.3.2.7 — см. pilot-indicator-calculation.service.ts.
 */
@Injectable()
export class EpguDocVisibilityImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly pilotCalculation: PilotIndicatorCalculationService,
    ) {}

    async importXlsx(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<EpguDocVisibilityImportResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл справочника видимости на ЕПГУ пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException(
                'Файл превышает максимально допустимый размер',
            )
        }
        await this.ensurePeriodExists(cleanPeriodId)

        const sourceName = this.cleanText(originalFilename, 256)
            || `${EPGU_DOC_VISIBILITY_DIRECTORY_OID}.xlsx`
        const parsed = await parseEpguDocVisibilityXlsx(fileBuffer, {
            originalFilename: sourceName,
        })

        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectFilename = this.buildObjectFilename(sourceName)
        const objectKey =
            `reporting/reference/epgu-doc-visibility/${cleanPeriodId}/${importId}/${objectFilename}`

        await this.s3.uploadBuffer(
            objectKey,
            fileBuffer,
            EPGU_DOC_VISIBILITY_CONTENT_TYPE,
        )

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
                    $1, $2, 'epgu_doc_visibility_xlsx', 'replace',
                    $3, $4, $5, $6,
                    'processing', 0, '[]'::jsonb, $7::jsonb, $8
                );`,
                [
                    importId,
                    cleanPeriodId,
                    sourceName,
                    objectKey,
                    fileSha256,
                    fileBuffer.length,
                    JSON.stringify({
                        directoryOid: parsed.directoryOid,
                        sourceVersion: parsed.sourceVersion,
                    }),
                    userId,
                ],
            )

            for (const type of parsed.types) {
                const result = await client.query(
                    `UPDATE reporting_semd_types
                     SET official_oid = $2,
                         epgu_visible_registry = $3,
                         updated_at = now()
                     WHERE nsi_oid = $1
                       AND is_active = TRUE
                     RETURNING id;`,
                    [type.typeCode, type.officialOid, type.visible],
                )
                if (result.rowCount && result.rowCount > 0) {
                    matchedTypeCount += 1
                } else {
                    unmatchedTypeCodes.push(type.typeCode)
                }
            }

            const warnings = [...parsed.warnings]
            if (unmatchedTypeCodes.length > 0) {
                warnings.push(
                    `Вид МД (TYPE) ${unmatchedTypeCodes.join(', ')} упомянут в справочнике 1253, но отсутствует среди активных видов СЭМД — сначала загрузите актуальный справочник 1520.`,
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

            await this.pilotCalculation.recalculate(cleanPeriodId)

            return {
                importId,
                periodId: cleanPeriodId,
                sourceName,
                directoryOid: parsed.directoryOid,
                sourceVersion: parsed.sourceVersion,
                rowCount: parsed.rowCount,
                typeCount: parsed.types.length,
                matchedTypeCount,
                visibleTypeCount: parsed.types.filter((type) => type.visible).length,
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
            || `${EPGU_DOC_VISIBILITY_DIRECTORY_OID}.xlsx`
        const withoutControlChars = Array.from(fileName)
            .filter((char) => char.charCodeAt(0) > 0x1f)
            .join('')
        const sanitized = withoutControlChars
            .replace(/[<>:"|?*]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
        return sanitized || `${EPGU_DOC_VISIBILITY_DIRECTORY_OID}.xlsx`
    }

    private cleanText(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }
}
