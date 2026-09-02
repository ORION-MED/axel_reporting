import type {
    PilotInstitutionDetails,
    PilotInstitutionSemdStatus,
    ReportingDashboard,
    ReportingImportRun,
    ReportingIndicator,
    ReportingIndicatorValue,
    ReportingOrganizationIndicatorValue,
    ReportingSummary,
    ReportingValueStatus,
} from '@shared/lib/reporting-api'

/**
 * Сколько видов СЭМД доступно на ЕПГУ по справочникам 1253/1520 — зеркало
 * `PILOT_EPGU_REFERENCE_TYPES` из `backend/src/reporting/pilot-calculation.types.ts`.
 *
 * 07.08.2026 справочники 1520 и 1253 дали 36-й вид, а подписи «35 видов» остались
 * жёстко вписанными в семь мест интерфейса — расхождение с расчётом увидели прямо
 * на демонстрации. Поэтому число теперь берётся из данных расчёта везде, где они
 * загружены (`semdTypeCountLabel`), а константа отвечает только за подписи, которые
 * показываются до выбора периода: пункты меню загрузки и описания источников.
 *
 * Это **не** цель показателя: с 20.08.2026 цель равна 35 (Соглашение, ответ В-05),
 * и подставлять её в подписи про состав справочника нельзя — разойдётся с окном
 * предпросмотра матрицы, которое сверяется именно с 36.
 */
export const PILOT_EPGU_REFERENCE_TYPES = 36

/**
 * Число видов для подписи: сколько их в самом расчёте, а пока данных нет — из справочника.
 * Нуль тоже считается «данных нет»: пустой список видов означает, что справочник
 * ещё не загружен, и «0 видов по региону» на кнопке было бы враньём.
 */
export function semdTypeCountLabel(actual: number | null | undefined): number {
    return actual != null && actual > 0 ? actual : PILOT_EPGU_REFERENCE_TYPES
}

/**
 * Р4: цветовая шкала Минздрава (5 тонов) для процента выполнения показателя.
 * Пороги и тона сверены с эталонным дашбордом Минздрава «Доля видов СЭМД, которые
 * передаются на регистрацию в РЭМД ЕГИСЗ» (скриншот от 29.07.2026): 100% ≤ /
 * 86,9–99,99 / 60–86,89 / 34–59,99 / 0–33,99. Держим здесь, а не в компоненте карты,
 * потому что по рекомендациям 27.07 (п.5) той же шкалой красится и полоса выполнения
 * в списке МО.
 */
export interface PercentColorBand {
    /** Нижняя граница диапазона в процентах (включительно). */
    min: number
    color: string
    label: string
}

export const MINZDRAV_PERCENT_SCALE: readonly PercentColorBand[] = [
    { min: 100, color: '#16843a', label: '100%' },
    { min: 86.9, color: '#4caf50', label: '86,9–99,99%' },
    { min: 60, color: '#e6a700', label: '60–86,89%' },
    { min: 34, color: '#f06d1f', label: '34–59,99%' },
    // На эталонной карте нижний диапазон заметно темнее «сигнального» красного —
    // тёмно-кирпичный, чтобы отличаться от оранжевого соседнего диапазона.
    { min: 0, color: '#a31f1f', label: '0–33,99%' },
]

export function minzdravPercentColor(percent: number): string {
    const band = MINZDRAV_PERCENT_SCALE.find((item) => percent >= item.min)
    return (band ?? MINZDRAV_PERCENT_SCALE[MINZDRAV_PERCENT_SCALE.length - 1]).color
}

/**
 * Индекс диапазона шкалы Минздрава — нужен, чтобы посчитать, сколько МО попало
 * в каждый тон (на эталонной легенде рядом с тоном стоит «— N субъектов РФ»).
 */
export function minzdravPercentBandIndex(percent: number): number {
    const index = MINZDRAV_PERCENT_SCALE.findIndex((item) => percent >= item.min)
    return index === -1 ? MINZDRAV_PERCENT_SCALE.length - 1 : index
}

export interface ValueForm {
    numerator: string
    denominator: string
    targetValue: string
    sourceName: string
    note: string
}

export interface PeriodForm {
    name: string
    code: string
    dateFrom: string
    dateTo: string
}

export type InstitutionDetailsFilter =
    | 'all'
    | 'problem'
    | 'required'
    | 'manual'
    | 'unknown'

// Р6: верхнее меню по МО на дашборде — порядок «Все → Выполняется → Не выполняется».
export type OrganizationListFilter =
    | 'all'
    | 'performed'
    | 'not_performed'

export type InstitutionSemdType = PilotInstitutionDetails['types'][number]

/**
 * Вид обязателен для МО, но регистрации в РЭМД нет (по любой из причин отсутствия).
 */
export const NOT_REGISTERED_STATUSES: ReadonlySet<PilotInstitutionSemdStatus> = new Set([
    'required_missing',
    'required_gis_unavailable',
    'required_gis_unknown',
])

/** Все обязательные для МО виды — и зарегистрированные, и нет. */
export const REQUIRED_STATUSES: ReadonlySet<PilotInstitutionSemdStatus> = new Set([
    ...NOT_REGISTERED_STATUSES,
    'required_registered',
])

/**
 * В1 (ВКС 31.07.2026): вкладка «Внимание» — только те виды, которые для МО
 * не обязательны, но она их фактически формирует. Дословно от методолога:
 * «Они сюда попадать должны в одном случае: если в контексте этих 35 СЭМД для
 * медорганизации они не требуются, а они формируют. Вот тогда — внимание.»
 *
 * До 31.07 сюда падало всё, что не входит в REQUIRED_STATUSES, из-за чего в списке
 * оказывались виды вроде «Выписной эпикриз из родильного дома» у поликлиники —
 * не требуется и не формируется, разбираться не с чем.
 *
 * `unknown_registered` включён сознательно: применимость не определена, но регистрации
 * идут — это тот же повод разобраться (см. ATTENTION_INCLUDES_UNKNOWN_REGISTERED).
 */
export const ATTENTION_INCLUDES_UNKNOWN_REGISTERED = true

export function isAttentionType(type: InstitutionSemdType): boolean {
    if (type.resultStatus === 'not_required_registered') return true
    return (
        ATTENTION_INCLUDES_UNKNOWN_REGISTERED
        && type.resultStatus === 'unknown_registered'
    )
}

export function countAttentionTypes(types: readonly InstitutionSemdType[]): number {
    return types.reduce((count, type) => (isAttentionType(type) ? count + 1 : count), 0)
}

/**
 * Показатели-доли СЭМД к объёмам ТПГГ (6.1.3.2.8–6.1.3.2.11) распознаются по типу
 * расчёта, а не по списку идентификаторов: список пришлось бы держать синхронно
 * с бэкендом, а тип показателя и так приходит в каждом ответе.
 */
export function isSemdVolumeRatioIndicator(
    indicator: ReportingIndicator | null | undefined,
): boolean {
    return indicator?.calculationType === 'semd_volume_ratio'
}

export type SemdVolumeRatioOrganizationStatus =
    | 'calculated'
    | 'no_approved_volume'
    | 'not_participating'

export interface SemdVolumeRatioDetails {
    status: SemdVolumeRatioOrganizationStatus
    /** `semdTypeName` подставляет сервис при сохранении: калькулятор знает только коды. */
    numeratorByType: Array<{
        semdTypeCode: string
        semdTypeName?: string
        documentCount: number
    }>
    denominatorBySheet: Array<{
        sheetCode: string
        cumulativeValue: number
        annualValue: number
    }>
    /**
     * Годовой план — вторая цифра на карточке. Знаменателем с 15.08.2026 служит
     * накопительный план по месяц отчётной даты, и без годового рядом накопительное
     * число не с чем сопоставить: «3 064» само по себе ни о чём не говорит.
     */
    annualDenominator: number | null
    /** Месяц, по который накоплен план (1–12). `null` — расчёт до перехода на накопительный. */
    throughMonth: number | null
    /** Роспись по части листов не нашлась: знаменатель взят за год и потому завышен. */
    usedAnnualFallback: boolean
    /**
     * Д-10: исполнение терпрограммы по реестрам ОМС — третья колонка карточки.
     * `null` — файлы исполнения не загружены; в карточке тогда прочерк, а не ноль.
     */
    execution: SemdVolumeRatioExecution | null
}

export interface SemdVolumeRatioExecution {
    /** Фактически предъявленные случаи по реестрам ОМС. */
    factValue: number
    /** План из той же выгрузки фонда — не всегда совпадает с планом терпрограммы. */
    planValue: number
    /** Границы среза исполнения; `null` — файл не назвал интервал. */
    fromMonth: number | null
    toMonth: number | null
}

/**
 * Детали расчёта доли по объёмам ТПГГ у конкретной МО. `null` — значение посчитано
 * другим показателем.
 *
 * Разбор идёт по форме данных, а не по идентификатору показателя: сота карты получает
 * только строку значения, типа показателя в ней нет, а тащить его через полдесятка
 * компонентов ради одной подписи — лишняя связность.
 */
export function semdVolumeRatioDetails(
    organization: ReportingOrganizationIndicatorValue,
): SemdVolumeRatioDetails | null {
    const details = organization.calculationDetails
    if (!details || !Array.isArray(details.numeratorByType)) return null
    const status = String(details.status ?? '')
    if (
        status !== 'calculated'
        && status !== 'no_approved_volume'
        && status !== 'not_participating'
    ) return null

    return {
        status,
        numeratorByType: details.numeratorByType as SemdVolumeRatioDetails['numeratorByType'],
        denominatorBySheet: Array.isArray(details.denominatorBySheet)
            ? details.denominatorBySheet as SemdVolumeRatioDetails['denominatorBySheet']
            : [],
        annualDenominator: typeof details.annualDenominator === 'number'
            ? details.annualDenominator
            : null,
        throughMonth: isCalendarMonth(details.throughMonth)
            ? details.throughMonth
            : null,
        usedAnnualFallback: details.usedAnnualFallback === true,
        execution: parseExecution(details.execution),
    }
}

function parseExecution(value: unknown): SemdVolumeRatioExecution | null {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (typeof record.factValue !== 'number') return null
    return {
        factValue: record.factValue,
        planValue: typeof record.planValue === 'number' ? record.planValue : 0,
        fromMonth: isCalendarMonth(record.fromMonth) ? record.fromMonth : null,
        toMonth: isCalendarMonth(record.toMonth) ? record.toMonth : null,
    }
}

function isCalendarMonth(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value >= 1
        && value <= 12
}

const MONTH_IN_PREPOSITIONAL: readonly string[] = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
]

/**
 * Подпись знаменателя доли: «План на август» вместо «План (госзадание)».
 *
 * Пока показатель не пересчитан после перехода на накопительный план, месяца
 * в деталях нет — тогда подпись остаётся прежней, а не врёт про месяц.
 */
export function volumePlanLabel(throughMonth: number | null): string {
    if (throughMonth === null) return 'План (госзадание)'
    return `План на ${MONTH_IN_PREPOSITIONAL[throughMonth - 1]}`
}

/**
 * Название месяца в именительном падеже: «июль», «январь».
 *
 * Нужно подписям выгрузок РЭМД: «выгрузка за июль» и «нарастающим итогом
 * по июль» — без месяца из списка загруженных файлов не понять, какие точки
 * кривой уже есть.
 */
export function monthName(month: number): string {
    return MONTH_IN_PREPOSITIONAL[month - 1] ?? String(month)
}

/**
 * Подпись третьей колонки карточки: «Факт ТПГГ (случаев), январь-июнь».
 *
 * Месяцы в подписи обязательны. Срез исполнения не совпадает с отчётной датой
 * периода — фонд присылает его за истекшее полугодие, — и без интервала число
 * читается как факт на сегодня, то есть заниженным вдвое.
 */
export function executionFactLabel(
    fromMonth: number | null,
    toMonth: number | null,
): string {
    if (fromMonth === null || toMonth === null) return 'Факт ТПГГ (случаев)'
    if (fromMonth === toMonth) {
        return `Факт ТПГГ (случаев), ${monthName(fromMonth)}`
    }
    return `Факт ТПГГ (случаев), ${monthName(fromMonth)}–${monthName(toMonth)}`
}

/**
 * Подпись целевого значения. Оно тоже месячное — берётся из колонки нужного месяца
 * «Приложения 2», — и это ровно то, что 15.08.2026 сбило методолога с толку:
 * «почему целевое 70 %, у нас 95». Месяц в подписи снимает вопрос.
 */
/**
 * Подпись показателя в выпадающем списке над картой: «23 · Карта вызова скорой».
 *
 * Номер — из «Приложения 2», на нумерацию которого методолог просила перейти
 * 15.08.2026. У показателя «Виды СЭМД в РЭМД» его нет: в «Приложении 2» такого
 * показателя не существует, а № 27 там занят маммографией с ИИ. Тогда остаётся
 * одно короткое имя — выдумывать номер, которого нет в документе, нельзя.
 *
 * Пустое короткое имя откатывает подпись на код: показатель, заведённый после
 * миграции 0048 и не описанный, должен остаться узнаваемым, а не безымянным.
 */
export function indicatorMenuLabel(indicator: {
    code: string
    shortTitle?: string
    appendix2Number?: string
}): string {
    const shortTitle = (indicator.shortTitle ?? '').trim()
    if (!shortTitle) return indicator.code
    const number = (indicator.appendix2Number ?? '').trim()
    return number ? `${number} · ${shortTitle}` : shortTitle
}

/**
 * Номер показателя в таблице «Показатели» — по «Приложению 2».
 *
 * Рекомендации методолога от 22.08.2026: «Изменить нумерацию согласно Приложения 2».
 * На скрине стрелка идёт от колонки A «Приложения 2» (№ 21) к нашей колонке кода,
 * где стоит 6.1.3.2.9. Над картой на нумерацию «Приложения 2» перешли ещё
 * 15.08.2026 — здесь тот же переход, чтобы номер показателя всюду был один.
 *
 * Прежний код не выбрасывается, а уходит подписью под номером: по нему идёт сверка
 * с Соглашением о предоставлении МБТ, на него ссылаются плановые значения и вся
 * переписка. В самом «Приложении 2» он записан в графе «Номер показателя» как
 * «основной показатель п. 6.1.3.2.9» — вторая стрелка на том же скрине.
 *
 * У показателя «Виды СЭМД в РЭМД» номера нет: в «Приложении 2» такого показателя
 * не существует, а № 27 там занят маммографией с ИИ. Тогда номером остаётся его
 * собственный код, а подпись пуста — дублировать одно и то же незачем.
 */
export function indicatorNumberView(indicator: {
    code: string
    appendix2Number?: string
}): { number: string; codeNote: string } {
    const number = (indicator.appendix2Number ?? '').trim()
    if (!number) return { number: indicator.code, codeNote: '' }
    return { number, codeNote: `п. ${indicator.code}` }
}

export function targetValueLabel(throughMonth: number | null): string {
    if (throughMonth === null) return 'Целевое значение'
    return `Целевое на ${MONTH_IN_PREPOSITIONAL[throughMonth - 1]}`
}

/**
 * План показателя 27 (Н18.2): сколько видов Перечня обязательны этой МО по матрице
 * применимости и сколько из них зарегистрировано. Исполнение считается по пересечению,
 * поэтому регистрации сверх плана его не завышают.
 */
export interface SemdTypeRegistryPlan {
    requiredTypeCount: number
    registeredRequiredTypeCount: number
    percent: number | null
    /** Виды, применимость которых не разобрана: план по МО занижен на это число. */
    undefinedTypeCount: number
}

export interface SemdTypeRegistryDetails {
    registeredTypeCount: number
    typesOutsideRegistryCount: number
    /** `null`, пока матрица применимости не загружена. */
    plan: SemdTypeRegistryPlan | null
}

/**
 * Детали показателя 27 «Виды СЭМД, регистрируемые в РЭМД» у конкретной МО.
 * `null` — значение посчитано другим показателем. Разбор по форме данных,
 * как и у долей к объёмам ТПГГ: соте карты тип показателя не передаётся.
 */
export function semdTypeRegistryDetails(
    organization: ReportingOrganizationIndicatorValue,
): SemdTypeRegistryDetails | null {
    const details = organization.calculationDetails
    if (!details || typeof details.registeredTypeCount !== 'number') return null
    return {
        registeredTypeCount: details.registeredTypeCount,
        typesOutsideRegistryCount:
            typeof details.typesOutsideRegistryCount === 'number'
                ? details.typesOutsideRegistryCount
                : 0,
        plan: readTypeRegistryPlan(details.plan),
    }
}

/**
 * «81 вид», «22 вида», «46 видов». Числа планов попадают в подписи карточки,
 * а «81 видов» в интерфейсе, который смотрит методолог, читается как небрежность.
 */
export function semdTypeCountText(count: number): string {
    const tail = Math.abs(count) % 100
    const last = tail % 10
    if (tail >= 11 && tail <= 14) return `${count} видов`
    if (last === 1) return `${count} вид`
    if (last >= 2 && last <= 4) return `${count} вида`
    return `${count} видов`
}

function readTypeRegistryPlan(value: unknown): SemdTypeRegistryPlan | null {
    if (!value || typeof value !== 'object') return null
    const plan = value as Record<string, unknown>
    if (typeof plan.requiredTypeCount !== 'number') return null
    return {
        requiredTypeCount: plan.requiredTypeCount,
        registeredRequiredTypeCount:
            typeof plan.registeredRequiredTypeCount === 'number'
                ? plan.registeredRequiredTypeCount
                : 0,
        percent: typeof plan.percent === 'number' ? plan.percent : null,
        undefinedTypeCount:
            typeof plan.undefinedTypeCount === 'number' ? plan.undefinedTypeCount : 0,
    }
}

/**
 * Подпись состояния МО в показателе-доле. «Нет утверждённого объёма» — не ноль
 * и не невыполнение: делить не на что, и ноль на карте был бы враньём (7.1.2 ТЗ).
 */
export function semdVolumeRatioStatusLabel(
    status: SemdVolumeRatioOrganizationStatus,
): string {
    if (status === 'no_approved_volume') return 'Нет утверждённого объёма'
    if (status === 'not_participating') return 'Не участвует в показателе'
    return ''
}

export const emptySummary: ReportingSummary = {
    periods: [],
    selectedPeriodId: null,
    organizationCount: 0,
    indicators: [],
    values: [],
}

export const emptyDashboard: ReportingDashboard = {
    periods: [],
    selectedPeriodId: null,
    indicators: [],
    selectedIndicatorId: null,
    organizations: [],
    diagnostics: [],
    pilotRegionSemdTypes: null,
    semdTypeRegistryTypes: null,
}

export const emptyValueForm: ValueForm = {
    numerator: '',
    denominator: '',
    targetValue: '',
    sourceName: '',
    note: '',
}

/**
 * В2 (ВКС 31.07.2026): формулировки результата приведены к паре «Зарегистрирован /
 * Не зарегистрирован в РЭМД». Дословно от методолога: «Давайте его переименуем…
 * "нет в РЭМД", "есть в РЭМД". Либо "не зарегистрирован / зарегистрирован", потому
 * что показатель — о регистрации СЭМД в РЭМД».
 *
 * Прежние формулировки («Формируется», «Нет в ГИС», «Есть факт, но не требуется»)
 * смешивали три разных вопроса: есть ли регистрация, обязателен ли вид и умеет ли
 * его региональная ГИС. Теперь в самой строке — только факт регистрации, а
 * обязательность видна по вкладке и по маркеру, причина — в графе «Основание».
 */
export function semdResultView(
    status: PilotInstitutionSemdStatus,
): {
    label: string
    color: 'default' | 'success' | 'warning' | 'info' | 'error'
    description: string
} {
    if (status === 'required_registered') {
        return { label: 'Зарегистрирован в РЭМД', color: 'success', description: 'Вид обязателен для МО и зарегистрирован в РЭМД.' }
    }
    if (status === 'required_missing') {
        return { label: 'Не зарегистрирован в РЭМД', color: 'error', description: 'Вид обязателен для МО, регистраций в РЭМД нет.' }
    }
    if (status === 'required_gis_unavailable') {
        return { label: 'Не зарегистрирован в РЭМД', color: 'warning', description: 'Вид обязателен, регистраций нет; региональная ГИС не подтверждает доступность вида — ответственность на стороне МИАЦ и поставщика ГИС.' }
    }
    if (status === 'required_gis_unknown') {
        return { label: 'Не зарегистрирован в РЭМД', color: 'warning', description: 'Вид обязателен, регистраций нет; доступность вида в региональной ГИС не уточнена.' }
    }
    if (status === 'not_required_registered') {
        return { label: 'Зарегистрирован в РЭМД', color: 'info', description: 'Вид не обязателен для МО, но регистрации есть — повод проверить правило применимости.' }
    }
    if (status === 'not_required') {
        return { label: 'Не зарегистрирован в РЭМД', color: 'default', description: 'Вид не обязателен для МО и не входит в знаменатель.' }
    }
    if (status === 'unknown_registered') {
        return { label: 'Зарегистрирован в РЭМД', color: 'info', description: 'Регистрации есть, но применимость вида для МО пока не определена.' }
    }
    return { label: 'Не зарегистрирован в РЭМД', color: 'warning', description: 'Регистраций нет, применимость вида для МО не определена.' }
}

/**
 * В2: обязательность вида для МО одной короткой пометкой. Отдельной колонки
 * «Применимость» больше нет — методолог счёл её лишней («35 установлено показателем,
 * 35 от медорганизации будьте добры»), но на вкладке со всеми 35 видами вперемешку
 * без этой пометки непонятно, почему один незарегистрированный вид красный, а другой
 * серый. Поэтому маркер остаётся, но занимает строку подписи, а не колонку.
 */
export function requirementMarker(type: InstitutionSemdType): {
    label: string
    color: 'error' | 'warning' | 'default'
} | null {
    if (REQUIRED_STATUSES.has(type.resultStatus)) {
        return { label: 'обязателен', color: 'error' }
    }
    if (
        type.requirementStatus === 'unknown'
        || type.requirementStatus === 'missing'
    ) {
        return { label: 'применимость не определена', color: 'warning' }
    }
    return { label: 'не обязателен', color: 'default' }
}

/**
 * В6 (ВКС 31.07.2026): «В интерфейс сервиса необходимо выводить все эти приоритеты
 * обязательности». Колонки «Приоритет обязательности 1..4» формы_1 приходят в
 * requirementGrounds с уровнем, но до сих пор уровень нигде не был подписан —
 * пользователь видел два текста подряд и не понимал, что это разные основания.
 *
 * Расшифровки взяты из объяснения методолога на ВКС 31.07 (тайминг 07:05–12:38),
 * не придуманы: уровень 1 снимает вопрос о ФРМО, уровень 2 закрывает двумя причинами
 * (госзадание/терпрограмма ИЛИ региональный акт), уровень 3 — лицензии, которых нет
 * в ФРМО, уровень 4 — само оказание медпомощи и прикреплённое население.
 *
 * ВАЖНО: формулировка «основания работают по ИЛИ» здесь сознательно не написана.
 * На словах методолог сказала «в режиме ИЛИ», но на её же контрольном примере
 * (цитология, код 121, два основания) строгое «ИЛИ» дало бы 31 МО вместо двух.
 * Пока противоречие не снято, интерфейс показывает уровни и не утверждает,
 * как они между собой соединяются. См. раздел 6.1 ТЗ по итогам ВКС 31.07.
 */
export interface GroundLevelView {
    /** Короткая подпись на чипе. */
    label: string
    /** Расшифровка уровня — уходит в подсказку. */
    description: string
}

export const GROUND_LEVELS: Readonly<Record<number, GroundLevelView>> = {
    1: {
        label: 'Приоритет 1',
        description: 'Условия входимости, утверждённые Минздравом РФ.'
            + ' Входимость в ФРМО описана в самих условиях.',
    },
    2: {
        label: 'Приоритет 2',
        description: 'Объём медицинской помощи, утверждённый государственным заданием,'
            + ' территориальной программой, либо региональным актом.',
    },
    3: {
        label: 'Приоритет 3',
        description: 'Наличие лицензии на отдельные виды медицинской помощи.'
            + ' Если признак лицензии в ФРМО отсутствует, перечень МО даёт регион.',
    },
    4: {
        label: 'Приоритет 4',
        description: 'Оказание медицинской помощи гражданам или наличие прикреплённого населения.',
    },
}

/** Порядок вывода уровней в легенде — по возрастанию приоритета. */
export const GROUND_LEVEL_ORDER: readonly number[] = [1, 2, 3, 4]

export function groundLevelView(level: number): GroundLevelView {
    return GROUND_LEVELS[level] ?? {
        label: `Приоритет ${level}`,
        description: 'Уровень приоритета не описан в методике — проверьте форму_1.',
    }
}

/**
 * Основания к показу: по возрастанию приоритета и без повторов. Бэкенд уже
 * дедуплицирует их при импорте матрицы, но форма_1 правится вручную и приезжает
 * от методолога, поэтому на клиенте страхуемся — дубль в колонке выглядит как ошибка.
 */
export function visibleGrounds(
    type: InstitutionSemdType,
): Array<{ level: number; text: string }> {
    const seen = new Set<string>()
    return (type.requirementGrounds ?? [])
        .filter((ground) => {
            const key = `${ground.level}|${ground.text.trim().toLocaleLowerCase('ru-RU')}`
            if (!ground.text.trim() || seen.has(key)) return false
            seen.add(key)
            return true
        })
        .sort((left, right) => left.level - right.level)
}

export function semdResultTone(
    color: ReturnType<typeof semdResultView>['color'],
): {
    bg: string
    border: string
    text: string
    dot: string
} {
    if (color === 'success') {
        return { bg: '#ecfdf3', border: '#bbf7d0', text: '#166534', dot: '#16a34a' }
    }
    if (color === 'error') {
        return { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', dot: '#dc2626' }
    }
    if (color === 'warning') {
        return { bg: '#fffbeb', border: '#fde68a', text: '#92400e', dot: '#f59e0b' }
    }
    if (color === 'info') {
        return { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', dot: '#3b82f6' }
    }
    return { bg: '#f8fafc', border: '#e2e8f0', text: '#475569', dot: '#94a3b8' }
}

export function compactRequirementReason(type: InstitutionSemdType): string {
    const reason = type.requirementReason?.trim()
    const normalizedReason = reason?.toLocaleLowerCase('ru-RU') ?? ''

    if (type.manualOverride?.reason) {
        return `Ручное уточнение: ${type.manualOverride.reason}`
    }
    // Рекомендации 22.08.2026: у вида, который МО уже регистрирует
    // (голубой статус), «По ТПГГ не требуется для этой МО» читается
    // как указание перестать его формировать — так фразу понял методолог.
    // Отсутствие требования по ТПГГ ничего не запрещает, поэтому Основание
    // остаётся пустым: сам статус уже говорит, что вид не обязателен.
    if (type.resultStatus === 'not_required_registered') {
        return ''
    }
    if (type.requirementStatus === 'not_required') {
        if (normalizedReason.includes('годовой объем равен нул')) {
            return 'ТПГГ: объем по связанным разделам = 0'
        }
        return 'По ТПГГ не требуется для этой МО'
    }
    if (type.requirementStatus === 'required') {
        if (normalizedReason.includes('положительный годовой объем')) {
            return 'ТПГГ: есть положительный годовой объем'
        }
        return 'По ТПГГ требуется для этой МО'
    }
    if (
        type.requirementStatus === 'unknown'
        || type.requirementStatus === 'missing'
    ) {
        return 'Нужно уточнить применимость'
    }

    return reason || 'Правило применимости пока не задано'
}

export function compactRequirementMeta(type: InstitutionSemdType): string {
    const parts: string[] = []
    if (type.requirementSource) parts.push(type.requirementSource)
    if (type.evidence.length > 0) {
        parts.push(`${type.evidence.length} подтвержд.`)
    }
    if (type.gisAvailable === false) {
        parts.push('ГИС: нет')
    } else if (type.gisAvailable !== true) {
        parts.push('ГИС: ?')
    }
    if (type.manualOverride) parts.push('ручное')
    return parts.join(' · ')
}

export function requirementStatusView(
    status: PilotInstitutionDetails['types'][number]['requirementStatus'],
): {
    label: string
    color: 'default' | 'success' | 'warning' | 'error'
} {
    if (status === 'required') {
        return { label: 'Обязательно', color: 'error' }
    }
    if (status === 'not_required') {
        return { label: 'Не требуется', color: 'default' }
    }
    if (status === 'unknown') {
        return { label: 'Не определено', color: 'warning' }
    }
    return { label: 'Нет правила', color: 'warning' }
}

export function isInstitutionTypeProblem(type: InstitutionSemdType): boolean {
    return (
        type.resultStatus === 'required_missing'
        || type.resultStatus === 'required_gis_unavailable'
        || type.resultStatus === 'required_gis_unknown'
        || type.resultStatus === 'not_required_registered'
    )
}

export function getInstitutionTypePriority(type: InstitutionSemdType): number {
    if (isInstitutionTypeProblem(type)) return 0
    if (type.manualOverride) return 1
    if (type.requirementStatus === 'required') return 2
    if (
        type.requirementStatus === 'unknown'
        || type.requirementStatus === 'missing'
    ) return 3
    return 4
}

export function compareInstitutionTypes(
    left: InstitutionSemdType,
    right: InstitutionSemdType,
): number {
    const priorityDelta = getInstitutionTypePriority(left)
        - getInstitutionTypePriority(right)
    if (priorityDelta !== 0) return priorityDelta

    const leftCode = Number(left.nsiTypeCode)
    const rightCode = Number(right.nsiTypeCode)
    if (Number.isFinite(leftCode) && Number.isFinite(rightCode)) {
        return leftCode - rightCode
    }

    return left.name.localeCompare(right.name, 'ru-RU')
}

export function buildDefaultPeriodForm(): PeriodForm {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, '0')

    return {
        name: `Период ${month}.${year}`,
        code: `${year}-${month}`,
        dateFrom: `${year}-${month}-01`,
        dateTo: `${year}-${month}-${lastDay}`,
    }
}

export function valueToForm(value?: ReportingIndicatorValue | null): ValueForm {
    if (!value) return emptyValueForm

    return {
        numerator: value.numerator === null ? '' : String(value.numerator),
        denominator: value.denominator === null ? '' : String(value.denominator),
        targetValue: value.targetValue === null ? '' : String(value.targetValue),
        sourceName: value.sourceName,
        note: value.note,
    }
}

export function getErrorMessage(err: unknown): string {
    const anyErr = err as any
    const message = anyErr?.response?.data?.message || anyErr?.message
    return typeof message === 'string' ? message : 'Не удалось выполнить действие'
}

export function formatNumber(value: number | null | undefined): string {
    if (value === null || typeof value === 'undefined') return '—'
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

/**
 * Подпись под значением показателя 6.1.3.2.7 в списке показателей.
 *
 * Здесь **не «исполнение»**. Знаменатель — сколько видов доступно гражданам
 * на ЕПГУ по справочникам 1253 и 1520 (36 на 21.08.2026), а цель показателя
 * равна 35 и берётся из Соглашения о межбюджетном трансферте. Рядом стоит чип
 * «План выполнен», и прежняя подпись «Исполнение 97,22 % · 35 / 36» читалась
 * как противоречие: выполнен, но не всё. Спрашивали все, кто открывал карточку.
 *
 * Процент из подписи убран сознательно — он и создавал впечатление недовыполнения.
 * Не хватает ровно одного вида (68, заключение по освидетельствованию
 * для усыновления и опеки), и это видно из «35 из 36».
 */
export function pilotCoverageLabel(
    numerator: number | null | undefined,
    denominator: number | null | undefined,
): string {
    return `Доступно на ЕПГУ: ${formatNumber(numerator)} из ${formatNumber(denominator)}`
}

export function formatPercent(value: number | null | undefined): string {
    if (value === null || typeof value === 'undefined') return '—'
    return `${formatNumber(value)} %`
}

export function detailNumber(
    details: Record<string, unknown> | undefined,
    key: string,
): number | null {
    const parsed = Number(details?.[key])
    return Number.isFinite(parsed) ? parsed : null
}

export function formatFileSize(value: number): string {
    if (value < 1024) return `${value} Б`
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`
    return `${(value / (1024 * 1024)).toFixed(1)} МБ`
}

export function formatDateTime(value: string): string {
    return new Date(value).toLocaleString('ru-RU')
}

export function importStatusView(
    status: ReportingImportRun['status'],
): { label: string; color: 'default' | 'success' | 'error' | 'warning' } {
    if (status === 'completed') return { label: 'Завершён', color: 'success' }
    if (status === 'failed') return { label: 'Ошибка', color: 'error' }
    if (status === 'previewed') return { label: 'Ждёт подтверждения', color: 'warning' }
    if (status === 'cancelled') return { label: 'Отменён', color: 'default' }
    return { label: 'Выполняется', color: 'default' }
}

export function statusView(
    indicator: ReportingIndicator,
    value?: ReportingIndicatorValue | null,
): { label: string; color: 'default' | 'success' | 'warning' | 'info' } {
    const status = resolveStatus(indicator, value)
    const readiness = String(value?.calculationDetails?.readiness ?? '')
    if (indicator.isPilot && status === 'awaiting_data') {
        if (readiness.startsWith('epgu_reference')) {
            return { label: 'Нужен справочник ЭМД/НСИ', color: 'warning' }
        }
        if (readiness === 'applicability_incomplete') {
            return { label: 'Нужны правила применимости', color: 'warning' }
        }
        if (readiness === 'remd_data_missing') {
            return { label: 'Нужна выгрузка РЭМД', color: 'warning' }
        }
    }
    if (status === 'methodology_in_development') {
        return { label: 'Методика в разработке', color: 'info' }
    }

    if (status === 'calculated') return { label: 'Рассчитан', color: 'success' }
    if (status === 'not_calculated') return { label: 'Не считается', color: 'default' }
    return { label: 'Нужны данные', color: 'warning' }
}

export function businessStatusView(
    businessStatus: ReportingIndicatorValue['businessStatus'],
): { label: string; color: 'default' | 'success' | 'warning' | 'error' } {
    if (businessStatus === 'target_met') return { label: 'План выполнен', color: 'success' }
    if (businessStatus === 'critical') return { label: 'Критическое отклонение', color: 'error' }
    if (businessStatus === 'below_target') return { label: 'Ниже плана', color: 'warning' }
    return { label: 'Не оценено', color: 'default' }
}

export function resolveStatus(
    indicator: ReportingIndicator,
    value?: ReportingIndicatorValue | null,
): ReportingValueStatus {
    if (indicator.methodologyStatus === 'in_development' || value?.status === 'methodology_in_development') {
        return 'methodology_in_development'
    }
    return value?.status ?? 'awaiting_data'
}

export function organizationStatusView(
    organization: ReportingOrganizationIndicatorValue,
): { label: string; color: 'default' | 'success' | 'warning' | 'info' | 'error' } {
    const readiness = String(organization.calculationDetails?.readiness ?? '')
    if (organization.indicatorId === 'semd_types_epgu_coverage') {
        if (readiness.startsWith('epgu_reference')) {
            return { label: 'Нужен НСИ', color: 'warning' }
        }
        if (readiness === 'applicability_incomplete') {
            if (
                organization.calculationDetails?.isPreliminary === true
                && organization.factValue !== null
            ) {
                return { label: 'Предварительно', color: 'warning' }
            }
            return { label: 'Применимость неполная', color: 'warning' }
        }
        if (readiness === 'not_applicable') {
            return { label: 'Не применяется', color: 'default' }
        }
    }
    const volumeRatio = semdVolumeRatioDetails(organization)
    if (volumeRatio && volumeRatio.status !== 'calculated') {
        return {
            label: semdVolumeRatioStatusLabel(volumeRatio.status),
            color: volumeRatio.status === 'no_approved_volume' ? 'warning' : 'default',
        }
    }
    if (organization.businessStatus !== 'not_assessed') {
        return businessStatusView(organization.businessStatus)
    }
    if (organization.status === 'calculated') return { label: 'Рассчитан', color: 'success' }
    if (organization.status === 'methodology_in_development') return { label: 'Методика в разработке', color: 'info' }
    if (organization.status === 'not_calculated') return { label: 'Не считается', color: 'default' }
    return { label: 'Нужен знаменатель', color: 'warning' }
}

export function hasOrganizationProblem(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    if (
        organization.factValue !== null
        && organization.targetValue !== null
        && organization.factValue < organization.targetValue
    ) return true

    return (
        (detailNumber(organization.calculationDetails, 'missingAtInstitutionCount') ?? 0) > 0
        || (detailNumber(organization.calculationDetails, 'blockedByRegionalGisCount') ?? 0) > 0
        || (detailNumber(organization.calculationDetails, 'unknownGisCapabilityCount') ?? 0) > 0
        || (detailNumber(organization.calculationDetails, 'unexpectedRegisteredTypeCount') ?? 0) > 0
    )
}

export function hasOrganizationTargetMet(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return (
        organization.factValue !== null
        && organization.targetValue !== null
        && organization.factValue >= organization.targetValue
    )
}

export function needsOrganizationDenominator(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return (
        organization.indicatorId === 'semd_types_epgu_coverage'
        && (organization.factValue === null || organization.targetValue === null)
    )
}

export function hasManualOrganizationClarification(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return (
        (detailNumber(organization.calculationDetails, 'manualOverrideCount') ?? 0) > 0
    )
}

/**
 * Р6 (верхнее меню по МО): процент выполнения показателя у МО. Для пилота 6.1.3.2.7
 * он лежит в secondaryValue (как в соте карты), для обычных показателей — в factValue.
 */
export function organizationCoveragePercent(
    organization: ReportingOrganizationIndicatorValue,
): number | null {
    if (organization.indicatorId === 'semd_types_epgu_coverage') {
        return typeof organization.secondaryValue === 'number'
            ? organization.secondaryValue
            : null
    }
    // Н18.2: у показателя 27 в списке стоит исполнение плана — то же число, что
    // на соте. Доля от 145 видов Перечня осталась бы в списке вторым, ничем
    // не подписанным процентом, и одна МО читалась бы как две разные.
    const plan = semdTypeRegistryDetails(organization)?.plan ?? null
    if (plan !== null) return plan.percent
    return organization.factValue
}

/**
 * В3 (ВКС 31.07.2026): «В правой части можно ли сделать сортировку по умолчанию
 * от большего к меньшему?» По умолчанию список идёт по убыванию процента.
 *
 * МО без вычислимого процента (АО «Курганфармация», «не участвует в показателе»)
 * уходят в конец при любом направлении: их значение — прочерк, и сравнивать его
 * с числом нельзя. Внутри равных процентов — по названию, чтобы порядок был
 * устойчивым от пересчёта к пересчёту.
 */
export type OrganizationSortOrder = 'percent_desc' | 'percent_asc' | 'name'

export const DEFAULT_ORGANIZATION_SORT: OrganizationSortOrder = 'percent_desc'

export function compareOrganizations(
    left: ReportingOrganizationIndicatorValue,
    right: ReportingOrganizationIndicatorValue,
    order: OrganizationSortOrder = DEFAULT_ORGANIZATION_SORT,
): number {
    const byName = () => left.organizationName.localeCompare(
        right.organizationName,
        'ru-RU',
    )

    if (order === 'name') return byName()

    const leftPercent = organizationCoveragePercent(left)
    const rightPercent = organizationCoveragePercent(right)

    if (leftPercent === null && rightPercent === null) return byName()
    if (leftPercent === null) return 1
    if (rightPercent === null) return -1

    const delta = order === 'percent_asc'
        ? leftPercent - rightPercent
        : rightPercent - leftPercent

    return delta !== 0 ? delta : byName()
}

export function sortOrganizations(
    organizations: readonly ReportingOrganizationIndicatorValue[],
    order: OrganizationSortOrder = DEFAULT_ORGANIZATION_SORT,
): ReportingOrganizationIndicatorValue[] {
    return [...organizations].sort((left, right) => compareOrganizations(left, right, order))
}

// «Выполняется» — цель достигнута (процент = 100). «Не выполняется» — процент < 100.
// МО без вычислимого процента (нет знаменателя/данных) не попадают ни туда, ни туда.
export function isOrganizationPerformed(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    const percent = organizationCoveragePercent(organization)
    return percent !== null && percent >= 100
}

export function isOrganizationNotPerformed(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    const percent = organizationCoveragePercent(organization)
    return percent !== null && percent < 100
}

export function organizationMatchesListFilter(
    organization: ReportingOrganizationIndicatorValue,
    filter: OrganizationListFilter,
): boolean {
    if (filter === 'performed') return isOrganizationPerformed(organization)
    if (filter === 'not_performed') return isOrganizationNotPerformed(organization)
    return true
}

export interface IndicatorNote {
    key: string
    text: string
    /** Формулировка ещё не согласована с методологом — показываем это явно (Н8). */
    draft: boolean
}

/**
 * Н8: пояснения к показателю, которые обязаны быть видны рядом со значением.
 *
 * Три штуки, и каждая закрывает свой риск:
 *  • знаменатель взят из ТПГГ вместо ФОМС — значения разойдутся с федеральным дашбордом;
 *  • числитель нарастающим итогом против годового плана — 40 % читаются как провал,
 *    хотя это семь месяцев против двенадцати;
 *  • перечень видов медпомощи в знаменателе — дословный текст методолога.
 *
 * Тексты лежат в `metadata` показателя, а не в коде: их правит методолог, и правка
 * не должна требовать сборки. Соседний ключ `…Status` со значением
 * `awaiting_methodologist_approval` помечает несогласованную формулировку.
 */
export function getIndicatorNotes(indicator: ReportingIndicator): IndicatorNote[] {
    const keys = [
        'denominatorSourceNote',
        'periodNote',
        'denominatorScopeNote',
        'numeratorScopeNote',
        'codeNote',
    ] as const
    const notes: IndicatorNote[] = []
    for (const key of keys) {
        const text = indicator.metadata?.[key]
        if (typeof text !== 'string' || !text.trim()) continue
        notes.push({
            key,
            text: text.trim(),
            draft: indicator.metadata?.[`${key}Status`] === 'awaiting_methodologist_approval',
        })
    }
    return notes
}

/**
 * Показывать ли на карточке пометки, формулировка которых ещё не согласована
 * с методологом. Выключено с 14.08.2026 — решение пользователя перед созвоном:
 * два оранжевых абзаца у каждого из четырёх показателей забивали таблицу.
 *
 * Скрыт только черновой текст. Дословные пояснения методолога остаются: перечень
 * видов медпомощи в знаменателе она сама просила вывести на карточку.
 *
 * **Это временно.** Пометка про замену ФОМС на ТПГГ и про нарастающий итог объясняет,
 * почему значения расходятся с федеральным дашбордом и почему четыре доли показываются
 * с критическим отклонением. Как методолог согласует формулировки — снять `Status`
 * в metadata показателей, и пометки вернутся уже без предупреждения.
 */
export const SHOW_DRAFT_INDICATOR_NOTES = false

/** Пометки, которые видит пользователь: черновые скрыты флагом выше. */
export function getVisibleIndicatorNotes(indicator: ReportingIndicator): IndicatorNote[] {
    return getIndicatorNotes(indicator).filter(
        (note) => SHOW_DRAFT_INDICATOR_NOTES || !note.draft,
    )
}

export function getDenominatorSource(indicator: ReportingIndicator): string {
    const source = indicator.metadata?.denominatorSource
    return typeof source === 'string' && source.trim() ? source.trim() : 'Внешний источник'
}
