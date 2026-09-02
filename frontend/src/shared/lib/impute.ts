import type { ParsedRow } from '@shared/types'

// ─── Типы ──────────────────────────────────────────────────────────────────

/** Стратегии заполнения пропусков */
export type ImputeMethod =
    | 'mean'      // среднее (числовые)
    | 'median'    // медиана (числовые)
    | 'mode'      // наиболее частое значение
    | 'constant'  // фиксированное значение
    | 'ffill'     // заполнение предыдущим значением
    | 'bfill'     // заполнение следующим значением
    | 'linear'    // линейная интерполяция (числовые)
    | 'drop'      // удалить строки с пропуском

export interface ColumnImputeConfig {
    method: ImputeMethod
    /** Используется только при method === 'constant' */
    value?: string | number
}

export type ImputeConfig = Record<string, ColumnImputeConfig>

export interface MissingInfo {
    field: string
    /** Кол-во строк с пропуском */
    count: number
    /** Всего строк */
    total: number
    /** Процент пропусков */
    pct: number
    /** Числовая ли колонка (определяется по непустым значениям) */
    isNumeric: boolean
}

// ─── Хелперы ───────────────────────────────────────────────────────────────

function isMissing(v: unknown): boolean {
    return v === null || v === undefined || v === ''
}

function numericValues(rows: ParsedRow[], field: string): number[] {
    return rows
        .map((r) => r[field])
        .filter((v) => !isMissing(v) && !isNaN(Number(v)))
        .map(Number)
}

function calcMean(nums: number[]): number {
    return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

function calcMedian(nums: number[]): number {
    if (nums.length === 0) return 0
    const sorted = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function calcMode(rows: ParsedRow[], field: string): unknown {
    const freq: Record<string, number> = {}
    for (const row of rows) {
        if (!isMissing(row[field])) {
            const key = String(row[field])
            freq[key] = (freq[key] || 0) + 1
        }
    }
    let bestKey = ''
    let bestCount = -1
    for (const [k, c] of Object.entries(freq)) {
        if (c > bestCount) {
            bestCount = c
            bestKey = k
        }
    }
    return bestKey
}

// ─── Основные функции ──────────────────────────────────────────────────────

/**
 * Возвращает сводку по пропускам для каждой колонки.
 * Колонки без пропусков тоже включены (count = 0).
 */
export function missingReport(rows: ParsedRow[]): MissingInfo[] {
    if (rows.length === 0) return []
    const fields = Object.keys(rows[0])
    return fields.map((field) => {
        let missing = 0, nonMissing = 0, numeric = 0
        for (const row of rows) {
            const v = row[field]
            if (isMissing(v)) { missing++; continue }
            nonMissing++
            if (!isNaN(Number(v))) numeric++
        }
        return {
            field,
            count: missing,
            total: rows.length,
            pct: (missing / rows.length) * 100,
            isNumeric: nonMissing > 0 && numeric === nonMissing,
        }
    })
}

/**
 * Применяет конфигурацию заполнения пропусков к массиву строк.
 * Возвращает новый массив (оригинал не мутируется).
 */
export function imputeRows(rows: ParsedRow[], config: ImputeConfig): ParsedRow[] {
    if (rows.length === 0) return rows

    let result = rows.map((r) => ({ ...r }))

    for (const [field, { method, value }] of Object.entries(config)) {
        // drop — удаляем строки с пропуском, дальше не обрабатываем
        if (method === 'drop') {
            result = result.filter((r) => !isMissing(r[field]))
            continue
        }

        // ffill — заполнение предыдущим
        if (method === 'ffill') {
            let last: unknown = null
            for (const row of result) {
                if (!isMissing(row[field])) {
                    last = row[field]
                } else if (last !== null) {
                    row[field] = last
                }
            }
            continue
        }

        // bfill — заполнение следующим
        if (method === 'bfill') {
            let next: unknown = null
            for (let i = result.length - 1; i >= 0; i--) {
                if (!isMissing(result[i][field])) {
                    next = result[i][field]
                } else if (next !== null) {
                    result[i][field] = next
                }
            }
            continue
        }

        // linear — линейная интерполяция
        if (method === 'linear') {
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
                                startVal +
                                ((endVal - startVal) * (j - startIdx)) / (i - startIdx)
                        }
                    }
                    startIdx = i
                }
            }
            continue
        }

        // Скалярные методы: вычисляем fillValue один раз
        let fillValue: unknown
        if (method === 'mean') {
            fillValue = calcMean(numericValues(result, field))
        } else if (method === 'median') {
            fillValue = calcMedian(numericValues(result, field))
        } else if (method === 'mode') {
            fillValue = calcMode(result, field)
        } else if (method === 'constant') {
            fillValue = value ?? ''
        }

        if (fillValue !== undefined) {
            for (const row of result) {
                if (isMissing(row[field])) {
                    row[field] = fillValue
                }
            }
        }
    }

    return result
}
