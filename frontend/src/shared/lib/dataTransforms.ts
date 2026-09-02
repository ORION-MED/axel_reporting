import type { ParsedRow, ColumnConfig } from '@shared/types'

// ─── Типы масштабирования ──────────────────────────────────────────────────

export type ScaleMethod =
    | 'standard'      // (x − μ) / σ
    | 'center_only'   // x − μ  (только центрирование)
    | 'unit_variance' // x / σ  (только деление на σ)
    | 'minmax'        // (x − min) / (max − min)  →  [0, 1]
    | 'minmax_sym'    // 2·(x − min)/(max − min) − 1  →  [−1, 1]
    | 'maxabs'        // x / max(|x|), сохраняет ноль (для sparse)
    | 'robust'        // (x − median) / IQR
    | 'percentile'    // привести [pLow%, pHigh%] к [0, 1], clip

export interface ColumnScaleConfig {
    method: ScaleMethod
    /** Для 'percentile'. По умолчанию 5 */
    pLow?: number
    /** Для 'percentile'. По умолчанию 95 */
    pHigh?: number
}

export type ScaleConfig = Record<string, ColumnScaleConfig>

// ─── Типы кодирования ──────────────────────────────────────────────────────

export type EncodeMethod =
    | 'onehot'    // бинарные колонки field__val
    | 'label'     // авто-сортировка уникальных → 0, 1, 2 … (Label Encoding)
    | 'ordinal'   // пользовательский порядок → 0, 1, 2 …
    | 'frequency' // относительная частота 0.0–1.0
    | 'count'     // абсолютное кол-во вхождений
    | 'target'    // среднее целевой переменной по категории (mean encoding)
    | 'loo'       // leave-one-out target encoding
    | 'woe'       // weight of evidence (бинарная цель)

export interface ColumnEncodeConfig {
    method: EncodeMethod
    /** Для 'ordinal': список значений в порядке возрастания */
    ordinalOrder?: string[]
    /** Для 'target', 'loo', 'woe': имя целевого поля */
    targetField?: string
    /** Сохранённый маппинг значений → кодов (только для отображения примеров в UI) */
    _labelMapping?: Record<string, number>
}

export type EncodeConfig = Record<string, ColumnEncodeConfig>

export interface EncodeResult {
    rows: ParsedRow[]
    /** Новые колонки, добавленные one-hot энкодером */
    addedColumns: ColumnConfig[]
}

// ─── Математические хелперы ────────────────────────────────────────────────

function numericValues(rows: ParsedRow[], field: string): number[] {
    return rows
        .map((r) => r[field])
        .filter((v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
        .map(Number)
}

function mean(nums: number[]): number {
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

function std(nums: number[], mu?: number): number {
    const m = mu ?? mean(nums)
    return Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length) || 1
}

function median(nums: number[]): number {
    if (!nums.length) return 0
    const s = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function iqr(nums: number[]): number {
    const s = [...nums].sort((a, b) => a - b)
    const q1 = s[Math.floor(s.length * 0.25)]
    const q3 = s[Math.floor(s.length * 0.75)]
    return (q3 - q1) || 1
}

function percentile(nums: number[], p: number): number {
    const s = [...nums].sort((a, b) => a - b)
    const idx = (p / 100) * (s.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}

function round8(v: number): number {
    return Math.round(v * 1e8) / 1e8
}

// ─── Масштабирование числовых признаков ───────────────────────────────────

/**
 * standard      — (x − μ) / σ
 * center_only   — x − μ
 * unit_variance — x / σ
 * minmax        — [0, 1]
 * minmax_sym    — [−1, 1]
 * maxabs        — x / max(|x|)
 * robust        — (x − median) / IQR
 * percentile    — [pLow%, pHigh%] → [0, 1], clip
 */
export function scaleRows(rows: ParsedRow[], config: ScaleConfig): ParsedRow[] {
    if (!rows.length) return rows
    const result = rows.map((r) => ({ ...r }))

    for (const [field, cfg] of Object.entries(config)) {
        const nums = numericValues(result, field)
        if (!nums.length) continue
        const { method, pLow = 5, pHigh = 95 } = cfg

        let transform: (v: number) => number

        switch (method) {
            case 'standard': {
                const mu = mean(nums)
                const sigma = std(nums, mu)
                transform = (v) => (v - mu) / sigma
                break
            }
            case 'center_only': {
                const mu = mean(nums)
                transform = (v) => v - mu
                break
            }
            case 'unit_variance': {
                const sigma = std(nums)
                transform = (v) => v / sigma
                break
            }
            case 'minmax': {
                const minV = Math.min(...nums)
                const range = (Math.max(...nums) - minV) || 1
                transform = (v) => (v - minV) / range
                break
            }
            case 'minmax_sym': {
                const minV = Math.min(...nums)
                const range = (Math.max(...nums) - minV) || 1
                transform = (v) => 2 * ((v - minV) / range) - 1
                break
            }
            case 'maxabs': {
                const maxAbs = Math.max(...nums.map(Math.abs)) || 1
                transform = (v) => v / maxAbs
                break
            }
            case 'robust': {
                const med = median(nums)
                const iqrVal = iqr(nums)
                transform = (v) => (v - med) / iqrVal
                break
            }
            case 'percentile': {
                const lo = percentile(nums, pLow)
                const hi = percentile(nums, pHigh)
                const range = (hi - lo) || 1
                transform = (v) => Math.min(1, Math.max(0, (v - lo) / range))
                break
            }
            default:
                continue
        }

        for (const row of result) {
            const v = row[field]
            if (v !== null && v !== undefined && v !== '' && !isNaN(Number(v))) {
                row[field] = round8(transform(Number(v)))
            }
        }
    }

    return result
}

// ─── Кодирование категориальных признаков ─────────────────────────────────

/**
 * onehot    — бинарные колонки field__val
 * ordinal   — ordinalOrder → 0, 1, 2 … (неизвестные в конец)
 * frequency — относительная частота 0.0–1.0
 * count     — абсолютное кол-во вхождений
 * target    — среднее targetField по категории
 * loo       — leave-one-out target encoding
 * woe       — log(P(event|cat)/P(non-event|cat)), бинарная цель
 */
export function encodeRows(
    rows: ParsedRow[],
    config: EncodeConfig,
    existingColumns: ColumnConfig[],
): EncodeResult {
    if (!rows.length) return { rows, addedColumns: [] }

    const result = rows.map((r) => ({ ...r }))
    const addedColumns: ColumnConfig[] = []

    for (const [field, cfg] of Object.entries(config)) {
        const { method, ordinalOrder, targetField } = cfg

        if (method === 'frequency') {
            const freq: Record<string, number> = {}
            for (const row of result) {
                const k = String(row[field] ?? '')
                freq[k] = (freq[k] || 0) + 1
            }
            const total = result.length
            for (const row of result) {
                row[field] = round8(freq[String(row[field] ?? '')] / total)
            }
            continue
        }

        if (method === 'count') {
            const cnt: Record<string, number> = {}
            for (const row of result) {
                const k = String(row[field] ?? '')
                cnt[k] = (cnt[k] || 0) + 1
            }
            for (const row of result) {
                row[field] = cnt[String(row[field] ?? '')] ?? 0
            }
            continue
        }

        if (method === 'label') {
            // Авто-сортированный Label Encoding: уникальные значения → 0, 1, 2...
            const unique = [
                ...new Set(
                    result
                        .map((r) => String(r[field] ?? ''))
                        .filter((v) => v !== ''),
                ),
            ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            const map: Record<string, number> = {}
            unique.forEach((v, i) => { map[v] = i })
            for (const row of result) {
                const k = String(row[field] ?? '')
                row[field] = k in map ? map[k] : unique.length // неизвестные → в конец
            }
            continue
        }

        if (method === 'ordinal') {
            // Если порядок не задан — автоматически сортируем уникальные значения
            const autoOrder = [
                ...new Set(
                    result
                        .map((r) => String(r[field] ?? ''))
                        .filter((v) => v !== ''),
                ),
            ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            const order = (ordinalOrder && ordinalOrder.length > 0) ? ordinalOrder : autoOrder
            const map: Record<string, number> = {}
            order.forEach((v, i) => { map[v] = i })
            for (const row of result) {
                const k = String(row[field] ?? '')
                row[field] = k in map ? map[k] : order.length
            }
            continue
        }

        if (method === 'onehot') {
            const unique = [
                ...new Set(
                    result
                        .map((r) => r[field])
                        .filter((v) => v !== null && v !== undefined && v !== ''),
                ),
            ].map(String).sort()

            for (const val of unique) {
                const newField = `${field}__${val.replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, '_')}`
                if (
                    !existingColumns.find((c) => c.field === newField) &&
                    !addedColumns.find((c) => c.field === newField)
                ) {
                    addedColumns.push({
                        field: newField,
                        headerName: `${field} = ${val}`,
                        type: 'number',
                        visible: true,
                    })
                }
                for (const row of result) {
                    row[newField] = String(row[field]) === val ? 1 : 0
                }
            }
            continue
        }

        if (method === 'target' && targetField) {
            const catSum: Record<string, number> = {}
            const catCnt: Record<string, number> = {}
            for (const row of result) {
                const k = String(row[field] ?? '')
                const t = Number(row[targetField])
                if (!isNaN(t)) {
                    catSum[k] = (catSum[k] || 0) + t
                    catCnt[k] = (catCnt[k] || 0) + 1
                }
            }
            const globalMean = mean(numericValues(result, targetField))
            for (const row of result) {
                const k = String(row[field] ?? '')
                row[field] = catCnt[k] ? round8(catSum[k] / catCnt[k]) : round8(globalMean)
            }
            continue
        }

        if (method === 'loo' && targetField) {
            const catSum: Record<string, number> = {}
            const catCnt: Record<string, number> = {}
            for (const row of result) {
                const k = String(row[field] ?? '')
                const t = Number(row[targetField])
                if (!isNaN(t)) {
                    catSum[k] = (catSum[k] || 0) + t
                    catCnt[k] = (catCnt[k] || 0) + 1
                }
            }
            const globalMean = mean(numericValues(result, targetField))
            for (const row of result) {
                const k = String(row[field] ?? '')
                const t = Number(row[targetField])
                const cnt = catCnt[k] ?? 0
                const sum = catSum[k] ?? 0
                if (cnt > 1 && !isNaN(t)) {
                    row[field] = round8((sum - t) / (cnt - 1))
                } else {
                    row[field] = round8(globalMean)
                }
            }
            continue
        }

        if (method === 'woe' && targetField) {
            const catEvent: Record<string, number> = {}
            const catNonEvent: Record<string, number> = {}
            let totalEvents = 0
            let totalNonEvents = 0
            for (const row of result) {
                const k = String(row[field] ?? '')
                const t = Number(row[targetField])
                if (t === 1) { catEvent[k] = (catEvent[k] || 0) + 1; totalEvents++ }
                else if (t === 0) { catNonEvent[k] = (catNonEvent[k] || 0) + 1; totalNonEvents++ }
            }
            if (totalEvents === 0 || totalNonEvents === 0) continue
            for (const row of result) {
                const k = String(row[field] ?? '')
                const er = (catEvent[k] || 0.5) / totalEvents
                const nr = (catNonEvent[k] || 0.5) / totalNonEvents
                row[field] = round8(Math.log(er / nr))
            }
            continue
        }
    }

    return { rows: result, addedColumns }
}

// ─── Статистика по колонке ─────────────────────────────────────────────────

export interface ColumnStats {
    field: string
    min: number
    max: number
    mean: number
    std: number
    median: number
}

export function columnStats(rows: ParsedRow[], field: string): ColumnStats | null {
    const nums = numericValues(rows, field)
    if (!nums.length) return null
    const mu = mean(nums)
    return {
        field,
        min: round8(Math.min(...nums)),
        max: round8(Math.max(...nums)),
        mean: round8(mu),
        std: round8(std(nums, mu)),
        median: round8(median(nums)),
    }
}
