import { toPercent } from './semd-volume-ratio.calculator'
import type { MonthlySeriesPoint } from './semd-monthly-series'

/**
 * Блок «от факта» — верхняя часть дашборда динамики (Д-23).
 *
 * ТЗ от 24.08.2026: «Для диаграммы с фактическими значениями законченных
 * амб.случаев (которые были поданы на оплату в ТФОМС) из объективных данных
 * у нас есть только исполнение ТПГГ за янв-июнь 2026г». Отсюда четыре плитки:
 * план по терпрограмме, факт по реестрам ОМС, зарегистрированные СЭМД
 * и доля СЭМД **от факта**, а не от плана.
 *
 * **Почему это отдельная величина, а не то же, что на диаграмме.** Нижняя
 * диаграмма считает долю от планового объёма — того, что утверждено. Здесь
 * знаменатель другой: случаи, реально поданные на оплату. Первое отвечает
 * на вопрос «успеваем ли за планом», второе — «на все ли пролеченные случаи
 * оформлен документ». Значения расходятся заметно, и путать их нельзя.
 *
 * **Период задаёт файл исполнения, а не отчётный период.** Фонд прислал срез
 * за январь–июнь; план и СЭМД берутся ровно за те же месяцы, иначе доля
 * считалась бы по разным отрезкам года.
 */

export interface ExecutionSummaryInput {
    /** Границы среза исполнения из файлов ТФОМС. */
    fromMonth: number
    toMonth: number
    /** Факт по реестрам ОМС за срез — сумма по листам знаменателя. */
    executionFact: number
    /** Точки нижней диаграммы: из них берутся план и СЭМД тех же месяцев. */
    points: readonly MonthlySeriesPoint[]
}

export interface ExecutionSummary {
    fromMonth: number
    toMonth: number
    /** Плановый объём по терпрограмме за месяцы среза. */
    planValue: number
    /** Фактические случаи по реестрам ОМС за те же месяцы. */
    factValue: number
    /** Зарегистрировано СЭМД за те же месяцы. */
    semdValue: number
    /** Доля СЭМД от факта, в процентах. `null` — фактов нет, делить не на что. */
    percentOfFact: number | null
    /**
     * Месяцы среза, за которые выгрузка РЭМД не загружена.
     *
     * Не мелочь: без них «зарегистрировано СЭМД» занижено, и доля выглядит
     * хуже, чем есть. Интерфейс обязан сказать об этом вслух, а не молча
     * показать красивое круглое число.
     */
    missingMonths: number[]
}

export function buildExecutionSummary(
    input: ExecutionSummaryInput,
): ExecutionSummary | null {
    const { fromMonth, toMonth } = input
    if (!isMonth(fromMonth) || !isMonth(toMonth) || fromMonth > toMonth) return null

    const inRange = input.points.filter(
        (point) => point.month >= fromMonth && point.month <= toMonth,
    )

    // План суммируется только по месяцам, где роспись есть. Отсутствующий план
    // — это `null`, и складывать его как ноль значило бы занизить знаменатель.
    const planValue = inRange.reduce(
        (sum, point) => sum + (point.plan ?? 0), 0,
    )
    const semdValue = inRange.reduce(
        (sum, point) => sum + (point.fact ?? 0), 0,
    )
    const missingMonths = inRange
        .filter((point) => point.fact === null)
        .map((point) => point.month)

    return {
        fromMonth,
        toMonth,
        planValue,
        factValue: input.executionFact,
        semdValue,
        percentOfFact: input.executionFact > 0
            ? toPercent(semdValue, input.executionFact)
            : null,
        missingMonths,
    }
}

function isMonth(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 12
}
