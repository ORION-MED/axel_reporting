/**
 * Доли СЭМД к утверждённым объёмам медицинской помощи — показатели 6.1.3.2.8–6.1.3.2.11.
 *
 * Одна чистая функция на все четыре показателя: они отличаются только списком видов СЭМД
 * в числителе, способом их агрегации и списком листов ТПГГ в знаменателе. Копий сервиса
 * быть не должно — конфигурация задаётся данными (`semd-volume-ratio.config.ts`).
 *
 * Почему не `engine/indicator-calculator.ts`: тот контракт рассчитан на один показатель =
 * одна пара «числитель/знаменатель». Здесь расчёт массовый — регион и каждая МО за один
 * проход, как у показателя 6.1.3.2.7.
 *
 * **Знаменатель взят из ТПГГ, а не из ФОМС.** Методика требует данных ФОМС, выгрузки нет
 * и не обещано; замена на объёмы госзадания предложена методологом на ВКС 07.08.2026
 * и подтверждена письменно. Это осознанное отступление, и оно обязано быть видно
 * в интерфейсе (задача Н8) — значения будут отличаться от федерального дашборда.
 *
 * **Знаменатель накопительный, а не годовой** (решение методолога и Николая Ермакова
 * на ВКС 15.08.2026). Числитель — выгрузка РЭМД нарастающим итогом за неполный год,
 * поэтому и план берётся нарастающим итогом по месяц отчётной даты: иначе семь месяцев
 * факта делятся на двенадцать месяцев плана и все четыре показателя оказываются
 * в «критическом отклонении» без всякой на то причины.
 *
 * Периоды всё равно сходятся не полностью: выгрузка РЭМД отстаёт от отчётной даты
 * (на 15.08.2026 — данные по 10.07), и без подписи с датой выгрузки цифра читается
 * как падение. Это задача интерфейса, а не расчёта.
 */

export type SemdVolumeAggregate = 'sum' | 'max'

export interface SemdVolumeRatioConfig {
    /** `reporting_indicators.id`. */
    indicatorId: string
    /** Код показателя по перечню — для сообщений и снимков. */
    code: string
    /** Коды видов СЭМД («Вид МД», `reporting_semd_types.nsi_oid`) в числителе. */
    semdTypeCodes: readonly string[]
    /**
     * Как свести несколько видов в одно число.
     * `max` нужен только 6.1.3.2.9 («наибольшее из видов 340 и 141»), остальным — `sum`.
     */
    aggregate: SemdVolumeAggregate
    /**
     * Виды, которые прибавляются к результату агрегации отдельным слагаемым.
     * Нужны для вида 551 в 6.1.3.2.9: методика добавляет его к наибольшему из двух,
     * а не участвует в выборе максимума.
     */
    additionalSemdTypeCodes?: readonly string[]
    /** Коды листов ТПГГ (`reporting_tpgg_plan_values.sheet_code`) в знаменателе. */
    tpggSheetCodes: readonly string[]
}

export interface SemdVolumeRatioFact {
    organizationOid: string
    semdTypeCode: string
    documentCount: number
}

export interface SemdVolumeRatioPlan {
    organizationOid: string
    sheetCode: string
    annualValue: number
    /**
     * Помесячная роспись: номер месяца (1–12) → объём. Пустая, если у листа ТПГГ
     * росписи не нашлось, — тогда строка считается по годовому плану, а результат
     * помечается `usedAnnualFallback`.
     */
    monthlyValues: Readonly<Record<number, number>>
}

export interface SemdVolumeRatioInput {
    /** Целевой контур: МО, попавшие в показатель. Факты прочих МО игнорируются. */
    organizationOids: readonly string[]
    facts: readonly SemdVolumeRatioFact[]
    plans: readonly SemdVolumeRatioPlan[]
    /**
     * Месяц отчётной даты периода (1–12): план накапливается с января по него
     * включительно. Берётся из периода, а не из системной даты, иначе пересчёт
     * прошлого периода однажды даст другую цифру.
     */
    throughMonth: number
}

/**
 * `no_approved_volume` — у МО есть зарегистрированные СЭМД, но утверждённого объёма
 * по нужным видам помощи в терпрограмме нет. Показывать такую МО нулём нельзя: это
 * не невыполнение, делить просто не на что. На данных 08.2026 таких пар «МО × показатель»
 * двенадцать. Методолог подтвердила это состояние на ВКС 15.08.2026: такие МО выполняют
 * объёмы по бюджету, а не по программе ОМС, — выводить справочно, в показатель не брать.
 *
 * Статус определяется по **годовому** плану: утверждён объём или нет — свойство года,
 * а не месяца. Если объём утверждён, но на прошедшие месяцы не расписан ни один,
 * статус остаётся `calculated`, а процент — прочерк: делить снова не на что.
 * На данных 08.2026 таких строк нет, но роспись целиком на декабрь законна.
 */
export type SemdVolumeRatioOrganizationStatus =
    | 'calculated'
    | 'no_approved_volume'
    | 'not_participating'

export interface SemdVolumeRatioTypeBreakdown {
    semdTypeCode: string
    documentCount: number
}

export interface SemdVolumeRatioSheetBreakdown {
    sheetCode: string
    /** Накопительный план по месяц отчётной даты — он и есть знаменатель. */
    cumulativeValue: number
    /** Годовой план: вторая цифра на карточке, «(за год: …)». */
    annualValue: number
    /** Роспись по листу не нашлась, накопительный план вынужденно равен годовому. */
    usedAnnualFallback: boolean
}

export interface SemdVolumeRatioOrganizationValue {
    organizationOid: string
    status: SemdVolumeRatioOrganizationStatus
    numerator: number
    /** Накопительный план по месяц отчётной даты. */
    denominator: number | null
    /** Годовой план — для второй цифры на карточке. */
    annualDenominator: number | null
    /**
     * Хотя бы по одному листу роспись не нашлась. Расчёт по такой МО предварительный:
     * часть знаменателя взята за весь год и потому завышена.
     */
    usedAnnualFallback: boolean
    percent: number | null
    /**
     * Разбивка числителя по видам СЭМД. Прямое требование ТЗ методолога для 6.1.3.2.10:
     * «выводим значения СЭМД по обоим видам СЭМД» отдельными строками. Для показателей
     * с одним видом строка одна — карточка МО не знает про эту разницу.
     */
    numeratorByType: SemdVolumeRatioTypeBreakdown[]
    /** Разбивка знаменателя по листам ТПГГ — чтобы было видно, из чего сложился план. */
    denominatorBySheet: SemdVolumeRatioSheetBreakdown[]
}

export interface SemdVolumeRatioRegionValue {
    numerator: number
    denominator: number
    annualDenominator: number
    /** Сколько МО посчитано с откатом на годовой план хотя бы по одному листу. */
    annualFallbackOrganizationCount: number
    percent: number | null
    organizationCount: number
    calculatedOrganizationCount: number
    /** МО с фактом, но без утверждённого объёма. */
    factWithoutPlanOrganizationCount: number
    notParticipatingOrganizationCount: number
    /**
     * Сколько документов пришло в числитель от МО без плана. Регион считается по сумме
     * фактов всех целевых МО, а знаменатель — только по тем, у кого объём утверждён,
     * поэтому эта часть числителя завышает региональный процент. Молча прятать её нельзя.
     */
    numeratorWithoutPlan: number
    numeratorByType: SemdVolumeRatioTypeBreakdown[]
    denominatorBySheet: SemdVolumeRatioSheetBreakdown[]
}

export interface SemdVolumeRatioResult {
    region: SemdVolumeRatioRegionValue
    organizations: SemdVolumeRatioOrganizationValue[]
}

export function calculateSemdVolumeRatio(
    config: SemdVolumeRatioConfig,
    input: SemdVolumeRatioInput,
): SemdVolumeRatioResult {
    const targetOids = new Set(input.organizationOids)
    const factsByOrganization = groupFacts(input.facts, targetOids)
    const plansByOrganization = groupPlans(input.plans, targetOids)

    const organizations = input.organizationOids.map((organizationOid) => {
        const counts = factsByOrganization.get(organizationOid) ?? new Map<string, number>()
        const plans = plansByOrganization.get(organizationOid) ?? new Map<string, SheetPlan>()

        const numeratorByType = breakdownByType(config, counts)
        const numerator = aggregateNumerator(config, counts)
        const denominatorBySheet = breakdownBySheet(config, plans, input.throughMonth)
        const cumulativeTotal = sumBy(denominatorBySheet, (item) => item.cumulativeValue)
        const annualTotal = sumBy(denominatorBySheet, (item) => item.annualValue)

        // Ноль в терпрограмме и отсутствие МО в терпрограмме — одно и то же:
        // утверждённого объёма нет, делить не на что. Смотрим на годовой план:
        // объём утверждён на год, а не на месяц.
        const hasPlan = annualTotal > 0
        const status: SemdVolumeRatioOrganizationStatus = hasPlan
            ? 'calculated'
            : numerator > 0
                ? 'no_approved_volume'
                : 'not_participating'

        return {
            organizationOid,
            status,
            numerator,
            denominator: hasPlan ? cumulativeTotal : null,
            annualDenominator: hasPlan ? annualTotal : null,
            usedAnnualFallback: denominatorBySheet.some(
                (item) => item.usedAnnualFallback,
            ),
            // Объём утверждён, но на прошедшие месяцы не расписан — прочерк,
            // а не ноль: делить не на что, невыполнением это не является.
            percent: hasPlan && cumulativeTotal > 0
                ? toPercent(numerator, cumulativeTotal)
                : null,
            numeratorByType,
            denominatorBySheet,
        }
    })

    const region = buildRegionValue(config, organizations)
    return { region, organizations }
}

/**
 * Числитель одной МО. «Наибольшее из двух видов» считается **по каждой МО отдельно**,
 * и уже эти максимумы складываются в регион (решение от 13.08.2026). Второй способ —
 * взять максимум по региону целиком — на данных 08.2026 даёт то же число (вид 340 больше
 * вида 141 у каждой МО), то есть разошёлся бы молча. Выбран разрез по МО: только при нём
 * региональное значение равно сумме сот на карте.
 */
/**
 * Свод числителя по видам СЭМД. Экспортируется ради помесячных кривых
 * (`semd-monthly-series.ts`): точка графика обязана считаться ровно так же,
 * как цифра на карточке, иначе у 6.1.3.2.9 кривая разойдётся с показателем —
 * там агрегат `max`, а максимум суммы не равен сумме максимумов.
 */
export function aggregateNumerator(
    config: SemdVolumeRatioConfig,
    counts: ReadonlyMap<string, number>,
): number {
    const main = config.semdTypeCodes.map((code) => counts.get(code) ?? 0)
    const base = config.aggregate === 'max'
        ? (main.length > 0 ? Math.max(...main) : 0)
        : main.reduce((sum, value) => sum + value, 0)
    const additional = (config.additionalSemdTypeCodes ?? []).reduce(
        (sum, code) => sum + (counts.get(code) ?? 0),
        0,
    )
    return base + additional
}

function buildRegionValue(
    config: SemdVolumeRatioConfig,
    organizations: readonly SemdVolumeRatioOrganizationValue[],
): SemdVolumeRatioRegionValue {
    const numerator = organizations.reduce((sum, item) => sum + item.numerator, 0)
    const denominator = organizations.reduce((sum, item) => sum + (item.denominator ?? 0), 0)
    const annualDenominator = organizations.reduce(
        (sum, item) => sum + (item.annualDenominator ?? 0),
        0,
    )
    const numeratorWithoutPlan = organizations
        .filter((item) => item.annualDenominator === null)
        .reduce((sum, item) => sum + item.numerator, 0)

    return {
        numerator,
        denominator,
        annualDenominator,
        annualFallbackOrganizationCount: organizations.filter(
            (item) => item.usedAnnualFallback,
        ).length,
        percent: denominator > 0 ? toPercent(numerator, denominator) : null,
        organizationCount: organizations.length,
        calculatedOrganizationCount: countByStatus(organizations, 'calculated'),
        factWithoutPlanOrganizationCount: countByStatus(organizations, 'no_approved_volume'),
        notParticipatingOrganizationCount: countByStatus(organizations, 'not_participating'),
        numeratorWithoutPlan,
        numeratorByType: numeratorCodes(config).map((semdTypeCode) => ({
            semdTypeCode,
            documentCount: organizations.reduce(
                (sum, item) => sum + findCount(item.numeratorByType, semdTypeCode),
                0,
            ),
        })),
        denominatorBySheet: config.tpggSheetCodes.map((sheetCode) => {
            const rows = organizations.map(
                (item) => findSheet(item.denominatorBySheet, sheetCode),
            )
            return {
                sheetCode,
                cumulativeValue: sumBy(rows, (row) => row?.cumulativeValue ?? 0),
                annualValue: sumBy(rows, (row) => row?.annualValue ?? 0),
                usedAnnualFallback: rows.some((row) => row?.usedAnnualFallback === true),
            }
        }),
    }
}

function findCount(
    breakdown: readonly SemdVolumeRatioTypeBreakdown[],
    semdTypeCode: string,
): number {
    return breakdown.find((item) => item.semdTypeCode === semdTypeCode)?.documentCount ?? 0
}

function findSheet(
    breakdown: readonly SemdVolumeRatioSheetBreakdown[],
    sheetCode: string,
): SemdVolumeRatioSheetBreakdown | undefined {
    return breakdown.find((item) => item.sheetCode === sheetCode)
}

function sumBy<T>(items: readonly T[], pick: (item: T) => number): number {
    return items.reduce((sum, item) => sum + pick(item), 0)
}

/** Все виды числителя в порядке конфигурации: основные, затем добавочные. */
export function numeratorCodes(config: SemdVolumeRatioConfig): readonly string[] {
    return [...config.semdTypeCodes, ...(config.additionalSemdTypeCodes ?? [])]
}

function breakdownByType(
    config: SemdVolumeRatioConfig,
    counts: ReadonlyMap<string, number>,
): SemdVolumeRatioTypeBreakdown[] {
    return numeratorCodes(config).map((semdTypeCode) => ({
        semdTypeCode,
        documentCount: counts.get(semdTypeCode) ?? 0,
    }))
}

function breakdownBySheet(
    config: SemdVolumeRatioConfig,
    plans: ReadonlyMap<string, SheetPlan>,
    throughMonth: number,
): SemdVolumeRatioSheetBreakdown[] {
    return config.tpggSheetCodes.map((sheetCode) => {
        const plan = plans.get(sheetCode)
        if (!plan) {
            return {
                sheetCode,
                cumulativeValue: 0,
                annualValue: 0,
                usedAnnualFallback: false,
            }
        }
        // Роспись пуста — накопительный план взять неоткуда. Обнулить знаменатель
        // нельзя (показатель обратился бы в прочерк на пустом месте), поэтому берём
        // годовой и помечаем расчёт: он завышен, значит доля занижена.
        const hasMonthlyBreakdown = Object.keys(plan.monthlyValues).length > 0
        return {
            sheetCode,
            cumulativeValue: hasMonthlyBreakdown
                ? accumulateMonths(plan.monthlyValues, throughMonth)
                : plan.annualValue,
            annualValue: plan.annualValue,
            usedAnnualFallback: !hasMonthlyBreakdown && plan.annualValue > 0,
        }
    })
}

/**
 * Сумма месяцев с января по `throughMonth` включительно.
 *
 * Именно сумма, а не доля года: месяцы 1–11 расписаны ровно, а в декабрь падает
 * остаток, поэтому `годовой / 12 × N` дал бы другое число — и разошёлся бы молча.
 */
function accumulateMonths(
    monthlyValues: Readonly<Record<number, number>>,
    throughMonth: number,
): number {
    const lastMonth = Math.min(Math.max(Math.trunc(throughMonth), 0), 12)
    let total = 0
    for (let month = 1; month <= lastMonth; month += 1) {
        total += toFiniteNumber(monthlyValues[month])
    }
    return total
}

function groupFacts(
    facts: readonly SemdVolumeRatioFact[],
    targetOids: ReadonlySet<string>,
): Map<string, Map<string, number>> {
    const grouped = new Map<string, Map<string, number>>()
    for (const fact of facts) {
        if (!targetOids.has(fact.organizationOid)) continue
        const counts = grouped.get(fact.organizationOid) ?? new Map<string, number>()
        // Одна МО может дать несколько строк по одному виду (разные форматы документа) —
        // складываем, а не перезаписываем.
        counts.set(
            fact.semdTypeCode,
            (counts.get(fact.semdTypeCode) ?? 0) + toFiniteNumber(fact.documentCount),
        )
        grouped.set(fact.organizationOid, counts)
    }
    return grouped
}

/** Сведённый по МО и листу план: годовой итог и роспись по месяцам. */
interface SheetPlan {
    annualValue: number
    monthlyValues: Record<number, number>
}

function groupPlans(
    plans: readonly SemdVolumeRatioPlan[],
    targetOids: ReadonlySet<string>,
): Map<string, Map<string, SheetPlan>> {
    const grouped = new Map<string, Map<string, SheetPlan>>()
    for (const plan of plans) {
        if (!targetOids.has(plan.organizationOid)) continue
        const sheets = grouped.get(plan.organizationOid) ?? new Map<string, SheetPlan>()
        // Одна МО может дать несколько строк по одному листу — складываем,
        // и годовой итог, и каждый месяц отдельно.
        const merged = sheets.get(plan.sheetCode)
            ?? { annualValue: 0, monthlyValues: {} as Record<number, number> }
        merged.annualValue += toFiniteNumber(plan.annualValue)
        for (const [month, value] of Object.entries(plan.monthlyValues ?? {})) {
            const monthNumber = Number(month)
            if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
                continue
            }
            merged.monthlyValues[monthNumber] =
                (merged.monthlyValues[monthNumber] ?? 0) + toFiniteNumber(value)
        }
        sheets.set(plan.sheetCode, merged)
        grouped.set(plan.organizationOid, sheets)
    }
    return grouped
}

function countByStatus(
    organizations: readonly SemdVolumeRatioOrganizationValue[],
    status: SemdVolumeRatioOrganizationStatus,
): number {
    return organizations.filter((item) => item.status === status).length
}

/** Два знака после запятой — как в `ratio-percent.calculator.ts`, чтобы проценты сходились. */
export function toPercent(numerator: number, denominator: number): number {
    return Math.round((numerator / denominator) * 10_000) / 100
}

function toFiniteNumber(value: unknown): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}
