import {
    aggregateNumerator,
    toPercent,
    type SemdVolumeRatioConfig,
} from './semd-volume-ratio.calculator'

/**
 * Помесячные кривые «план против факта» — Д-9.
 *
 * Зачем. Николай Ермаков на ВКС 24.08.2026: «количество зарегистрированных
 * СЭМДов должно следовать строго за графиком количества зарегистрированных
 * случаев — вот идеальное состояние», и наоборот: «а если у нас график
 * законченных случаев кривую, а график СЭМДов имеет сначала прямую, а потом
 * пару всплесков — это не цифровая трансформация, это рукоблудие».
 *
 * То есть смысл графика не в уровне, а в форме: ровные кривые означают, что
 * оформление документов встроено в работу, всплеск в конце года — что их делают
 * авралом.
 *
 * **Обе линии помесячные, а не накопительные.** Накопительные кривые растут
 * монотонно и выглядят гладко даже там, где месяц пропущен целиком, — ровно тот
 * авральный характер, ради которого график и заводился, на них не виден.
 * Накопительный план остаётся знаменателем показателя, это разные вещи.
 *
 * **Числитель считается тем же `aggregateNumerator`, что и карточка.** У 6.1.3.2.9
 * агрегат `max` по двум видам, и максимум суммы не равен сумме максимумов;
 * своя реализация здесь однажды разошлась бы с показателем незаметно.
 */

export interface MonthlySeriesFact {
    month: number
    organizationOid: string
    /** Код «Вид МД» — тот же ключ, что в конфигурации показателя. */
    semdTypeCode: string
    documentCount: number
}

export interface MonthlySeriesPlan {
    organizationOid: string
    sheetCode: string
    /** Роспись по месяцам: номер месяца (1–12) → объём. */
    monthlyValues: Readonly<Record<number, number>>
}

export interface MonthlySeriesPoint {
    month: number
    /**
     * План месяца по росписи терпрограммы. `null` — росписи нет вовсе:
     * рисовать ноль нельзя, иначе месяц выглядит как невыполненный план.
     */
    plan: number | null
    /**
     * Факт месяца по выгрузке РЭМД. `null` — выгрузка за месяц не загружена.
     * Это не то же самое, что ноль: у ноля линия падает в пол и читается
     * как провал, которого не было.
     */
    fact: number | null
    /**
     * Доля СЭМД от планового объёма месяца — третья линия диаграммы по ТЗ
     * от 24.08.2026: «доля СЭМД (от плана)», подписи вида «январь; 101».
     *
     * Считается здесь, а не на клиенте, тем же `toPercent`, что и карточка:
     * два независимых округления однажды разошлись бы на границе, и объяснять
     * пользователю, почему в окне 73, а в карточке 72,99, было бы нечем.
     *
     * `null`, если нет плана или нет выгрузки за месяц: доли просто не существует,
     * и ноль на её месте читался бы как «ничего не передали».
     */
    ratio: number | null
}

export interface MonthlySeriesInput {
    config: SemdVolumeRatioConfig
    /**
     * Контур расчёта: все целевые МО для региональной кривой либо одна МО.
     * Регион считается как сумма по МО — так же, как в самом показателе.
     */
    organizationOids: readonly string[]
    facts: readonly MonthlySeriesFact[]
    plans: readonly MonthlySeriesPlan[]
    /** Месяцы, за которые выгрузки РЭМД действительно загружены. */
    loadedMonths: readonly number[]
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export function buildSemdMonthlySeries(
    input: MonthlySeriesInput,
): MonthlySeriesPoint[] {
    const targetOids = new Set(input.organizationOids)
    const loadedMonths = new Set(input.loadedMonths)
    const sheetCodes = new Set(input.config.tpggSheetCodes)

    // Факты: месяц → МО → вид → количество. Разложение по МО обязательно:
    // числитель у 6.1.3.2.9 берёт максимум внутри МО, а регион суммирует уже
    // посчитанные значения.
    const factsByMonth = new Map<number, Map<string, Map<string, number>>>()
    for (const fact of input.facts) {
        if (!targetOids.has(fact.organizationOid)) continue
        const byOrganization = factsByMonth.get(fact.month)
            ?? new Map<string, Map<string, number>>()
        const counts = byOrganization.get(fact.organizationOid)
            ?? new Map<string, number>()
        counts.set(
            fact.semdTypeCode,
            (counts.get(fact.semdTypeCode) ?? 0) + fact.documentCount,
        )
        byOrganization.set(fact.organizationOid, counts)
        factsByMonth.set(fact.month, byOrganization)
    }

    // План: месяц → объём по всем листам знаменателя и всем МО контура.
    // Отдельно помним, нашлась ли роспись хоть у кого-то: без неё месяц —
    // прочерк, а не ноль.
    const planByMonth = new Map<number, number>()
    let hasAnyMonthlyPlan = false
    for (const plan of input.plans) {
        if (!targetOids.has(plan.organizationOid)) continue
        if (!sheetCodes.has(plan.sheetCode)) continue
        for (const month of MONTHS) {
            const value = plan.monthlyValues[month]
            if (typeof value !== 'number' || !Number.isFinite(value)) continue
            hasAnyMonthlyPlan = true
            planByMonth.set(month, (planByMonth.get(month) ?? 0) + value)
        }
    }

    return MONTHS.map((month) => {
        const plan = hasAnyMonthlyPlan ? planByMonth.get(month) ?? 0 : null
        const fact = loadedMonths.has(month)
            ? monthFact(input.config, factsByMonth.get(month))
            : null
        return {
            month,
            plan,
            fact,
            // Ноль в знаменателе отбрасывается вместе с отсутствующим планом:
            // делить не на что, а «бесконечный процент» рисовать негде.
            ratio: plan !== null && plan > 0 && fact !== null
                ? toPercent(fact, plan)
                : null,
        }
    })
}

/**
 * Факт месяца: числитель считается по каждой МО отдельно и складывается.
 *
 * Месяц загружен, но фактов по нужным видам нет — это честный ноль, а не
 * отсутствие данных: выгрузка пришла и в ней по этим видам пусто.
 */
function monthFact(
    config: SemdVolumeRatioConfig,
    byOrganization: ReadonlyMap<string, Map<string, number>> | undefined,
): number {
    if (!byOrganization) return 0
    let total = 0
    for (const counts of byOrganization.values()) {
        total += aggregateNumerator(config, counts)
    }
    return total
}
