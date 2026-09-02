import type { ParsedRow } from '@shared/types'

// ─── Типы ─────────────────────────────────────────────────────────────────

export type OutlierMethod = 'iqr' | 'zscore' | 'robust_zscore' | 'percentile'

export interface ColumnOutlierConfig {
    method: OutlierMethod
    /** IQR: множитель (по умолчанию 1.5) */
    iqrK?: number
    /** Z-score / Robust Z-score: порог (по умолчанию 3) */
    zThreshold?: number
    /** Percentile: нижняя граница % (по умолчанию 1) */
    pLow?: number
    /** Percentile: верхняя граница % (по умолчанию 99) */
    pHigh?: number
}

export type OutlierConfig = Record<string, ColumnOutlierConfig>

export interface OutlierResult {
    rows: ParsedRow[]
    removedCount: number
}

// ─── Вспомогательные функции ──────────────────────────────────────────────

function sortedNums(rows: ParsedRow[], field: string): number[] {
    return rows
        .map((r) => r[field])
        .filter((v): v is number => typeof v === 'number' && isFinite(v))
        .sort((a, b) => a - b)
}

function quantile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function mean(vals: number[]): number {
    return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length
}

function std(vals: number[], avg: number): number {
    if (vals.length < 2) return 0
    const variance = vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length
    return Math.sqrt(variance)
}

function median(sorted: number[]): number {
    const n = sorted.length
    if (n === 0) return 0
    return n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)]
}

function mad(vals: number[], med: number): number {
    const deviations = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
    return median(deviations)
}

// ─── Расчёт границ выбросов по одной колонке ──────────────────────────────

export interface OutlierBounds {
    lower: number
    upper: number
}

export function computeBounds(rows: ParsedRow[], field: string, cfg: ColumnOutlierConfig): OutlierBounds | null {
    const sorted = sortedNums(rows, field)
    if (sorted.length === 0) return null

    if (cfg.method === 'iqr') {
        const k = cfg.iqrK ?? 1.5
        const q1 = quantile(sorted, 25)
        const q3 = quantile(sorted, 75)
        const iqr = q3 - q1
        return { lower: q1 - k * iqr, upper: q3 + k * iqr }
    }

    if (cfg.method === 'zscore') {
        const avg = mean(sorted)
        const s = std(sorted, avg)
        const t = cfg.zThreshold ?? 3
        return { lower: avg - t * s, upper: avg + t * s }
    }

    if (cfg.method === 'robust_zscore') {
        const med = median(sorted)
        const madVal = mad(sorted, med)
        // 0.6745 — нормировочный коэффициент (MAD ≈ 0.6745σ при норм. распред.)
        const s = madVal === 0 ? 1 : madVal / 0.6745
        const t = cfg.zThreshold ?? 3.5
        return { lower: med - t * s, upper: med + t * s }
    }

    if (cfg.method === 'percentile') {
        const lo = cfg.pLow ?? 1
        const hi = cfg.pHigh ?? 99
        return { lower: quantile(sorted, lo), upper: quantile(sorted, hi) }
    }

    return null
}

// ─── Основная функция ─────────────────────────────────────────────────────

export function removeOutlierRows(rows: ParsedRow[], config: OutlierConfig): OutlierResult {
    const fields = Object.keys(config)
    if (fields.length === 0) return { rows, removedCount: 0 }

    // Вычисляем границы один раз (до фильтрации)
    const boundsMap: Record<string, OutlierBounds> = {}
    for (const field of fields) {
        const b = computeBounds(rows, field, config[field])
        if (b) boundsMap[field] = b
    }

    const filtered = rows.filter((row) => {
        for (const field of fields) {
            const b = boundsMap[field]
            if (!b) continue
            const v = row[field]
            if (typeof v !== 'number' || !isFinite(v)) continue
            if (v < b.lower || v > b.upper) return false
        }
        return true
    })

    return { rows: filtered, removedCount: rows.length - filtered.length }
}

// ─── Предварительный расчёт (для диалога) ─────────────────────────────────

export interface OutlierPreview {
    field: string
    totalCount: number
    outlierCount: number
    bounds: OutlierBounds
}

export function previewOutliers(rows: ParsedRow[], config: OutlierConfig): OutlierPreview[] {
    return Object.entries(config).flatMap(([field, cfg]) => {
        const bounds = computeBounds(rows, field, cfg)
        if (!bounds) return []
        const vals = rows
            .map((r) => r[field])
            .filter((v): v is number => typeof v === 'number' && isFinite(v))
        const outlierCount = vals.filter((v) => v < bounds.lower || v > bounds.upper).length
        return [{ field, totalCount: vals.length, outlierCount, bounds }]
    })
}
