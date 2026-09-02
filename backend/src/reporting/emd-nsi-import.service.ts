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
import {
    EMD_NSI_DIRECTORY_OID,
    type EmdNsiParseResult,
    type EmdNsiType,
    normalizeSemdName,
    parseEmdNsiCsv,
    parseEmdNsiXlsx,
} from './emd-nsi-csv'
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'

const EMD_NSI_CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const EMD_NSI_XLSX_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024

interface ExistingSemdType {
    id: string
    code: string
    nsiOid: string | null
    name: string
}

export interface EmdNsiImportResult {
    importId: string
    periodId: string
    sourceName: string
    directoryOid: string
    sourceVersion: string | null
    reportingDate: string
    rowCount: number
    typeCount: number
    activeTypeCount: number
    epguAvailableTypeCount: number
    matchedExistingTypeCount: number
    createdTypeCount: number
    remdTypesOutsideReferenceCount: number
    warnings: string[]
}

@Injectable()
export class EmdNsiImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly pilotCalculation: PilotIndicatorCalculationService,
    ) {}

    async importCsv(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<EmdNsiImportResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл справочника ЭМД пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException(
                'Файл превышает максимально допустимый размер',
            )
        }

        const period = await this.getPeriod(cleanPeriodId)
        const reportingDate = String(period.dateTo ?? period.dateFrom ?? '')
        if (!reportingDate) {
            throw new BadRequestException(
                'Для импорта справочника у отчетного периода должна быть указана дата',
            )
        }
        const sourceName = this.cleanText(originalFilename, 256)
            || `${EMD_NSI_DIRECTORY_OID}.csv`
        // Roadmap Пакет A, задача 10 — тот же справочник 1520 также выгружается в формате XLSX;
        // определяем формат по расширению файла, дальше оба варианта дают один EmdNsiParseResult.
        const isXlsx = /\.xlsx$/iu.test(sourceName)
        const parsed = isXlsx
            ? await parseEmdNsiXlsx(fileBuffer, {
                reportingDate,
                originalFilename: sourceName,
            })
            : parseEmdNsiCsv(fileBuffer, {
                reportingDate,
                originalFilename: sourceName,
            })
        const importId = randomUUID()
        const fileSha256 = createHash('sha256')
            .update(fileBuffer)
            .digest('hex')
        const objectFilename = this.buildObjectFilename(sourceName)
        const objectKey =
            `reporting/reference/emd-nsi/${cleanPeriodId}/${importId}/${objectFilename}`

        await this.s3.uploadBuffer(
            objectKey,
            fileBuffer,
            isXlsx ? EMD_NSI_XLSX_CONTENT_TYPE : EMD_NSI_CSV_CONTENT_TYPE,
        )
        try {
            await this.pool.query(
                `
                INSERT INTO reporting_import_runs (
                    id,
                    period_id,
                    source_type,
                    import_mode,
                    original_filename,
                    object_key,
                    file_sha256,
                    file_size,
                    status,
                    organization_rows,
                    warnings,
                    details,
                    created_by
                )
                VALUES (
                    $1,
                    $2,
                    'emd_nsi_csv',
                    'replace',
                    $3,
                    $4,
                    $5,
                    $6,
                    'processing',
                    0,
                    $7::jsonb,
                    $8::jsonb,
                    $9
                );
                `,
                [
                    importId,
                    cleanPeriodId,
                    sourceName,
                    objectKey,
                    fileSha256,
                    fileBuffer.length,
                    JSON.stringify(parsed.warnings),
                    JSON.stringify({
                        directoryOid: parsed.directoryOid,
                        sourceVersion: parsed.sourceVersion,
                        reportingDate: parsed.reportingDate,
                    }),
                    userId,
                ],
            )
        } catch (err) {
            await this.deleteObjectQuietly(objectKey)
            throw err
        }

        const client = await this.pool.connect()
        let completedResult: EmdNsiImportResult | null = null
        try {
            await client.query('BEGIN')
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1));`,
                [EMD_NSI_DIRECTORY_OID],
            )
            const persisted = await this.persistReference(
                client,
                parsed,
                importId,
            )
            const outsideReferenceResult = await client.query(
                `
                SELECT COUNT(*)::int AS count
                FROM reporting_semd_types
                WHERE is_active = TRUE
                  AND nsi_oid IS NULL;
                `,
            )
            const result: EmdNsiImportResult = {
                importId,
                periodId: cleanPeriodId,
                sourceName,
                directoryOid: parsed.directoryOid,
                sourceVersion: parsed.sourceVersion,
                reportingDate: parsed.reportingDate,
                rowCount: parsed.rows.length,
                typeCount: parsed.types.length,
                activeTypeCount: parsed.activeTypeCount,
                epguAvailableTypeCount: parsed.epguAvailableTypeCount,
                matchedExistingTypeCount: persisted.matchedExistingTypeCount,
                createdTypeCount: persisted.createdTypeCount,
                remdTypesOutsideReferenceCount: Number(
                    outsideReferenceResult.rows[0]?.count ?? 0,
                ),
                warnings: parsed.warnings,
            }

            await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'completed',
                    indicator_values_count = 1,
                    organization_values_count = 0,
                    warnings = $2::jsonb,
                    details = $3::jsonb,
                    error_message = '',
                    completed_at = now()
                WHERE id = $1;
                `,
                [
                    importId,
                    JSON.stringify(parsed.warnings),
                    JSON.stringify({
                        directoryOid: parsed.directoryOid,
                        sourceVersion: parsed.sourceVersion,
                        reportingDate: parsed.reportingDate,
                        result,
                    }),
                ],
            )
            await client.query('COMMIT')
            completedResult = result
        } catch (err) {
            await client.query('ROLLBACK')
            await this.markImportFailed(importId, err)
            throw err
        } finally {
            client.release()
        }
        await this.pilotCalculation.recalculate(cleanPeriodId)
        return completedResult!
    }

    private async persistReference(
        client: PoolClient,
        parsed: EmdNsiParseResult,
        importId: string,
    ): Promise<{
        matchedExistingTypeCount: number
        createdTypeCount: number
    }> {
        const existingResult = await client.query(
            `
            SELECT id::text,
                   code,
                   nsi_oid AS "nsiOid",
                   name
            FROM reporting_semd_types
            FOR UPDATE;
            `,
        )
        const existing = existingResult.rows.map((row) => ({
            id: String(row.id),
            code: String(row.code),
            nsiOid: row.nsiOid ? String(row.nsiOid) : null,
            name: String(row.name),
        })) as ExistingSemdType[]
        const aliasResult = await client.query(
            `
            SELECT semd_type_id::text AS "semdTypeId",
                   normalized_alias AS "normalizedAlias"
            FROM reporting_semd_type_aliases;
            `,
        )

        const existingByNsiCode = new Map(
            existing
                .filter((type) => type.nsiOid)
                .map((type) => [String(type.nsiOid), type]),
        )
        const existingByNormalizedName = new Map<string, ExistingSemdType[]>()
        const addExistingName = (normalized: string, type: ExistingSemdType) => {
            if (!normalized) return
            const matches = existingByNormalizedName.get(normalized) ?? []
            if (!matches.some((candidate) => candidate.id === type.id)) {
                matches.push(type)
            }
            existingByNormalizedName.set(normalized, matches)
        }
        for (const type of existing) {
            addExistingName(normalizeSemdName(type.code), type)
            addExistingName(normalizeSemdName(type.name), type)
        }
        const existingById = new Map(existing.map((type) => [type.id, type]))
        for (const row of aliasResult.rows) {
            const type = existingById.get(String(row.semdTypeId))
            if (type) {
                addExistingName(String(row.normalizedAlias), type)
            }
        }

        const assignedExistingIds = new Set<string>()
        const semdTypeIdByNsiCode = new Map<string, string>()
        let matchedExistingTypeCount = 0
        let createdTypeCount = 0

        for (const type of parsed.types) {
            let existingType = existingByNsiCode.get(type.typeCode) ?? null
            if (!existingType) {
                const candidates = new Map<string, ExistingSemdType>()
                for (const alias of type.aliases) {
                    for (
                        const candidate
                        of existingByNormalizedName.get(
                            normalizeSemdName(alias),
                        ) ?? []
                    ) {
                        if (!assignedExistingIds.has(candidate.id)) {
                            candidates.set(candidate.id, candidate)
                        }
                    }
                }
                if (candidates.size > 1) {
                    throw new BadRequestException(
                        `Неоднозначное сопоставление TYPE=${type.typeCode} «${type.canonicalName}» с видами СЭМД из РЭМД`,
                    )
                }
                existingType = candidates.values().next().value ?? null
            }

            let semdTypeId: string
            if (existingType) {
                if (
                    assignedExistingIds.has(existingType.id)
                    && existingType.nsiOid !== type.typeCode
                ) {
                    throw new BadRequestException(
                        `Один вид РЭМД сопоставлен с несколькими TYPE справочника ЭМД`,
                    )
                }
                assignedExistingIds.add(existingType.id)
                matchedExistingTypeCount += 1
                semdTypeId = existingType.id
                await this.updateSemdType(
                    client,
                    semdTypeId,
                    type,
                    parsed,
                    importId,
                )
            } else {
                semdTypeId = await this.insertSemdType(
                    client,
                    type,
                    parsed,
                    importId,
                )
                createdTypeCount += 1
            }
            semdTypeIdByNsiCode.set(type.typeCode, semdTypeId)
        }

        await client.query(
            `
            DELETE FROM reporting_semd_type_versions
            WHERE metadata->>'source' = 'emd_nsi_csv';
            `,
        )
        for (const type of parsed.types) {
            const semdTypeId = semdTypeIdByNsiCode.get(type.typeCode)!
            await this.upsertAliases(
                client,
                semdTypeId,
                type,
                importId,
            )
            await this.insertVersions(
                client,
                semdTypeId,
                type,
                parsed,
                importId,
            )
        }
        return {
            matchedExistingTypeCount,
            createdTypeCount,
        }
    }

    private async updateSemdType(
        client: PoolClient,
        semdTypeId: string,
        type: EmdNsiType,
        parsed: EmdNsiParseResult,
        importId: string,
    ): Promise<void> {
        await client.query(
            `
            UPDATE reporting_semd_types
            SET nsi_oid = $2,
                document_format = $3,
                version_label = $4,
                epgu_available = $5,
                effective_from = $6,
                effective_to = $7,
                is_active = TRUE,
                source_import_id = $8,
                metadata = metadata || $9::jsonb,
                updated_at = now()
            WHERE id = $1;
            `,
            [
                semdTypeId,
                type.typeCode,
                type.documentFormats.join(', '),
                parsed.sourceVersion ?? '',
                type.epguAvailable,
                type.effectiveFrom,
                type.effectiveTo,
                importId,
                JSON.stringify(this.typeMetadata(type, parsed)),
            ],
        )
    }

    private async insertSemdType(
        client: PoolClient,
        type: EmdNsiType,
        parsed: EmdNsiParseResult,
        importId: string,
    ): Promise<string> {
        const result = await client.query(
            `
            INSERT INTO reporting_semd_types (
                code,
                nsi_oid,
                name,
                document_format,
                version_label,
                epgu_available,
                effective_from,
                effective_to,
                is_active,
                source_import_id,
                metadata
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                TRUE,
                $9,
                $10::jsonb
            )
            RETURNING id::text;
            `,
            [
                `nsi_type_${type.typeCode}`,
                type.typeCode,
                type.canonicalName,
                type.documentFormats.join(', '),
                parsed.sourceVersion ?? '',
                type.epguAvailable,
                type.effectiveFrom,
                type.effectiveTo,
                importId,
                JSON.stringify(this.typeMetadata(type, parsed)),
            ],
        )
        return String(result.rows[0].id)
    }

    private async upsertAliases(
        client: PoolClient,
        semdTypeId: string,
        type: EmdNsiType,
        importId: string,
    ): Promise<void> {
        for (const alias of type.aliases) {
            const normalizedAlias = normalizeSemdName(alias)
            if (!normalizedAlias) continue
            await client.query(
                `
                INSERT INTO reporting_semd_type_aliases (
                    semd_type_id,
                    alias,
                    normalized_alias,
                    document_format,
                    source_import_id
                )
                VALUES ($1, $2, $3, '', $4)
                ON CONFLICT (
                    semd_type_id,
                    normalized_alias,
                    document_format
                ) DO UPDATE SET
                    alias = EXCLUDED.alias,
                    source_import_id = EXCLUDED.source_import_id;
                `,
                [semdTypeId, alias, normalizedAlias, importId],
            )
        }
    }

    private async insertVersions(
        client: PoolClient,
        semdTypeId: string,
        type: EmdNsiType,
        parsed: EmdNsiParseResult,
        importId: string,
    ): Promise<void> {
        for (const version of type.versions) {
            await client.query(
                `
                INSERT INTO reporting_semd_type_versions (
                    semd_type_id,
                    version_label,
                    name,
                    document_format,
                    epgu_available,
                    effective_from,
                    effective_to,
                    source_import_id,
                    metadata
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5,
                    $6,
                    $7,
                    $8,
                    $9::jsonb
                );
                `,
                [
                    semdTypeId,
                    version.id,
                    version.name,
                    version.documentFormat,
                    version.epguAvailable,
                    version.effectiveFrom,
                    version.effectiveTo,
                    importId,
                    JSON.stringify({
                        source: 'emd_nsi_csv',
                        directoryOid: parsed.directoryOid,
                        sourceVersion: parsed.sourceVersion,
                        nsiRecordOid: version.oid,
                        nsiTypeCode: version.typeCode,
                        formatCode: version.formatCode,
                        isOnline: version.isOnline,
                        raw: version.raw,
                    }),
                ],
            )
        }
    }

    private typeMetadata(
        type: EmdNsiType,
        parsed: EmdNsiParseResult,
    ): Record<string, unknown> {
        return {
            referenceSource: 'emd_nsi_csv',
            nsiDirectoryOid: parsed.directoryOid,
            nsiTypeCode: type.typeCode,
            sourceVersion: parsed.sourceVersion,
            referenceReportingDate: parsed.reportingDate,
            aliases: type.aliases,
        }
    }

    private async getPeriod(periodId: string): Promise<{
        id: string
        dateFrom: string | null
        dateTo: string | null
    }> {
        const result = await this.pool.query(
            `
            SELECT id::text,
                   date_from::text AS "dateFrom",
                   date_to::text AS "dateTo"
            FROM reporting_periods
            WHERE id = $1;
            `,
            [periodId],
        )
        if (!result.rows[0]) {
            throw new NotFoundException('Отчетный период не найден')
        }
        return result.rows[0]
    }

    private async markImportFailed(
        importId: string,
        err: unknown,
    ): Promise<void> {
        const errorMessage = this.cleanText(
            err instanceof Error ? err.message : String(err),
            2000,
        )
        try {
            await this.pool.query(
                `
                UPDATE reporting_import_runs
                SET status = 'failed',
                    error_message = $2,
                    completed_at = now()
                WHERE id = $1;
                `,
                [importId, errorMessage],
            )
        } catch {
            // The original import error is more useful to the caller.
        }
    }

    private buildObjectFilename(originalFilename: string): string {
        const fileName = originalFilename.split(/[\\/]/).pop()
            || `${EMD_NSI_DIRECTORY_OID}.csv`
        const sanitized = fileName
            .replace(/[\u0000-\u001f<>:"|?*]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
        return sanitized || `${EMD_NSI_DIRECTORY_OID}.csv`
    }

    private async deleteObjectQuietly(objectKey: string): Promise<void> {
        try {
            await this.s3.deleteObject(objectKey)
        } catch {
            // Preserve the original database error.
        }
    }

    private cleanText(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }
}
