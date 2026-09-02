import {
    addEpguVisibilitySourceMismatchFindings,
    calculateInstitutionPilotProgress,
    calculatePilotCoverage,
    classifyPilotInstitutionSemd,
    resolvePilotRequirementStatus,
    resolvePilotReferenceReadiness,
    resolvePrimaryEpguVisible,
} from './pilot-calculation.pure'
import {
    PILOT_EPGU_REFERENCE_TYPES,
    PILOT_TARGET_TYPES,
    type FindingToSave,
    type SemdTypeRow,
} from './pilot-calculation.types'

function semdType(overrides: Partial<SemdTypeRow>): SemdTypeRow {
    return {
        id: 'type-1',
        code: 'nsi_type_6',
        nsiOid: '6',
        officialOid: null,
        officialName5pr: null,
        name: 'Протокол инструментального исследования',
        epguAvailable: null,
        epguVisibleRegistry: null,
        ...overrides,
    }
}

describe('pilot indicator calculation rules', () => {
    it('целевое число видов — 35 по Соглашению (В-05, 20.08.2026)', () => {
        expect(PILOT_TARGET_TYPES).toBe(35)
    })

    it('состав справочника ЕПГУ отделён от цели показателя', () => {
        // Одна константа вела обе величины, и смена цели на 35 заблокировала бы
        // импорт матрицы: её предпросмотр сверяет состав справочника этим же числом.
        expect(PILOT_EPGU_REFERENCE_TYPES).toBe(36)
        expect(PILOT_EPGU_REFERENCE_TYPES).not.toBe(PILOT_TARGET_TYPES)
    })

    it('does not declare an official result when the EPGU reference is missing', () => {
        expect(resolvePilotReferenceReadiness({
            catalogTypeCount: 151,
            unknownTypeCount: 151,
            epguAvailableTypeCount: 0,
            hasRemdData: true,
        })).toBe('epgu_reference_missing')
    })

    it('requires every catalog type to be classified', () => {
        expect(resolvePilotReferenceReadiness({
            catalogTypeCount: 151,
            unknownTypeCount: 1,
            epguAvailableTypeCount: 80,
            hasRemdData: true,
        })).toBe('epgu_reference_incomplete')

        expect(resolvePilotReferenceReadiness({
            catalogTypeCount: 151,
            unknownTypeCount: 0,
            epguAvailableTypeCount: 80,
            hasRemdData: true,
        })).toBe('ready')
    })

    it('calculates the secondary coverage percentage', () => {
        expect(calculatePilotCoverage(35, 40)).toBe(87.5)
        expect(calculatePilotCoverage(0, 40)).toBe(0)
        expect(calculatePilotCoverage(10, 0)).toBeNull()
        expect(calculatePilotCoverage(null, 40)).toBeNull()
    })

    it('calculates a preliminary institution result only from known required types', () => {
        expect(calculateInstitutionPilotProgress({
            actualRequiredTypeCount: 8,
            requiredTypeCount: 10,
            missingApplicabilityRuleCount: 0,
            unknownApplicabilityCount: 25,
        })).toEqual({
            applicabilityComplete: false,
            isPreliminary: true,
            actualTypeCount: 8,
            plannedTypeCount: 10,
            coveragePercent: 80,
        })
    })

    it('does not invent a denominator when no required type is known', () => {
        expect(calculateInstitutionPilotProgress({
            actualRequiredTypeCount: 0,
            requiredTypeCount: 0,
            missingApplicabilityRuleCount: 10,
            unknownApplicabilityCount: 25,
        })).toEqual({
            applicabilityComplete: false,
            isPreliminary: false,
            actualTypeCount: null,
            plannedTypeCount: null,
            coveragePercent: null,
        })
    })

    it('classifies institution SEMD rows without blaming unknown rules', () => {
        expect(classifyPilotInstitutionSemd({
            requirementStatus: 'required',
            registered: false,
            gisAvailable: true,
        })).toBe('required_missing')
        expect(classifyPilotInstitutionSemd({
            requirementStatus: 'required',
            registered: false,
            gisAvailable: false,
        })).toBe('required_gis_unavailable')
        expect(classifyPilotInstitutionSemd({
            requirementStatus: 'unknown',
            registered: false,
            gisAvailable: true,
        })).toBe('unknown')
        expect(classifyPilotInstitutionSemd({
            requirementStatus: 'missing',
            registered: true,
            gisAvailable: true,
        })).toBe('unknown_registered')
        expect(classifyPilotInstitutionSemd({
            requirementStatus: 'not_required',
            registered: true,
            gisAvailable: true,
        })).toBe('not_required_registered')
    })

    it('gives a manual applicability clarification priority without losing the base rule', () => {
        expect(resolvePilotRequirementStatus(
            'unknown',
            'required',
        )).toBe('required')
        expect(resolvePilotRequirementStatus(
            'required',
            'not_required',
        )).toBe('not_required')
        expect(resolvePilotRequirementStatus(
            'required',
            null,
        )).toBe('required')
    })

    it('uses doc_visible (1253) for EPGU visibility with SHOW_PATIENT (1520) as fallback', () => {
        expect(resolvePrimaryEpguVisible(semdType({
            epguAvailable: false,
            epguVisibleRegistry: true,
        }))).toBe(true)
        expect(resolvePrimaryEpguVisible(semdType({
            epguAvailable: true,
            epguVisibleRegistry: null,
        }))).toBe(true)
        expect(resolvePrimaryEpguVisible(semdType({
            epguAvailable: null,
            epguVisibleRegistry: true,
        }))).toBe(true)
        expect(resolvePrimaryEpguVisible(semdType({
            epguAvailable: false,
            epguVisibleRegistry: null,
        }))).toBe(false)
    })

    it('flags a finding when SHOW_PATIENT and doc_visible disagree for the same type', () => {
        const findings: FindingToSave[] = []
        addEpguVisibilitySourceMismatchFindings(findings, [
            semdType({ id: 'a', epguAvailable: true, epguVisibleRegistry: false }),
            semdType({ id: 'b', epguAvailable: true, epguVisibleRegistry: true }),
            semdType({ id: 'c', epguAvailable: null, epguVisibleRegistry: true }),
        ])
        expect(findings).toHaveLength(1)
        expect(findings[0]).toEqual(expect.objectContaining({
            semdTypeId: 'a',
            findingCode: 'epgu_visibility_source_mismatch',
        }))
    })
})
