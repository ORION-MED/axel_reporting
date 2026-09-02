import { DateTime } from 'luxon'
import type { ColumnType } from '@shared/types'

const TIME_ONLY_RE = /^\d{1,2}:\d{2}(:\d{2})?(\s*(AM|PM))?$/i

const DATE_ONLY_FORMATS = [
    'yyyy-MM-dd',
    'dd.MM.yyyy',
    'dd/MM/yyyy',
    'dd-MM-yyyy',
    'MM/dd/yyyy',
    'MM-dd-yyyy',
    'yyyy.MM.dd',
    'd.M.yyyy',
    'M/d/yyyy',
]

const DATETIME_FORMATS = [
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    "yyyy-MM-dd'T'HH:mm:ss",
    "yyyy-MM-dd'T'HH:mm",
    "yyyy-MM-dd'T'HH:mm:ssZZ",
    'dd.MM.yyyy HH:mm:ss',
    'dd.MM.yyyy HH:mm',
    'dd/MM/yyyy HH:mm:ss',
    'MM/dd/yyyy HH:mm:ss',
]


// Функция tryParseDateOnly


function tryParseDateOnly(str: string): DateTime | null {
    for (const fmt of DATE_ONLY_FORMATS) {
        const dt = DateTime.fromFormat(str, fmt, { zone: 'utc' })
        if (dt.isValid) return dt
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const iso = DateTime.fromISO(str, { zone: 'utc' })
        if (iso.isValid) return iso
    }
    return null
}


// Функция tryParseAsDatetime


function tryParseAsDatetime(str: string): DateTime | null {
    for (const fmt of DATETIME_FORMATS) {
        const dt = DateTime.fromFormat(str, fmt, { zone: 'utc' })
        if (dt.isValid) return dt
    }

    if (str.includes('-') && !str.startsWith('-') && (str.includes('T') || / \d{2}:/.test(str))) {
        const iso = DateTime.fromISO(str.replace(' ', 'T'), { zone: 'utc' })
        if (iso.isValid) return iso
    }

    const rfc = DateTime.fromRFC2822(str, { zone: 'utc' })
    if (rfc.isValid) return rfc
    return null
}


// Функция tryParseDate


export function tryParseDate(raw: string): DateTime | null {
    const str = raw.trim()
    if (!str || TIME_ONLY_RE.test(str)) return null
    return tryParseAsDatetime(str) ?? tryParseDateOnly(str)
}


// Функция classifyDateValue


function classifyDateValue(v: unknown): 'time' | 'date' | 'datetime' | null {
    if (v instanceof Date) {
        if (isNaN(v.getTime())) return null
        const dt = DateTime.fromJSDate(v, { zone: 'utc' })
        return dt.hour === 0 && dt.minute === 0 && dt.second === 0 ? 'date' : 'datetime'
    }
    if (typeof v !== 'string') return null
    const str = v.trim()
    if (!str) return null
    if (TIME_ONLY_RE.test(str)) return 'time'

    if (tryParseAsDatetime(str)) return 'datetime'
    if (tryParseDateOnly(str)) return 'date'
    return null
}


// Функция normalizeTimeValue


function normalizeTimeValue(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null
    const str = String(value).trim()
    if (!TIME_ONLY_RE.test(str)) return null
    const formats = ['H:mm:ss', 'H:mm', 'h:mm:ss a', 'h:mm a']
    for (const fmt of formats) {
        const dt = DateTime.fromFormat(str, fmt)
        if (dt.isValid) return dt.toFormat('HH:mm:ss')
    }
    return str
}


// Функция normalizeDatetimeValue


function normalizeDatetimeValue(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date) {
        const dt = DateTime.fromJSDate(value, { zone: 'utc' })
        return dt.isValid ? dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") : null
    }
    const str = String(value).trim()
    const dt = tryParseAsDatetime(str)
    return dt ? dt.toFormat("yyyy-MM-dd'T'HH:mm:ss") : null
}


// Функция normalizeDateValue


export function normalizeDateValue(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date) {
        const dt = DateTime.fromJSDate(value, { zone: 'utc' })
        return dt.isValid ? dt.toISODate() : null
    }
    const str = String(value).trim()
    const dt = tryParseDateOnly(str) ?? tryParseAsDatetime(str)
    return dt ? dt.toISODate() : null
}


// Функция detectColumnType


export function detectColumnType(values: unknown[]): ColumnType {
    // Функция nonNull
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '')
    if (nonNull.length === 0) return 'string'

    const sample = nonNull.slice(0, 100)

    // Функция numberCount

    const numberCount = sample.filter((v) => {
        if (typeof v === 'number') return true
        if (typeof v === 'string') {
            const cleaned = v.replace(/\s/g, '').replace(',', '.')
            return !isNaN(Number(cleaned)) && cleaned !== ''
        }
        return false
    }).length
    if (numberCount === sample.length) return 'number'

    const counts = { time: 0, date: 0, datetime: 0 }
    for (const v of sample) {
        const cls = classifyDateValue(v)
        if (cls) counts[cls]++
    }

    const recognized = counts.time + counts.date + counts.datetime
    if (recognized / sample.length < 0.7) return 'string'

    if (counts.time >= counts.date && counts.time >= counts.datetime) return 'time'
    if (counts.datetime >= counts.date) return 'datetime'
    return 'date'
}


// Парсит value


export function parseValue(value: unknown, type: ColumnType): unknown {
    if (value === null || value === undefined || value === '') return null
    if (type === 'number') {
        const cleaned = String(value).replace(/\s/g, '').replace(',', '.')
        const n = Number(cleaned)
        return isNaN(n) ? null : n
    }
    if (type === 'date') return normalizeDateValue(value)
    if (type === 'datetime') return normalizeDatetimeValue(value)
    if (type === 'time') return normalizeTimeValue(value) ?? String(value)
    return String(value)
}


// Функция generateId


export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
