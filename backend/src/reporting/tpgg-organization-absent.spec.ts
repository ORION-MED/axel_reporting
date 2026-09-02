import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'
import { addTpggOrganizationAbsentFindings } from './pilot-calculation.pure'
import type { FindingToSave } from './pilot-calculation.types'
import type { TpggPlanEntry } from './tpgg-workbook-parser'

/**
 * Р10: отличаем надёжный вывод ТПГГ от вывода на допущении.
 *
 * «МО есть в терпрограмме, но объёма по этому профилю нет» — источник высказался,
 * обязательность снимается молча. «МО вообще нет в файле ТПГГ» — источник промолчал,
 * обязательность снимается на допущении «учреждение вне ОМС», и это допущение должно
 * попасть в диагностику для подтверждения методологом.
 */

// Сервис инстанцируем без зависимостей: проверяемые методы чисто вычислительные,
// к БД и хранилищу не обращаются.
const service = new ApplicabilityMatrixImportService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
)

function resolveTpggVerdict(
    rule: Record<string, unknown>,
    organizationOid: string,
    entriesByOrganization: Map<string, TpggPlanEntry[]>,
) {
    return (service as unknown as {
        resolveTpggVerdict: (
            rule: unknown,
            organization: { oid: string },
            entries: Map<string, TpggPlanEntry[]>,
        ) => { verdict: string; organizationAbsentFromTpgg?: boolean }
    }).resolveTpggVerdict(rule, { oid: organizationOid }, entriesByOrganization)
}

/** Правило с основанием уровня 2 («утверждено госзаданием») — только для них работает ТПГГ. */
function stateTaskRule(semdTypeCode: string) {
    return {
        semdTypeCode,
        grounds: [{ level: 2, text: 'Утверждено госзаданием и(или) региональными актами' }],
    }
}

function entry(sheetCode: string, annualValue: number): TpggPlanEntry {
    return {
        sheetName: `${sheetCode} Тестовый раздел`,
        sheetCode,
        rowNumber: 7,
        organizationName: 'ГБУ «Тестовая больница»',
        normalizedOrganizationName: 'гбу тестовая больница',
        annualValue,
        // Правила применимости смотрят только на годовой объём: «утверждён или нет» —
        // свойство года, а не месяца.
        monthlyValues: {},
    }
}

describe('resolveTpggVerdict: отсутствие МО в ТПГГ vs нулевой объём', () => {
    const OID = '1.2.643.5.1.13.13.12.2.45.4319'

    it('положительный объём делает вид обязательным', () => {
        const result = resolveTpggVerdict(
            stateTaskRule('121'),
            OID,
            new Map([[OID, [entry('2.7', 40)]]]),
        )

        expect(result.verdict).toBe('required')
        expect(result.organizationAbsentFromTpgg).toBeFalsy()
    })

    it('нулевой объём снимает обязательность и НЕ помечается как допущение', () => {
        const result = resolveTpggVerdict(
            stateTaskRule('121'),
            OID,
            new Map([[OID, [entry('2.7', 0)]]]),
        )

        // Источник высказался прямо — правило ТПГГ вернуло not_required само,
        // до ветки с допущением дело не доходит.
        expect(result.verdict).toBe('not_required')
        expect(result.organizationAbsentFromTpgg).toBeFalsy()
    })

    it('МО есть в ТПГГ, но не в релевантном разделе — вывод надёжный, без пометки', () => {
        const result = resolveTpggVerdict(
            stateTaskRule('121'),
            OID,
            new Map([[OID, [entry('5', 1200)]]]),
        )

        expect(result.verdict).toBe('not_required')
        expect(result.organizationAbsentFromTpgg).toBe(false)
    })

    it('МО вообще нет в файле ТПГГ — обязательность снята, но помечена как допущение', () => {
        const result = resolveTpggVerdict(
            stateTaskRule('121'),
            OID,
            new Map(),
        )

        expect(result.verdict).toBe('not_required')
        expect(result.organizationAbsentFromTpgg).toBe(true)
    })

    it('без основания «госзадание» ТПГГ не вмешивается вовсе', () => {
        const result = resolveTpggVerdict(
            { semdTypeCode: '121', grounds: [{ level: 1, text: 'Условия входимости МЗ РФ' }] },
            OID,
            new Map(),
        )

        expect(result.verdict).toBe('unknown')
    })

    it('для видов, где нулевой объём не решающий, отсутствие МО ничего не снимает', () => {
        const result = resolveTpggVerdict(
            stateTaskRule('6'),
            OID,
            new Map(),
        )

        expect(result.verdict).toBe('unknown')
    })
})

describe('addTpggOrganizationAbsentFindings', () => {
    it('порождает причину по каждой затронутой паре МО × вид', () => {
        const findings: FindingToSave[] = []
        addTpggOrganizationAbsentFindings(findings, [
            { organizationOid: '1.2.3', semdTypeId: 'type-121' },
            { organizationOid: '4.5.6', semdTypeId: 'type-121' },
        ])

        expect(findings).toHaveLength(2)
        expect(findings[0].findingCode).toBe(
            'requirement_waived_organization_absent_from_tpgg',
        )
        expect(findings[0].severity).toBe('info')
        expect(findings[0].organizationOid).toBe('1.2.3')
        expect(findings[0].semdTypeId).toBe('type-121')
    })

    it('текст причины не содержит имён — иначе группировка FR-11 не схлопнёт карточки', () => {
        const findings: FindingToSave[] = []
        addTpggOrganizationAbsentFindings(findings, [
            { organizationOid: '1.2.3', semdTypeId: 'type-121' },
            { organizationOid: '4.5.6', semdTypeId: 'type-141' },
        ])

        expect(new Set(findings.map((finding) => finding.cause)).size).toBe(1)
        expect(findings[0].cause).not.toMatch(/1\.2\.3/)
    })
})
