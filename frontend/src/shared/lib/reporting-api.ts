import axios from 'axios'

/** Typed HTTP client for the Reporting module. */

export type MethodologyStatus = 'ready' | 'in_development'
export type ReportingValueStatus =
    | 'awaiting_data'
    | 'calculated'
    | 'methodology_in_development'
    | 'not_calculated'
export type ReportingBusinessStatus =
    | 'not_assessed'
    | 'target_met'
    | 'below_target'
    | 'critical'

export interface ReportingIndicator {
    id: string
    code: string
    title: string
    /**
     * Короткое имя для выпадающего списка над картой: по одному коду
     * «6.1.3.2.11» непонятно, между чем переключаешься (ВКС 15.08.2026).
     * В «Приложении 2» короткого имени нет — заведено миграцией 0048.
     */
    shortTitle: string
    /** Номер показателя в «Приложении 2». Пусто — показателя там нет. */
    appendix2Number: string
    unit: string
    formulaText: string
    numeratorLabel: string
    denominatorLabel: string
    methodologyStatus: MethodologyStatus
    isMvp: boolean
    valueKind: 'count' | 'percent' | 'count_and_percent'
    calculationType:
        | 'manual'
        | 'ratio_percent'
        | 'semd_type_coverage'
        /** Доли СЭМД к утверждённым объёмам ТПГГ — показатели 6.1.3.2.8–6.1.3.2.11. */
        | 'semd_volume_ratio'
        /** Виды СЭМД, регистрируемые в РЭМД, к Перечню № 5пр — показатель 27. */
        | 'semd_type_registry'
    isPilot: boolean
    sortOrder: number
    metadata: Record<string, unknown>
    createdAt: string
    updatedAt: string
}

export interface ReportingPeriod {
    id: string
    code: string
    name: string
    dateFrom: string | null
    dateTo: string | null
    status: 'draft' | 'active' | 'closed'
    createdBy: number | null
    createdAt: string
    updatedAt: string
}

export interface ReportingIndicatorValue {
    id: string
    indicatorId: string
    periodId: string
    numerator: number | null
    denominator: number | null
    factValue: number | null
    secondaryValue: number | null
    targetValue: number | null
    /**
     * Целевое на конец года из «Приложения 2». Рядом с месячным: методолог 15.08.2026
     * приняла месячные 70 % за ошибку, помня годовые 95 %. Оценка выполнения
     * по-прежнему считается по месячному.
     */
    targetYearEndValue: number | null
    status: ReportingValueStatus
    deviationValue: number | null
    businessStatus: ReportingBusinessStatus
    calculationDetails: Record<string, unknown>
    note: string
    sourceName: string
    createdBy: number | null
    updatedBy: number | null
    createdAt: string
    updatedAt: string
}

export type LocationPrecision = 'exact' | 'street' | 'locality' | 'approximate' | 'unknown'

export interface ReportingOrganizationIndicatorValue {
    id: string
    indicatorId: string
    periodId: string
    organizationOid: string
    organizationName: string
    organizationFullName: string
    address: string
    latitude: number | null
    longitude: number | null
    locationSource: string
    locationPrecision: LocationPrecision
    numerator: number | null
    denominator: number | null
    factValue: number | null
    secondaryValue: number | null
    targetValue: number | null
    /**
     * Целевое на конец года из «Приложения 2». Рядом с месячным: методолог 15.08.2026
     * приняла месячные 70 % за ошибку, помня годовые 95 %. Оценка выполнения
     * по-прежнему считается по месячному.
     */
    targetYearEndValue: number | null
    targetSource: 'organization' | 'period' | 'none'
    relativePercent: number | null
    status: ReportingValueStatus
    deviationValue: number | null
    businessStatus: ReportingBusinessStatus
    calculationDetails: Record<string, unknown>
    note: string
    sourceName: string
    createdBy: number | null
    updatedBy: number | null
    createdAt: string
    updatedAt: string
}

export interface ReportingSummary {
    periods: ReportingPeriod[]
    selectedPeriodId: string | null
    organizationCount: number
    indicators: ReportingIndicator[]
    values: ReportingIndicatorValue[]
}

export interface PilotRegionSemdType {
    id: string
    code: string
    name: string
    nsiOid: string | null
    officialOid: string | null
    officialName5pr: string | null
    covered: boolean
}

/**
 * Строка разбора показателя «Виды СЭМД в РЭМД» (Н18.1). `outside_registry` — вид
 * регистрируется, но в Перечень № 5пр не входит и в числитель не берётся.
 */
export interface SemdTypeRegistryType {
    semdTypeId: string
    nsiOid: string | null
    name: string
    officialOid: string | null
    officialName5pr: string | null
    status: 'registered' | 'not_registered' | 'outside_registry'
    organizationCount: number
    documentCount: number
    /**
     * Итоги прошлого года. `null` — выгрузка за него не загружена; ноль
     * означал бы «вид не регистрировали», а это другое утверждение.
     */
    priorYear: number | null
    priorYearDocumentCount: number | null
    priorYearOrganizationCount: number | null
}

export interface ReportingDashboard {
    periods: ReportingPeriod[]
    selectedPeriodId: string | null
    indicators: ReportingIndicator[]
    selectedIndicatorId: string | null
    organizations: ReportingOrganizationIndicatorValue[]
    diagnostics: ReportingDiagnosticFinding[]
    pilotRegionSemdTypes: PilotRegionSemdType[] | null
    semdTypeRegistryTypes: SemdTypeRegistryType[] | null
}

export interface ReportingDiagnosticFinding {
    id: string
    periodId: string
    indicatorId: string
    organizationOid: string | null
    semdTypeId: string | null
    semdTypeName: string | null
    findingCode: string
    severity: 'info' | 'warning' | 'error'
    cause: string
    responsibilityArea: string
    recommendation: string
    evidence: Record<string, unknown>
    status: 'active' | 'resolved' | 'not_applicable'
    sourceImportId: string | null
    createdAt: string
    updatedAt: string
}

export type PilotInstitutionSemdStatus =
    | 'required_registered'
    | 'required_missing'
    | 'required_gis_unavailable'
    | 'required_gis_unknown'
    | 'not_required'
    | 'not_required_registered'
    | 'unknown'
    | 'unknown_registered'

export interface PilotInstitutionDetails {
    periodId: string
    indicatorId: 'semd_types_epgu_coverage'
    reportingDate: string | null
    organization: {
        oid: string
        name: string
        fullName: string
        address: string
    }
    summary: {
        totalTypeCount: number
        registeredTypeCount: number
        knownApplicabilityCount: number
        requiredTypeCount: number
        registeredRequiredTypeCount: number
        missingRequiredTypeCount: number
        notRequiredTypeCount: number
        unknownApplicabilityCount: number
        manualOverrideCount: number
        coveragePercent: number | null
        isPreliminary: boolean
    }
    types: Array<{
        semdTypeId: string
        nsiTypeCode: string
        officialOid: string | null
        officialName5pr: string | null
        name: string
        documentFormat: string
        requirementStatus:
            | 'required'
            | 'not_required'
            | 'unknown'
            | 'missing'
        baseRequirementStatus:
            | 'required'
            | 'not_required'
            | 'unknown'
            | 'missing'
        /**
         * Р9: основания обязательности вида для этой МО — колонки «Приоритет
         * обязательности 1..4» формы_1 (1 — входимость МЗ РФ, 2 — госзадание/регион,
         * 3 — лицензии, 4 — прочее). Обычно 1–2; несколько трактуются как ИЛИ.
         */
        requirementGrounds: Array<{ level: number; text: string }>
        resultStatus: PilotInstitutionSemdStatus
        documentCount: number
        registered: boolean
        gisAvailable: boolean | null
        requirementReason: string
        requirementSource: string
        baseRequirementReason: string
        baseRequirementSource: string
        manualOverride: {
            status: 'required' | 'not_required'
            reason: string
            createdAt: string
            createdBy: string
        } | null
        evidence: Array<{
            sheetName: string
            sheetCode: string
            rowNumber: number | null
            annualValue: number | null
            organizationName: string
        }>
    }>
}

export interface PilotRequirementOverrideHistoryEntry {
    id: string
    periodId: string
    organizationOid: string
    semdTypeId: string
    nsiTypeCode: string
    semdTypeName: string
    requirementStatus: 'required' | 'not_required' | null
    reason: string
    createdAt: string
    createdBy: string
    isCurrent: boolean
}

export interface CreateReportingPeriodPayload {
    name: string
    code?: string
    dateFrom?: string | null
    dateTo?: string | null
    status?: ReportingPeriod['status']
}

export interface UpsertReportingValuePayload {
    periodId: string
    numerator?: string | number | null
    denominator?: string | number | null
    targetValue?: string | number | null
    note?: string | null
    sourceName?: string | null
}

export interface ReportingRemdImportResult {
    importId: string
    importMode: ReportingImportMode
    periodId: string
    sourceName: string
    fileSha256: string
    organizationRows: number
    importedCount: number
    organizationValuesImported: number
    denominatorIndicatorsImported: number
    organizationDenominatorsImported: number
    values: ReportingIndicatorValue[]
    matchedColumns: Array<{
        indicatorId: string
        code: string
        numerator: number
        denominator: number | null
        targetValue: number | null
        denominatorColumn: { index: number; header: string; sum: number } | null
        targetColumn: { index: number; header: string } | null
        aggregation: 'sum' | 'max'
        columns: Array<{ index: number; header: string; sum: number }>
        groups: Array<{
            key: string
            label: string
            sum: number
            selected: boolean
            columns: Array<{ index: number; header: string; sum: number }>
        }>
    }>
    warnings: string[]
}

export type ReportingImportStatus =
    | 'previewed'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
export type ReportingImportMode = 'merge' | 'replace'

export type RemdSheetKind = 'region' | 'institution' | 'subdivision'
export type RemdQualitySeverity = 'warning' | 'error'

export interface RemdWorkbookPreview {
    canConfirm: boolean
    metadata: {
        periodFrom: string | null
        periodTo: string | null
        generatedAt: string | null
    }
    sheets: Array<{
        kind: RemdSheetKind
        sheetName: string
        declaredRecordCount: number | null
        parsedRecordCount: number
        semdColumnCount: number
    }>
    totals: {
        institutionCount: number
        subdivisionRowCount: number
        unassignedSubdivisionRowCount: number
        unassignedSubdivisionDocumentCount: number
        availableSemdTypeCount: number
        activeRegionSemdTypeCount: number
        regionDocumentCount: number
        institutionDocumentCount: number
        subdivisionDocumentCount: number
    }
    institutions: Array<{
        oid: string
        name: string
        /** `null` — счётчик видов в отчёте не заполнен (например, формулой без кэша). */
        uniqueSemdTypes: number | null
        totalDocuments: number
    }>
    checks: Array<{
        code: string
        label: string
        status: 'passed' | 'failed'
        severity: RemdQualitySeverity
        expected: number
        actual: number
    }>
    issueSummary: Array<{
        code: string
        severity: RemdQualitySeverity
        count: number
    }>
    issues: Array<{
        code: string
        severity: RemdQualitySeverity
        sheetKind: RemdSheetKind
        sheetName: string
        rowNumber: number | null
        columnNumber: number | null
        message: string
        details: Record<string, unknown>
    }>
}

export interface RemdWorkbookPreviewResult {
    importId: string
    periodId: string
    importMode: ReportingImportMode
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: RemdWorkbookPreview
}

export interface RemdWorkbookConfirmResult {
    importId: string
    periodId: string
    importMode: ReportingImportMode
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

export interface Perechen5prImportResult {
    importId: string
    periodId: string
    sourceName: string
    rowCount: number
    matchedTypeCount: number
    unmatchedTypeCodes: string[]
    warnings: string[]
}

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

export interface RemdNumeratorImportResult {
    importId: string
    periodId: string
    sourceName: string
    sheetName: string
    rowCount: number
    skippedRowCount: number
    directoryOrganizationCount: number
    matchedOrganizationCount: number
    unmatchedOrganizationOids: string[]
    excludedOrganizationOids: string[]
    matchedTypeCount: number
    unmatchedDocumentTypeNames: string[]
    factCount: number
    subdivisionFactCount: number
    matchedSubdivisionCount: number
    unknownSubdivisionFactCount: number
    warnings: string[]
}

/**
 * Справочник признаков МО региона (файл методолога «МО Курганской области.xlsx»).
 * Закрывает прикреплённое население (приоритет 4) и лицензии (приоритет 3);
 * региональные акты (приоритет 2) в него не входят.
 */
export interface OrganizationDirectoryPreview {
    canConfirm: boolean
    sheetName: string
    totals: {
        rowCount: number
        matchedOrganizationCount: number
        /** Строки файла, которых в реестре ещё нет: они будут созданы. */
        newOrganizationCount: number
        directoryOrganizationCount: number
        missingFromFileCount: number
        attachedPopulationCount: number
        attachedChildPopulationCount: number
    }
    licenses: Array<{
        code: string
        title: string
        organizationCount: number
        /** false — лицензия принимается, но ни один из 35 видов от неё не зависит. */
        usedByIndicator: boolean
    }>
    newOrganizations: Array<{ rowNumber: number; oid: string; name: string }>
    missingFromFile: Array<{ oid: string; name: string }>
    warnings: string[]
}

export interface OrganizationDirectoryPreviewResult {
    importId: string
    periodId: string
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: OrganizationDirectoryPreview
}

export interface OrganizationDirectoryConfirmResult {
    importId: string
    periodId: string
    sourceName: string
    savedOrganizationCount: number
    /** Сколько МО справочник завёл заново: их не было ни в одной выгрузке. */
    createdOrganizationCount: number
    attachedPopulationCount: number
    attachedChildPopulationCount: number
    licenseCounts: Record<string, number>
    requiresMatrixReimport: true
    warnings: string[]
}

export interface TpggWorkbookPreview {
    canConfirm: boolean
    reportingYear: number
    selectedPeriodYear: number
    sheets: Array<{
        sheetName: string
        sheetCode: string
        status: 'parsed' | 'skipped'
        headerRowNumber: number | null
        organizationColumnNumber: number | null
        annualValueColumnNumber: number | null
        parsedRowCount: number
        positiveRowCount: number
        annualValueTotal: number
        warning: string
    }>
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
    directoryLoaded: boolean
    directoryOverrides: ApplicabilityDirectoryOverride[]
    blockingErrors: string[]
    warnings: string[]
}

/**
 * Расхождение справочника признаков МО с перечнем из комментария методолога в форме_1.
 * Справочник главнее, но подмену показываем явно — иначе методолог правит матрицу
 * и не понимает, почему её список не сработал.
 */
export interface ApplicabilityDirectoryOverride {
    semdTypeCode: string
    documentName: string
    conditionCode: string
    conditionText: string
    sourceRowNumber: number
    addedOrganizations: string[]
    removedOrganizations: string[]
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

export interface TargetPlanPreviewItem {
    itemNumber: string
    name: string
    indicatorCode: string | null
    unit: string
    matched: boolean
    applicable: boolean
    note: string
    indicatorId: string | null
    currentTargetValue: number | null
    newTargetValue: number | null
    willChange: boolean
}

export interface TargetPlanPreview {
    canConfirm: boolean
    planYear: number
    targetMonth: number | null
    rows: TargetPlanPreviewItem[]
    totals: {
        rowCount: number
        matchedCount: number
        applicableCount: number
        changingCount: number
    }
    warnings: string[]
}

export interface TargetPlanPreviewResult {
    importId: string
    periodId: string
    sourceName: string
    fileSha256: string
    previewExpiresAt: string
    preview: TargetPlanPreview
}

export interface TargetPlanConfirmResult {
    importId: string
    periodId: string
    sourceName: string
    updatedCount: number
    warnings: string[]
}

export interface ReportingOrganization {
    oid: string
    officialFullName: string
    officialShortName: string
    commonName: string
    address: string
    latitude: number | null
    longitude: number | null
    locationSource: string
    locationPrecision: LocationPrecision
    activityType: string | null
    isActive: boolean
    sourceImportId: string | null
    metadata: Record<string, unknown>
    createdAt: string
    updatedAt: string
}

export type ReportingOrganizationExternalIdSystem = 'фомс' | 'фрмо' | 'прочее'

export interface ReportingOrganizationExternalId {
    id: string
    organizationOid: string
    system: ReportingOrganizationExternalIdSystem
    externalId: string
    note: string
    createdBy: number | null
    createdAt: string
}

export interface UpdateOrganizationPayload {
    officialFullName?: string
    officialShortName?: string
    commonName?: string
    address?: string
    latitude?: number | string | null
    longitude?: number | string | null
    locationPrecision?: string
    isActive?: boolean
}

export interface CreateExternalIdPayload {
    system: string
    externalId: string
    note?: string
}

export interface ReportingImportRun {
    id: string
    periodId: string
    periodName: string
    sourceType: string
    importMode: ReportingImportMode
    originalFilename: string
    fileSha256: string
    fileSize: number
    status: ReportingImportStatus
    organizationRows: number
    indicatorValuesCount: number
    organizationValuesCount: number
    warnings: string[]
    details: Record<string, unknown>
    errorMessage: string
    createdBy: number | null
    createdAt: string
    completedAt: string | null
}

export async function getReportingSummary(periodId?: string | null): Promise<ReportingSummary> {
    const { data } = await axios.get<ReportingSummary>('/api/reporting/summary', {
        params: periodId ? { periodId } : undefined,
    })
    return data
}

export async function getReportingDashboard(
    periodId?: string | null,
    indicatorId?: string | null,
): Promise<ReportingDashboard> {
    const { data } = await axios.get<ReportingDashboard>('/api/reporting/dashboard', {
        params: {
            ...(periodId ? { periodId } : {}),
            ...(indicatorId ? { indicatorId } : {}),
        },
    })
    return data
}

/**
 * Н20: находки лежат в общей таблице с ключом по показателю. Без `indicatorId`
 * бэкенд отдаёт находки 6.1.3.2.7 — прежнее поведение всех существующих вызовов.
 */
export async function getReportingDiagnostics(
    periodId: string,
    organizationOid?: string,
    indicatorId?: string,
): Promise<ReportingDiagnosticFinding[]> {
    const { data } = await axios.get<ReportingDiagnosticFinding[]>(
        '/api/reporting/diagnostics',
        {
            params: {
                periodId,
                ...(organizationOid ? { organizationOid } : {}),
                ...(indicatorId ? { indicatorId } : {}),
            },
        },
    )
    return data
}

export async function getPilotInstitutionDetails(
    periodId: string,
    organizationOid: string,
): Promise<PilotInstitutionDetails> {
    const { data } = await axios.get<PilotInstitutionDetails>(
        '/api/reporting/pilot-institution-details',
        {
            params: { periodId, organizationOid },
        },
    )
    return data
}

export async function getPilotInstitutionRequirementHistory(
    periodId: string,
    organizationOid: string,
    semdTypeId?: string,
): Promise<PilotRequirementOverrideHistoryEntry[]> {
    const { data } = await axios.get<PilotRequirementOverrideHistoryEntry[]>(
        '/api/reporting/pilot-institution-requirement-history',
        {
            params: {
                periodId,
                organizationOid,
                ...(semdTypeId ? { semdTypeId } : {}),
            },
        },
    )
    return data
}

export async function setPilotInstitutionRequirement(
    payload: {
        periodId: string
        organizationOid: string
        semdTypeId: string
        requirementStatus: 'required' | 'not_required' | null
        reason: string
    },
): Promise<PilotInstitutionDetails> {
    const { data } = await axios.put<PilotInstitutionDetails>(
        '/api/reporting/pilot-institution-requirement',
        payload,
    )
    return data
}

// Р3: справочник технической реализации видов СЭМД в региональной ГИС (владелец — МИАЦ).
export interface SemdGisAvailability {
    semdTypeId: string
    code: string
    nsiTypeCode: string | null
    name: string
    officialName5pr: string | null
    isAvailable: boolean | null
    note: string
    updatedAt: string | null
}

export async function getSemdGisAvailability(): Promise<SemdGisAvailability[]> {
    const { data } = await axios.get<SemdGisAvailability[]>(
        '/api/reporting/semd-gis-availability',
    )
    return data
}

export async function setSemdGisAvailability(
    semdTypeId: string,
    isAvailable: boolean | null,
    note = '',
): Promise<SemdGisAvailability> {
    const { data } = await axios.put<SemdGisAvailability>(
        `/api/reporting/semd-gis-availability/${encodeURIComponent(semdTypeId)}`,
        { isAvailable, note },
    )
    return data
}

export async function recalculatePilotIndicator(periodId: string): Promise<void> {
    await axios.get('/api/reporting/pilot-calculation', { params: { periodId } })
}

export async function importRemdExcel(
    periodId: string,
    file: File,
    mode: ReportingImportMode = 'merge',
): Promise<ReportingRemdImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('mode', mode)
    form.append('file', file)

    const { data } = await axios.post<ReportingRemdImportResult>(
        '/api/reporting/import/remd-excel',
        form,
    )
    return data
}

export async function previewRemdWorkbook(
    periodId: string,
    file: File,
    mode: ReportingImportMode = 'merge',
): Promise<RemdWorkbookPreviewResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('mode', mode)
    form.append('file', file)

    const { data } = await axios.post<RemdWorkbookPreviewResult>(
        '/api/reporting/import/remd-preview',
        form,
    )
    return data
}

export async function importEmdNsiCsv(
    periodId: string,
    file: File,
): Promise<EmdNsiImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<EmdNsiImportResult>(
        '/api/reporting/import/emd-nsi-csv',
        form,
    )
    return data
}

export async function importEpguDocVisibility(
    periodId: string,
    file: File,
): Promise<EpguDocVisibilityImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<EpguDocVisibilityImportResult>(
        '/api/reporting/import/epgu-doc-visibility',
        form,
    )
    return data
}

export async function importPerechen5pr(
    periodId: string,
    file: File,
): Promise<Perechen5prImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<Perechen5prImportResult>(
        '/api/reporting/import/perechen-5pr',
        form,
    )
    return data
}

export async function importRemdNumerator(
    periodId: string,
    file: File,
): Promise<RemdNumeratorImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<RemdNumeratorImportResult>(
        '/api/reporting/import/remd-numerator',
        form,
    )
    return data
}

export interface InclusionRegisterImportResult {
    importId: string
    sourceName: string
    title: string
    semdTypeCode: string
    semdTypeName: string
    month: number | null
    year: number | null
    rowCount: number
    organizationCount: number
    planTotal: number
    factTotal: number
    skippedOtherSubjects: number
    unmatchedOrganizationOids: string[]
    warnings: string[]
}

/**
 * Перечни входимости ТВСП от Минздрава. Вид СЭМД определяется по заголовку
 * файла, поэтому параметров, кроме периода и самого файла, нет.
 */
export async function importInclusionRegister(
    periodId: string,
    file: File,
): Promise<InclusionRegisterImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<InclusionRegisterImportResult>(
        '/api/reporting/import/inclusion-register',
        form,
    )
    return data
}

export interface TpggExecutionImportResult {
    importId: string
    periodId: string
    reportingYear: number
    sourceName: string
    sheetName: string
    layout: string
    sheetCodes: string[]
    fromMonth: number | null
    toMonth: number | null
    rowCount: number
    matchedOrganizationCount: number
    unmatchedOrganizationNames: string[]
    ambiguousOrganizationNames: string[]
    planTotal: number
    factTotal: number
    warnings: string[]
}

/**
 * Исполнение терпрограммы по реестрам ОМС. Лист терпрограммы определяется
 * по имени файла, поэтому переименовывать файлы фонда перед загрузкой нельзя.
 */
export async function importTpggExecution(
    periodId: string,
    file: File,
): Promise<TpggExecutionImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<TpggExecutionImportResult>(
        '/api/reporting/import/tpgg-execution',
        form,
    )
    return data
}

export interface MonthlySeriesPoint {
    month: number
    /** План месяца по росписи терпрограммы; `null` — росписи нет. */
    plan: number | null
    /** Факт месяца по выгрузке РЭМД; `null` — выгрузка за месяц не загружена. */
    fact: number | null
    /**
     * Доля СЭМД от планового объёма месяца, в процентах. `null` — нет плана
     * или нет выгрузки. Считается на сервере тем же округлением, что и карточка.
     */
    ratio: number | null
}

export interface MonthlyTypeCountPoint {
    month: number
    uniqueTypeCount: number
}

/**
 * Блок «от факта»: доля СЭМД от случаев, поданных на оплату в ТФОМС.
 * Знаменатель здесь другой, чем на диаграмме: там утверждённый план,
 * здесь реально пролеченные и оплаченные случаи.
 */
export interface ExecutionSummary {
    fromMonth: number
    toMonth: number
    planValue: number
    factValue: number
    semdValue: number
    percentOfFact: number | null
    /** Месяцы среза без выгрузки РЭМД: без них «СЭМД» занижено. */
    missingMonths: number[]
}

/**
 * Разрез по медорганизациям: точка на диаграмме рассеяния и строка
 * тепловой карты — одна и та же запись.
 */
export interface OrganizationBreakdownRow {
    organizationOid: string
    organizationName: string
    /** Доля от плана по месяцам, индекс 0 — январь. */
    monthlyRatios: Array<number | null>
    /** Случаи по реестрам ОМС; `null` — реестров по этой МО нет. */
    caseFact: number | null
    semdInSlice: number | null
    percentOfFact: number | null
}

export interface OrganizationBreakdown {
    fromMonth: number | null
    toMonth: number | null
    rows: OrganizationBreakdownRow[]
}

export interface MonthlySeriesResult {
    periodId: string
    indicatorId: string
    indicatorCode: string
    level: 'region' | 'organization'
    organizationOid: string | null
    organizationName: string | null
    loadedMonths: number[]
    points: MonthlySeriesPoint[]
    /** Только у показателя «Виды СЭМД в РЭМД»; у остальных пусто. */
    typeCountPoints: MonthlyTypeCountPoint[]
    /** `null` — исполнение не загружено или период файла не распознан. */
    executionSummary: ExecutionSummary | null
    /** `null` при разрезе по одной МО: сравнивать её не с кем. */
    organizationBreakdown: OrganizationBreakdown | null
}

/**
 * Помесячные кривые «план против факта». Без `organizationOid` — по региону,
 * с ним — по одной МО.
 */
export async function fetchMonthlySeries(
    periodId: string,
    indicatorId: string,
    organizationOid?: string,
): Promise<MonthlySeriesResult> {
    const { data } = await axios.get<MonthlySeriesResult>(
        '/api/reporting/monthly-series',
        { params: { periodId, indicatorId, organizationOid } },
    )
    return data
}

/**
 * Выгрузка РЭМД за интервал: помесячная или нарастающим итогом.
 * `coverage` определяется по шапке отчёта, поэтому в результате и приходит,
 * а не задаётся при отправке.
 */
export interface RemdIntervalImportResult {
    importId: string
    periodId: string
    sourceName: string
    sheetName: string
    coverage: 'month' | 'cumulative'
    month: number
    year: number
    intervalFromHeader: boolean
    factCount: number
    matchedOrganizationCount: number
    matchedTypeCount: number
    uniqueTypeCount: number
    documentCount: number
    unmatchedOrganizationOids: string[]
    unmatchedDocumentTypeNames: string[]
    warnings: string[]
}

/**
 * Помесячные и нарастающие выгрузки РЭМД. Грузятся по одной, но все в один
 * отчётный период: кривая динамики собирается внутри периода.
 *
 * Месяц и разновидность сервис читает из шапки отчёта — параметров тут нет
 * намеренно, чтобы файл нельзя было пометить неверно одним неудачным кликом.
 */
export async function importRemdInterval(
    periodId: string,
    file: File,
): Promise<RemdIntervalImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<RemdIntervalImportResult>(
        '/api/reporting/import/remd-interval',
        form,
    )
    return data
}

export async function importFrmr(
    periodId: string,
    file: File,
): Promise<FrmrImportResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<FrmrImportResult>(
        '/api/reporting/import/frmr',
        form,
    )
    return data
}

export async function previewOrganizationDirectory(
    periodId: string,
    file: File,
): Promise<OrganizationDirectoryPreviewResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<OrganizationDirectoryPreviewResult>(
        '/api/reporting/import/organization-directory-preview',
        form,
    )
    return data
}

export async function confirmOrganizationDirectory(
    importId: string,
): Promise<OrganizationDirectoryConfirmResult> {
    const { data } = await axios.post<OrganizationDirectoryConfirmResult>(
        `/api/reporting/imports/${importId}/organization-directory-confirm`,
    )
    return data
}

export async function cancelOrganizationDirectoryPreview(
    importId: string,
): Promise<void> {
    await axios.post(`/api/reporting/imports/${importId}/organization-directory-cancel`)
}

export async function previewTpggWorkbook(
    periodId: string,
    file: File,
): Promise<TpggWorkbookPreviewResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<TpggWorkbookPreviewResult>(
        '/api/reporting/import/tpgg-preview',
        form,
    )
    return data
}

export async function confirmTpggWorkbook(
    importId: string,
): Promise<TpggWorkbookConfirmResult> {
    const { data } = await axios.post<TpggWorkbookConfirmResult>(
        `/api/reporting/imports/${importId}/tpgg-confirm`,
    )
    return data
}

export async function getTpggWorkbookPreview(
    importId: string,
): Promise<TpggWorkbookPreviewResult> {
    const { data } = await axios.get<TpggWorkbookPreviewResult>(
        `/api/reporting/imports/${importId}/tpgg-preview`,
    )
    return data
}

export async function cancelTpggWorkbookPreview(
    importId: string,
): Promise<void> {
    await axios.post(`/api/reporting/imports/${importId}/tpgg-cancel`)
}

export async function previewApplicabilityMatrix(
    periodId: string,
    file: File,
): Promise<ApplicabilityMatrixPreviewResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<ApplicabilityMatrixPreviewResult>(
        '/api/reporting/import/applicability-matrix-preview',
        form,
    )
    return data
}

export async function getApplicabilityMatrixPreview(
    importId: string,
): Promise<ApplicabilityMatrixPreviewResult> {
    const { data } = await axios.get<ApplicabilityMatrixPreviewResult>(
        `/api/reporting/imports/${importId}/applicability-matrix-preview`,
    )
    return data
}

export async function confirmApplicabilityMatrix(
    importId: string,
): Promise<ApplicabilityMatrixConfirmResult> {
    const { data } = await axios.post<ApplicabilityMatrixConfirmResult>(
        `/api/reporting/imports/${importId}/applicability-matrix-confirm`,
    )
    return data
}

export async function cancelApplicabilityMatrixPreview(
    importId: string,
): Promise<void> {
    await axios.post(`/api/reporting/imports/${importId}/applicability-matrix-cancel`)
}

export async function confirmRemdWorkbook(
    importId: string,
    mode?: ReportingImportMode,
): Promise<RemdWorkbookConfirmResult> {
    const { data } = await axios.post<RemdWorkbookConfirmResult>(
        `/api/reporting/imports/${importId}/confirm`,
        mode ? { mode } : {},
    )
    return data
}

export async function getRemdWorkbookPreview(
    importId: string,
): Promise<RemdWorkbookPreviewResult> {
    const { data } = await axios.get<RemdWorkbookPreviewResult>(
        `/api/reporting/imports/${importId}/preview`,
    )
    return data
}

export async function cancelRemdWorkbookPreview(
    importId: string,
): Promise<void> {
    await axios.post(`/api/reporting/imports/${importId}/cancel`)
}

export async function previewTargetPlan(
    periodId: string,
    file: File,
): Promise<TargetPlanPreviewResult> {
    const form = new FormData()
    form.append('periodId', periodId)
    form.append('file', file)

    const { data } = await axios.post<TargetPlanPreviewResult>(
        '/api/reporting/import/target-plan-preview',
        form,
    )
    return data
}

export async function getTargetPlanPreview(
    importId: string,
): Promise<TargetPlanPreviewResult> {
    const { data } = await axios.get<TargetPlanPreviewResult>(
        `/api/reporting/imports/${importId}/target-plan-preview`,
    )
    return data
}

export async function confirmTargetPlan(
    importId: string,
): Promise<TargetPlanConfirmResult> {
    const { data } = await axios.post<TargetPlanConfirmResult>(
        `/api/reporting/imports/${importId}/target-plan-confirm`,
    )
    return data
}

export async function cancelTargetPlanPreview(
    importId: string,
): Promise<void> {
    await axios.post(`/api/reporting/imports/${importId}/target-plan-cancel`)
}

export async function getReportingImports(periodId?: string | null): Promise<ReportingImportRun[]> {
    const { data } = await axios.get<ReportingImportRun[]>('/api/reporting/imports', {
        params: periodId ? { periodId } : undefined,
    })
    return data
}

export async function downloadReportingImportSource(
    importRun: ReportingImportRun,
): Promise<void> {
    const { data } = await axios.get<Blob>(
        `/api/reporting/imports/${importRun.id}/source`,
        { responseType: 'blob' },
    )
    const url = URL.createObjectURL(data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = importRun.originalFilename || `reporting-import-${importRun.id}.xlsx`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}

export async function createReportingPeriod(
    payload: CreateReportingPeriodPayload,
): Promise<ReportingPeriod> {
    const { data } = await axios.post<ReportingPeriod>('/api/reporting/periods', payload)
    return data
}

/** Что исчезнет вместе с отчётным периодом. Запрашивается до удаления. */
export interface ReportingPeriodDeletionPreview {
    period: ReportingPeriod
    counts: {
        remdFacts: number
        remdSubdivisionFacts: number
        indicatorValues: number
        organizationValues: number
        diagnosticFindings: number
        qualityIssues: number
        tpggPlanValues: number
        importRuns: number
        /** Ручные уточнения применимости — единственное здесь, что вводит человек. */
        requirementOverrides: number
    }
    isLastPeriod: boolean
}

export interface ReportingPeriodDeletionResult {
    deleted: true
    period: ReportingPeriod
    counts: ReportingPeriodDeletionPreview['counts']
    storageObjectKeys: string[]
}

export async function getReportingPeriodDeletionPreview(
    periodId: string,
): Promise<ReportingPeriodDeletionPreview> {
    const { data } = await axios.get<ReportingPeriodDeletionPreview>(
        `/api/reporting/periods/${periodId}/deletion-preview`,
    )
    return data
}

export async function deleteReportingPeriod(
    periodId: string,
    confirmCode: string,
): Promise<ReportingPeriodDeletionResult> {
    const { data } = await axios.delete<ReportingPeriodDeletionResult>(
        `/api/reporting/periods/${periodId}`,
        { data: { confirmCode } },
    )
    return data
}

export async function upsertReportingValue(
    indicatorId: string,
    payload: UpsertReportingValuePayload,
): Promise<ReportingIndicatorValue> {
    const { data } = await axios.put<ReportingIndicatorValue>(
        `/api/reporting/values/${indicatorId}`,
        payload,
    )
    return data
}

export async function getReportingOrganizations(
    includeInactive = false,
): Promise<ReportingOrganization[]> {
    const { data } = await axios.get<ReportingOrganization[]>('/api/reporting/organizations', {
        params: includeInactive ? { includeInactive: 'true' } : undefined,
    })
    return data
}

export async function updateReportingOrganization(
    oid: string,
    payload: UpdateOrganizationPayload,
): Promise<ReportingOrganization> {
    const { data } = await axios.put<ReportingOrganization>(
        `/api/reporting/organizations/${encodeURIComponent(oid)}`,
        payload,
    )
    return data
}

export async function getOrganizationExternalIds(
    oid: string,
): Promise<ReportingOrganizationExternalId[]> {
    const { data } = await axios.get<ReportingOrganizationExternalId[]>(
        `/api/reporting/organizations/${encodeURIComponent(oid)}/external-ids`,
    )
    return data
}

export async function addOrganizationExternalId(
    oid: string,
    payload: CreateExternalIdPayload,
): Promise<ReportingOrganizationExternalId> {
    const { data } = await axios.post<ReportingOrganizationExternalId>(
        `/api/reporting/organizations/${encodeURIComponent(oid)}/external-ids`,
        payload,
    )
    return data
}

export async function removeOrganizationExternalId(
    oid: string,
    id: string,
): Promise<void> {
    await axios.delete(
        `/api/reporting/organizations/${encodeURIComponent(oid)}/external-ids/${encodeURIComponent(id)}`,
    )
}

export async function downloadIndicatorFactsExport(periodId: string): Promise<void> {
    const response = await axios.get<Blob>('/api/reporting/export/indicator-facts', {
        params: { periodId },
        responseType: 'blob',
    })
    const disposition = response.headers['content-disposition'] as string | undefined
    const match = disposition?.match(/filename\*=UTF-8''([^;]+)/)
    const filename = match ? decodeURIComponent(match[1]) : 'indicator-facts.xlsx'
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}
