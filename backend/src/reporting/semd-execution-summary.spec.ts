import { buildExecutionSummary } from './semd-execution-summary'
import type { MonthlySeriesPoint } from './semd-monthly-series'

/**
 * Блок «от факта» (Д-23).
 *
 * Главное, что здесь защищается, — совпадение отрезков. План, СЭМД и факт
 * обязаны относиться к одним и тем же месяцам: фонд присылает срез
 * за январь–июнь, а выгрузки РЭМД идут дальше, и сложить их целиком значило бы
 * поделить восемь месяцев СЭМД на шесть месяцев случаев.
 */

function point(
    month: number,
    plan: number | null,
    fact: number | null,
): MonthlySeriesPoint {
    return {
        month,
        plan,
        fact,
        ratio: plan !== null && plan > 0 && fact !== null
            ? Math.round((fact / plan) * 10_000) / 100
            : null,
    }
}

const JANUARY_TO_AUGUST: MonthlySeriesPoint[] = [
    point(1, 266_979, 269_727),
    point(2, 266_918, 231_538),
    point(3, 266_983, 194_331),
    point(4, 266_912, 195_339),
    point(5, 266_982, 243_975),
    point(6, 266_935, 127_015),
    point(7, 266_983, 177_507),
    point(8, 266_915, null),
]

describe('buildExecutionSummary', () => {
    it('берёт план и СЭМД ровно за месяцы среза исполнения', () => {
        // Числа сверены с примером в ТЗ от 24.08.2026: СЭМД за январь-июнь
        // там 1 261 925, факт по реестрам ОМС — 1 776 769, доля 71 %.
        const summary = buildExecutionSummary({
            fromMonth: 1,
            toMonth: 6,
            executionFact: 1_776_769,
            points: JANUARY_TO_AUGUST,
        })!

        expect(summary.semdValue).toBe(1_261_925)
        expect(summary.factValue).toBe(1_776_769)
        expect(summary.percentOfFact).toBe(71.02)
        // Июль в срез не входит, хотя выгрузка за него есть.
        expect(summary.planValue).toBe(1_601_709)
    })

    it('месяцы без выгрузки называются поимённо', () => {
        // Иначе «зарегистрировано СЭМД» занижено, а доля выглядит хуже,
        // чем на самом деле, — и сказать об этом некому.
        const summary = buildExecutionSummary({
            fromMonth: 1,
            toMonth: 8,
            executionFact: 1_776_769,
            points: JANUARY_TO_AUGUST,
        })!

        expect(summary.missingMonths).toEqual([8])
    })

    it('без фактов по реестрам доли нет', () => {
        const summary = buildExecutionSummary({
            fromMonth: 1,
            toMonth: 6,
            executionFact: 0,
            points: JANUARY_TO_AUGUST,
        })!

        expect(summary.percentOfFact).toBeNull()
    })

    it('без границ среза блока не существует', () => {
        // Файл фонда, где период не распознан, не должен превращаться
        // в блок «за январь-январь» — лучше не показывать вовсе.
        expect(buildExecutionSummary({
            fromMonth: 0,
            toMonth: 6,
            executionFact: 100,
            points: JANUARY_TO_AUGUST,
        })).toBeNull()

        expect(buildExecutionSummary({
            fromMonth: 7,
            toMonth: 3,
            executionFact: 100,
            points: JANUARY_TO_AUGUST,
        })).toBeNull()
    })
})
