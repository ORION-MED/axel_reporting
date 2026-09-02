import type { ReportingDiagnosticFinding } from '@shared/lib/reporting-api'

const SEVERITY_WEIGHT: Record<ReportingDiagnosticFinding['severity'], number> = {
    error: 0,
    warning: 1,
    info: 2,
}

export interface DiagnosticFindingGroup {
    key: string
    severity: ReportingDiagnosticFinding['severity']
    cause: string
    recommendation: string
    responsibilityArea: string
    semdTypeNames: string[]
    organizationNames: string[]
    findingCount: number
    evidenceChips: Array<{ label: string; values: string[]; total: number }>
}

const EVIDENCE_CHIP_FIELDS: ReadonlyArray<{
    valuesKey: string
    countKey: string
    label: string
}> = [
    {
        valuesKey: 'unknownSubdivisionOids',
        countKey: 'unknownSubdivisionCount',
        label: 'OID подразделений',
    },
    {
        valuesKey: 'unmappedTypeNames',
        countKey: 'unmappedTypeCount',
        label: 'Виды документов из выгрузки',
    },
]

function collectEvidenceChips(
    findings: ReportingDiagnosticFinding[],
): DiagnosticFindingGroup['evidenceChips'] {
    const chips: DiagnosticFindingGroup['evidenceChips'] = []
    for (const field of EVIDENCE_CHIP_FIELDS) {
        const values: string[] = []
        let total = 0
        for (const finding of findings) {
            const raw = finding.evidence?.[field.valuesKey]
            if (Array.isArray(raw)) {
                for (const item of raw) {
                    const value = String(item)
                    if (!values.includes(value)) values.push(value)
                }
            }
            const count = Number(finding.evidence?.[field.countKey])
            if (Number.isFinite(count)) total = Math.max(total, count)
        }
        if (values.length > 0) {
            chips.push({ label: field.label, values, total: Math.max(total, values.length) })
        }
    }
    return chips
}

/** Groups repeated diagnostic findings into one management-facing reason card. */
export function groupFindings(
    findings: ReportingDiagnosticFinding[],
    organizationNameByOid: Readonly<Record<string, string>> = {},
): DiagnosticFindingGroup[] {
    const groups = new Map<string, DiagnosticFindingGroup>()
    const findingsByKey = new Map<string, ReportingDiagnosticFinding[]>()
    for (const finding of findings) {
        const key = [finding.findingCode, finding.cause, finding.recommendation].join('|')
        findingsByKey.set(key, [...(findingsByKey.get(key) ?? []), finding])
        const group = groups.get(key) ?? {
            key,
            severity: finding.severity,
            cause: finding.cause,
            recommendation: finding.recommendation,
            responsibilityArea: finding.responsibilityArea,
            semdTypeNames: [],
            organizationNames: [],
            findingCount: 0,
            evidenceChips: [],
        }
        group.findingCount += 1
        if (SEVERITY_WEIGHT[finding.severity] < SEVERITY_WEIGHT[group.severity]) {
            group.severity = finding.severity
        }
        if (finding.semdTypeName && !group.semdTypeNames.includes(finding.semdTypeName)) {
            group.semdTypeNames.push(finding.semdTypeName)
        }
        const organizationName = finding.organizationOid
            ? organizationNameByOid[finding.organizationOid] ?? finding.organizationOid
            : ''
        if (organizationName && !group.organizationNames.includes(organizationName)) {
            group.organizationNames.push(organizationName)
        }
        groups.set(key, group)
    }
    const byRussian = (left: string, right: string) => left.localeCompare(right, 'ru')
    return [...groups.values()]
        .map((group) => ({
            ...group,
            semdTypeNames: [...group.semdTypeNames].sort(byRussian),
            organizationNames: [...group.organizationNames].sort(byRussian),
            evidenceChips: collectEvidenceChips(findingsByKey.get(group.key) ?? []),
        }))
        .sort((left, right) => {
            const bySeverity = SEVERITY_WEIGHT[left.severity] - SEVERITY_WEIGHT[right.severity]
            return bySeverity !== 0 ? bySeverity : right.findingCount - left.findingCount
        })
}
