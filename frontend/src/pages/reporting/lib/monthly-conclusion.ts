import type {
    MonthlySeriesPoint,
    OrganizationBreakdown,
} from '@shared/lib/reporting-api'
import { formatNumber, monthName } from './reporting-helpers'
import { getInstitutionCellLabel } from '../model/institution-cell-labels'
import { buildManagementVerdict } from './management-conclusion'

/**
 * Месяцы в дательном падеже — для оборота «+24,9 % к апрелю». Именительный
 * из `monthName` в такую фразу не встаёт, а склонять кодом ради одного оборота
 * незачем.
 */
const MONTH_IN_DATIVE: readonly string[] = [
    'январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню',
    'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю',
]

function monthNameDative(month: number): string {
    return MONTH_IN_DATIVE[month - 1] ?? monthName(month)
}

/**
 * Текст под диаграммой динамики — главное требование ВКС 28.08.2026.
 *
 * Николай: «Дашбордов, графиков и прочее — сотни, миллионы. Наша идея, чтобы мы
 * любой график завершали комментариями, способными привести к осознанным
 * управленческим действиям… Внизу пусть будет три строки с жирным текстом».
 *
 * Он же продиктовал состав: «Первое — визуализация должна быть жёстко понятной.
 * Второе — нам нужно заключение по какому-то графику, что в нём стабильно,
 * нестабильно. Но вот и самое интересное прозвучало — это прогноз, что уже
 * поликлиника физически не выполнит. И четвёртое — управленческий вывод».
 *
 * Отсюда четыре строки: факт, ровность работы, прогноз, управленческий вывод.
 * Четвёртая пока пустая — прямая оговорка Николая: «управленческий вывод пока
 * можно просто двоеточие поставить, поработаем с экспертизой и подумаем».
 *
 * Тон один и жёсткий: спор Николая и Марины на созвоне («может, не надо это
 * в презентацию» — «надо, надо: у нас инструмент не перед федерацией отчитаться,
 * а инструмент со своими разобраться») решён в пользу Николая.
 *
 * Считается на фронте, а не на сервере: всё нужное уже приехало в ряду точек,
 * и заводить ради текста ещё один расчёт на бэкенде значило бы держать две
 * копии одной арифметики.
 */

/** Месяцев в году — прогноз всегда считается до декабря, а не до конца периода. */
const MONTHS_IN_YEAR = 12

/**
 * Во сколько раз лучший месяц должен превышать худший, чтобы назвать работу
 * неровной. Полтора — не подобранная константа: на данных региона разрыв
 * январь/июнь двукратный, а внутри «спокойных» показателей колебания месяцев
 * держатся в пределах трети.
 */
const UNEVEN_RATIO = 1.5

/**
 * Пороги правил Д-33 — «неявные закономерности», которые Николай на ВКС 28.08.2026
 * просил подсказывать самим: «мне нужно внизу резюме, о чём этот график говорит.
 * И вот в этом резюме ты можешь показать… странную закономерность, да, там вспышка
 * активности в мае. Почему нельзя так работать?»
 *
 * Он предлагал прикрутить сюда языковую модель и обещал ключ. Илья возразил —
 * «не очень честно… закономерности только нам самим искать», и Николай согласился:
 * «задачу ты примерно понял». Поэтому здесь правила, а не модель: каждое можно
 * пересчитать руками и оспорить цифрой.
 */

/** Падение к предыдущему месяцу, после которого месяц называется провалом. */
const DROP_RATIO = 1.4
/** Рост к предыдущему месяцу, после которого месяц называется всплеском. */
const SPIKE_RATIO = 1.15
/**
 * Во сколько раз январь должен превышать средний остальной месяц, чтобы назвать
 * его хвостом декабря. Марина объяснила это прямо: «январь особенный месяц, там
 * регистрируется большинство документов декабрьских, которые стояли в очереди
 * ещё в декабре». Отсеять их нельзя — в СЭМД учитывается только дата регистрации,
 * — поэтому январь можно назвать, но не исправить.
 */
const JANUARY_TAIL_RATIO = 1.25
/**
 * Размах помесячного плана, ниже которого роспись считается формальной.
 * Николай: «что за цифры такие кругленькие с колебаниями в десятых?.. Кто этот
 * план строил, руки оборвать». На данных региона размах — 0,03 %.
 */
const FLAT_PLAN_SPREAD = 0.01
/** Сколько находок показываем: больше трёх — это уже не резюме, а отчёт. */
const MAX_ANOMALIES = 3

export interface AchievabilityForecast {
    /** Годовой план по росписи терпрограммы — сумма двенадцати месяцев. */
    yearPlan: number
    /** Зарегистрировано за месяцы, по которым есть выгрузка. */
    factToDate: number
    /** Сколько это от годового плана, в процентах. */
    factShare: number
    monthsWithFact: number
    monthsLeft: number
    /** Лучший месяц года по числу зарегистрированных СЭМД. */
    bestMonth: number
    bestMonthFact: number
    /** Сколько нужно регистрировать ежемесячно, чтобы закрыть год. */
    requiredPerMonth: number
    /** Потолок: оставшиеся месяцы повторяют лучший. */
    ceiling: number
    ceilingShare: number
    /** Достижим ли годовой план даже при повторении лучшего месяца. */
    achievable: boolean
}

export type AnomalyCode =
    | 'spike_and_drop'
    | 'january_tail'
    | 'ratio_over_plan'
    | 'flat_plan'
    | 'missing_execution'

export interface Anomaly {
    code: AnomalyCode
    text: string
}

export interface ConclusionLine {
    label: string
    text: string
    /** `true` — строка о невыполнимом: в интерфейсе она выделяется. */
    alarming: boolean
    /** `true` — формулировка не подтверждена методологом, идёт с пометкой. */
    draft?: boolean
}

export interface MonthlyConclusion {
    lines: ConclusionLine[]
    forecast: AchievabilityForecast | null
}

/**
 * Прогноз достижимости годового плана.
 *
 * Потолок считается по **лучшему месяцу года**, а не по среднему, и это выбор
 * в пользу оппонента: даже заведомо оптимистичная оценка на данных региона
 * не дотягивает до плана, и спорить с ней нечем. Средний темп дал бы цифру
 * жёстче, но на неё легко ответить «мы поднажмём».
 *
 * `null` — если плана нет (показатель 27, у него знаменатель не объёмный)
 * или если нет ни одного месяца с фактом.
 */
export function buildAchievabilityForecast(
    points: readonly MonthlySeriesPoint[],
): AchievabilityForecast | null {
    const yearPlan = points.reduce((sum, point) => sum + (point.plan ?? 0), 0)
    const withFact = points.filter((point) => point.fact !== null)
    if (yearPlan <= 0 || withFact.length === 0) return null

    const factToDate = withFact.reduce((sum, point) => sum + (point.fact ?? 0), 0)
    const best = withFact.reduce(
        (top, point) => ((point.fact ?? 0) > (top.fact ?? 0) ? point : top),
        withFact[0],
    )
    const bestMonthFact = best.fact ?? 0
    // Оставшиеся месяцы считаем от календаря, а не от числа месяцев с выгрузкой:
    // пропуск в середине года — это не будущее, его уже не наверстать.
    const lastMonthWithFact = withFact[withFact.length - 1].month
    const monthsLeft = Math.max(0, MONTHS_IN_YEAR - lastMonthWithFact)
    const ceiling = factToDate + bestMonthFact * monthsLeft

    return {
        yearPlan,
        factToDate,
        factShare: percent(factToDate, yearPlan),
        monthsWithFact: withFact.length,
        monthsLeft,
        bestMonth: best.month,
        bestMonthFact,
        requiredPerMonth: monthsLeft > 0
            ? Math.max(0, Math.ceil((yearPlan - factToDate) / monthsLeft))
            : 0,
        ceiling,
        ceilingShare: percent(ceiling, yearPlan),
        achievable: ceiling >= yearPlan,
    }
}

export function buildMonthlyConclusion(
    points: readonly MonthlySeriesPoint[],
    breakdown?: OrganizationBreakdown | null,
): MonthlyConclusion {
    const withFact = points.filter((point) => point.fact !== null)
    const forecast = buildAchievabilityForecast(points)
    const lines: ConclusionLine[] = []

    if (withFact.length === 0) {
        return {
            lines: [{
                label: 'Что на графике',
                text: 'Выгрузок РЭМД за этот период нет — считать нечего.',
                alarming: false,
            }],
            forecast: null,
        }
    }

    const firstMonth = withFact[0].month
    const lastMonth = withFact[withFact.length - 1].month
    const factToDate = withFact.reduce((sum, point) => sum + (point.fact ?? 0), 0)
    const period = firstMonth === lastMonth
        ? monthName(firstMonth)
        : `${monthName(firstMonth)}–${monthName(lastMonth)}`

    lines.push({
        label: 'Что на графике',
        text: forecast
            ? `За ${period} зарегистрировано ${formatNumber(factToDate)} СЭМД — `
                + `${formatNumber(forecast.factShare)} % годового плана ТПГГ `
                + `(${formatNumber(forecast.yearPlan)} случаев).`
            : `За ${period} зарегистрировано ${formatNumber(factToDate)} СЭМД.`,
        alarming: false,
    })

    lines.push(anomalyLine(points, breakdown ?? null))

    if (forecast) lines.push(forecastLine(forecast))

    // Управленческий вывод — из справочника. Пока ни одна формулировка
    // не подтверждена методологом, строка идёт с пометкой «черновик»:
    // Николай разрешил оставить здесь двоеточие, а не выдавать наш текст
    // за вывод системы.
    const verdict = buildManagementVerdict(
        forecast,
        detectAnomalies(points, breakdown ?? null),
    )
    lines.push({
        label: 'Управленческий вывод',
        text: verdict?.text ?? '',
        alarming: false,
        draft: verdict?.draft ?? false,
    })

    return { lines, forecast }
}

/**
 * Строка «Что настораживает»: находки правил Д-33, не больше трёх.
 *
 * Порядок правил — по управленческой цене. Первым идёт рваный ритм: на созвоне
 * именно он вывел Николая на «сначала в марте говно пинали… в мае получили
 * нагоняй… потом ушли в отпуск». Последними — качество данных: оно важно,
 * но действий главврача не меняет.
 */
function anomalyLine(
    points: readonly MonthlySeriesPoint[],
    breakdown: OrganizationBreakdown | null,
): ConclusionLine {
    const anomalies = detectAnomalies(points, breakdown)
    if (anomalies.length > 0) {
        return {
            label: 'Что настораживает',
            text: anomalies.slice(0, MAX_ANOMALIES).map((item) => item.text).join(' '),
            alarming: true,
        }
    }
    return { ...evennessLine(points), label: 'Что настораживает' }
}

/** Находки по помесячному ряду и, если он есть, по разрезу МО. */
export function detectAnomalies(
    points: readonly MonthlySeriesPoint[],
    breakdown: OrganizationBreakdown | null = null,
): Anomaly[] {
    const found: Anomaly[] = []
    const spike = detectSpikeAndDrop(points)
    if (spike) found.push(spike)
    const january = detectJanuaryTail(points)
    if (january) found.push(january)
    const overPlan = detectRatioOverPlan(breakdown)
    if (overPlan) found.push(overPlan)
    const flatPlan = detectFlatPlan(points)
    if (flatPlan) found.push(flatPlan)
    const missing = detectMissingExecution(breakdown)
    if (missing) found.push(missing)
    return found
}

/**
 * Всплеск и следующий за ним провал. Ищем самое глубокое падение к предыдущему
 * месяцу — именно оно читается с графика как «выдохнули».
 *
 * Последний месяц ряда провалом не объявляется. Выгрузку забирают среди месяца:
 * августовская сформирована 27.08 и покрывает 01–26.08, поэтому её столбик ниже
 * июльского на 40 % просто потому, что в месяце ещё пять дней. Назвать это
 * провалом — дать методологу законный повод не поверить и остальным находкам.
 */
function detectSpikeAndDrop(points: readonly MonthlySeriesPoint[]): Anomaly | null {
    const facts = points.filter(
        (point): point is MonthlySeriesPoint & { fact: number } => point.fact !== null,
    )
    if (facts.length < 3) return null
    const lastMonth = facts[facts.length - 1].month

    let peak = facts[0]
    let low = facts[0]
    let deepest = 0
    for (let index = 1; index < facts.length; index += 1) {
        const before = facts[index - 1]
        const current = facts[index]
        // Соседние по календарю: разрыв в выгрузках падением не считается.
        if (current.month !== before.month + 1 || current.fact <= 0) continue
        // Незакрытый месяц — не провал.
        if (current.month === lastMonth) continue
        const ratio = before.fact / current.fact
        if (ratio >= DROP_RATIO && ratio > deepest) {
            deepest = ratio
            peak = before
            low = current
        }
    }
    if (deepest === 0) return null

    const beforePeak = facts.find((point) => point.month === peak.month - 1)
    const rise = beforePeak && beforePeak.fact > 0 ? peak.fact / beforePeak.fact : 0
    const fall = round((1 - low.fact / peak.fact) * 100)

    const peakPart = rise >= SPIKE_RATIO && beforePeak
        ? `${capitalize(monthName(peak.month))} — всплеск `
            + `(+${formatNumber(round((rise - 1) * 100))} % к ${monthNameDative(beforePeak.month)}), `
        : `${capitalize(monthName(peak.month))} — вершина, `

    return {
        code: 'spike_and_drop',
        text: `${peakPart}${monthName(low.month)} — провал `
            + `(−${formatNumber(fall)} %). Ритм рваный.`,
    }
}

/**
 * Январский хвост: в январе регистрируют то, что закончили в декабре.
 * Правило только называет находку — отсеять декабрьские документы нельзя,
 * в СЭМД учитывается лишь дата регистрации.
 */
function detectJanuaryTail(points: readonly MonthlySeriesPoint[]): Anomaly | null {
    const january = points.find((point) => point.month === 1 && point.fact !== null)
    if (!january?.fact) return null
    const rest = points.filter(
        (point): point is MonthlySeriesPoint & { fact: number } =>
            point.month > 1 && point.fact !== null,
    )
    if (rest.length < 2) return null

    const average = rest.reduce((sum, point) => sum + point.fact, 0) / rest.length
    if (average <= 0 || january.fact / average < JANUARY_TAIL_RATIO) return null

    return {
        code: 'january_tail',
        text: `Январь выбивается: ${formatNumber(january.fact)} против `
            + `${formatNumber(Math.round(average))} в среднем по остальным месяцам — `
            + 'в нём добивают декабрь.',
    }
}

/** Доля выше 100 % плана: либо план занижен, либо профиль МО не тот. */
function detectRatioOverPlan(breakdown: OrganizationBreakdown | null): Anomaly | null {
    const rows = breakdown?.rows ?? []
    const withData = rows.filter((row) => row.monthlyRatios.some((value) => value !== null))
    if (withData.length === 0) return null

    let worstName = ''
    let worstRatio = 0
    let worstMonth = 0
    let count = 0
    for (const row of withData) {
        let rowRatio = 0
        let rowMonth = 0
        row.monthlyRatios.forEach((value, index) => {
            if (value === null || value <= 100 || value <= rowRatio) return
            rowRatio = value
            rowMonth = index + 1
        })
        if (rowMonth === 0) continue
        count += 1
        if (rowRatio > worstRatio) {
            worstRatio = rowRatio
            worstMonth = rowMonth
            // Короткое имя, а не полное из ФРМО: в резюме из трёх строк
            // «ГБУ "КУРГАНСКИЙ ОБЛАСТНОЙ ЦЕНТР МЕДИЦИНСКОЙ ПРОФИЛАКТИКИ,
            // ЛЕЧЕБНОЙ ФИЗКУЛЬТУРЫ И СПОРТИВНОЙ МЕДИЦИНЫ"» съедает всю строку.
            worstName = getInstitutionCellLabel(row.organizationOid, row.organizationName)
        }
    }
    if (count === 0) return null

    return {
        code: 'ratio_over_plan',
        text: `Выше 100 % плана хотя бы раз были ${count} МО из ${withData.length}; `
            + `рекорд — ${worstName}, ${formatNumber(round(worstRatio))} % `
            + `(${monthName(worstMonth)}). Либо план занижен, либо профиль не тот.`,
    }
}

/** Помесячная роспись плана без сезонности — план формальный. */
function detectFlatPlan(points: readonly MonthlySeriesPoint[]): Anomaly | null {
    const plans = points.filter(
        (point): point is MonthlySeriesPoint & { plan: number } => point.plan !== null,
    )
    if (plans.length < MONTHS_IN_YEAR) return null

    const values = plans.map((point) => point.plan)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const average = values.reduce((sum, value) => sum + value, 0) / values.length
    if (average <= 0) return null
    const spread = (max - min) / average
    if (spread >= FLAT_PLAN_SPREAD) return null

    return {
        code: 'flat_plan',
        text: `План ТПГГ расписан ровно: размах ${formatNumber(max - min)} из `
            + `${formatNumber(Math.round(average))} в месяц `
            + `(${formatNumber(round(spread * 100))} %) — сезонность в него не заложена.`,
    }
}

/** МО, по которым фонд не прислал реестры исполнения. */
function detectMissingExecution(breakdown: OrganizationBreakdown | null): Anomaly | null {
    const rows = breakdown?.rows ?? []
    if (rows.length === 0) return null
    const missing = rows.filter((row) => row.caseFact === null).length
    if (missing === 0) return null

    return {
        code: 'missing_execution',
        text: `У ${missing} МО из ${rows.length} фонд не прислал реестры исполнения — `
            + 'это не ноль случаев, это отсутствие данных.',
    }
}

/** Запасная строка, когда ни одно правило не сработало: разброс по месяцам. */
function evennessLine(points: readonly MonthlySeriesPoint[]): ConclusionLine {
    const ratios = points.filter(
        (point): point is MonthlySeriesPoint & { ratio: number } => point.ratio !== null,
    )
    if (ratios.length < 2) {
        const facts = points.filter(
            (point): point is MonthlySeriesPoint & { fact: number } => point.fact !== null,
        )
        if (facts.length < 2) {
            return {
                label: 'Ровность работы',
                text: 'Месяцев для сравнения пока мало.',
                alarming: false,
            }
        }
        const low = facts.reduce((min, p) => (p.fact < min.fact ? p : min), facts[0])
        const high = facts.reduce((max, p) => (p.fact > max.fact ? p : max), facts[0])
        return {
            label: 'Ровность работы',
            text: `Разброс по месяцам: от ${formatNumber(low.fact)} (${monthName(low.month)}) `
                + `до ${formatNumber(high.fact)} (${monthName(high.month)}).`,
            alarming: false,
        }
    }

    const low = ratios.reduce((min, p) => (p.ratio < min.ratio ? p : min), ratios[0])
    const high = ratios.reduce((max, p) => (p.ratio > max.ratio ? p : max), ratios[0])
    const times = low.ratio > 0 ? high.ratio / low.ratio : Infinity
    const uneven = times >= UNEVEN_RATIO

    return {
        label: 'Ровность работы',
        text: uneven
            ? `Работа неровная: от ${formatNumber(round(low.ratio))} % плана `
                + `(${monthName(low.month)}) до ${formatNumber(round(high.ratio))} % `
                + `(${monthName(high.month)}) — разрыв в `
                + `${formatNumber(round(times))} раза.`
            : `Работа ровная: доля держится в пределах `
                + `${formatNumber(round(low.ratio))}–${formatNumber(round(high.ratio))} % плана.`,
        alarming: uneven,
    }
}

function forecastLine(forecast: AchievabilityForecast): ConclusionLine {
    if (forecast.monthsLeft === 0) {
        return {
            label: 'Прогноз',
            text: `Год закрыт: ${formatNumber(forecast.factShare)} % плана.`,
            alarming: forecast.factShare < 100,
        }
    }

    const tail = `${monthName(MONTHS_IN_YEAR - forecast.monthsLeft + 1)}–`
        + `${monthName(MONTHS_IN_YEAR)}`

    if (!forecast.achievable) {
        return {
            label: 'Прогноз',
            text: `Чтобы закрыть год, нужно ${formatNumber(forecast.requiredPerMonth)} СЭМД `
                + `в месяц за ${tail}. Лучший месяц года — `
                + `${formatNumber(forecast.bestMonthFact)} (${monthName(forecast.bestMonth)}). `
                + `Даже если оставшиеся месяцы повторят его, год закроется `
                + `на ${formatNumber(forecast.ceilingShare)} % плана: показатель недостижим.`,
            alarming: true,
        }
    }

    return {
        label: 'Прогноз',
        text: `Чтобы закрыть год, нужно ${formatNumber(forecast.requiredPerMonth)} СЭМД `
            + `в месяц за ${tail} — это в пределах лучшего месяца года `
            + `(${formatNumber(forecast.bestMonthFact)}, ${monthName(forecast.bestMonth)}). `
            + `План достижим, но запаса нет.`,
        alarming: false,
    }
}

function capitalize(value: string): string {
    return value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1)
}

function percent(part: number, whole: number): number {
    return whole > 0 ? round((part / whole) * 100) : 0
}

function round(value: number): number {
    return Math.round(value * 10) / 10
}
