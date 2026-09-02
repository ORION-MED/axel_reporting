import Papa from 'papaparse'
import { detectColumnType, parseValue } from '@shared/lib/columnUtils'
import type { ColumnConfig, ColumnType, ParsedRow } from '@shared/types'

type InMsg =
    | { type: 'chunk'; buffer: ArrayBuffer }
    | { type: 'finish' }

type OutMsg =
    | { type: 'progress'; phase: 'reading' | 'typing' | 'rows'; percent: number }
    | { type: 'columns'; columns: ColumnConfig[]; totalRows: number }
    | { type: 'rows'; rows: ParsedRow[] }
    | { type: 'done' }
    | { type: 'error'; error: string }

const decoder = new TextDecoder()
let pending = ''
let headers: string[] | null = null
const rawRows: string[][] = []
const typeSamples: string[][] = []

const ROW_CHUNK_SIZE = 5000
const TYPE_SAMPLE_SIZE = 100

function post(msg: OutMsg): void {
    self.postMessage(msg)
}

function extractRecords(text: string, flush = false): { records: string[]; rest: string } {
    const records: string[] = []
    let recordStart = 0
    let inQuotes = false

    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') {
                i++
            } else {
                inQuotes = !inQuotes
            }
        } else if (!inQuotes && ch === '\n') {
            let record = text.slice(recordStart, i)
            if (record.endsWith('\r')) record = record.slice(0, -1)
            records.push(record)
            recordStart = i + 1
        }
    }

    let rest = text.slice(recordStart)
    if (flush && rest.length > 0) {
        if (rest.endsWith('\r')) rest = rest.slice(0, -1)
        records.push(rest)
        rest = ''
    }

    return { records, rest }
}

function parseRecordBatch(records: string[]): void {
    if (records.length === 0) return
    const parsed = Papa.parse<string[]>(records.join('\n'), {
        header: false,
        skipEmptyLines: true,
    })
    if (parsed.errors.length > 0) {
        throw new Error(parsed.errors[0].message)
    }

    for (const row of parsed.data) {
        if (!headers) {
            headers = row.map((field) => String(field ?? '').trim())
            for (let i = 0; i < headers.length; i++) typeSamples[i] = []
            continue
        }

        const normalized = headers.map((_, idx) => String(row[idx] ?? '').trim())
        rawRows.push(normalized)
        for (let i = 0; i < normalized.length; i++) {
            const value = normalized[i]
            if (value !== '' && typeSamples[i].length < TYPE_SAMPLE_SIZE) {
                typeSamples[i].push(value)
            }
        }
    }
}

function buildColumns(): ColumnConfig[] {
    if (!headers) return []
    return headers.map((header, idx) => ({
        field: header,
        headerName: header,
        type: detectColumnType(typeSamples[idx] ?? []) as ColumnType,
        visible: true,
        width: 150,
    }))
}

function emitRows(columns: ColumnConfig[]): void {
    const chunk: ParsedRow[] = []
    for (let i = 0; i < rawRows.length; i++) {
        const source = rawRows[i]
        const row: ParsedRow = { id: i }
        for (let c = 0; c < columns.length; c++) {
            const col = columns[c]
            row[col.field] = parseValue(source[c], col.type)
        }
        chunk.push(row)

        if (chunk.length >= ROW_CHUNK_SIZE || i === rawRows.length - 1) {
            post({ type: 'rows', rows: chunk.splice(0) })
            post({ type: 'progress', phase: 'rows', percent: Math.round(((i + 1) / rawRows.length) * 100) })
        }
    }
}

self.onmessage = (event: MessageEvent<InMsg>) => {
    try {
        if (event.data.type === 'chunk') {
            const text = pending + decoder.decode(event.data.buffer, { stream: true })
            const { records, rest } = extractRecords(text)
            pending = rest
            parseRecordBatch(records)
            post({ type: 'progress', phase: 'reading', percent: 0 })
            return
        }

        const tail = decoder.decode()
        const { records, rest } = extractRecords(pending + tail, true)
        pending = rest
        parseRecordBatch(records)

        post({ type: 'progress', phase: 'typing', percent: 0 })
        const columns = buildColumns()
        post({ type: 'columns', columns, totalRows: rawRows.length })
        emitRows(columns)
        post({ type: 'done' })
    } catch (err) {
        post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
    }
}
