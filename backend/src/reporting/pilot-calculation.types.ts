export const PILOT_INDICATOR_ID = 'semd_types_epgu_coverage'

/**
 * Целевое число видов СЭМД показателя 6.1.3.2.7.
 *
 * 35 — ответ методолога на вопрос В-05 (файл согласования от 20.08.2026): цель берётся
 * из показателя 6.1.3.2.7 Соглашения о предоставлении иного межбюджетного трансферта
 * на информатизацию здравоохранения, там же стоит и в «Приложении 2». До 20.08.2026
 * в расчёте стояло 36 — число видов, которое дали справочники доступности на ЕПГУ
 * (1253 и 1520) 07.08.2026. Развилка «35 или 36» закрыта в пользу Соглашения.
 *
 * Следствие правки: факт региона тоже 35, поэтому показатель переходит из
 * `below_target` в `target_met`, а причина `regional_target_not_met` больше
 * не выставляется. Это ожидаемо и согласовано, а не потеря находки.
 */
export const PILOT_TARGET_TYPES = 35

/**
 * Сколько видов с признаком доступности на ЕПГУ ожидается в справочниках 1253/1520.
 *
 * Отделено от цели 20.08.2026. Раньше обе величины вела одна константа, и это работало
 * только пока они совпадали: тем же числом проверяется состав справочника при импорте
 * матрицы применимости, причём **блокировкой** («найдено 36 видов вместо 35»). Простая
 * смена цели на 35 запретила бы применять матрицу — цель по Соглашению и фактический
 * состав справочника это разные вещи, и расходиться они имеют право.
 */
export const PILOT_EPGU_REFERENCE_TYPES = 36

export type PilotCalculationReadiness =
    | 'ready'
    | 'remd_data_missing'
    | 'epgu_reference_missing'
    | 'epgu_reference_incomplete'
    | 'epgu_reference_empty'
    | 'applicability_incomplete'
    | 'not_applicable'

export interface PilotDiagnosticFinding {
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

export interface PilotCalculationResult {
    periodId: string
    indicatorId: typeof PILOT_INDICATOR_ID
    calculatedAt: string
    sourceImportId: string | null
    region: {
        readiness: PilotCalculationReadiness
        actualTypeCount: number | null
        plannedTypeCount: number | null
        coveragePercent: number | null
        targetTypeCount: number
        rawActiveTypeCount: number
        catalogTypeCount: number
        epguAvailableTypeCount: number
        epguUnavailableTypeCount: number
        epguUnknownTypeCount: number
        unknownActiveTypeCount: number
        types: Array<{
            id: string
            code: string
            name: string
            nsiOid: string | null
            officialOid: string | null
            officialName5pr: string | null
            covered: boolean
        }>
    }
    organizations: Array<{
        organizationOid: string
        readiness: PilotCalculationReadiness
        isPreliminary: boolean
        actualTypeCount: number | null
        plannedTypeCount: number | null
        coveragePercent: number | null
        rawActiveTypeCount: number
        epguActiveTypeCount: number
        knownApplicabilityCount: number
        requiredTypeCount: number
        notRequiredTypeCount: number
        missingApplicabilityRuleCount: number
        unknownApplicabilityCount: number
        manualOverrideCount: number
        blockedByRegionalGisCount: number
        missingAtInstitutionCount: number
        unknownGisCapabilityCount: number
        /** В12: обязательные виды, которые регион ведёт в другой информационной системе. */
        handledInExternalSystemCount: number
        unexpectedRegisteredTypeCount: number
    }>
    findingCount: number
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

export type PilotRequirementStatus =
    | 'required'
    | 'not_required'
    | 'unknown'
    | 'missing'

export interface PilotInstitutionDetails {
    periodId: string
    indicatorId: typeof PILOT_INDICATOR_ID
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
        requirementStatus: PilotRequirementStatus
        baseRequirementStatus: PilotRequirementStatus
        resultStatus: PilotInstitutionSemdStatus
        documentCount: number
        registered: boolean
        gisAvailable: boolean | null
        requirementReason: string
        requirementSource: string
        baseRequirementReason: string
        baseRequirementSource: string
        /** Р9: основания обязательности из формы_1 («Приоритет обязательности 1..4»). */
        requirementGrounds: Array<{ level: number; text: string }>
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

export interface SemdTypeRow {
    id: string
    code: string
    nsiOid: string | null
    name: string
    epguAvailable: boolean | null
    /** Roadmap Пакет A, задача 10 — реальный OID (1253.doc_kind), не «Вид МД». */
    officialOid: string | null
    /** Roadmap Пакет A, задача 10 — doc_visible из справочника 1253, основной флаг для 6.1.3.2.7. */
    epguVisibleRegistry: boolean | null
    /** ТЗ 6.1.3.2.7 п.1.1 — официальное наименование по перечню №5пр (join по «Вид МД»). */
    officialName5pr: string | null
}

export interface OrganizationRow {
    oid: string
    officialFullName: string
    officialShortName: string
    commonName: string
    address: string
    latitude: number | null
    longitude: number | null
    locationSource: string
    locationPrecision: string
}

export interface RequirementRow {
    organizationOid: string
    semdTypeId: string
    requirementStatus: 'required' | 'not_required' | 'unknown'
    gisAvailable: boolean | null
    reason: string
    sourceName: string
    isManualOverride: boolean
}

export interface FindingToSave {
    organizationOid: string | null
    semdTypeId: string | null
    findingCode: string
    severity: 'info' | 'warning' | 'error'
    cause: string
    responsibilityArea: string
    recommendation: string
    evidence: Record<string, unknown>
}
