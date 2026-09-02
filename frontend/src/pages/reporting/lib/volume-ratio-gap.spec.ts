import { describe, expect, it } from 'vitest'
import type { ReportingOrganizationIndicatorValue } from '@shared/lib/reporting-api'
import { buildVolumeRatioGapSummary } from './volume-ratio-gap'

/**
 * Разбор недостачи у показателей-долей: сколько случаев оказания помощи прошло
 * без СЭМД. Главное, что проверяется, — недостача не путается с нулём: у МО без
 * утверждённого объёма её не существует, и в сумму она не входит.
 */

function organization(
    name: string,
    numerator: number,
    denominator: number | null,
    status: 'calculated' | 'no_approved_volume' | 'not_participating' = 'calculated',
    extra: Record<string, unknown> = {},
): ReportingOrganizationIndicatorValue {
    return {
        organizationOid: `oid-${name}`,
        organizationName: name,
        organizationFullName: name,
        indicatorId: 'semd_ambulance_call_card',
        numerator,
        denominator,
        factValue: denominator ? Math.round((numerator / denominator) * 10000) / 100 : null,
        calculationDetails: {
            status,
            numeratorByType: [{ semdTypeCode: '74', documentCount: numerator }],
            denominatorBySheet: [],
            usedAnnualFallback: false,
            ...extra,
        },
    } as unknown as ReportingOrganizationIndicatorValue
}

describe('разбор недостачи по долям', () => {
    it('считает недостачу как план минус факт и складывает её по региону', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-1', 40, 100),
            organization('МО-2', 10, 60),
        ])

        expect(summary.totalGap).toBe(110)
        expect(summary.totalFact).toBe(50)
        expect(summary.totalPlan).toBe(160)
        expect(summary.rows.map((row) => row.gap)).toEqual([60, 50])
    })

    it('сортирует по недостаче, а не по проценту', () => {
        // У «МО-мало» процент хуже (10 %), но в документах она теряет вдвое меньше.
        const summary = buildVolumeRatioGapSummary([
            organization('МО-мало', 10, 100),
            organization('МО-много', 800, 1000),
        ])

        expect(summary.rows.map((row) => row.organizationName)).toEqual(['МО-много', 'МО-мало'])
    })

    /**
     * Перевыполнение не должно уходить в минус: отрицательная недостача вычлась бы
     * из суммы и занизила общий разрыв по региону.
     */
    it('перевыполнение даёт нулевую недостачу, а не отрицательную', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-перевыполнение', 150, 100),
            organization('МО-отстаёт', 20, 100),
        ])

        expect(summary.rows.find((row) => row.organizationName === 'МО-перевыполнение')?.gap).toBe(0)
        expect(summary.totalGap).toBe(80)
    })

    /** «Нет утверждённого объёма» — не нулевая недостача, а её отсутствие. */
    it('МО без утверждённого объёма не даёт недостачи и не входит в сумму', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-с-планом', 20, 100),
            organization('МО-без-объёма', 500, null, 'no_approved_volume'),
        ])

        expect(summary.totalGap).toBe(80)
        expect(summary.noApprovedVolumeCount).toBe(1)
        expect(summary.rows.find((row) => row.organizationName === 'МО-без-объёма')?.gap).toBeNull()
    })

    it('МО без объёма и не участвующие уходят в конец списка', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-без-объёма', 500, null, 'no_approved_volume'),
            organization('МО-не-участвует', 0, null, 'not_participating'),
            organization('МО-с-планом', 20, 100),
        ])

        expect(summary.rows[0].organizationName).toBe('МО-с-планом')
        expect(summary.rows.slice(1).every((row) => row.gap === null)).toBe(true)
        expect(summary.notParticipatingCount).toBe(1)
    })

    it('считает долю каждой МО в общей недостаче', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-1', 0, 75),
            organization('МО-2', 0, 25),
        ])

        expect(summary.rows.map((row) => row.shareOfGap)).toEqual([75, 25])
    })

    /** Ради этого числа разбор и делается: «с кем разговаривать в первую очередь». */
    it('считает, сколько МО набирают первые 80 % недостачи', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-1', 0, 500),
            organization('МО-2', 0, 300),
            organization('МО-3', 0, 100),
            organization('МО-4', 0, 100),
        ])

        expect(summary.totalGap).toBe(1000)
        expect(summary.organizationsToCloseEightyPercent).toBe(2)
    })

    it('без недостачи вовсе список не предлагает адресатов', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-1', 100, 100),
            organization('МО-2', 200, 100),
        ])

        expect(summary.totalGap).toBe(0)
        expect(summary.organizationsToCloseEightyPercent).toBe(0)
        expect(summary.rows.every((row) => row.shareOfGap === null)).toBe(true)
    })

    /** Значения других показателей в разбор не попадают: у них нет этих деталей. */
    it('строки чужих показателей игнорируются', () => {
        const alien = {
            organizationOid: 'oid-alien',
            organizationName: 'МО-чужая',
            indicatorId: 'semd_types_remd_registry',
            numerator: 46,
            denominator: 145,
            factValue: 31.72,
            calculationDetails: { registeredTypeCount: 46 },
        } as unknown as ReportingOrganizationIndicatorValue

        const summary = buildVolumeRatioGapSummary([organization('МО-1', 20, 100), alien])

        expect(summary.rows).toHaveLength(1)
        expect(summary.calculatedCount).toBe(1)
    })

    it('помечает МО, у которых план взят за год', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-1', 20, 100, 'calculated', { usedAnnualFallback: true }),
        ])

        expect(summary.rows[0].usedAnnualFallback).toBe(true)
    })
})

/**
 * Числитель показателя считается по всем МО, недостача — только по тем, где есть план.
 * Разница обязана быть названа: иначе два числа выглядят как потерянные документы.
 */
describe('расхождение с числителем показателя', () => {
    it('считает документы МО без утверждённого объёма отдельно', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-с-планом', 20, 100),
            organization('МО-без-объёма-1', 500, null, 'no_approved_volume'),
            organization('МО-без-объёма-2', 300, null, 'no_approved_volume'),
        ])

        expect(summary.totalFact).toBe(20)
        expect(summary.factWithoutPlan).toBe(800)
        expect(summary.noApprovedVolumeCount).toBe(2)
    })

    it('не участвующие МО в эту цифру не попадают', () => {
        const summary = buildVolumeRatioGapSummary([
            organization('МО-не-участвует', 0, null, 'not_participating'),
        ])

        expect(summary.factWithoutPlan).toBe(0)
    })
})
