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
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'
import {
    evaluateTpggSemdRule,
    TPGG_SEMD_RULES,
    type TpggRequirementStatus,
} from './tpgg-semd-rules'
import { buildOrganizationAliasIndex } from './tpgg-organization-alias-index'
import {
    type TpggPlanEntry,
    type TpggSheetSummary,
    type TpggWorkbookParseResult,
} from './tpgg-workbook-parser'
import { WorkbookImportJournal } from './engine/workbook-import-journal'
import { runWorkbookParseInWorker } from './workers/run-in-worker'

const TPGG_CONTENT_TYPE =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PREVIEW_TTL_HOURS = 24
const MAX_STORED_IMPORT_SIZE =
    Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 200

interface ReportingPeriodRow {
    id: string
    dateFrom: string | null
    dateTo: string | null
}

interface OrganizationRow {
    oid: string
    officialFullName: string
    officialShortName: string
    commonName: string
    aliases: string[]
}

interface SemdTypeRow {
    id: string
    nsiTypeCode: string
    name: string
}

interface PreviewImportRow {
    id: string
    periodId: string
    originalFilename: string
    objectKey: string
    fileSha256: string
    fileSize: number
    status: string
    previewExpiresAt: Date | string | null
    details: Record<string, unknown>
}

interface TpggImportContext {
    reportingYear: number
    selectedPeriodYear: number
    organizationBySourceName: Map<string, OrganizationRow>
    entriesByOrganizationOid: Map<string, TpggPlanEntry[]>
    organizations: OrganizationRow[]
    epguTypes: SemdTypeRow[]
    unmatchedOrganizations: string[]
    ambiguousOrganizations: string[]
    warnings: string[]
}

interface RequirementCandidate {
    organizationOid: string
    semdTypeId: string
    requirementStatus: TpggRequirementStatus
    gisAvailable: boolean | null
    reason: string
    metadata: Record<string, unknown>
}

export interface TpggWorkbookPreview {
    canConfirm: boolean
    reportingYear: number
    selectedPeriodYear: number
    sheets: TpggSheetSummary[]
    totals: {
        sheetCount: number
        parsedSheetCount: number
        skippedSheetCount: number
        planValueCount: number
        positivePlanValueCount: number
        uniqueSourceOrganizationCount: number
        matchedOrganizationCount: number
        unmatchedOrganizationCount: number
        ambiguousOrganizationCount: number
        directoryOrganizationCount: number
        epguTypeCount: number
        supportedRuleTypeCount: number
        requiredCount: number
        notRequiredCount: number
        unknownCount: number
    }
    unmatchedOrganizations: string[]
    ambiguousOrganizations: string[]
    warnings: string[]
}

export interface TpggWorkbookPreviewResult {
    importId: string
    periodId: string
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: TpggWorkbookPreview
}

export interface TpggWorkbookConfirmResult {
    importId: string
    periodId: string
    sourceName: string
    reportingYear: number
    planValueCount: number
    matchedOrganizationCount: number
    unmatchedOrganizationCount: number
    epguTypeCount: number
    requiredCount: number
    notRequiredCount: number
    unknownCount: number
    protectedRequirementCount: number
    warnings: string[]
}

@Injectable()
export class TpggWorkbookImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly pilotCalculation: PilotIndicatorCalculationService,
        private readonly journal: WorkbookImportJournal,
    ) {}

    async createPreview(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<TpggWorkbookPreviewResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (!fileBuffer.length) {
            throw new BadRequestException('Файл ТПГГ пуст')
        }
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException(
                'Файл превышает максимально допустимый размер',
            )
        }

        const period = await this.getPeriod(cleanPeriodId)
        const sourceName = this.cleanText(originalFilename, 256)
            || 'ТПГГ.xlsx'
        const parsed = await runWorkbookParseInWorker<TpggWorkbookParseResult>({ kind: 'tpgg', fileBuffer })
        const context = await this.buildContext(
            cleanPeriodId,
            period,
            sourceName,
            parsed,
            null,
        )
        const candidates = this.buildRequirementCandidates(
            context,
            sourceName,
        )
        const preview = this.buildPreview(parsed, context, candidates)
        const importId = randomUUID()
        const fileSha256 = createHash('sha256')
            .update(fileBuffer)
            .digest('hex')
        const previewExpiresAt = new Date(
            Date.now() + PREVIEW_TTL_HOURS * 60 * 60 * 1000,
        )
        const objectKey =
            `reporting/reference/tpgg/${cleanPeriodId}/${importId}/`
            + this.buildObjectFilename(sourceName)

        await this.journal.createPreviewedRun({
            importId,
            periodId: cleanPeriodId,
            sourceType: 'tpgg_workbook',
            importMode: 'replace',
            sourceName,
            fileBuffer,
            contentType: TPGG_CONTENT_TYPE,
            objectKey,
            fileSha256,
            organizationRows: preview.totals.matchedOrganizationCount,
            warnings: preview.warnings,
            details: { preview },
            userId,
            previewExpiresAt,
        })

        return {
            importId,
            periodId: cleanPeriodId,
            sourceName,
            fileSha256,
            previewExpiresAt: previewExpiresAt.toISOString(),
            preview,
        }
    }

    async getPreview(
        userId: number,
        importId: string,
    ): Promise<TpggWorkbookPreviewResult> {
        const run = await this.getPreviewRun(userId, importId)
        const preview = run.details?.preview as TpggWorkbookPreview | undefined
        if (!preview) {
            throw new NotFoundException('Предпросмотр импорта ТПГГ не найден')
        }
        return {
            importId: run.id,
            periodId: run.periodId,
            sourceName: run.originalFilename,
            fileSha256: run.fileSha256,
            previewExpiresAt: this.toIsoString(run.previewExpiresAt),
            preview,
        }
    }

    async confirmPreview(
        userId: number,
        importId: string,
    ): Promise<TpggWorkbookConfirmResult> {
        const run = await this.getPreviewRun(userId, importId)
        this.assertPreviewCanBeConfirmed(run)
        const fileBuffer = await this.readStoredImport(
            run.objectKey,
            run.fileSize,
        )
        const storedHash = createHash('sha256')
            .update(fileBuffer)
            .digest('hex')
        if (storedHash !== run.fileSha256) {
            throw new BadRequestException(
                'Сохраненный файл импорта поврежден: контрольная сумма не совпадает',
            )
        }

        const period = await this.getPeriod(run.periodId)
        const parsed = await runWorkbookParseInWorker<TpggWorkbookParseResult>({ kind: 'tpgg', fileBuffer })
        const context = await this.buildContext(
            run.periodId,
            period,
            run.originalFilename,
            parsed,
            run.id,
        )
        const candidates = this.buildRequirementCandidates(
            context,
            run.originalFilename,
        )
        const preview = this.buildPreview(parsed, context, candidates)
        if (!preview.canConfirm) {
            throw new BadRequestException(
                'ТПГГ нельзя применить: проверьте справочник ЭМД/НСИ и сопоставление МО',
            )
        }

        let transitionedToProcessing = false
        const client = await this.pool.connect()
        let completedResult: TpggWorkbookConfirmResult | null = null
        try {
            await client.query('BEGIN')
            const transition = await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'processing',
                    confirmed_at = now(),
                    error_message = ''
                WHERE id = $1
                  AND created_by = $2
                  AND source_type = 'tpgg_workbook'
                  AND status = 'previewed'
                  AND preview_expires_at > now()
                RETURNING id;
                `,
                [run.id, userId],
            )
            if (transition.rowCount !== 1) {
                throw new BadRequestException(
                    'Предпросмотр уже подтвержден или срок его действия истек',
                )
            }
            transitionedToProcessing = true

            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), $2);`,
                ['reporting_tpgg', context.reportingYear],
            )
            await this.insertPlanValues(
                client,
                run,
                parsed,
                context,
            )
            const persistedRequirementCount =
                await this.upsertRequirements(
                    client,
                    run,
                    context,
                    candidates,
                )
            const counts = this.countRequirements(candidates)
            const result: TpggWorkbookConfirmResult = {
                importId: run.id,
                periodId: run.periodId,
                sourceName: run.originalFilename,
                reportingYear: context.reportingYear,
                planValueCount: parsed.entries.length,
                matchedOrganizationCount:
                    preview.totals.matchedOrganizationCount,
                unmatchedOrganizationCount:
                    preview.totals.unmatchedOrganizationCount,
                epguTypeCount: context.epguTypes.length,
                requiredCount: counts.required,
                notRequiredCount: counts.notRequired,
                unknownCount: counts.unknown,
                protectedRequirementCount:
                    candidates.length - persistedRequirementCount,
                warnings: preview.warnings,
            }

            await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'completed',
                    organization_rows = $2,
                    indicator_values_count = 1,
                    organization_values_count = $3,
                    warnings = $4::jsonb,
                    details = $5::jsonb,
                    error_message = '',
                    completed_at = now()
                WHERE id = $1;
                `,
                [
                    run.id,
                    preview.totals.matchedOrganizationCount,
                    candidates.length,
                    JSON.stringify(preview.warnings),
                    JSON.stringify({ preview, result }),
                ],
            )
            await client.query('COMMIT')
            completedResult = result
        } catch (err) {
            await client.query('ROLLBACK')
            if (transitionedToProcessing) {
                await this.markImportFailed(run.id, err)
            }
            throw err
        } finally {
            client.release()
        }

        await this.pilotCalculation.recalculate(run.periodId)
        return completedResult!
    }

    async cancelPreview(
        userId: number,
        importId: string,
    ): Promise<{ importId: string; status: 'cancelled' }> {
        return this.journal.cancelPreview(
            'tpgg_workbook',
            userId,
            this.cleanText(importId, 80),
        )
    }

    private async buildContext(
        periodId: string,
        period: ReportingPeriodRow,
        sourceName: string,
        parsed: TpggWorkbookParseResult,
        currentImportId: string | null,
    ): Promise<TpggImportContext> {
        const selectedPeriodYear = this.getSelectedPeriodYear(period)
        const filenameYear = this.extractYear(sourceName)
        const reportingYear =
            parsed.reportingYear
            ?? filenameYear
            ?? selectedPeriodYear
        const reportingDate =
            period.dateTo
            ?? period.dateFrom
            ?? `${reportingYear}-12-31`

        const [
            organizations,
            epguTypes,
            duplicateResult,
        ] = await Promise.all([
            this.loadOrganizations(),
            this.loadEpguTypes(reportingDate),
            this.pool.query(
                `
                SELECT id::text
                FROM reporting_import_runs
                WHERE period_id = $1
                  AND source_type = 'tpgg_workbook'
                  AND original_filename = $2
                  AND ($3::uuid IS NULL OR id <> $3::uuid)
                  AND status IN ('previewed', 'processing', 'completed')
                ORDER BY created_at DESC
                LIMIT 1;
                `,
                [periodId, sourceName, currentImportId],
            ),
        ])
        const aliases = buildOrganizationAliasIndex(organizations)
        const organizationBySourceName = new Map<string, OrganizationRow>()
        const unmatchedOrganizations: string[] = []
        const ambiguousOrganizations: string[] = []
        const sourceNames = new Map<string, string>()
        for (const entry of parsed.entries) {
            if (!sourceNames.has(entry.normalizedOrganizationName)) {
                sourceNames.set(
                    entry.normalizedOrganizationName,
                    entry.organizationName,
                )
            }
        }
        for (const [normalizedName, sourceOrganizationName] of sourceNames) {
            const matches = aliases.get(normalizedName) ?? []
            if (matches.length === 1) {
                organizationBySourceName.set(normalizedName, matches[0])
            } else if (matches.length > 1) {
                ambiguousOrganizations.push(sourceOrganizationName)
            } else {
                unmatchedOrganizations.push(sourceOrganizationName)
            }
        }

        const entriesByOrganizationOid = new Map<string, TpggPlanEntry[]>()
        for (const entry of parsed.entries) {
            const organization = organizationBySourceName.get(
                entry.normalizedOrganizationName,
            )
            if (!organization) continue
            const organizationEntries =
                entriesByOrganizationOid.get(organization.oid) ?? []
            organizationEntries.push(entry)
            entriesByOrganizationOid.set(
                organization.oid,
                organizationEntries,
            )
        }

        const warnings = [...parsed.warnings]
        if (reportingYear !== selectedPeriodYear) {
            warnings.push(
                `Год ТПГГ (${reportingYear}) не совпадает с годом выбранного периода (${selectedPeriodYear}).`,
            )
        }
        if (unmatchedOrganizations.length > 0) {
            warnings.push(
                `${unmatchedOrganizations.length} организаций из ТПГГ не входят в загруженный справочник МО; их объемы сохранены без привязки и не влияют на диагностику МО.`,
            )
        }
        if (ambiguousOrganizations.length > 0) {
            warnings.push(
                `${ambiguousOrganizations.length} наименований ТПГГ сопоставляются неоднозначно и не применены.`,
            )
        }
        if (epguTypes.length === 0) {
            warnings.push(
                'Не найдены действующие виды СЭМД с признаком доступности на ЕПГУ. Сначала загрузите справочник ЭМД/НСИ.',
            )
        }
        if (duplicateResult.rows[0]) {
            warnings.push(
                'Файл с таким именем уже загружался для выбранного периода.',
            )
        }

        return {
            reportingYear,
            selectedPeriodYear,
            organizationBySourceName,
            entriesByOrganizationOid,
            organizations,
            epguTypes,
            unmatchedOrganizations: unmatchedOrganizations.sort(
                (left, right) => left.localeCompare(right, 'ru'),
            ),
            ambiguousOrganizations: ambiguousOrganizations.sort(
                (left, right) => left.localeCompare(right, 'ru'),
            ),
            warnings,
        }
    }

    private buildRequirementCandidates(
        context: TpggImportContext,
        sourceName: string,
    ): RequirementCandidate[] {
        const candidates: RequirementCandidate[] = []
        for (const organization of context.organizations) {
            const organizationEntries =
                context.entriesByOrganizationOid.get(organization.oid) ?? []
            for (const semdType of context.epguTypes) {
                const evaluation = evaluateTpggSemdRule(
                    semdType.nsiTypeCode,
                    organizationEntries,
                )
                candidates.push({
                    organizationOid: organization.oid,
                    semdTypeId: semdType.id,
                    requirementStatus: evaluation.requirementStatus,
                    // Р3 (решение от 29.07): признак доступности в ГИС по паре МО × вид
                    // задаётся только осознанно. Прежде сюда писалась региональная эвристика
                    // «вид зарегистрирован кем-то в регионе ⇒ ГИС его умеет» — она перекрывала
                    // справочник МИАЦ и делала его бесполезным. Теперь региональные источники
                    // (справочник и факт РЭМД) подключаются каскадом в расчёте, а не
                    // записываются в требование. См. миграцию 0038.
                    gisAvailable: null,
                    reason: evaluation.reason,
                    metadata: {
                        source: 'tpgg_workbook',
                        sourceName,
                        inferencePolicy:
                            evaluation.rule?.zeroMeansNotRequired
                                ? 'positive_and_zero'
                                : 'positive_only',
                        nsiTypeCode: semdType.nsiTypeCode,
                        ruleTitle: evaluation.rule?.title ?? null,
                        sectionCodes:
                            evaluation.rule?.sectionCodes ?? [],
                        evidence: evaluation.evidence.map((entry) => ({
                            sheetName: entry.sheetName,
                            sheetCode: entry.sheetCode,
                            rowNumber: entry.rowNumber,
                            annualValue: entry.annualValue,
                            organizationName: entry.organizationName,
                        })),
                    },
                })
            }
        }
        return candidates
    }

    private buildPreview(
        parsed: TpggWorkbookParseResult,
        context: TpggImportContext,
        candidates: RequirementCandidate[],
    ): TpggWorkbookPreview {
        const uniqueSourceOrganizations = new Set(
            parsed.entries.map(
                (entry) => entry.normalizedOrganizationName,
            ),
        )
        const matchedOrganizations = new Set(
            context.organizationBySourceName.values(),
        )
        const counts = this.countRequirements(candidates)
        const parsedSheetCount = parsed.sheets.filter(
            (sheet) => sheet.status === 'parsed',
        ).length
        return {
            canConfirm:
                parsed.entries.length > 0
                && matchedOrganizations.size > 0
                && context.epguTypes.length > 0,
            reportingYear: context.reportingYear,
            selectedPeriodYear: context.selectedPeriodYear,
            sheets: parsed.sheets,
            totals: {
                sheetCount: parsed.sheets.length,
                parsedSheetCount,
                skippedSheetCount:
                    parsed.sheets.length - parsedSheetCount,
                planValueCount: parsed.entries.length,
                positivePlanValueCount: parsed.entries.filter(
                    (entry) => entry.annualValue > 0,
                ).length,
                uniqueSourceOrganizationCount:
                    uniqueSourceOrganizations.size,
                matchedOrganizationCount: matchedOrganizations.size,
                unmatchedOrganizationCount:
                    context.unmatchedOrganizations.length,
                ambiguousOrganizationCount:
                    context.ambiguousOrganizations.length,
                directoryOrganizationCount: context.organizations.length,
                epguTypeCount: context.epguTypes.length,
                supportedRuleTypeCount: context.epguTypes.filter(
                    (type) => TPGG_SEMD_RULES.some(
                        (rule) => rule.nsiTypeCode === type.nsiTypeCode,
                    ),
                ).length,
                requiredCount: counts.required,
                notRequiredCount: counts.notRequired,
                unknownCount: counts.unknown,
            },
            unmatchedOrganizations: context.unmatchedOrganizations,
            ambiguousOrganizations: context.ambiguousOrganizations,
            warnings: context.warnings,
        }
    }

    private async insertPlanValues(
        client: PoolClient,
        run: PreviewImportRow,
        parsed: TpggWorkbookParseResult,
        context: TpggImportContext,
    ): Promise<void> {
        for (const batch of this.chunk(parsed.entries, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((entry, index) => {
                const offset = index * 12
                const organization = context.organizationBySourceName.get(
                    entry.normalizedOrganizationName,
                )
                values.push(
                    run.periodId,
                    context.reportingYear,
                    organization?.oid ?? null,
                    entry.organizationName,
                    entry.normalizedOrganizationName,
                    entry.sheetName,
                    entry.sheetCode,
                    entry.annualValue,
                    JSON.stringify(entry.monthlyValues),
                    entry.rowNumber,
                    run.id,
                    JSON.stringify({
                        source: 'tpgg_workbook',
                        matched: Boolean(organization),
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
                    $${offset + 8},
                    $${offset + 9}::jsonb,
                    $${offset + 10},
                    $${offset + 11},
                    $${offset + 12}::jsonb
                )`
            })
            await client.query(
                `
                INSERT INTO reporting_tpgg_plan_values (
                    period_id,
                    reporting_year,
                    organization_oid,
                    organization_name,
                    normalized_organization_name,
                    sheet_name,
                    sheet_code,
                    annual_value,
                    monthly_values,
                    source_row_number,
                    source_import_id,
                    metadata
                )
                VALUES ${placeholders.join(',')};
                `,
                values,
            )
        }
    }

    private async upsertRequirements(
        client: PoolClient,
        run: PreviewImportRow,
        context: TpggImportContext,
        candidates: RequirementCandidate[],
    ): Promise<number> {
        const effectiveFrom = `${context.reportingYear}-01-01`
        const effectiveTo = `${context.reportingYear}-12-31`
        let persistedCount = 0
        for (const batch of this.chunk(candidates, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((candidate, index) => {
                const offset = index * 10
                values.push(
                    candidate.organizationOid,
                    candidate.semdTypeId,
                    candidate.requirementStatus,
                    candidate.gisAvailable,
                    candidate.reason,
                    run.originalFilename,
                    effectiveFrom,
                    effectiveTo,
                    run.id,
                    JSON.stringify(candidate.metadata),
                )
                return `(
                    $${offset + 1},
                    $${offset + 2},
                    $${offset + 3},
                    $${offset + 4},
                    $${offset + 5},
                    $${offset + 6},
                    $${offset + 7}::date,
                    $${offset + 8}::date,
                    $${offset + 9},
                    $${offset + 10}::jsonb
                )`
            })
            const result = await client.query(
                `
                INSERT INTO reporting_organization_semd_requirements (
                    organization_oid,
                    semd_type_id,
                    requirement_status,
                    gis_available,
                    reason,
                    source_name,
                    effective_from,
                    effective_to,
                    source_import_id,
                    metadata
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (
                    organization_oid,
                    semd_type_id,
                    effective_from
                )
                DO UPDATE SET
                    requirement_status = EXCLUDED.requirement_status,
                    gis_available = EXCLUDED.gis_available,
                    reason = EXCLUDED.reason,
                    source_name = EXCLUDED.source_name,
                    effective_to = EXCLUDED.effective_to,
                    source_import_id = EXCLUDED.source_import_id,
                    metadata = EXCLUDED.metadata,
                    updated_at = now()
                WHERE
                    reporting_organization_semd_requirements.metadata
                        ->> 'source' = 'tpgg_workbook'
                    OR btrim(
                        reporting_organization_semd_requirements.source_name
                    ) = '';
                `,
                values,
            )
            persistedCount += result.rowCount ?? 0
        }
        return persistedCount
    }

    private async loadOrganizations(): Promise<OrganizationRow[]> {
        const result = await this.pool.query(
            `
            SELECT organization.oid,
                   organization.official_full_name AS "officialFullName",
                   organization.official_short_name AS "officialShortName",
                   organization.common_name AS "commonName",
                   COALESCE(
                       jsonb_agg(alias.normalized_alias)
                           FILTER (WHERE alias.normalized_alias IS NOT NULL),
                       '[]'::jsonb
                   ) AS aliases
            FROM reporting_organizations organization
            LEFT JOIN reporting_organization_aliases alias
                ON alias.organization_oid = organization.oid
            WHERE organization.is_active = TRUE
            GROUP BY
                organization.oid,
                organization.official_full_name,
                organization.official_short_name,
                organization.common_name
            ORDER BY organization.oid;
            `,
        )
        return result.rows.map((row) => ({
            oid: String(row.oid),
            officialFullName: String(row.officialFullName ?? ''),
            officialShortName: String(row.officialShortName ?? ''),
            commonName: String(row.commonName ?? ''),
            aliases: Array.isArray(row.aliases)
                ? row.aliases.map((alias: unknown) => String(alias))
                : [],
        }))
    }

    private async loadEpguTypes(
        reportingDate: string,
    ): Promise<SemdTypeRow[]> {
        const result = await this.pool.query(
            `
            SELECT type.id::text,
                   type.nsi_oid AS "nsiTypeCode",
                   type.name
            FROM reporting_semd_types type
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS active_version_count,
                       BOOL_OR(version.epgu_available = TRUE)
                           AS epgu_available
                FROM reporting_semd_type_versions version
                WHERE version.semd_type_id = type.id
                  AND version.metadata->>'source' = 'emd_nsi_csv'
                  AND (
                      version.effective_from IS NULL
                      OR version.effective_from <= $1::date
                  )
                  AND (
                      version.effective_to IS NULL
                      OR version.effective_to >= $1::date
                  )
            ) version_state ON TRUE
            WHERE type.is_active = TRUE
              AND type.nsi_oid IS NOT NULL
              AND btrim(type.nsi_oid) <> ''
              AND (
                  CASE
                      WHEN version_state.active_version_count > 0
                          THEN version_state.epgu_available
                      ELSE type.epgu_available
                  END
              ) = TRUE
            ORDER BY type.nsi_oid;
            `,
            [reportingDate],
        )
        return result.rows.map((row) => ({
            id: String(row.id),
            nsiTypeCode: String(row.nsiTypeCode),
            name: String(row.name),
        }))
    }



    private countRequirements(
        candidates: RequirementCandidate[],
    ): {
        required: number
        notRequired: number
        unknown: number
    } {
        return {
            required: candidates.filter(
                (candidate) =>
                    candidate.requirementStatus === 'required',
            ).length,
            notRequired: candidates.filter(
                (candidate) =>
                    candidate.requirementStatus === 'not_required',
            ).length,
            unknown: candidates.filter(
                (candidate) =>
                    candidate.requirementStatus === 'unknown',
            ).length,
        }
    }

    private async getPeriod(
        periodId: string,
    ): Promise<ReportingPeriodRow> {
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

    private async getPreviewRun(
        userId: number,
        importId: string,
    ): Promise<PreviewImportRow> {
        return this.journal.getPreviewedRun(
            'tpgg_workbook',
            userId,
            this.cleanText(importId, 80),
            'Импорт ТПГГ не найден',
        )
    }

    private assertPreviewCanBeConfirmed(run: PreviewImportRow): void {
        if (run.status !== 'previewed') {
            throw new BadRequestException(
                'Этот импорт уже был обработан',
            )
        }
        const expiresAt = run.previewExpiresAt
            ? new Date(run.previewExpiresAt).getTime()
            : 0
        if (!expiresAt || expiresAt <= Date.now()) {
            throw new BadRequestException(
                'Срок действия предпросмотра истек. Загрузите файл повторно',
            )
        }
        const preview = run.details?.preview as
            | TpggWorkbookPreview
            | undefined
        if (!preview?.canConfirm) {
            throw new BadRequestException(
                'ТПГГ нельзя применить: проверьте предупреждения предпросмотра',
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

    private getSelectedPeriodYear(period: ReportingPeriodRow): number {
        const source = period.dateTo ?? period.dateFrom
        const year = source ? Number(source.slice(0, 4)) : NaN
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            throw new BadRequestException(
                'Для импорта ТПГГ у отчетного периода должна быть указана дата',
            )
        }
        return year
    }

    private extractYear(value: string): number | null {
        const match = String(value ?? '').match(/\b(20\d{2})\b/)
        return match ? Number(match[1]) : null
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
            : `${safe || 'tpgg'}.xlsx`
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

    private cleanText(
        value: unknown,
        maxLength: number = 1000,
    ): string {
        return String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLength)
    }

    private toIsoString(value: Date | string | null): string {
        if (!value) return ''
        return value instanceof Date
            ? value.toISOString()
            : new Date(value).toISOString()
    }

    private chunk<T>(items: T[], size: number): T[][] {
        const result: T[][] = []
        for (let index = 0; index < items.length; index += size) {
            result.push(items.slice(index, index + size))
        }
        return result
    }
}
