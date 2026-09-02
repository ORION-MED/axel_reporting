import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, randomUUID } from 'crypto'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import {
    loadApplicabilityMatrixWorkbook,
    type ApplicabilityMatrixParseResult,
    type ApplicabilityMatrixRule,
    type ApplicabilityRequirementGround,
    type ApplicabilityRequirementStatus,
} from './applicability-matrix-xlsx'
import { WorkbookImportJournal, type WorkbookImportRunRow } from './engine/workbook-import-journal'
import { PILOT_EPGU_REFERENCE_TYPES } from './pilot-calculation.types'
import { PilotIndicatorCalculationService } from './pilot-indicator-calculation.service'
import { type TpggPlanEntry } from './tpgg-workbook-parser'
import {
    buildMatrixOrganizationAliasIndex,
    resolveMatrixOrganizations,
} from './matrix-organization-alias-index'
import { evaluateTpggSemdRule } from './tpgg-semd-rules'
import {
    buildDirectoryOverride,
    directoryOidsForCondition,
    isEmptyOverride,
} from './applicability-directory-override'
import {
    buildMatrixBlockingErrors,
    buildMatrixOrphanedInclusionWarning,
    type OrphanedInclusionList,
} from './applicability-matrix-blocking'
import { OrganizationDirectoryImportService } from './organization-directory-import.service'

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const SOURCE_TYPE = 'applicability_matrix'
/**
 * Р10: уровень основания «утверждено госзаданием и(или) региональными актами региона»
 * в форме_1 («Приоритет обязательности 2») — именно он допускает подтверждение по ТПГГ.
 */
const TPGG_GROUND_LEVEL = 2
/**
 * Уровень основания «условия входимости, утверждённые Минздравом РФ» («Приоритет
 * обязательности 1» в форме_1). Практически выполняется наличием подразделения нужного
 * типа/вида в ФРМО.
 */
const MINZDRAV_ENTRY_GROUND_LEVEL = 1

/**
 * Вопрос 8.1, главный открытый. Методолог сказала, что приоритеты обязательности работают
 * «в режиме ИЛИ» — достаточно одного основания. Реализация от 28.07 работает иначе:
 * отсутствие объёма в ТПГГ снимает обязательность даже при выполненном основании уровня 1.
 *
 * Формально это расхождение, практически именно оно даёт её контрольный кейс: цитология
 * (код 121) имеет основания уровня 1 и 2, и при строгом ИЛИ хватило бы первого — вид стал бы
 * обязателен у 31 МО вместо ГБУ «КООД» и ГБУ «ШГБ», то есть вместо того, что она просила.
 *
 * `true` включает строгое ИЛИ. Держим `false` до письменного ответа методолога:
 * значение меняет знаменатель и цифры, уже показанные руководителю проекта.
 */
const GROUNDS_WORK_AS_STRICT_OR = false

/**
 * Вопрос 8.2. «Есть ФРМО, нет ФРМО — нас уже не интересует» (тайминг 07:05–12:38).
 * При буквальном прочтении для правил с основанием уровня 1 проверку подразделения
 * в ФРМО нужно отключить. Это меняет знаменатели, поэтому тоже ждёт подтверждения.
 */
const LEVEL_1_GROUND_SKIPS_FRMR_CHECK = false
const PREVIEW_TTL_HOURS = 24

/**
 * Р10: вердикт ТПГГ по правилу. `organizationAbsentFromTpgg` отличает надёжный вывод
 * («МО есть в терпрограмме, но объёма по этому профилю нет») от вывода на допущении
 * («МО вообще нет в файле ТПГГ» — считаем, что учреждение финансируется вне ОМС).
 * Второй случай должен быть виден методологу, а не применяться молча.
 */
interface TpggVerdict {
    verdict: 'required' | 'not_required' | 'unknown'
    organizationAbsentFromTpgg?: boolean
}

interface RuleEvaluation {
    verdict: 'matched' | 'not_matched' | 'unknown'
    organizationAbsentFromTpgg?: boolean
}
const MAX_STORED_IMPORT_SIZE = Number(process.env.REPORTING_IMPORT_MAX_FILE_SIZE) || 25 * 1024 * 1024
const INSERT_BATCH_SIZE = 250


interface PeriodRow {
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
    /**
     * Синонимы, намеренно закреплённые за несколькими МО сразу (`alias_kind = 'group'`).
     * У методолога это «Санаторий» — одно слово в перечне на две организации.
     */
    groupAliases: string[]
}

interface SubdivisionRow {
    organizationOid: string
    subdivisionType: string
    subdivisionKind: string
    subdivisionName: string
}

interface SemdTypeRow {
    id: string
    nsiTypeCode: string
    name: string
}

interface PreparedRule extends ApplicabilityMatrixRule {
    semdTypeId: string
    matchedOrganizationOids: Set<string>
    /**
     * Перечень МО в `matchedOrganizationOids` пришёл из справочника признаков МО,
     * а не из разбора комментария методолога. Тогда пустой комментарий — не повод
     * считать условие неопределённым: перечень известен, просто из другого источника.
     */
    organizationOidsFromDirectory: boolean
}

interface RequirementCandidate {
    organizationOid: string
    semdTypeId: string
    semdTypeCode: string
    requirementStatus: ApplicabilityRequirementStatus
    reason: string
    matchedRules: PreparedRule[]
    metadata: Record<string, unknown>
}

interface ImportContext {
    period: PeriodRow
    reportingDate: string
    reportingYear: number
    organizations: OrganizationRow[]
    subdivisionsByOrganization: Map<string, SubdivisionRow[]>
    /** Р10: объёмы ТПГГ по МО — альтернативное основание, когда ФРМО неактуален. */
    tpggEntriesByOrganization: Map<string, TpggPlanEntry[]>
    epguTypes: SemdTypeRow[]
    /**
     * Виды, по которым материализуются требования: Перечень № 5пр плюс виды,
     * доступные на ЕПГУ. Шире, чем `epguTypes`: показателю 27 нужен план по всем
     * 145 видам Перечня, а не по 36 видам показателя 6.1.3.2.7.
     */
    applicableTypes: SemdTypeRow[]
    matchedRules: PreparedRule[]
    unmatchedSemdTypeCodes: string[]
    missingMatrixSemdTypeCodes: string[]
    unmatchedOrganizationNames: string[]
    ambiguousOrganizationNames: string[]
    matchedExternalOrganizationOids: Set<string>
    organizationWithoutSubdivisionCount: number
    /** Где справочник признаков МО разошёлся с перечнем из комментария методолога. */
    directoryOverrides: ApplicabilityDirectoryOverrideSummary[]
    directoryLoaded: boolean
}

/**
 * Расхождение по одному правилу: справочник признаков МО главнее комментария,
 * но подменять перечень молча нельзя — методолог должна увидеть, что именно разошлось.
 */
export interface ApplicabilityDirectoryOverrideSummary {
    semdTypeCode: string
    documentName: string
    conditionCode: string
    conditionText: string
    sourceRowNumber: number
    /** МО, которых нет в комментарии, но справочник их подтверждает. */
    addedOrganizations: string[]
    /** МО из комментария, которых справочник не подтверждает. */
    removedOrganizations: string[]
}

export interface ApplicabilityMatrixTypeSummary {
    semdTypeCode: string
    documentName: string
    ruleCount: number
    requiredOrganizationCount: number
    notRequiredOrganizationCount: number
    unknownOrganizationCount: number
}

export interface ApplicabilityMatrixPreview {
    canConfirm: boolean
    sheetName: string
    totals: {
        sourceRuleCount: number
        normalizedRuleCount: number
        ignoredRedundantRuleCount: number
        overriddenRuleCount: number
        uniqueSemdTypeCount: number
        matchedSemdTypeCount: number
        epguTypeCount: number
        directoryOrganizationCount: number
        organizationWithoutSubdivisionCount: number
        conditionRuleCount: number
        matchedExternalOrganizationCount: number
        requirementCount: number
        requiredCount: number
        notRequiredCount: number
        unknownCount: number
        finalOrganizationCount: number
        preliminaryOrganizationCount: number
    }
    typeSummaries: ApplicabilityMatrixTypeSummary[]
    ignoredRedundantRows: number[]
    overriddenRows: number[]
    /** Виды из формы, известные справочнику, но недоступные гражданам на ЕПГУ. */
    unmatchedSemdTypeCodes: string[]
    /** Коды, которых нет в справочнике видов СЭМД вообще, — опечатки. */
    unknownSemdTypeCodes: string[]
    missingMatrixSemdTypeCodes: string[]
    unmatchedOrganizationNames: string[]
    ambiguousOrganizationNames: string[]
    /** Справочник признаков МО загружен и перебил перечни из комментариев. */
    directoryLoaded: boolean
    directoryOverrides: ApplicabilityDirectoryOverrideSummary[]
    blockingErrors: string[]
    warnings: string[]
}

export interface ApplicabilityMatrixPreviewResult {
    importId: string
    periodId: string
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: ApplicabilityMatrixPreview
}

export interface ApplicabilityMatrixConfirmResult {
    importId: string
    periodId: string
    sourceName: string
    normalizedRuleCount: number
    semdTypeCount: number
    organizationCount: number
    requirementCount: number
    requiredCount: number
    notRequiredCount: number
    unknownCount: number
    finalOrganizationCount: number
    recalculated: boolean
    warnings: string[]
}

@Injectable()
export class ApplicabilityMatrixImportService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly journal: WorkbookImportJournal,
        private readonly pilotCalculation: PilotIndicatorCalculationService,
        private readonly organizationDirectory: OrganizationDirectoryImportService,
    ) {}

    async createPreview(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
    ): Promise<ApplicabilityMatrixPreviewResult> {
        const cleanPeriodId = this.cleanText(periodId, 80)
        if (!cleanPeriodId) throw new BadRequestException('Укажите отчетный период')
        if (!fileBuffer.length) throw new BadRequestException('Файл матрицы применимости пуст')
        if (fileBuffer.length > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Файл превышает максимально допустимый размер')
        }

        const sourceName = this.cleanText(originalFilename, 256) || 'applicability-matrix.xlsx'
        const parsed = await loadApplicabilityMatrixWorkbook(fileBuffer)
        const { preview } = await this.buildPreview(cleanPeriodId, parsed)
        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const previewExpiresAt = new Date(Date.now() + PREVIEW_TTL_HOURS * 60 * 60 * 1000)
        const objectKey = `reporting/reference/applicability-matrix/${cleanPeriodId}/${importId}/${this.buildObjectFilename(sourceName)}`

        await this.journal.createPreviewedRun({
            importId,
            periodId: cleanPeriodId,
            sourceType: SOURCE_TYPE,
            importMode: 'replace',
            sourceName,
            fileBuffer,
            contentType: CONTENT_TYPE,
            objectKey,
            fileSha256,
            organizationRows: preview.totals.directoryOrganizationCount,
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

    async getPreview(userId: number, importId: string): Promise<ApplicabilityMatrixPreviewResult> {
        const run = await this.getPreviewRun(userId, importId)
        const preview = run.details?.preview as ApplicabilityMatrixPreview | undefined
        if (!preview) throw new NotFoundException('Предпросмотр матрицы применимости не найден')
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
    ): Promise<ApplicabilityMatrixConfirmResult> {
        const run = await this.getPreviewRun(userId, importId)
        this.assertPreviewCanBeConfirmed(run)
        const fileBuffer = await this.readStoredImport(run.objectKey, run.fileSize)
        const storedHash = createHash('sha256').update(fileBuffer).digest('hex')
        if (storedHash !== run.fileSha256) {
            throw new BadRequestException('Контрольная сумма сохраненного файла не совпадает')
        }

        const parsed = await loadApplicabilityMatrixWorkbook(fileBuffer)
        const { preview, context, candidates } = await this.buildPreview(run.periodId, parsed)
        if (!preview.canConfirm) {
            throw new BadRequestException(
                this.matrixBlockingMessage(preview),
            )
        }

        let transitionedToProcessing = false
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            const transition = await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'processing', confirmed_at = now(), error_message = ''
                WHERE id = $1
                  AND created_by = $2
                  AND source_type = $3
                  AND status = 'previewed'
                  AND preview_expires_at > now()
                RETURNING id;
                `,
                [run.id, userId, SOURCE_TYPE],
            )
            if (transition.rowCount !== 1) {
                throw new BadRequestException('Предпросмотр уже обработан или срок его действия истек')
            }
            transitionedToProcessing = true
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));`,
                ['reporting_applicability_matrix', run.periodId],
            )

            await this.insertRules(client, run.id, context.matchedRules)
            const requirementCount = await this.upsertRequirements(
                client,
                run,
                context.reportingYear,
                candidates,
            )
            await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'completed',
                    organization_rows = $2,
                    organization_values_count = $3,
                    warnings = $4::jsonb,
                    details = $5::jsonb,
                    error_message = '',
                    completed_at = now()
                WHERE id = $1;
                `,
                [
                    run.id,
                    context.organizations.length,
                    requirementCount,
                    JSON.stringify(preview.warnings),
                    JSON.stringify({ preview, requirementCount }),
                ],
            )
            await client.query('COMMIT')
        } catch (err) {
            await client.query('ROLLBACK')
            if (transitionedToProcessing) await this.markImportFailed(run.id, err)
            throw err
        } finally {
            client.release()
        }

        let recalculated = true
        const warnings = [...preview.warnings]
        try {
            await this.pilotCalculation.recalculate(run.periodId)
        } catch (err) {
            recalculated = false
            warnings.push(
                `Матрица сохранена, но автоматический пересчет не завершен: ${this.cleanText(err instanceof Error ? err.message : err, 500)}`,
            )
            await this.pool.query(
                `UPDATE reporting_import_runs SET warnings = $2::jsonb WHERE id = $1;`,
                [run.id, JSON.stringify(warnings)],
            )
        }

        return {
            importId: run.id,
            periodId: run.periodId,
            sourceName: run.originalFilename,
            normalizedRuleCount: preview.totals.normalizedRuleCount,
            semdTypeCount: preview.totals.matchedSemdTypeCount,
            organizationCount: preview.totals.directoryOrganizationCount,
            requirementCount: preview.totals.requirementCount,
            requiredCount: preview.totals.requiredCount,
            notRequiredCount: preview.totals.notRequiredCount,
            unknownCount: preview.totals.unknownCount,
            finalOrganizationCount: preview.totals.finalOrganizationCount,
            recalculated,
            warnings,
        }
    }

    async cancelPreview(userId: number, importId: string): Promise<{ importId: string; status: 'cancelled' }> {
        return this.journal.cancelPreview(SOURCE_TYPE, userId, this.cleanText(importId, 80))
    }

    private async buildPreview(
        periodId: string,
        parsed: ApplicabilityMatrixParseResult,
    ): Promise<{
        preview: ApplicabilityMatrixPreview
        context: ImportContext
        candidates: RequirementCandidate[]
    }> {
        const period = await this.getPeriod(periodId)
        const reportingDate = period.dateTo ?? period.dateFrom ?? `${new Date().getFullYear()}-12-31`
        const reportingYear = Number(reportingDate.slice(0, 4))
        const [
            organizations,
            subdivisions,
            epguTypes,
            applicableTypes,
            knownTypeCodes,
            tpggEntriesByOrganization,
            organizationDirectory,
        ] = await Promise.all([
            this.loadOrganizations(),
            this.loadSubdivisions(),
            this.loadEpguTypes(reportingDate),
            this.loadApplicableTypes(reportingDate),
            this.loadKnownTypeCodes(),
            this.loadTpggEntriesByOrganization(reportingYear),
            this.organizationDirectory.loadDirectory(),
        ])
        const subdivisionsByOrganization = new Map<string, SubdivisionRow[]>()
        for (const subdivision of subdivisions) {
            const rows = subdivisionsByOrganization.get(subdivision.organizationOid) ?? []
            rows.push(subdivision)
            subdivisionsByOrganization.set(subdivision.organizationOid, rows)
        }

        const organizationAliasIndex = buildMatrixOrganizationAliasIndex(organizations)
        const organizationNameByOid = new Map(
            organizations.map((row) => [row.oid, row.officialShortName || row.officialFullName]),
        )
        // Сопоставление идёт по всем применимым видам, а не только по ЕПГУ-видам.
        // До 18.08.2026 карта строилась из `epguTypes`, и правила остальных 109 видов
        // Перечня молча отбрасывались строкой `if (!semdType) continue` ниже — при том
        // что предупреждение обещало «их правила сохранены». Из-за этого у показателя 27
        // не было плана: обязательность существовала только для 36 видов из 145.
        const typeByCode = new Map(applicableTypes.map((type) => [type.nsiTypeCode, type]))
        // Код формы, которого нет среди применимых видов, — это два разных случая, и раньше
        // они были свалены в один блокирующий:
        //   • вида нет в справочнике видов СЭМД вообще — опечатка, применять нельзя;
        //   • вид есть, но ни в Перечне № 5пр, ни на ЕПГУ — правило описано впрок,
        //     ни в один показатель пока не входит.
        const unmatchedSemdTypeCodes = parsed.uniqueSemdTypeCodes.filter(
            (code) => !typeByCode.has(code) && knownTypeCodes.has(code),
        )
        const unknownSemdTypeCodes = parsed.uniqueSemdTypeCodes.filter(
            (code) => !typeByCode.has(code) && !knownTypeCodes.has(code),
        )
        const missingMatrixSemdTypeCodes = epguTypes
            .map((type) => type.nsiTypeCode)
            .filter((code) => !parsed.uniqueSemdTypeCodes.includes(code))
        const unmatchedOrganizationNames = new Set<string>()
        /**
         * Те же несопоставленные имена, но из условий-исключений («если МО НЕ …»).
         * Собраны отдельно, потому что цена ошибки другая: в перечне-включении
         * нераспознанное имя сужает состав МО и это видно по цифрам, а в исключении
         * оно означает, что МО осталась обязанной — то есть правка методолога
         * просто не сработала, а расчёт выглядит прежним.
         */
        const unmatchedExclusionOrganizationNames = new Set<string>()
        /**
         * Наименование из условия «если МО - …» → коды видов СЭМД, чьи правила на него
         * ссылаются, но ни одной МО за ним не нашлось. Такой перечень адресован никому:
         * пока «условно» = «не определено», это видно по цифрам, а под флагом
         * `CONDITIONAL_STATUS_IS_REQUIRED` вид молча станет не обязательным у всех.
         */
        const orphanedInclusionSemdCodes = new Map<string, Set<string>>()
        const ambiguousOrganizationNames = new Set<string>()
        const matchedExternalOrganizationOids = new Set<string>()
        const matchedRules: PreparedRule[] = []

        const directoryOverrides: ApplicabilityDirectoryOverrideSummary[] = []
        /** Строки формы, для которых перечень МО дал справочник признаков МО. */
        const rowsCoveredByDirectory = new Set<number>()

        for (const rule of parsed.rules) {
            const semdType = typeByCode.get(rule.semdTypeCode)
            if (!semdType) continue
            const commentOrganizationOids = new Set<string>()
            for (const organizationName of rule.organizationNames) {
                // «Санаторий» — одно имя на две МО, и это объявлено групповым синонимом;
                // всё прочее, совпавшее с несколькими, по-прежнему неоднозначно.
                const match = resolveMatrixOrganizations(organizationAliasIndex, organizationName)
                if (match.status === 'single' || match.status === 'group') {
                    for (const organization of match.organizations) {
                        commentOrganizationOids.add(organization.oid)
                        matchedExternalOrganizationOids.add(organization.oid)
                    }
                } else if (match.status === 'ambiguous') {
                    ambiguousOrganizationNames.add(organizationName)
                } else {
                    unmatchedOrganizationNames.add(organizationName)
                    if (rule.conditionExcludesOrganizations) {
                        unmatchedExclusionOrganizationNames.add(organizationName)
                    }
                }
            }
            // Справочник признаков МО главнее комментария методолога — см.
            // applicability-directory-override.ts. Перечень из комментария остаётся
            // в правиле (organizationNames) для аудита, а расхождение уезжает
            // в предпросмотр, а не применяется молча.
            const directoryOids = directoryOidsForCondition(rule.conditionCode, organizationDirectory)
            /**
             * Перечень-включение остался без единой МО.
             *
             * Проверяется по всему правилу, а не по каждому имени: «если МО - КООД,
             * Санаторий» с одним найденным адресатом работает, пусть и уже, — сужение
             * видно по цифрам предпросмотра. Пусто — другое дело: правило адресовано
             * никому.
             *
             * Условие намеренно не смотрит на `conditionCode`. При выключенном
             * `CONDITIONAL_STATUS_IS_REQUIRED` парсер уводит такие строки в `custom`,
             * и проверка по коду молчала бы ровно там, где предупреждение нужнее всего —
             * до включения флага, пока состав перечней ещё можно поправить.
             *
             * Правила, чей перечень пришёл из справочника признаков МО
             * (`directoryOids`), сюда не попадают: имена из комментария там не
             * используются вовсе, и их несопоставленность ни на что не влияет.
             */
            if (
                directoryOids === null
                && !rule.conditionExcludesOrganizations
                && rule.organizationNames.length > 0
                && commentOrganizationOids.size === 0
            ) {
                for (const organizationName of rule.organizationNames) {
                    const codes = orphanedInclusionSemdCodes.get(organizationName)
                        ?? new Set<string>()
                    codes.add(rule.semdTypeCode)
                    orphanedInclusionSemdCodes.set(organizationName, codes)
                }
            }
            let matchedOrganizationOids = commentOrganizationOids
            if (directoryOids) {
                const override = buildDirectoryOverride(commentOrganizationOids, directoryOids)
                matchedOrganizationOids = directoryOids
                for (const oid of directoryOids) matchedExternalOrganizationOids.add(oid)
                if (!isEmptyOverride(override)) {
                    directoryOverrides.push({
                        semdTypeCode: rule.semdTypeCode,
                        documentName: rule.documentName,
                        conditionCode: rule.conditionCode,
                        conditionText: rule.conditionText,
                        sourceRowNumber: rule.sourceRowNumber,
                        addedOrganizations: override.added.map(
                            (oid) => organizationNameByOid.get(oid) ?? oid,
                        ),
                        removedOrganizations: override.removed.map(
                            (oid) => organizationNameByOid.get(oid) ?? oid,
                        ),
                    })
                }
            }

            if (directoryOids) rowsCoveredByDirectory.add(rule.sourceRowNumber)

            matchedRules.push({
                ...rule,
                semdTypeId: semdType.id,
                matchedOrganizationOids,
                organizationOidsFromDirectory: directoryOids !== null,
            })
        }

        const orphanedInclusionLists: OrphanedInclusionList[] = [...orphanedInclusionSemdCodes]
            .map(([organizationName, codes]) => ({
                organizationName,
                // Коды видов — числа, и строковая сортировка дала бы «357, 48, 50».
                semdTypeCodes: [...codes].sort((a, b) => Number(a) - Number(b)),
            }))
            .sort((a, b) => a.organizationName.localeCompare(b.organizationName, 'ru'))

        const context: ImportContext = {
            period,
            reportingDate,
            reportingYear: Number.isInteger(reportingYear) ? reportingYear : new Date().getFullYear(),
            organizations,
            subdivisionsByOrganization,
            tpggEntriesByOrganization,
            epguTypes,
            applicableTypes,
            matchedRules,
            unmatchedSemdTypeCodes,
            missingMatrixSemdTypeCodes,
            unmatchedOrganizationNames: [...unmatchedOrganizationNames].sort((a, b) => a.localeCompare(b, 'ru')),
            ambiguousOrganizationNames: [...ambiguousOrganizationNames].sort((a, b) => a.localeCompare(b, 'ru')),
            matchedExternalOrganizationOids,
            organizationWithoutSubdivisionCount: organizations.filter(
                (organization) => (subdivisionsByOrganization.get(organization.oid)?.length ?? 0) === 0,
            ).length,
            directoryOverrides,
            directoryLoaded: organizationDirectory.size > 0,
        }
        const candidates = this.buildRequirementCandidates(context)
        const requiredCount = candidates.filter((item) => item.requirementStatus === 'required').length
        const notRequiredCount = candidates.filter((item) => item.requirementStatus === 'not_required').length
        const unknownCount = candidates.filter((item) => item.requirementStatus === 'unknown').length
        // «Окончательно» и «предварительно» — про готовность показателя 6.1.3.2.7,
        // поэтому считаются по его 36 видам, а не по всем 145. Иначе с 18.08.2026,
        // когда применимость стала материализоваться по всему Перечню, все 37 МО
        // разом стали бы предварительными из-за видов, к 6.1.3.2.7 не относящихся.
        const epguTypeIds = new Set(epguTypes.map((type) => type.id))
        const finalOrganizationCount = organizations.filter((organization) => (
            candidates.filter((item) => (
                item.organizationOid === organization.oid
                && item.requirementStatus === 'unknown'
                && epguTypeIds.has(item.semdTypeId)
            )).length === 0
        )).length
        const typeSummaries = epguTypes.map((type) => {
            const typeCandidates = candidates.filter((candidate) => candidate.semdTypeId === type.id)
            const typeRules = matchedRules.filter((rule) => rule.semdTypeId === type.id)
            return {
                semdTypeCode: type.nsiTypeCode,
                documentName: typeRules[0]?.documentName || type.name,
                ruleCount: typeRules.length,
                requiredOrganizationCount: typeCandidates.filter((item) => item.requirementStatus === 'required').length,
                notRequiredOrganizationCount: typeCandidates.filter((item) => item.requirementStatus === 'not_required').length,
                unknownOrganizationCount: typeCandidates.filter((item) => item.requirementStatus === 'unknown').length,
            }
        }).sort((left, right) => Number(left.semdTypeCode) - Number(right.semdTypeCode))

        const warnings = [...parsed.warnings]
        // Условие требует перечня МО, а в комментарии формы_1 наименований нет.
        // Предупреждаем только о тех строках, которые не закрыл справочник признаков МО:
        // для вида 68 методолог сознательно оставила комментарий «Перечень МО определяется
        // по справочнику признаков МО», и предупреждение по такой строке — ложная тревога.
        const uncoveredRows = parsed.rowsWithoutOrganizationList.filter(
            (rowNumber) => !rowsCoveredByDirectory.has(rowNumber),
        )
        if (uncoveredRows.length > 0) {
            warnings.push(
                `Перечень МО не найден ни в комментарии, ни в справочнике признаков МО — `
                + `строки формы: ${uncoveredRows.join(', ')}. Условие останется «не определено».`,
            )
        }
        // Сверяется с составом справочника ЕПГУ, а не с целью показателя: цель по
        // Соглашению 35, а справочники 1253/1520 дают 36 видов (В-05, 20.08.2026).
        if (epguTypes.length !== PILOT_EPGU_REFERENCE_TYPES) {
            warnings.push(`В справочнике ЕПГУ найдено ${epguTypes.length} видов вместо ожидаемых ${PILOT_EPGU_REFERENCE_TYPES}.`)
        }
        if (unmatchedSemdTypeCodes.length > 0) {
            warnings.push(
                `${unmatchedSemdTypeCodes.length} видов СЭМД из формы не входят ни в Перечень `
                + '№ 5пр, ни в число доступных на ЕПГУ — их правила не применяются ни в одном '
                + 'из показателей.',
            )
        }
        const nonEpguApplicableTypeCount = applicableTypes.length - epguTypes.length
        if (nonEpguApplicableTypeCount > 0) {
            warnings.push(
                `Применимость рассчитана по ${applicableTypes.length} видам: `
                + `${epguTypes.length} видов показателя 6.1.3.2.7 и ещё `
                + `${nonEpguApplicableTypeCount} видов Перечня № 5пр — они дают плановое `
                + 'значение показателю «Виды СЭМД в РЭМД».',
            )
        }
        if (unknownSemdTypeCodes.length > 0) {
            warnings.push(
                `Кодов нет в справочнике видов СЭМД: ${unknownSemdTypeCodes.join(', ')}.`,
            )
        }
        if (missingMatrixSemdTypeCodes.length > 0) {
            warnings.push(`В форме нет правил для ЕПГУ-кодов: ${missingMatrixSemdTypeCodes.join(', ')}.`)
        }
        if (unmatchedOrganizationNames.size > 0) {
            // Имена перечислены поимённо намеренно. Прежний текст («N наименований …
            // для демонстрации они пропущены») читался как безобидная мелочь, и на нём
            // одиннадцать правил формы от 18.08 остались без адресата незамеченными.
            warnings.push(
                `${unmatchedOrganizationNames.size} наименований МО из формы не сопоставлены `
                + `со справочником и в правилах пропущены: `
                + `${[...unmatchedOrganizationNames].join(', ')}.`,
            )
        }
        const orphanedInclusionWarning = buildMatrixOrphanedInclusionWarning(orphanedInclusionLists)
        if (orphanedInclusionWarning) warnings.push(orphanedInclusionWarning)
        if (ambiguousOrganizationNames.size > 0) {
            warnings.push(`${ambiguousOrganizationNames.size} наименований МО сопоставляются неоднозначно и пропущены.`)
        }
        if (context.organizationWithoutSubdivisionCount > 0) {
            warnings.push(`${context.organizationWithoutSubdivisionCount} МО не имеют подразделений в текущей выгрузке ФРМО.`)
        }
        if (unknownCount > 0) {
            warnings.push(`Для ${unknownCount} пар МО × СЭМД осталось значение «не определено».`)
        }
        // Справочник признаков МО главнее комментариев формы_1, но подмена перечня
        // обязана быть видимой: без этого методолог правит матрицу и не понимает,
        // почему её список не сработал.
        if (context.directoryLoaded && context.directoryOverrides.length > 0) {
            const affectedTypes = new Set(context.directoryOverrides.map((item) => item.semdTypeCode))
            warnings.push(
                `Перечни МО по ${context.directoryOverrides.length} правилам взяты из справочника признаков МО, `
                + `а не из комментариев формы_1 (затронуто видов СЭМД: ${affectedTypes.size}). `
                + 'Расхождения перечислены в блоке «Справочник признаков МО».',
            )
        }
        // Р10: страховка от обрезанной выгрузки ТПГГ. Отсутствие МО в терпрограмме снимает
        // обязательность по видам с основанием «госзадание», поэтому неполный файл молча
        // занизил бы знаменатели. Покрытие видно в окне предпросмотра до подтверждения.
        const tpggCoveredOrganizationCount = organizations.filter(
            (organization) => (
                (context.tpggEntriesByOrganization.get(organization.oid)?.length ?? 0) > 0
            ),
        ).length
        if (organizations.length > 0) {
            if (tpggCoveredOrganizationCount === 0) {
                warnings.push(
                    'ТПГГ не загружена или не сопоставилась ни с одной МО: применимость видов '
                    + 'с основанием «утверждено госзаданием» считается только по ФРМО. '
                    + 'Загрузите терпрограмму до подтверждения матрицы.',
                )
            } else {
                warnings.push(
                    `В ТПГГ найдено ${tpggCoveredOrganizationCount} из ${organizations.length} МО. `
                    + `Для остальных ${organizations.length - tpggCoveredOrganizationCount} `
                    + 'отсутствие в терпрограмме трактуется как «утверждённого объёма нет» '
                    + 'и снимает обязательность по видам с основанием «госзадание».',
                )
            }
        }

        const blockingErrors = buildMatrixBlockingErrors({
            organizationCount: organizations.length,
            epguTypeCount: epguTypes.length,
            expectedEpguTypeCount: PILOT_EPGU_REFERENCE_TYPES,
            unknownSemdTypeCodes,
            missingMatrixSemdTypeCodes,
            directoryLoaded: context.directoryLoaded,
            unmatchedExclusionOrganizationNames: [...unmatchedExclusionOrganizationNames],
        })
        const canConfirm = blockingErrors.length === 0
        return {
            context,
            candidates,
            preview: {
                canConfirm,
                sheetName: parsed.sheetName,
                totals: {
                    sourceRuleCount: parsed.sourceRuleCount,
                    normalizedRuleCount: matchedRules.length,
                    ignoredRedundantRuleCount: parsed.ignoredRedundantRows.length,
                    overriddenRuleCount: parsed.overriddenRows.length,
                    uniqueSemdTypeCount: parsed.uniqueSemdTypeCodes.length,
                    matchedSemdTypeCount: new Set(matchedRules.map((rule) => rule.semdTypeId)).size,
                    epguTypeCount: epguTypes.length,
                    directoryOrganizationCount: organizations.length,
                    organizationWithoutSubdivisionCount: context.organizationWithoutSubdivisionCount,
                    conditionRuleCount: matchedRules.filter((rule) => rule.conditionCode !== 'none').length,
                    matchedExternalOrganizationCount: matchedExternalOrganizationOids.size,
                    requirementCount: candidates.length,
                    requiredCount,
                    notRequiredCount,
                    unknownCount,
                    finalOrganizationCount,
                    preliminaryOrganizationCount: organizations.length - finalOrganizationCount,
                },
                typeSummaries,
                ignoredRedundantRows: parsed.ignoredRedundantRows,
                overriddenRows: parsed.overriddenRows,
                unmatchedSemdTypeCodes,
                unknownSemdTypeCodes,
                missingMatrixSemdTypeCodes,
                unmatchedOrganizationNames: context.unmatchedOrganizationNames,
                ambiguousOrganizationNames: context.ambiguousOrganizationNames,
                directoryLoaded: context.directoryLoaded,
                directoryOverrides: context.directoryOverrides,
                blockingErrors,
                warnings,
            },
        }
    }

    private buildRequirementCandidates(context: ImportContext): RequirementCandidate[] {
        const rulesByTypeId = new Map<string, PreparedRule[]>()
        for (const rule of context.matchedRules) {
            const rules = rulesByTypeId.get(rule.semdTypeId) ?? []
            rules.push(rule)
            rulesByTypeId.set(rule.semdTypeId, rules)
        }

        const candidates: RequirementCandidate[] = []
        for (const organization of context.organizations) {
            const subdivisions = context.subdivisionsByOrganization.get(organization.oid) ?? []
            for (const semdType of context.applicableTypes) {
                const rules = rulesByTypeId.get(semdType.id) ?? []
                if (rules.length === 0) {
                    candidates.push({
                        organizationOid: organization.oid,
                        semdTypeId: semdType.id,
                        semdTypeCode: semdType.nsiTypeCode,
                        requirementStatus: 'unknown',
                        reason: 'В загруженной матрице нет правила для этого вида СЭМД.',
                        matchedRules: [],
                        metadata: { source: SOURCE_TYPE, missingRule: true },
                    })
                    continue
                }

                const matched: PreparedRule[] = []
                let hasUnknownCondition = false
                // Р10: хотя бы одно правило сняло обязательность из-за того, что МО
                // отсутствует в файле ТПГГ — это допущение, его надо показать методологу.
                let organizationAbsentFromTpgg = false
                for (const rule of rules) {
                    const evaluation = this.evaluateRule(
                        rule,
                        organization,
                        subdivisions,
                        context.tpggEntriesByOrganization,
                    )
                    if (evaluation.verdict === 'matched') matched.push(rule)
                    if (evaluation.verdict === 'unknown') hasUnknownCondition = true
                    if (evaluation.organizationAbsentFromTpgg) {
                        organizationAbsentFromTpgg = true
                    }
                }
                const requiredRules = matched.filter((rule) => rule.requirementStatus === 'required')
                const unknownRules = matched.filter((rule) => rule.requirementStatus === 'unknown')
                const notRequiredRules = matched.filter((rule) => rule.requirementStatus === 'not_required')
                let requirementStatus: ApplicabilityRequirementStatus
                let reason: string
                if (requiredRules.length > 0) {
                    requirementStatus = 'required'
                    reason = this.buildReason('Обязателен', requiredRules)
                } else if (hasUnknownCondition || unknownRules.length > 0) {
                    requirementStatus = 'unknown'
                    reason = 'Условие матрицы не удалось определить автоматически.'
                } else if (notRequiredRules.length > 0) {
                    requirementStatus = 'not_required'
                    reason = this.buildReason('Не обязателен', notRequiredRules)
                } else {
                    requirementStatus = 'not_required'
                    reason = 'Условия обязательности из матрицы для этой МО не выполнены.'
                }
                const evidenceRules = requirementStatus === 'required'
                    ? requiredRules
                    : requirementStatus === 'not_required'
                        ? notRequiredRules
                        : matched
                candidates.push({
                    organizationOid: organization.oid,
                    semdTypeId: semdType.id,
                    semdTypeCode: semdType.nsiTypeCode,
                    requirementStatus,
                    reason,
                    matchedRules: evidenceRules,
                    metadata: {
                        source: SOURCE_TYPE,
                        closedWorldDefault: matched.length === 0 && !hasUnknownCondition,
                        sourceRows: evidenceRules.map((rule) => rule.sourceRowNumber),
                        conditionCodes: [...new Set(evidenceRules.map((rule) => rule.conditionCode))],
                        // Р10: помечаем только фактически снятую обязательность — по ней
                        // расчёт порождает диагностическую причину для подтверждения.
                        ...(organizationAbsentFromTpgg && requirementStatus === 'not_required'
                            ? { tpggOrganizationAbsent: true }
                            : {}),
                        // Р9: основания обязательности («Приоритет обязательности 1..4» формы_1).
                        // По сработавшим правилам их 1–2; несколько оснований трактуются как ИЛИ.
                        grounds: this.collectGrounds(evidenceRules),
                    },
                })
            }
        }
        return candidates
    }

    /**
     * Р10 (пояснение методолога от 28.07): основания обязательности соединяются через ИЛИ.
     * Если в ФРМО/ФРМР есть нужный тип/вид подразделения — вид обязателен. Но МО иногда не
     * успевают актуализировать ФРМО, поэтому при отсутствии подразделения срабатывает второе
     * основание: утверждённый объём медицинской помощи в ТПГГ (приоритет обязательности 2).
     */
    private resolveTpggVerdict(
        rule: PreparedRule,
        organization: OrganizationRow,
        tpggEntriesByOrganization: Map<string, TpggPlanEntry[]>,
    ): TpggVerdict {
        const hasStateTaskGround = (rule.grounds ?? []).some(
            (ground) => ground.level === TPGG_GROUND_LEVEL,
        )
        if (!hasStateTaskGround) return { verdict: 'unknown' }
        const entries = tpggEntriesByOrganization.get(organization.oid) ?? []
        const evaluation = evaluateTpggSemdRule(rule.semdTypeCode, entries)
        if (evaluation.requirementStatus !== 'unknown') {
            return { verdict: evaluation.requirementStatus }
        }
        // Раздел ТПГГ не найден или МО вообще нет в терпрограмме. Для видов, где нулевой объём
        // методически означает «не требуется», отсутствие утверждённого объёма трактуем так же —
        // см. п.9.5: цитологию формируют только МО с утверждённым объёмом.
        if (!evaluation.rule?.zeroMeansNotRequired) return { verdict: 'unknown' }

        // Два случая различаем: «МО есть в ТПГГ, но не в этих разделах» — вывод надёжный
        // («объёма по этому профилю нет»); «МО вообще нет в файле ТПГГ» — вывод основан на
        // допущении, что учреждение финансируется вне терпрограммы. Второй случай помечаем,
        // чтобы он был виден в диагностике и мог быть подтверждён методологом, а не
        // применялся молча.
        return {
            verdict: 'not_required',
            organizationAbsentFromTpgg: entries.length === 0,
        }
    }

    /** Есть ли у правила основание «условия входимости, утверждённые Минздравом РФ». */
    private hasMinzdravEntryGround(rule: PreparedRule): boolean {
        return (rule.grounds ?? []).some(
            (ground) => ground.level === MINZDRAV_ENTRY_GROUND_LEVEL,
        )
    }

    private evaluateRule(
        rule: PreparedRule,
        organization: OrganizationRow,
        subdivisions: SubdivisionRow[],
        tpggEntriesByOrganization: Map<string, TpggPlanEntry[]>,
    ): RuleEvaluation {
        // Р10: если у правила есть основание «утверждено госзаданием» (приоритет 2), то ТПГГ
        // авторитетнее ФРМО: положительный объём делает вид обязательным даже без подразделения
        // (МО не успела актуализировать ФРМО), а явный нулевой объём снимает обязательность,
        // даже если подразделение заведено (МО не оказывает эту помощь — см. п.9.5, цитология).
        const tpgg = this.resolveTpggVerdict(
            rule,
            organization,
            tpggEntriesByOrganization,
        )
        if (tpgg.verdict === 'required') return { verdict: 'matched' }

        const type = this.normalizeSubdivisionValue(rule.subdivisionType)
        const kind = this.normalizeSubdivisionValue(rule.subdivisionKind)
        const baseSubdivisions = subdivisions.filter((subdivision) => (
            (!type || this.normalizeSubdivisionValue(subdivision.subdivisionType) === type)
            && (!kind || this.normalizeSubdivisionValue(subdivision.subdivisionKind) === kind)
        ))
        // Основание уровня 1 считается выполненным, когда подразделение нужного типа/вида
        // заведено в ФРМО (или когда правило вообще не ограничено подразделением).
        const entryGroundSatisfied = !(type || kind) || baseSubdivisions.length > 0
        const hasEntryGround = this.hasMinzdravEntryGround(rule)

        if (tpgg.verdict === 'not_required') {
            // Вопрос 8.1. При строгом ИЛИ выполненное основание уровня 1 достаточно само по себе,
            // и отсутствие объёма в терпрограмме обязательность не снимает.
            const keptByEntryGround = GROUNDS_WORK_AS_STRICT_OR
                && hasEntryGround
                && entryGroundSatisfied
            if (!keptByEntryGround) {
                return {
                    verdict: 'not_matched',
                    organizationAbsentFromTpgg: tpgg.organizationAbsentFromTpgg,
                }
            }
        }

        // Вопрос 8.2. «Есть ФРМО, нет ФРМО — нас уже не интересует»: при буквальном прочтении
        // для правил с основанием уровня 1 наличие подразделения в ФРМО проверять не нужно.
        const skipFrmrCheck = LEVEL_1_GROUND_SKIPS_FRMR_CHECK && hasEntryGround
        if (!entryGroundSatisfied && !skipFrmrCheck) return { verdict: 'not_matched' }

        if (rule.conditionCode === 'none') return { verdict: 'matched' }
        if (rule.conditionCode === 'custom') return { verdict: 'unknown' }
        if (rule.conditionCode === 'inpatient_or_day_hospital') {
            // Два способа выполнить условие, и оба смотрят на всю медорганизацию,
            // а не на подразделения объявленного типа: круглосуточный стационар
            // сам по себе достаточен, дневной — тоже.
            const covered = subdivisions.some((subdivision) => {
                if (
                    this.normalizeSubdivisionValue(subdivision.subdivisionType)
                    === 'стационарный'
                ) return true
                const haystack = this.normalizeSubdivisionValue(
                    `${subdivision.subdivisionKind} ${subdivision.subdivisionName}`,
                )
                return haystack.includes('дневн') && haystack.includes('стационар')
            })
            return { verdict: covered ? 'matched' : 'not_matched' }
        }
        if (rule.conditionCode === 'day_hospital_group') {
            const dayHospital = subdivisions.some((subdivision) => {
                if (type && this.normalizeSubdivisionValue(subdivision.subdivisionType) !== type) return false
                const haystack = this.normalizeSubdivisionValue(
                    `${subdivision.subdivisionKind} ${subdivision.subdivisionName}`,
                )
                return haystack.includes('дневн') && haystack.includes('стационар')
            })
            return { verdict: dayHospital ? 'matched' : 'not_matched' }
        }
        // Перечень МО для условия («прикреплённое население», «лицензия…») известен
        // из двух источников: разбора комментария методолога и справочника признаков МО.
        // «Не удалось определить» — только когда нет ни одного из них. Проверять один
        // комментарий нельзя: методолог для вида 68 написала «Перечень МО определяется
        // по справочнику признаков МО» и наименований в комментарии не оставила —
        // условие уходило в `unknown` у всех 37 МО, хотя справочник его закрывает.
        const hasOrganizationList = rule.organizationOidsFromDirectory
            || rule.organizationNames.length > 0
        if (!hasOrganizationList) return { verdict: 'unknown' }
        // Перечень назван, но не сопоставился ни с одной МО — «Санаторий», которого
        // среди 37 организаций нет. Это «мы не знаем, кому вид обязателен», а не
        // «он не обязателен никому»: без этой ветки правило молча делало вид
        // необязательным всем, и по цифрам это неотличимо от честного решения
        // (у ГКУ «КОБСМЭ» так выходило ноль обязательных видов из шести правил).
        //
        // Раньше от такого спасала блокировка импорта. Она била слишком широко —
        // три вида из ста сорока пяти останавливали загрузку всей матрицы, — поэтому
        // с 25.08.2026 неверный исход убран здесь, а блокировка понижена
        // до предупреждения (`applicability-matrix-blocking.ts`).
        //
        // Важны обе оговорки.
        //
        // Перечень должен быть именно из наименований. Пустой перечень **из справочника
        // признаков МО** — это честное «ни у кого»: справочник загружен и условие
        // по нему разобрано, просто ни одна МО ему не удовлетворяет. Подвешивать
        // такое в «не определено» значило бы оставить расчёт предварительным
        // на ровном месте.
        //
        // И только для перечня-включения: у исключения пустое совпадение означает
        // «исключать некого», то есть правило действует на всех. Этот случай ловит
        // собственная блокировка, она осталась жёсткой.
        const orphanedNameList = rule.organizationNames.length > 0
            && !rule.organizationOidsFromDirectory
            && rule.matchedOrganizationOids.size === 0
        if (orphanedNameList && !rule.conditionExcludesOrganizations) {
            return { verdict: 'unknown' }
        }
        const inOrganizationList = rule.matchedOrganizationOids.has(organization.oid)
        // «если МО НЕ КОПАБ, КОБСМЭ, …»: перечень задаёт исключения, а не адресатов.
        // Правило действует на всех, кто прошёл проверку подразделения, кроме перечисленных.
        if (rule.conditionExcludesOrganizations) {
            return { verdict: inOrganizationList ? 'not_matched' : 'matched' }
        }
        // Остальные условия — включающие: перечень называет тех, кому вид обязателен.
        // Сюда же попал `organization_list` («если МО - КООД») — он читается так же,
        // как «прикреплённое население» и лицензии, просто перечень задан текстом.
        return { verdict: inOrganizationList ? 'matched' : 'not_matched' }
    }

    /**
     * Р9: собирает уникальные основания обязательности по сработавшим правилам,
     * сортируя по приоритету (1 — входимость МЗ РФ … 4 — прочее).
     */
    private collectGrounds(
        rules: PreparedRule[],
    ): ApplicabilityRequirementGround[] {
        // Объект основания кладём целиком: рабочая заметка методолога (workingNote)
        // остаётся в metadata для аудита, но на экран выводится только `text`.
        const byText = new Map<string, ApplicabilityRequirementGround>()
        for (const rule of rules) {
            for (const ground of rule.grounds ?? []) {
                const existing = byText.get(ground.text)
                if (!existing || ground.level < existing.level) {
                    byText.set(ground.text, ground)
                }
            }
        }
        return [...byText.values()].sort((left, right) => left.level - right.level)
    }

    private buildReason(prefix: string, rules: PreparedRule[]): string {
        const descriptions = rules.map((rule) => {
            const parts = [
                rule.subdivisionType,
                rule.subdivisionKind,
                rule.conditionText,
            ].filter(Boolean)
            return `строка ${rule.sourceRowNumber}${parts.length ? `: ${parts.join(' · ')}` : ''}`
        })
        return `${prefix} по матрице применимости (${descriptions.join('; ')}).`.slice(0, 4000)
    }

    private async insertRules(
        client: PoolClient,
        importId: string,
        rules: PreparedRule[],
    ): Promise<void> {
        for (const batch of this.chunk(rules, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((rule, index) => {
                const offset = index * 13
                values.push(
                    importId,
                    rule.semdTypeId,
                    rule.semdTypeCode,
                    rule.documentName,
                    rule.requirementStatus,
                    rule.subdivisionType,
                    rule.subdivisionKind,
                    rule.conditionCode,
                    rule.conditionText,
                    JSON.stringify(rule.organizationNames),
                    rule.comment,
                    rule.sourceRowNumber,
                    JSON.stringify({
                        normalizationNotes: rule.normalizationNotes,
                        // Р9: основания обязательности сохраняем и на уровне правила — для аудита.
                        grounds: rule.grounds ?? [],
                    }),
                )
                return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10}::jsonb,$${offset + 11},$${offset + 12},$${offset + 13}::jsonb)`
            })
            await client.query(
                `
                INSERT INTO reporting_semd_applicability_rules (
                    source_import_id, semd_type_id, semd_type_code, document_name,
                    requirement_status, subdivision_type, subdivision_kind,
                    condition_code, condition_text, organization_names, comment,
                    source_row_number, metadata
                ) VALUES ${placeholders.join(',')};
                `,
                values,
            )
        }
    }

    private async upsertRequirements(
        client: PoolClient,
        run: WorkbookImportRunRow,
        reportingYear: number,
        candidates: RequirementCandidate[],
    ): Promise<number> {
        const effectiveFrom = `${reportingYear}-01-01`
        const effectiveTo = `${reportingYear}-12-31`
        let count = 0
        for (const batch of this.chunk(candidates, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((candidate, index) => {
                const offset = index * 9
                values.push(
                    candidate.organizationOid,
                    candidate.semdTypeId,
                    candidate.requirementStatus,
                    candidate.reason,
                    run.originalFilename,
                    effectiveFrom,
                    effectiveTo,
                    run.id,
                    JSON.stringify(candidate.metadata),
                )
                return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6}::date,$${offset + 7}::date,$${offset + 8},$${offset + 9}::jsonb)`
            })
            const result = await client.query(
                `
                INSERT INTO reporting_organization_semd_requirements (
                    organization_oid, semd_type_id, requirement_status, reason,
                    source_name, effective_from, effective_to, source_import_id, metadata
                ) VALUES ${placeholders.join(',')}
                ON CONFLICT (organization_oid, semd_type_id, effective_from)
                DO UPDATE SET
                    requirement_status = EXCLUDED.requirement_status,
                    reason = EXCLUDED.reason,
                    source_name = EXCLUDED.source_name,
                    effective_to = EXCLUDED.effective_to,
                    source_import_id = EXCLUDED.source_import_id,
                    metadata = EXCLUDED.metadata,
                    updated_at = now();
                `,
                values,
            )
            count += result.rowCount ?? 0
        }
        return count
    }

    private async loadOrganizations(): Promise<OrganizationRow[]> {
        const result = await this.pool.query(`
            SELECT organization.oid,
                   organization.official_full_name AS "officialFullName",
                   organization.official_short_name AS "officialShortName",
                   organization.common_name AS "commonName",
                   -- Берём исходный текст синонима, а не normalized_alias:
                   -- дальше он всё равно проходит через organizationNameVariants,
                   -- и подавать туда уже обрезанную строку — терять варианты.
                   COALESCE(
                       jsonb_agg(alias.alias) FILTER (WHERE alias.alias IS NOT NULL),
                       '[]'::jsonb
                   ) AS aliases,
                   COALESCE(
                       jsonb_agg(alias.alias) FILTER (WHERE alias.alias_kind = 'group'),
                       '[]'::jsonb
                   ) AS "groupAliases"
            FROM reporting_organizations organization
            LEFT JOIN reporting_organization_aliases alias
                ON alias.organization_oid = organization.oid
            WHERE organization.is_active = TRUE
            GROUP BY organization.oid, organization.official_full_name,
                     organization.official_short_name, organization.common_name
            ORDER BY organization.oid;
        `)
        return result.rows.map((row) => ({
            oid: String(row.oid),
            officialFullName: String(row.officialFullName ?? ''),
            officialShortName: String(row.officialShortName ?? ''),
            commonName: String(row.commonName ?? ''),
            // Рабочие сокращения методолога («ГБУ МРБ №4» и подобные) лежат
            // в reporting_organization_aliases с миграции 0049. До неё они были
            // зашиты в этот файл и все до одного курганские — для второго региона
            // это был тупик: добавить синоним значило пересобрать бэкенд.
            aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
            groupAliases: Array.isArray(row.groupAliases) ? row.groupAliases.map(String) : [],
        }))
    }

    /**
     * Р10: утверждённые объёмы медицинской помощи из ТПГГ по каждой МО.
     * Нужны как альтернативное основание обязательности, когда подразделение не заведено
     * в ФРМО/ФРМР (см. evaluateRule — правило «ФРМО ИЛИ ТПГГ»).
     */
    private async loadTpggEntriesByOrganization(
        reportingYear: number,
    ): Promise<Map<string, TpggPlanEntry[]>> {
        const result = await this.pool.query(
            `
            SELECT organization_oid AS "organizationOid",
                   sheet_name AS "sheetName",
                   sheet_code AS "sheetCode",
                   source_row_number AS "rowNumber",
                   organization_name AS "organizationName",
                   normalized_organization_name AS "normalizedOrganizationName",
                   annual_value::float8 AS "annualValue"
            FROM reporting_tpgg_plan_values
            WHERE reporting_year = $1
              AND organization_oid IS NOT NULL;
            `,
            [reportingYear],
        )
        const byOrganization = new Map<string, TpggPlanEntry[]>()
        for (const row of result.rows) {
            const oid = String(row.organizationOid)
            const entries = byOrganization.get(oid) ?? []
            entries.push({
                sheetName: String(row.sheetName ?? ''),
                sheetCode: String(row.sheetCode ?? ''),
                rowNumber: Number(row.rowNumber ?? 0),
                organizationName: String(row.organizationName ?? ''),
                normalizedOrganizationName: String(row.normalizedOrganizationName ?? ''),
                annualValue: Number(row.annualValue ?? 0),
                // Помесячная роспись здесь не нужна: матрица проверяет только факт
                // «утверждён ли объём больше нуля», а он свойство года, не месяца.
                monthlyValues: {},
            })
            byOrganization.set(oid, entries)
        }
        return byOrganization
    }

    private async loadSubdivisions(): Promise<SubdivisionRow[]> {
        const result = await this.pool.query(`
            SELECT organization_oid AS "organizationOid",
                   subdivision_type AS "subdivisionType",
                   subdivision_kind AS "subdivisionKind",
                   subdivision_name AS "subdivisionName"
            FROM reporting_organization_subdivisions
            WHERE is_active = TRUE;
        `)
        return result.rows.map((row) => ({
            organizationOid: String(row.organizationOid),
            subdivisionType: String(row.subdivisionType ?? ''),
            subdivisionKind: String(row.subdivisionKind ?? ''),
            subdivisionName: String(row.subdivisionName ?? ''),
        }))
    }

    private async loadEpguTypes(reportingDate: string): Promise<SemdTypeRow[]> {
        const result = await this.pool.query(
            `
            SELECT type.id::text,
                   type.nsi_oid AS "nsiTypeCode",
                   COALESCE(NULLIF(type.official_name_5pr, ''), type.name) AS name
            FROM reporting_semd_types type
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS active_version_count,
                       BOOL_OR(version.epgu_available = TRUE) AS epgu_available
                FROM reporting_semd_type_versions version
                WHERE version.semd_type_id = type.id
                  AND version.metadata->>'source' = 'emd_nsi_csv'
                  AND (version.effective_from IS NULL OR version.effective_from <= $1::date)
                  AND (version.effective_to IS NULL OR version.effective_to >= $1::date)
            ) version_state ON TRUE
            WHERE type.is_active = TRUE
              AND type.nsi_oid IS NOT NULL
              AND btrim(type.nsi_oid) <> ''
              AND (
                  CASE
                      WHEN type.epgu_visible_registry IS NOT NULL
                          THEN type.epgu_visible_registry
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
            name: String(row.name ?? ''),
        }))
    }

    /**
     * Виды, по которым материализуется применимость: Перечень № 5пр плюс виды,
     * доступные гражданам на ЕПГУ. Объединение, а не один из списков: 35 ЕПГУ-видов
     * входят в Перечень, а 36-й приходит из резервного признака `epgu_available`
     * и в Перечне не значится — потеряв его, мы обрушили бы 6.1.3.2.7.
     *
     * Даты версий здесь не проверяются, в отличие от `loadEpguTypes`: там от версии
     * зависит сам признак доступности на ЕПГУ, а принадлежность Перечню — свойство
     * вида, а не периода.
     */
    private async loadApplicableTypes(reportingDate: string): Promise<SemdTypeRow[]> {
        const result = await this.pool.query(
            `
            SELECT type.id::text,
                   type.nsi_oid AS "nsiTypeCode",
                   COALESCE(NULLIF(type.official_name_5pr, ''), type.name) AS name
            FROM reporting_semd_types type
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS active_version_count,
                       BOOL_OR(version.epgu_available = TRUE) AS epgu_available
                FROM reporting_semd_type_versions version
                WHERE version.semd_type_id = type.id
                  AND version.metadata->>'source' = 'emd_nsi_csv'
                  AND (version.effective_from IS NULL OR version.effective_from <= $1::date)
                  AND (version.effective_to IS NULL OR version.effective_to >= $1::date)
            ) version_state ON TRUE
            WHERE type.is_active = TRUE
              AND type.nsi_oid IS NOT NULL
              AND btrim(type.nsi_oid) <> ''
              AND (
                  (
                      type.official_name_5pr IS NOT NULL
                      AND btrim(type.official_name_5pr) <> ''
                  )
                  OR (
                      CASE
                          WHEN type.epgu_visible_registry IS NOT NULL
                              THEN type.epgu_visible_registry
                          WHEN version_state.active_version_count > 0
                              THEN version_state.epgu_available
                          ELSE type.epgu_available
                      END
                  ) = TRUE
              )
            ORDER BY type.nsi_oid;
            `,
            [reportingDate],
        )
        return result.rows.map((row) => ({
            id: String(row.id),
            nsiTypeCode: String(row.nsiTypeCode),
            name: String(row.name ?? ''),
        }))
    }

    /**
     * Коды всех известных видов СЭМД — без фильтра по доступности на ЕПГУ.
     * Нужны, чтобы отличить опечатку в коде от вида, описанного впрок:
     * форма с 07.08.2026 покрывает все виды Перечня № 5пр, а не только 36 видов
     * показателя 6.1.3.2.7.
     */
    private async loadKnownTypeCodes(): Promise<Set<string>> {
        const result = await this.pool.query(
            `
            SELECT nsi_oid AS "nsiTypeCode"
            FROM reporting_semd_types
            WHERE nsi_oid IS NOT NULL AND btrim(nsi_oid) <> '';
            `,
        )
        return new Set(result.rows.map((row: { nsiTypeCode: string }) => String(row.nsiTypeCode)))
    }

    private normalizeSubdivisionValue(value: string): string {
        return String(value ?? '')
            .normalize('NFKC')
            .toLocaleLowerCase('ru-RU')
            .replace(/ё/g, 'е')
            .replace(/\s+/g, ' ')
            .trim()
    }

    private async getPeriod(periodId: string): Promise<PeriodRow> {
        const result = await this.pool.query(
            `SELECT id::text, date_from::text AS "dateFrom", date_to::text AS "dateTo" FROM reporting_periods WHERE id = $1;`,
            [periodId],
        )
        if (!result.rows[0]) throw new NotFoundException('Отчетный период не найден')
        return result.rows[0]
    }

    private async getPreviewRun(userId: number, importId: string): Promise<WorkbookImportRunRow> {
        return this.journal.getPreviewedRun(
            SOURCE_TYPE,
            userId,
            this.cleanText(importId, 80),
            'Импорт матрицы применимости не найден',
        )
    }

    private assertPreviewCanBeConfirmed(run: WorkbookImportRunRow): void {
        if (run.status !== 'previewed') throw new BadRequestException('Этот импорт уже был обработан')
        const expiresAt = run.previewExpiresAt ? new Date(run.previewExpiresAt).getTime() : 0
        if (!expiresAt || expiresAt <= Date.now()) {
            throw new BadRequestException('Срок действия предпросмотра истек. Загрузите файл повторно')
        }
        const preview = run.details?.preview as ApplicabilityMatrixPreview | undefined
        if (!preview?.canConfirm) {
            throw new BadRequestException(
                preview
                    ? this.matrixBlockingMessage(preview)
                    : 'Матрицу нельзя применить: проверьте сообщения предпросмотра',
            )
        }
    }

    private matrixBlockingMessage(
        preview: ApplicabilityMatrixPreview,
    ): string {
        const details = Array.isArray(preview.blockingErrors)
            ? preview.blockingErrors.filter(Boolean).join(' ')
            : ''
        return details
            ? `Матрицу нельзя применить. ${details}`
            : 'Матрицу нельзя применить: проверьте сообщения предпросмотра'
    }

    private async readStoredImport(objectKey: string, expectedSize: number): Promise<Buffer> {
        if (expectedSize < 0 || expectedSize > MAX_STORED_IMPORT_SIZE) {
            throw new BadRequestException('Размер сохраненного файла недопустим')
        }
        const stream = await this.s3.getObjectStream(objectKey)
        const chunks: Buffer[] = []
        let totalSize = 0
        for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            totalSize += buffer.length
            if (totalSize > MAX_STORED_IMPORT_SIZE) {
                stream.destroy()
                throw new BadRequestException('Сохраненный файл превышает допустимый размер')
            }
            chunks.push(buffer)
        }
        if (totalSize !== Number(expectedSize)) {
            throw new BadRequestException('Размер сохраненного файла не совпадает с исходным')
        }
        return Buffer.concat(chunks)
    }

    private buildObjectFilename(sourceName: string): string {
        const safe = sourceName.replace(/\\/g, '/').split('/').pop()!
            .replace(/[^\p{L}\p{N}._-]+/gu, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 180)
        return safe.toLocaleLowerCase('ru-RU').endsWith('.xlsx') ? safe : `${safe || 'matrix'}.xlsx`
    }

    private async markImportFailed(importId: string, err: unknown): Promise<void> {
        await this.pool.query(
            `UPDATE reporting_import_runs SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1 AND status = 'processing';`,
            [importId, this.cleanText(err instanceof Error ? err.message : err, 2000)],
        )
    }

    private cleanText(value: unknown, maxLength = 1000): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }

    private toIsoString(value: Date | string | null): string {
        if (!value) return ''
        return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
    }

    private chunk<T>(rows: T[], size: number): T[][] {
        const result: T[][] = []
        for (let index = 0; index < rows.length; index += size) {
            result.push(rows.slice(index, index + size))
        }
        return result
    }
}
