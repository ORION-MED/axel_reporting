export type ReportingIndicatorValueKind = 'count' | 'percent' | 'count_and_percent'

export type ReportingCalculationType =
    | 'manual'
    | 'ratio_percent'
    | 'semd_type_coverage'
    /** Доли СЭМД к утверждённым объёмам ТПГГ — показатели 6.1.3.2.8–6.1.3.2.11. */
    | 'semd_volume_ratio'
    /** Виды СЭМД, регистрируемые в РЭМД, к Перечню № 5пр — показатель 27. */
    | 'semd_type_registry'

export type ReportingLocationPrecision =
    | 'exact'
    | 'street'
    | 'locality'
    | 'approximate'
    | 'unknown'

export type ReportingRequirementStatus = 'required' | 'not_required' | 'unknown'

export type ReportingRemdScope = 'region' | 'organization' | 'subdivision'

export type ReportingIssueSeverity = 'info' | 'warning' | 'error'

export interface ReportingPilotIndicatorContract {
    id: string
    code: string
    title: string
    unit: string
    valueKind: ReportingIndicatorValueKind
    calculationType: ReportingCalculationType
    metadata: Record<string, unknown>
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
    locationPrecision: ReportingLocationPrecision
    /** ТЗ 6.1.3.2.7 п.1.3 — «Вид деятельности организации» из ФРМР (Госпиталь, Диспансер, ...). */
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

export interface ReportingSemdType {
    id: string
    code: string
    nsiOid: string | null
    name: string
    documentFormat: string
    versionLabel: string
    epguAvailable: boolean | null
    effectiveFrom: string | null
    effectiveTo: string | null
    isActive: boolean
    sourceImportId: string | null
    metadata: Record<string, unknown>
    createdAt: string
    updatedAt: string
}
