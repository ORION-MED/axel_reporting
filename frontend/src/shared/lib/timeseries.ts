import type { ParsedRow, ColumnConfig } from '@shared/types'

// ─── Типы ──────────────────────────────────────────────────────────────────

// ── Разбиение на окна ──────────────────────────────────────────────────────

/** Единицы разбиения для date/datetime колонок */
export type WindowDateUnit = 'year' | 'yearmonth' | 'yearweek' | 'day'

/** Единицы разбиения для time/datetime колонок */
export type WindowTimeUnit = 'hour' | 'hourminute' | 'second'

export type WindowSplitUnit = WindowDateUnit | WindowTimeUnit

export interface WindowSplitConfig {
    /** Исходная колонка с датой/временем */
    field: string
    /** Тип колонки: 'date' | 'datetime' | 'time' */
    fieldType: 'date' | 'datetime' | 'time'
    /** Единица разбиения */
    unit: WindowSplitUnit
}

/** Метки единиц для отображения */
export const WINDOW_DATE_UNITS: Array<{ value: WindowDateUnit; label: string; hint: string }> = [
    { value: 'year', label: 'Год', hint: 'Метка: 2021, 2022, …' },
    { value: 'yearmonth', label: 'Год–Месяц', hint: 'Метка: 2021-03, 2021-04, …' },
    { value: 'yearweek', label: 'Год–Неделя', hint: 'Метка: 2021-W12, …' },
    { value: 'day', label: 'День (дата)', hint: 'Метка: 2021-03-15, …' },
]

export const WINDOW_TIME_UNITS: Array<{ value: WindowTimeUnit; label: string; hint: string }> = [
    { value: 'hour', label: 'Час', hint: 'Метка: 0, 1, … 23' },
    { value: 'hourminute', label: 'Час:Минута', hint: 'Метка: 14:30, …' },
    { value: 'second', label: 'Час:Мин:Сек', hint: 'Метка: 14:30:45, …' },
]

// ── Хелперы парсинга даты/времени ─────────────────────────────────────────

function parseDateTime(val: unknown, fieldType: 'date' | 'datetime' | 'time'): Date | null {
    if (val === null || val === undefined || val === '') return null
    const s = String(val).trim()
    if (fieldType === 'time') {
        // "HH:MM:SS" или "HH:MM"
        const d = new Date(`1970-01-01T${s.includes('T') ? s.split('T')[1] : s}`)
        return isNaN(d.getTime()) ? null : d
    }
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
}

function isoWeek(d: Date): string {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

function extractWindowLabel(d: Date, unit: WindowSplitUnit): string | number {
    switch (unit) {
        case 'year': return d.getFullYear()
        case 'yearmonth': return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
        case 'yearweek': return isoWeek(d)
        case 'day': return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        case 'hour': return d.getHours()
        case 'hourminute': return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
        case 'second': return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    }
}

/**
 * Разбивает строки на именованные окна по дате/времени.
 * Добавляет новую колонку `{field}_{unit}` с меткой окна.
 * Оригинальные данные НЕ изменяются.
 */
export function applyWindowSplit(
    rows: ParsedRow[],
    config: WindowSplitConfig,
    columns: ColumnConfig[],
): { rows: ParsedRow[]; addedColumns: ColumnConfig[] } {
    const { field, fieldType, unit } = config
    const newField = `${field}_${unit}`

    const newRows = rows.map((r) => {
        const d = parseDateTime(r[field], fieldType)
        return {
            ...r,
            [newField]: d !== null ? extractWindowLabel(d, unit) : null,
        }
    })

    const isNumericUnit = unit === 'year' || unit === 'hour'
    const addedCol: ColumnConfig = {
        field: newField,
        headerName: newField,
        type: isNumericUnit ? 'number' : 'string',
        visible: true,
    }

    // Не добавлять колонку повторно если уже есть
    const alreadyExists = columns.some((c) => c.field === newField)
    return { rows: newRows, addedColumns: alreadyExists ? [] : [addedCol] }
}

/** Методы обработки временных рядов */
export type TimeSeriesMethod =
    // ── Заполнение пропусков ──────────────────────────────────
    | 'mean_fill'         // Заполнение средним значением
    | 'median_fill'       // Заполнение медианой
    | 'ffill'             // Перенос предыдущего значения
    | 'bfill'             // Перенос следующего значения
    | 'rolling_mean_fill' // Скользящее среднее (только пропуски)
    | 'linear'            // Линейная интерполяция пропусков
    | 'polynomial_fill'   // Квадратичная интерполяция пропусков
    | 'spline_fill'       // Кубический сплайн (Catmull-Rom)
    // ── Преобразование нестационарного ряда ──────────────────
    | 'log_transform'     // Логарифмирование ln(x)
    | 'boxcox'            // Преобразование Бокса–Кокса
    | 'diff'              // Дифференцирование (устранение тренда/сезонности)
    // ── Сглаживание (все значения) ───────────────────────────
    | 'rolling_mean'      // Скользящее среднее
    | 'rolling_median'    // Скользящая медиана
    | 'ewm'               // Экспоненциальное сглаживание
    // ── Нормализация и масштабирование ───────────────────────
    | 'normalize'         // Min-max нормализация → [0, 1]
    | 'standardize'       // Z-score стандартизация → μ=0, σ=1
    // ── Лаговые признаки ──────────────────────────────────────
    | 'seasonal_diff'     // Сезонное дифференцирование y[t] - y[t-k]
    | 'lag_feature'       // Создание лаговой колонки {field}_lagK

export interface TimeSeriesConfig {
    method: TimeSeriesMethod
    fields: string[]
    /** Размер окна для rolling-методов / порядок для diff (default 3 / 1) */
    window?: number
    /** Коэффициент сглаживания для EWM ∈ (0, 1] (default 0.3) */
    alpha?: number
    /** Параметр λ для преобразования Бокса–Кокса (default 0.5) */
    lambda?: number
}

// ─── Хелперы ───────────────────────────────────────────────────────────────

function isMissing(v: unknown): boolean {
    return v === null || v === undefined || v === ''
}

// ─── Нормализация и стандартизация ─────────────────────────────────────────

function tsNormalize(rows: ParsedRow[], field: string): ParsedRow[] {
    const vals = rows.map((r) => r[field]).filter((v) => !isMissing(v) && !isNaN(Number(v))).map(Number)
    if (vals.length === 0) return rows
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    if (max === min) return rows
    return rows.map((r) => ({
        ...r,
        [field]: isMissing(r[field]) || isNaN(Number(r[field])) ? r[field] : (Number(r[field]) - min) / (max - min),
    }))
}

function tsStandardize(rows: ParsedRow[], field: string): ParsedRow[] {
    const vals = rows.map((r) => r[field]).filter((v) => !isMissing(v) && !isNaN(Number(v))).map(Number)
    if (vals.length === 0) return rows
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
    if (std === 0) return rows
    return rows.map((r) => ({
        ...r,
        [field]: isMissing(r[field]) || isNaN(Number(r[field])) ? r[field] : (Number(r[field]) - mean) / std,
    }))
}

// ─── Лаговые признаки и сезонное дифференцирование ─────────────────────────

function tsSeasonalDiff(rows: ParsedRow[], field: string, period: number): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    for (let i = 0; i < result.length; i++) {
        const v = result[i][field]
        if (i < period || isMissing(v) || isNaN(Number(v))) {
            result[i][field] = null
        } else {
            const prev = result[i - period][field]
            result[i][field] = isMissing(prev) || isNaN(Number(prev)) ? null : Number(v) - Number(prev)
        }
    }
    return result
}

function tsLagFeature(rows: ParsedRow[], field: string, lag: number): ParsedRow[] {
    return rows.map((r, i) => {
        const lagVal = i >= lag ? rows[i - lag][field] : null
        return { ...r, [`${field}_lag${lag}`]: isMissing(lagVal) ? null : lagVal }
    })
}

// ─── Точка входа ───────────────────────────────────────────────────────────

/**
 * Применяет конфигурацию обработки временных рядов к массиву строк.
 * Возвращает новый массив (оригинал не мутируется).
 */
export function applyTimeSeries(rows: ParsedRow[], config: TimeSeriesConfig): ParsedRow[] {
    let result = rows.map((r) => ({ ...r }))
    const w = config.window ?? 3
    const a = config.alpha ?? 0.3
    const lam = config.lambda ?? 0.5
    for (const field of config.fields) {
        switch (config.method) {
            case 'mean_fill': result = tsMeanFill(result, field); break
            case 'median_fill': result = tsMedianFill(result, field); break
            case 'ffill': result = tsForwardFill(result, field); break
            case 'bfill': result = tsBackwardFill(result, field); break
            case 'linear': result = tsLinearFill(result, field); break
            case 'rolling_mean_fill': result = tsRollingMeanFill(result, field, w); break
            case 'polynomial_fill': result = tsPolynomialFill(result, field); break
            case 'spline_fill': result = tsSplineFill(result, field); break
            case 'log_transform': result = tsLogTransform(result, field); break
            case 'boxcox': result = tsBoxCox(result, field, lam); break
            case 'diff': result = tsDiff(result, field, config.window ?? 1); break
            case 'rolling_mean': result = tsRollingMean(result, field, w); break
            case 'rolling_median': result = tsRollingMedian(result, field, w); break
            case 'ewm': result = tsEwmSmooth(result, field, a); break
            case 'normalize': result = tsNormalize(result, field); break
            case 'standardize': result = tsStandardize(result, field); break
            case 'seasonal_diff': result = tsSeasonalDiff(result, field, config.window ?? 12); break
            case 'lag_feature': result = tsLagFeature(result, field, config.window ?? 1); break
        }
    }
    return result
}

// ─── Методы заполнения пропусков ───────────────────────────────────────────

function tsMeanFill(rows: ParsedRow[], field: string): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    const vals = result.map(r => r[field]).filter(v => !isMissing(v) && !isNaN(Number(v))).map(Number)
    if (vals.length === 0) return result
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    for (const row of result) if (isMissing(row[field])) row[field] = mean
    return result
}

function tsMedianFill(rows: ParsedRow[], field: string): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    const sorted = result.map(r => r[field]).filter(v => !isMissing(v) && !isNaN(Number(v))).map(Number).sort((a, b) => a - b)
    if (sorted.length === 0) return result
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    for (const row of result) if (isMissing(row[field])) row[field] = median
    return result
}

function tsForwardFill(rows: ParsedRow[], field: string): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    let last: unknown = null
    for (const row of result) {
        if (!isMissing(row[field])) {
            last = row[field]
        } else if (last !== null) {
            row[field] = last
        }
    }
    return result
}

function tsBackwardFill(rows: ParsedRow[], field: string): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    let next: unknown = null
    for (let i = result.length - 1; i >= 0; i--) {
        if (!isMissing(result[i][field])) {
            next = result[i][field]
        } else if (next !== null) {
            result[i][field] = next
        }
    }
    return result
}

function tsLinearFill(rows: ParsedRow[], field: string): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    let startIdx = -1
    for (let i = 0; i <= result.length; i++) {
        const atEnd = i === result.length
        const miss = atEnd || isMissing(result[i][field])
        if (!miss) {
            if (startIdx >= 0 && i - startIdx > 1) {
                const startVal = Number(result[startIdx][field])
                const endVal = Number(result[i][field])
                for (let j = startIdx + 1; j < i; j++) {
                    result[j][field] =
                        startVal + ((endVal - startVal) * (j - startIdx)) / (i - startIdx)
                }
            }
            startIdx = i
        }
    }
    return result
}

function tsRollingMeanFill(rows: ParsedRow[], field: string, window: number): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    const half = Math.floor(window / 2)
    for (let i = 0; i < result.length; i++) {
        if (!isMissing(result[i][field])) continue
        const vals: number[] = []
        for (let j = Math.max(0, i - half); j <= Math.min(result.length - 1, i + half); j++) {
            if (j === i) continue
            const v = result[j][field]
            if (!isMissing(v) && !isNaN(Number(v))) vals.push(Number(v))
        }
        if (vals.length > 0) {
            result[i][field] = vals.reduce((a, b) => a + b, 0) / vals.length
        }
    }
    return result
}

function tsPolynomialFill(rows: ParsedRow[], field: string): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    const known: Array<[number, number]> = []
    for (let i = 0; i < result.length; i++) {
        const v = result[i][field]
        if (!isMissing(v) && !isNaN(Number(v))) known.push([i, Number(v)])
    }
    for (let i = 0; i < result.length; i++) {
        if (!isMissing(result[i][field])) continue
        const before = known.filter(([idx]) => idx < i)
        const after = known.filter(([idx]) => idx > i)
        if (before.length >= 2 && after.length >= 1) {
            const p1 = before[before.length - 2]
            const p2 = before[before.length - 1]
            const p3 = after[0]
            result[i][field] = lagrangeInterp3(p1, p2, p3, i)
        } else if (before.length >= 1 && after.length >= 1) {
            const [x0, y0] = before[before.length - 1]
            const [x1, y1] = after[0]
            result[i][field] = y0 + ((y1 - y0) * (i - x0)) / (x1 - x0)
        }
    }
    return result
}

function lagrangeInterp3(
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    x: number,
): number {
    const [x1, y1] = p1
    const [x2, y2] = p2
    const [x3, y3] = p3
    return (
        y1 * ((x - x2) * (x - x3)) / ((x1 - x2) * (x1 - x3)) +
        y2 * ((x - x1) * (x - x3)) / ((x2 - x1) * (x2 - x3)) +
        y3 * ((x - x1) * (x - x2)) / ((x3 - x1) * (x3 - x2))
    )
}

function tsSplineFill(rows: ParsedRow[], field: string): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    const known: Array<[number, number]> = []
    for (let i = 0; i < result.length; i++) {
        const v = result[i][field]
        if (!isMissing(v) && !isNaN(Number(v))) known.push([i, Number(v)])
    }
    if (known.length < 2) return result
    for (let i = 0; i < result.length; i++) {
        if (!isMissing(result[i][field])) continue
        const before = known.filter(([idx]) => idx < i)
        const after = known.filter(([idx]) => idx > i)
        if (before.length === 0 || after.length === 0) continue
        const p1 = before[before.length - 1]
        const p2 = after[0]
        const p0: [number, number] = before.length >= 2
            ? before[before.length - 2]
            : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]]
        const p3: [number, number] = after.length >= 2
            ? after[1]
            : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]]
        const t = (i - p1[0]) / (p2[0] - p1[0])
        result[i][field] = 0.5 * (
            2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t * t +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t * t * t
        )
    }
    return result
}

function tsLogTransform(rows: ParsedRow[], field: string): ParsedRow[] {
    return rows.map((r) => {
        const v = r[field]
        if (isMissing(v)) return { ...r }
        const n = Number(v)
        return { ...r, [field]: isFinite(n) && n > 0 ? Math.log(n) : null }
    })
}

function tsBoxCox(rows: ParsedRow[], field: string, lambda: number): ParsedRow[] {
    return rows.map((r) => {
        const v = r[field]
        if (isMissing(v)) return { ...r }
        const n = Number(v)
        if (!isFinite(n) || n <= 0) return { ...r, [field]: null }
        const t = Math.abs(lambda) < 1e-6 ? Math.log(n) : (Math.pow(n, lambda) - 1) / lambda
        return { ...r, [field]: t }
    })
}

function tsDiff(rows: ParsedRow[], field: string, order: number): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    for (let i = 0; i < result.length; i++) {
        if (i < order) { result[i][field] = null; continue }
        const curr = result[i][field]
        const prev = result[i - order][field]
        result[i][field] = (isMissing(curr) || isMissing(prev)) ? null : Number(curr) - Number(prev)
    }
    return result
}

// ─── Методы сглаживания ────────────────────────────────────────────────────

function tsRollingMean(rows: ParsedRow[], field: string, window: number): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    const half = Math.floor(window / 2)
    for (let i = 0; i < result.length; i++) {
        const vals: number[] = []
        for (let j = Math.max(0, i - half); j <= Math.min(result.length - 1, i + half); j++) {
            const v = result[j][field]
            if (!isMissing(v) && !isNaN(Number(v))) vals.push(Number(v))
        }
        if (vals.length > 0) {
            result[i][field] = vals.reduce((a, b) => a + b, 0) / vals.length
        }
    }
    return result
}

function tsRollingMedian(rows: ParsedRow[], field: string, window: number): ParsedRow[] {
    const result = rows.map((r) => ({ ...r }))
    const half = Math.floor(window / 2)
    for (let i = 0; i < result.length; i++) {
        const vals: number[] = []
        for (let j = Math.max(0, i - half); j <= Math.min(result.length - 1, i + half); j++) {
            const v = result[j][field]
            if (!isMissing(v) && !isNaN(Number(v))) vals.push(Number(v))
        }
        if (vals.length > 0) {
            const sorted = [...vals].sort((a, b) => a - b)
            const mid = Math.floor(sorted.length / 2)
            result[i][field] =
                sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
        }
    }
    return result
}

function tsEwmSmooth(rows: ParsedRow[], field: string, alpha: number): ParsedRow[] {
    const a = Math.max(0.001, Math.min(1, alpha))
    const result = rows.map((r) => ({ ...r }))
    let prev: number | null = null
    for (let i = 0; i < result.length; i++) {
        const v = result[i][field]
        if (!isMissing(v) && !isNaN(Number(v))) {
            const cur = Number(v)
            prev = prev === null ? cur : a * cur + (1 - a) * prev
            result[i][field] = prev
        }
    }
    return result
}
