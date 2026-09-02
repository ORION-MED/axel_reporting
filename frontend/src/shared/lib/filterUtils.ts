import { DateTime } from 'luxon'
import type { ColumnFilter, ParsedRow } from '@shared/types'

export const FILTER_KEY_DUPLICATE_SEPARATOR = '__dup__'

export function getBaseFilterField(fieldKey: string): string {
    const idx = fieldKey.indexOf(FILTER_KEY_DUPLICATE_SEPARATOR)
    return idx >= 0 ? fieldKey.slice(0, idx) : fieldKey
}

function parseFilterDate(value: string): DateTime {
    return DateTime.fromISO(value, { zone: 'utc' })
}

function parseCellDate(raw: unknown): DateTime | null {
    if (raw === null || raw === undefined || raw === '') return null
    const dt = DateTime.fromISO(String(raw), { zone: 'utc' })
    return dt.isValid ? dt : null
}

function normalizeTimeStr(t: string): string {
    const s = t.trim()
    return s.length === 5 ? `${s}:00` : s
}

function normalizeDtStr(s: string): string {
    const t = s.trim()
    return t.length === 16 ? `${t}:00` : t
}

export function applyFilters(
    rows: ParsedRow[],
    filters: Record<string, ColumnFilter>,
): ParsedRow[] {
    const filterEntries = Object.entries(filters)
    const categoryEqualsGroups = new Map<string, ColumnFilter[]>()
    // Pre-compile ilike regexes once — avoids recompiling per row (O(n) → O(1))
    const ilikeRegexMap = new Map<string, RegExp>()

    for (const [fieldKey, filter] of filterEntries) {
        if (filter.type === 'string' && filter.operator === 'categoryEquals') {
            const field = getBaseFilterField(fieldKey)
            const group = categoryEqualsGroups.get(field) ?? []
            group.push(filter)
            categoryEqualsGroups.set(field, group)
        }
        if (filter.type === 'string' && filter.operator === 'ilike' && filter.value) {
            const pattern = filter.value
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/%/g, '.*')
                .toLowerCase()
            ilikeRegexMap.set(fieldKey, new RegExp(`^${pattern}$`))
        }
    }

    return rows.filter((row) => {
        const processedCategoryEqFields = new Set<string>()
        return filterEntries.every(([fieldKey, filter]) => {
            const field = getBaseFilterField(fieldKey)
            const rawVal = row[field]

            if (filter.type === 'string' && filter.operator === 'categoryEquals') {
                if (processedCategoryEqFields.has(field)) {
                    return true
                }
                processedCategoryEqFields.add(field)

                const group = categoryEqualsGroups.get(field) ?? [filter]
                const val = rawVal === null || rawVal === undefined ? null : String(rawVal)
                return group.some((item) => val !== null && item.value !== undefined && val === item.value)
            }

            if (filter.type === 'number') {
                const val = rawVal === null || rawVal === undefined || rawVal === '' ? null : Number(rawVal)
                switch (filter.operator) {
                    case 'isNull':
                        return val === null || isNaN(val as number)
                    case 'isNotNull':
                        return val !== null && !isNaN(val as number)
                    case '>':
                        return val !== null && filter.value !== undefined && val > filter.value
                    case '<':
                        return val !== null && filter.value !== undefined && val < filter.value
                    case '==':
                        return val !== null && filter.value !== undefined && val === filter.value
                    case '<=':
                        return val !== null && filter.value !== undefined && val <= filter.value
                    case '>=':
                        return val !== null && filter.value !== undefined && val >= filter.value
                    case 'between':
                        return (
                            val !== null &&
                            filter.valueFrom !== undefined &&
                            filter.valueTo !== undefined &&
                            val >= filter.valueFrom &&
                            val <= filter.valueTo
                        )
                    default:
                        return true
                }
            }

            if (filter.type === 'date') {
                const cellDt = parseCellDate(rawVal)
                const isValid = cellDt !== null

                switch (filter.operator) {
                    case 'isNull':
                        return !isValid
                    case 'isNotNull':
                        return isValid
                    case '>': {
                        if (!isValid || !filter.value) return false
                        const fDt = parseFilterDate(filter.value)
                        return cellDt!.toISODate()! > fDt.toISODate()!
                    }
                    case '<': {
                        if (!isValid || !filter.value) return false
                        const fDt = parseFilterDate(filter.value)
                        return cellDt!.toISODate()! < fDt.toISODate()!
                    }
                    case '==': {
                        if (!isValid || !filter.value) return false
                        const fDt = parseFilterDate(filter.value)
                        return cellDt!.toISODate() === fDt.toISODate()
                    }
                    case 'between': {
                        if (!isValid || !filter.valueFrom || !filter.valueTo) return false
                        const from = parseFilterDate(filter.valueFrom)
                        const to = parseFilterDate(filter.valueTo)
                        const cellDate = cellDt!.toISODate()!
                        return cellDate >= from.toISODate()! && cellDate <= to.toISODate()!
                    }
                    default:
                        return true
                }
            }

            if (filter.type === 'datetime') {
                const isNull = rawVal === null || rawVal === undefined || rawVal === ''
                if (filter.operator === 'isNull') return isNull
                if (filter.operator === 'isNotNull') return !isNull
                if (isNull) return false
                const cellStr = normalizeDtStr(String(rawVal))
                if (filter.operator === 'between') {
                    if (!filter.valueFrom || !filter.valueTo) return false
                    return (
                        cellStr >= normalizeDtStr(filter.valueFrom) &&
                        cellStr <= normalizeDtStr(filter.valueTo)
                    )
                }
                if (!filter.value) return false
                const filterStr = normalizeDtStr(filter.value)
                switch (filter.operator) {
                    case '>': return cellStr > filterStr
                    case '<': return cellStr < filterStr

                    case '==': return cellStr.slice(0, 16) === filterStr.slice(0, 16)
                    default: return true
                }
            }

            if (filter.type === 'time') {
                const isNull = rawVal === null || rawVal === undefined || rawVal === ''
                if (filter.operator === 'isNull') return isNull
                if (filter.operator === 'isNotNull') return !isNull
                if (isNull) return false
                const cellStr = normalizeTimeStr(String(rawVal))
                if (filter.operator === 'between') {
                    if (!filter.valueFrom || !filter.valueTo) return false
                    return (
                        cellStr >= normalizeTimeStr(filter.valueFrom) &&
                        cellStr <= normalizeTimeStr(filter.valueTo)
                    )
                }
                if (!filter.value) return false
                const filterStr = normalizeTimeStr(filter.value)
                switch (filter.operator) {
                    case '>': return cellStr > filterStr
                    case '<': return cellStr < filterStr
                    case '==': return cellStr === filterStr
                    default: return true
                }
            }

            if (filter.type === 'string') {
                const val = rawVal === null || rawVal === undefined ? null : String(rawVal)
                switch (filter.operator) {
                    case 'isNull':
                        return val === null || val === ''
                    case 'isNotNull':
                        return val !== null && val !== ''
                    case '==':
                        return val !== null && filter.value !== undefined && val === filter.value
                    case 'ilike': {
                        if (val === null || !filter.value) return false
                        const re = ilikeRegexMap.get(fieldKey)
                        return re ? re.test(val.toLowerCase()) : false
                    }
                    case 'categoryEquals':
                        return val !== null && filter.value !== undefined && val === filter.value
                    case 'categoryNotEquals':
                        return val !== null && filter.value !== undefined && val !== filter.value
                    default:
                        return true
                }
            }

            return true
        })
    })
}
