import { evaluateTpggSemdRule } from './tpgg-semd-rules'
import type { TpggPlanEntry } from './tpgg-workbook-parser'

function entry(
    sheetCode: string,
    annualValue: number,
): TpggPlanEntry {
    return {
        sheetName: `${sheetCode} Тестовый раздел`,
        sheetCode,
        rowNumber: 7,
        organizationName: 'ГБУ «Тестовая больница»',
        normalizedOrganizationName: 'гбу тестовая больница',
        annualValue,
        // Правила применимости смотрят только на годовой объём.
        monthlyValues: {},
    }
}

describe('ТПГГ applicability rules', () => {
    it('marks an exact positive section as required', () => {
        const result = evaluateTpggSemdRule('74', [entry('1', 100)])

        expect(result.requirementStatus).toBe('required')
        expect(result.evidence).toHaveLength(1)
    })

    it('uses zero as not required only for an explicit bidirectional rule', () => {
        expect(
            evaluateTpggSemdRule('85', [entry('2.2', 0)])
                .requirementStatus,
        ).toBe('not_required')
        expect(
            evaluateTpggSemdRule('6', [entry('2.3', 0)])
                .requirementStatus,
        ).toBe('unknown')
    })

    it('keeps unsupported types unknown', () => {
        const result = evaluateTpggSemdRule('999', [entry('1', 100)])

        expect(result.requirementStatus).toBe('unknown')
        expect(result.rule).toBeNull()
    })

    /**
     * Р10 (рекомендации 27.07, п.9.5): цитологическое исследование обязательно только для МО
     * с утверждённым объёмом по разделу 2.7 ПАИ. В ТПГГ Курганской области на 2026 год такой
     * объём есть только у ГБУ «КООД» (5000) и ГБУ «ШГБ» (2000).
     */
    it('requires cytology only for organizations with approved 2.7 volume', () => {
        expect(
            evaluateTpggSemdRule('121', [entry('2.7', 5000)])
                .requirementStatus,
        ).toBe('required')
        expect(
            evaluateTpggSemdRule('121', [entry('2.7', 0)])
                .requirementStatus,
        ).toBe('not_required')
    })
})
