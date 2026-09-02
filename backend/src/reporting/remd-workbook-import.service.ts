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
import { getOrganizationGeo } from './organization-geo'
import {
    buildRemdWorkbookPreview,
    type RemdQualityIssue,
    type RemdSparseFact,
    type RemdSubdivisionRow,
    type RemdWorkbookParseResult,
    type RemdWorkbookPreview,
} from './remd-workbook-parser'
import { WorkbookImportJournal } from './engine/workbook-import-journal'
import { runWorkbookParseInWorker } from './workers/run-in-worker'

const REMD_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PREVIEW_TTL_HOURS = 24
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 400

export type RemdWorkbookImportMode = 'merge' | 'replace'

export interface RemdWorkbookPreviewResult {
    importId: string
    periodId: string
    importMode: RemdWorkbookImportMode
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: RemdWorkbookPreview
}

export interface RemdWorkbookConfirmResult {
    importId: string
    periodId: string
    importMode: RemdWorkbookImportMode
    sourceName: string
    institutionCount: number
    subdivisionCount: number
    unassignedSubdivisionCount: number
    unassignedDocumentCount: number
    semdTypeCount: number
    activeRegionSemdTypeCount: number
    factCount: number
    qualityIssueCount: number
}

export interface GroupedRemdSubdivision {
    organizationOid: string
    sourceKey: string
    externalOid: string | null
    name: string
    isUnassigned: boolean
    totalDocuments: number
    rowNumbers: number[]
    buildings: Array<{
        id: string
        name: string
        address: string
    }>
    facts: Map<string, number>
}

interface PreviewImportRow {
    id: string
    periodId: string
    importMode: RemdWorkbookImportMode
    originalFilename: string
    objectKey: string
    fileSha256: string
    fileSize: number
    status: string
    previewExpiresAt: Date | string | null
    details: Record<string, unknown>
}

interface PersistedFact {
    scopeLevel: 'region' | 'organization' | 'subdivision'
    organizationOid: string | null
    subdivisionId: string | null
    semdTypeId: string
    documentCount: number
    metadata: Record<string, unknown>
}

export function aggregateRemdFacts(
    facts: RemdSparseFact[],
): Map<string, number> {
    const result = new Map<string, number>()
    for (const fact of facts) {
        result.set(fact.typeKey, (result.get(fact.typeKey) ?? 0) + fact.count)
    }
    return result
}

export function groupRemdSubdivisionRows(
    rows: RemdSubdivisionRow[],
): GroupedRemdSubdivision[] {
    const grouped = new Map<string, GroupedRemdSubdivision>()

    for (const row of rows) {
        const sourceKey = row.isUnassigned
            ? `unassigned:${row.institutionOid}`
            : String(row.subdivisionOid)
        const mapKey = `${row.institutionOid}\u0000${sourceKey}`
        let subdivision = grouped.get(mapKey)
        if (!subdivision) {
            subdivision = {
                organizationOid: row.institutionOid,
                sourceKey,
                externalOid: row.isUnassigned ? null : row.subdivisionOid,
                name: row.isUnassigned
                    ? 'Без привязки к подразделению'
                    : row.subdivisionName,
                isUnassigned: row.isUnassigned,
                totalDocuments: 0,
                rowNumbers: [],
                buildings: [],
                facts: new Map<string, number>(),
            }
            grouped.set(mapKey, subdivision)
        }

        subdivision.totalDocuments += row.totalDocuments
        subdivision.rowNumbers.push(row.rowNumber)
        for (const fact of row.facts) {
            subdivision.facts.set(
                fact.typeKey,
                (subdivision.facts.get(fact.typeKey) ?? 0) + fact.count,
            )
        }

        const building = {
            id: row.buildingId,
            name: row.buildingName,
            address: row.buildingAddress,
        }
        if (
            building.id
            || building.name
            || building.address
        ) {
            const buildingKey = JSON.stringify(building)
            const alreadyAdded = subdivision.buildings.some(
                (candidate) => JSON.stringify(candidate) === buildingKey,
            )
            if (!alreadyAdded) subdivision.buildings.push(building)
        }
    }

    return Array.from(grouped.values()).sort((left, right) => {
        const organizationOrder = left.organizationOid.localeCompare(
            right.organizationOid,
        )
        if (organizationOrder !== 0) return organizationOrder
        return left.sourceKey.localeCompare(right.sourceKey, 'ru')
    })
}

@Injectable()
export class RemdWorkbookImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly journal: WorkbookImportJournal,
    ) {}

    async createPreview(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
        requestedMode: string = 'merge',
    ): Promise<RemdWorkbookPreviewResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        const importMode = this.parseImportMode(requestedMode)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Файл превышает максимально допустимый размер')
        }

        const period = await this.getPeriod(cleanPeriodId)
        const sourceName =
            this.cleanText(originalFilename, 256) || 'Импорт отчета РЭМД.xlsx'
        const importId = randomUUID()
        const fileSha256 = createHash('sha256')
            .update(fileBuffer)
            .digest('hex')
        const objectFilename = this.buildObjectFilename(sourceName)
        const objectKey =
            `reporting/imports/${cleanPeriodId}/${importId}/${objectFilename}`

        let parsed = await runWorkbookParseInWorker<RemdWorkbookParseResult>({ kind: 'remd', fileBuffer })
        const serviceIssues = await this.buildPreviewIssues(
            cleanPeriodId,
            fileSha256,
            parsed,
            period,
        )
        if (serviceIssues.length > 0) {
            parsed = {
                ...parsed,
                issues: [...parsed.issues, ...serviceIssues],
            }
        }
        const preview = buildRemdWorkbookPreview(parsed)
        const previewExpiresAt = new Date(
            Date.now() + PREVIEW_TTL_HOURS * 60 * 60 * 1000,
        )

        await this.journal.createPreviewedRun({
            importId,
            periodId: cleanPeriodId,
            sourceType: 'remd_workbook',
            importMode,
            sourceName,
            fileBuffer,
            contentType: REMD_CONTENT_TYPE,
            objectKey,
            fileSha256,
            organizationRows: parsed.institutions.rows.length,
            warnings: parsed.issues.map((issue) => issue.message),
            details: { preview },
            userId,
            previewExpiresAt,
        })

        return {
            importId,
            periodId: cleanPeriodId,
            importMode,
            sourceName,
            fileSha256,
            previewExpiresAt: previewExpiresAt.toISOString(),
            preview,
        }
    }

    async getPreview(
        userId: number,
        importId: string,
    ): Promise<RemdWorkbookPreviewResult> {
        const run = await this.getPreviewRun(userId, importId)
        const preview = run.details?.preview as RemdWorkbookPreview | undefined
        if (!preview) {
            throw new NotFoundException('Предпросмотр импорта не найден')
        }

        return {
            importId: run.id,
            periodId: run.periodId,
            importMode: run.importMode,
            sourceName: run.originalFilename,
            fileSha256: run.fileSha256,
            previewExpiresAt: this.toIsoString(run.previewExpiresAt),
            preview,
        }
    }

    async confirmPreview(
        userId: number,
        importId: string,
        requestedMode?: string,
    ): Promise<RemdWorkbookConfirmResult> {
        const run = await this.getPreviewRun(userId, importId)
        this.assertPreviewCanBeConfirmed(run)
        const importMode = requestedMode
            ? this.parseImportMode(requestedMode)
            : run.importMode
        const fileBuffer = await this.readStoredImport(
            run.objectKey,
            run.fileSize,
        )
        const parsed = await runWorkbookParseInWorker<RemdWorkbookParseResult>({ kind: 'remd', fileBuffer })
        const storedHash = createHash('sha256').update(fileBuffer).digest('hex')
        if (storedHash !== run.fileSha256) {
            throw new BadRequestException(
                'Сохраненный файл импорта поврежден: контрольная сумма не совпадает',
            )
        }
        const previewIssues =
            (run.details?.preview as RemdWorkbookPreview | undefined)?.issues
            ?? []
        const parsedIssueKeys = new Set(
            parsed.issues.map((issue) => this.issueKey(issue)),
        )
        parsed.issues.push(
            ...previewIssues.filter(
                (issue) => !parsedIssueKeys.has(this.issueKey(issue)),
            ),
        )
        if (parsed.issues.some((issue) => issue.severity === 'error')) {
            throw new BadRequestException(
                'Файл содержит ошибки контроля и не может быть подтвержден',
            )
        }

        const groupedSubdivisions = groupRemdSubdivisionRows(
            parsed.subdivisions.rows,
        )
        let transitionedToProcessing = false
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            const transition = await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'processing',
                    import_mode = $3,
                    confirmed_at = now(),
                    error_message = ''
                WHERE id = $1
                  AND created_by = $2
                  AND status = 'previewed'
                  AND preview_expires_at > now()
                RETURNING id;
                `,
                [run.id, userId, importMode],
            )
            if (transition.rowCount !== 1) {
                throw new BadRequestException(
                    'Предпросмотр уже подтвержден или срок его действия истек',
                )
            }
            transitionedToProcessing = true

            await this.upsertOrganizations(client, parsed, run.id)
            const semdTypeIds = await this.upsertSemdTypes(
                client,
                parsed,
                run.id,
            )
            const subdivisionIds = await this.upsertSubdivisions(
                client,
                groupedSubdivisions,
                run.id,
            )

            await this.clearFactsForImport(
                client,
                run.periodId,
                importMode,
                parsed.institutions.rows.map((row) => row.institutionOid),
                Array.from(subdivisionIds.values()),
            )
            const facts = this.buildFacts(
                parsed,
                groupedSubdivisions,
                semdTypeIds,
                subdivisionIds,
            )
            await this.insertFacts(
                client,
                run.periodId,
                run.id,
                run.originalFilename,
                facts,
            )

            await client.query(
                `DELETE FROM reporting_quality_issues WHERE source_import_id = $1;`,
                [run.id],
            )
            await this.insertQualityIssues(
                client,
                run.periodId,
                run.id,
                parsed.issues,
            )

            const unassigned = groupedSubdivisions.filter(
                (subdivision) => subdivision.isUnassigned,
            )
            const result: RemdWorkbookConfirmResult = {
                importId: run.id,
                periodId: run.periodId,
                importMode,
                sourceName: run.originalFilename,
                institutionCount: parsed.institutions.rows.length,
                subdivisionCount: groupedSubdivisions.length,
                unassignedSubdivisionCount: unassigned.length,
                unassignedDocumentCount: unassigned.reduce(
                    (sum, subdivision) => sum + subdivision.totalDocuments,
                    0,
                ),
                semdTypeCount: parsed.semdTypes.length,
                activeRegionSemdTypeCount:
                    parsed.activeRegionSemdTypeCount,
                factCount: facts.length,
                qualityIssueCount: parsed.issues.length,
            }
            const preview = buildRemdWorkbookPreview(parsed)
            await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'completed',
                    organization_rows = $2,
                    indicator_values_count = 0,
                    organization_values_count = $3,
                    warnings = $4::jsonb,
                    details = $5::jsonb,
                    error_message = '',
                    completed_at = now()
                WHERE id = $1;
                `,
                [
                    run.id,
                    parsed.institutions.rows.length,
                    parsed.institutions.rows.length,
                    JSON.stringify(
                        parsed.issues.map((issue) => issue.message),
                    ),
                    JSON.stringify({ preview, result }),
                ],
            )
            await client.query('COMMIT')
            return result
        } catch (err) {
            await client.query('ROLLBACK')
            if (transitionedToProcessing) {
                await this.markImportFailed(run.id, err)
            }
            throw err
        } finally {
            client.release()
        }
    }

    async cancelPreview(
        userId: number,
        importId: string,
    ): Promise<{ importId: string; status: 'cancelled' }> {
        return this.journal.cancelPreview(
            'remd_workbook',
            userId,
            this.cleanText(importId, 80),
        )
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

    private async buildPreviewIssues(
        periodId: string,
        fileSha256: string,
        parsed: RemdWorkbookParseResult,
        period: { dateFrom: string | null; dateTo: string | null },
    ): Promise<RemdQualityIssue[]> {
        const issues: RemdQualityIssue[] = []
        if (
            parsed.metadata.periodFrom
            && parsed.metadata.periodTo
            && period.dateFrom
            && period.dateTo
            && (
                parsed.metadata.periodFrom !== period.dateFrom
                || parsed.metadata.periodTo !== period.dateTo
            )
        ) {
            issues.push({
                code: 'reporting_period_mismatch',
                severity: 'warning',
                sheetKind: 'region',
                sheetName: parsed.region.sheetName,
                rowNumber: null,
                columnNumber: null,
                message:
                    `Период в файле ${parsed.metadata.periodFrom} — ${parsed.metadata.periodTo} `
                    + `не совпадает с выбранным периодом ${period.dateFrom} — ${period.dateTo}.`,
                details: {
                    workbookPeriodFrom: parsed.metadata.periodFrom,
                    workbookPeriodTo: parsed.metadata.periodTo,
                    selectedPeriodFrom: period.dateFrom,
                    selectedPeriodTo: period.dateTo,
                },
            })
        }

        const duplicate = await this.pool.query(
            `
            SELECT id::text, created_at AS "createdAt", status
            FROM reporting_import_runs
            WHERE period_id = $1
              AND file_sha256 = $2
              AND status IN ('previewed', 'processing', 'completed')
            ORDER BY created_at DESC
            LIMIT 1;
            `,
            [periodId, fileSha256],
        )
        if (duplicate.rows[0]) {
            issues.push({
                code: 'duplicate_file_for_period',
                severity: 'warning',
                sheetKind: 'region',
                sheetName: parsed.region.sheetName,
                rowNumber: null,
                columnNumber: null,
                message:
                    'Этот файл уже загружался для выбранного отчетного периода.',
                details: {
                    previousImportId: duplicate.rows[0].id,
                    previousImportStatus: duplicate.rows[0].status,
                    previousImportCreatedAt: this.toIsoString(
                        duplicate.rows[0].createdAt,
                    ),
                },
            })
        }
        return issues
    }

    private async getPreviewRun(
        userId: number,
        importId: string,
    ): Promise<PreviewImportRow> {
        const row = await this.journal.getPreviewedRun(
            'remd_workbook',
            userId,
            this.cleanText(importId, 80),
            'Импорт РЭМД не найден',
        )
        return { ...row, importMode: this.parseImportMode(row.importMode) }
    }

    private assertPreviewCanBeConfirmed(run: PreviewImportRow): void {
        if (run.status !== 'previewed') {
            throw new BadRequestException('Этот импорт уже был обработан')
        }
        const expiresAt = run.previewExpiresAt
            ? new Date(run.previewExpiresAt).getTime()
            : 0
        if (!expiresAt || expiresAt <= Date.now()) {
            throw new BadRequestException(
                'Срок действия предпросмотра истек. Загрузите файл повторно',
            )
        }
        const preview = run.details?.preview as RemdWorkbookPreview | undefined
        if (!preview?.canConfirm) {
            throw new BadRequestException(
                'Файл содержит ошибки контроля и не может быть подтвержден',
            )
        }
    }

    private async readStoredImport(
        objectKey: string,
        expectedSize: number,
    ): Promise<Buffer> {
        if (expectedSize < 0 || expectedSize > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException(
                'Размер сохраненного файла импорта недопустим',
            )
        }
        const stream = await this.s3.getObjectStream(objectKey)
        const chunks: Buffer[] = []
        let totalSize = 0
        for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk)
            totalSize += buffer.length
            if (totalSize > MAX_STORED_IMPORT_SIZE) {
                stream.destroy()
                throw new BadRequestException(
                    'Сохраненный файл превышает максимально допустимый размер',
                )
            }
            chunks.push(buffer)
        }
        if (totalSize !== Number(expectedSize)) {
            throw new BadRequestException(
                'Сохраненный файл импорта поврежден: размер не совпадает',
            )
        }
        return Buffer.concat(chunks)
    }

    private async upsertOrganizations(
        client: PoolClient,
        parsed: RemdWorkbookParseResult,
        importId: string,
    ): Promise<void> {
        for (const batch of this.chunk(parsed.institutions.rows, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((row, index) => {
                const offset = index * 10
                const geo = getOrganizationGeo(row.institutionOid)
                values.push(
                    row.institutionOid,
                    row.institutionName,
                    geo?.address ?? '',
                    geo?.latitude ?? null,
                    geo?.longitude ?? null,
                    geo?.locationSource ?? '',
                    geo?.locationPrecision ?? 'unknown',
                    importId,
                    JSON.stringify({
                        nameSource: 'remd',
                        nameLevel: 'short',
                        sourceRowNumber: row.rowNumber,
                    }),
                    row.institutionName,
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 10},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6},
                    $${offset + 7},
                    TRUE,
                    $${offset + 8},
                    $${offset + 9}::jsonb
                )`
            })
            await client.query(
                `
                INSERT INTO reporting_organizations (
                    oid,
                    official_full_name,
                    official_short_name,
                    common_name,
                    address,
                    latitude,
                    longitude,
                    location_source,
                    location_precision,
                    is_active,
                    source_import_id,
                    metadata
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (oid) DO UPDATE SET
                    -- Имя из справочника признаков МО выгрузка не перетирает.
                    -- Справочник ведёт методолог, там же лежит колонка «краткое
                    -- наименование для отображения в сервисе»; выгрузка РЭМД несёт
                    -- только то краткое имя, которое записано в самой РЭМД.
                    -- 15.08.2026 она переименовала «Курганский областной центр
                    -- медицинской профилактики, лечебной физкультуры и спортивной
                    -- медицины» в «КОЦОЗМП» во всех трёх полях сразу.
                    official_full_name = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.official_full_name
                        ELSE EXCLUDED.official_full_name
                    END,
                    official_short_name = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.official_short_name
                        ELSE EXCLUDED.official_short_name
                    END,
                    common_name = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.common_name
                        ELSE EXCLUDED.common_name
                    END,
                    is_active = TRUE,
                    source_import_id = EXCLUDED.source_import_id,
                    -- Оператор слияния отдаёт победу правой стороне, поэтому метку
                    -- nameSource = directory надо беречь отдельно: иначе первый же
                    -- импорт РЭМД сбросил бы её на remd и защита выше сработала бы
                    -- ровно один раз.
                    metadata = CASE
                        WHEN reporting_organizations.metadata->>'nameSource' = 'directory'
                            THEN reporting_organizations.metadata
                                || (EXCLUDED.metadata - 'nameSource' - 'nameLevel')
                        ELSE reporting_organizations.metadata || EXCLUDED.metadata
                    END,
                    updated_at = now();
                `,
                values,
            )
        }
    }

    private async upsertSemdTypes(
        client: PoolClient,
        parsed: RemdWorkbookParseResult,
        importId: string,
    ): Promise<Map<string, string>> {
        const result = new Map<string, string>()
        const typeByKey = new Map(
            parsed.semdTypes.map((type) => [type.typeKey, type]),
        )
        const aliasResult = await client.query(
            `
            SELECT DISTINCT
                   alias.normalized_alias AS "normalizedAlias",
                   alias.semd_type_id::text AS "semdTypeId"
            FROM reporting_semd_type_aliases alias
            WHERE alias.normalized_alias = ANY($1::text[]);
            `,
            [parsed.semdTypes.map((type) => type.typeKey)],
        )
        const aliasesByKey = new Map<string, Set<string>>()
        for (const row of aliasResult.rows) {
            const key = String(row.normalizedAlias)
            const matches = aliasesByKey.get(key) ?? new Set<string>()
            matches.add(String(row.semdTypeId))
            aliasesByKey.set(key, matches)
        }
        for (const [key, matches] of aliasesByKey) {
            if (matches.size > 1) {
                throw new BadRequestException(
                    `Неоднозначное сопоставление вида СЭМД «${typeByKey.get(key)?.name ?? key}» со справочником ЭМД`,
                )
            }
            result.set(key, Array.from(matches)[0])
        }

        const matchedTypes = parsed.semdTypes.filter(
            (type) => result.has(type.typeKey),
        )
        for (const batch of this.chunk(matchedTypes, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((type, index) => {
                const offset = index * 5
                values.push(
                    result.get(type.typeKey),
                    type.name,
                    type.formats.join(', '),
                    importId,
                    JSON.stringify({
                        formats: type.formats,
                        source: 'remd_workbook',
                    }),
                )
                return `(
                    $${offset + 1}::uuid,
                    $${offset + 2}::text,
                    $${offset + 3}::text,
                    $${offset + 4}::uuid,
                    $${offset + 5}::jsonb
                )`
            })
            await client.query(
                `
                UPDATE reporting_semd_types AS semd
                SET name = source.name,
                    document_format = source.document_format,
                    is_active = TRUE,
                    source_import_id = source.source_import_id,
                    metadata = semd.metadata || source.metadata,
                    updated_at = now()
                FROM (
                    VALUES ${placeholders.join(',')}
                ) AS source(
                    id,
                    name,
                    document_format,
                    source_import_id,
                    metadata
                )
                WHERE semd.id = source.id;
                `,
                values,
            )
        }

        const unmatchedTypes = parsed.semdTypes.filter(
            (type) => !result.has(type.typeKey),
        )
        for (const batch of this.chunk(unmatchedTypes, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((type, index) => {
                const offset = index * 5
                values.push(
                    type.typeKey,
                    type.name,
                    type.formats.join(', '),
                    importId,
                    JSON.stringify({
                        formats: type.formats,
                        source: 'remd_workbook',
                    }),
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 3},
                    TRUE,
                    $${offset + 4},
                    $${offset + 5}::jsonb
                )`
            })
            const queryResult = await client.query(
                `
                INSERT INTO reporting_semd_types (
                    code,
                    name,
                    document_format,
                    is_active,
                    source_import_id,
                    metadata
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name,
                    document_format = EXCLUDED.document_format,
                    is_active = TRUE,
                    source_import_id = EXCLUDED.source_import_id,
                    metadata = reporting_semd_types.metadata || EXCLUDED.metadata,
                    updated_at = now()
                RETURNING id::text, code;
                `,
                values,
            )
            for (const row of queryResult.rows) {
                result.set(row.code, row.id)
            }
        }
        return result
    }

    private async upsertSubdivisions(
        client: PoolClient,
        subdivisions: GroupedRemdSubdivision[],
        importId: string,
    ): Promise<Map<string, string>> {
        const result = new Map<string, string>()
        for (const batch of this.chunk(subdivisions, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((subdivision, index) => {
                const offset = index * 7
                values.push(
                    subdivision.organizationOid,
                    subdivision.sourceKey,
                    subdivision.externalOid,
                    subdivision.name,
                    importId,
                    JSON.stringify({
                        isUnassigned: subdivision.isUnassigned,
                        sourceRowNumbers: subdivision.rowNumbers,
                        buildings: subdivision.buildings,
                        sourceTotalDocuments: subdivision.totalDocuments,
                    }),
                    subdivision.name,
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 7},
                    TRUE,
                    $${offset + 5},
                    $${offset + 6}::jsonb
                )`
            })
            const queryResult = await client.query(
                `
                INSERT INTO reporting_subdivisions (
                    organization_oid,
                    source_key,
                    external_oid,
                    name,
                    short_name,
                    is_active,
                    source_import_id,
                    metadata
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (organization_oid, source_key) DO UPDATE SET
                    external_oid = EXCLUDED.external_oid,
                    name = EXCLUDED.name,
                    short_name = EXCLUDED.short_name,
                    is_active = TRUE,
                    source_import_id = EXCLUDED.source_import_id,
                    metadata = EXCLUDED.metadata,
                    updated_at = now()
                RETURNING id::text,
                          organization_oid AS "organizationOid",
                          source_key AS "sourceKey";
                `,
                values,
            )
            for (const row of queryResult.rows) {
                result.set(
                    this.subdivisionMapKey(
                        row.organizationOid,
                        row.sourceKey,
                    ),
                    row.id,
                )
            }
        }
        return result
    }

    private async clearFactsForImport(
        client: PoolClient,
        periodId: string,
        importMode: RemdWorkbookImportMode,
        organizationOids: string[],
        subdivisionIds: string[],
    ): Promise<void> {
        if (importMode === 'replace') {
            await client.query(
                `DELETE FROM reporting_remd_facts WHERE period_id = $1;`,
                [periodId],
            )
            return
        }

        await client.query(
            `
            DELETE FROM reporting_remd_facts fact
            WHERE fact.period_id = $1
              AND (
                  fact.scope_level = 'region'
                  OR (
                      fact.scope_level = 'organization'
                      AND fact.organization_oid = ANY($2::text[])
                  )
                  OR (
                      fact.scope_level = 'subdivision'
                      AND fact.subdivision_id = ANY($3::uuid[])
                  )
              );
            `,
            [periodId, organizationOids, subdivisionIds],
        )
    }

    private buildFacts(
        parsed: RemdWorkbookParseResult,
        subdivisions: GroupedRemdSubdivision[],
        semdTypeIds: Map<string, string>,
        subdivisionIds: Map<string, string>,
    ): PersistedFact[] {
        const facts: PersistedFact[] = []

        for (const row of parsed.region.rows) {
            for (const [typeKey, count] of aggregateRemdFacts(row.facts)) {
                facts.push({
                    scopeLevel: 'region',
                    organizationOid: null,
                    subdivisionId: null,
                    semdTypeId: this.requireMapValue(
                        semdTypeIds,
                        typeKey,
                        'вида СЭМД',
                    ),
                    documentCount: count,
                    metadata: {
                        sourceRowNumber: row.rowNumber,
                        aggregation: 'sum_across_document_formats',
                    },
                })
            }
        }

        for (const row of parsed.institutions.rows) {
            for (const [typeKey, count] of aggregateRemdFacts(row.facts)) {
                facts.push({
                    scopeLevel: 'organization',
                    organizationOid: row.institutionOid,
                    subdivisionId: null,
                    semdTypeId: this.requireMapValue(
                        semdTypeIds,
                        typeKey,
                        'вида СЭМД',
                    ),
                    documentCount: count,
                    metadata: {
                        sourceRowNumber: row.rowNumber,
                        aggregation: 'sum_across_document_formats',
                    },
                })
            }
        }

        for (const subdivision of subdivisions) {
            const subdivisionId = this.requireMapValue(
                subdivisionIds,
                this.subdivisionMapKey(
                    subdivision.organizationOid,
                    subdivision.sourceKey,
                ),
                'подразделения',
            )
            for (const [typeKey, count] of subdivision.facts) {
                facts.push({
                    scopeLevel: 'subdivision',
                    organizationOid: subdivision.organizationOid,
                    subdivisionId,
                    semdTypeId: this.requireMapValue(
                        semdTypeIds,
                        typeKey,
                        'вида СЭМД',
                    ),
                    documentCount: count,
                    metadata: {
                        sourceRowNumbers: subdivision.rowNumbers,
                        isUnassigned: subdivision.isUnassigned,
                        aggregation:
                            'sum_across_buildings_and_document_formats',
                    },
                })
            }
        }

        return facts
    }

    private async insertFacts(
        client: PoolClient,
        periodId: string,
        importId: string,
        sourceName: string,
        facts: PersistedFact[],
    ): Promise<void> {
        for (const batch of this.chunk(facts, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((fact, index) => {
                const offset = index * 9
                values.push(
                    periodId,
                    fact.scopeLevel,
                    fact.organizationOid,
                    fact.subdivisionId,
                    fact.semdTypeId,
                    fact.documentCount,
                    importId,
                    sourceName,
                    JSON.stringify(fact.metadata),
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6},
                    $${offset + 7},
                    $${offset + 8},
                    $${offset + 9}::jsonb
                )`
            })
            await client.query(
                `
                INSERT INTO reporting_remd_facts (
                    period_id,
                    scope_level,
                    organization_oid,
                    subdivision_id,
                    semd_type_id,
                    document_count,
                    source_import_id,
                    source_name,
                    metadata
                )
                VALUES ${placeholders.join(',')};
                `,
                values,
            )
        }
    }

    private async insertQualityIssues(
        client: PoolClient,
        periodId: string,
        importId: string,
        issues: RemdQualityIssue[],
    ): Promise<void> {
        for (const batch of this.chunk(issues, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((issue, index) => {
                const offset = index * 8
                const entity = this.mapIssueEntity(issue)
                values.push(
                    periodId,
                    importId,
                    entity.type,
                    entity.key,
                    issue.code,
                    issue.severity,
                    issue.message,
                    JSON.stringify({
                        sheetKind: issue.sheetKind,
                        sheetName: issue.sheetName,
                        rowNumber: issue.rowNumber,
                        columnNumber: issue.columnNumber,
                        ...issue.details,
                    }),
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6},
                    $${offset + 7},
                    $${offset + 8}::jsonb
                )`
            })
            await client.query(
                `
                INSERT INTO reporting_quality_issues (
                    period_id,
                    source_import_id,
                    entity_type,
                    entity_key,
                    issue_code,
                    severity,
                    title,
                    details
                )
                VALUES ${placeholders.join(',')};
                `,
                values,
            )
        }
    }

    private mapIssueEntity(issue: RemdQualityIssue): {
        type:
            | 'import'
            | 'organization'
            | 'subdivision'
            | 'semd_type'
            | 'fact'
            | 'reconciliation'
        key: string
    } {
        if (issue.code === 'subdivision_not_specified') {
            return {
                type: 'subdivision',
                key: String(issue.details.institutionOid ?? ''),
            }
        }
        if (issue.code.startsWith('semd_header')) {
            return {
                type: 'semd_type',
                key: String(issue.details.semdName ?? ''),
            }
        }
        if (
            issue.code.includes('_vs_')
            || issue.code.includes('total_vs_columns')
        ) {
            return { type: 'reconciliation', key: issue.code }
        }
        if (issue.sheetKind === 'institution') {
            return {
                type: 'organization',
                key: String(issue.details.institutionOid ?? ''),
            }
        }
        if (issue.sheetKind === 'subdivision') {
            return {
                type: 'subdivision',
                key: String(
                    issue.details.subdivisionOid
                    ?? issue.details.institutionOid
                    ?? '',
                ),
            }
        }
        return { type: 'import', key: '' }
    }

    private issueKey(issue: RemdQualityIssue): string {
        return [
            issue.code,
            issue.sheetKind,
            issue.sheetName,
            issue.rowNumber ?? '',
            issue.columnNumber ?? '',
        ].join('\u0000')
    }

    private async markImportFailed(
        importId: string,
        err: unknown,
    ): Promise<void> {
        const errorMessage = this.cleanText(
            err instanceof Error ? err.message : String(err),
            2000,
        )
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
    }

    private parseImportMode(value: string): RemdWorkbookImportMode {
        if (value !== 'merge' && value !== 'replace') {
            throw new BadRequestException('Некорректный режим импорта')
        }
        return value
    }

    private buildObjectFilename(sourceName: string): string {
        const withoutPath = sourceName
            .replace(/\\/g, '/')
            .split('/')
            .pop()!
        const safe = withoutPath
            .replace(/[^\p{L}\p{N}._-]+/gu, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 180)
        return safe.toLocaleLowerCase('ru-RU').endsWith('.xlsx')
            ? safe
            : `${safe || 'remd-report'}.xlsx`
    }

    private subdivisionMapKey(
        organizationOid: string,
        sourceKey: string,
    ): string {
        return `${organizationOid}\u0000${sourceKey}`
    }

    private requireMapValue(
        values: Map<string, string>,
        key: string,
        entityLabel: string,
    ): string {
        const value = values.get(key)
        if (!value) {
            throw new Error(`Не найден идентификатор ${entityLabel}: ${key}`)
        }
        return value
    }

    private chunk<T>(items: T[], size: number): T[][] {
        const result: T[][] = []
        for (let index = 0; index < items.length; index += size) {
            result.push(items.slice(index, index + size))
        }
        return result
    }

    private cleanText(value: unknown, maxLength: number): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }

    private toIsoString(value: Date | string | null): string {
        if (!value) return ''
        const date = value instanceof Date ? value : new Date(value)
        return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
    }
}
