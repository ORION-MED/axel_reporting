import Papa from 'papaparse'
import ExcelJS from 'exceljs'
import { detectColumnType, parseValue } from '@shared/lib/columnUtils'
import type { ColumnConfig, ParsedRow } from '@shared/types'

const report = (pct: number) => self.postMessage({ type: 'progress', pct })
const ROW_CHUNK = 5000
let cancelled = false

function parseCsv(
    text: string,
    progressBase: number,
    progressScale: number,
): Promise<{ columns: ColumnConfig[] }> {
    const p = (local: number) => report(progressBase + Math.round(local * progressScale))

    return new Promise((resolve, reject) => {
        Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h: string) => h.trim(),
            transform: (v: string) => v.trim(),
            complete: (result) => {
                p(20) // PapaParse done

                const headers: string[] = result.meta.fields ?? []
                const rawData = result.data as Record<string, unknown>[]

                const columns: ColumnConfig[] = headers.map((header) => ({
                    field: header,
                    headerName: header,
                    type: detectColumnType(rawData.map((r) => r[header])),
                    visible: true,
                    width: 150,
                }))

                p(35) // column type detection done

                // Row transformation — main bottleneck, report per chunk
                self.postMessage({ type: 'columns', columns, totalRows: rawData.length })
                const rows: ParsedRow[] = []
                for (let i = 0; i < rawData.length; i++) {
                    if (cancelled) throw new DOMException('Parse cancelled', 'AbortError')
                    const row = rawData[i]
                    const parsed: ParsedRow = { id: i }
                    for (const col of columns) {
                        parsed[col.field] = parseValue(row[col.field], col.type)
                    }
                    rows.push(parsed)
                    if (rows.length >= ROW_CHUNK || i === rawData.length - 1) {
                        self.postMessage({ type: 'rows', rows: rows.splice(0) })
                        p(35 + Math.round(((i + 1) / rawData.length) * 65))
                    }
                }

                resolve({ columns })
            },
            error: (err: Error) => reject(err),
        })
    })
}

self.onmessage = async (e: MessageEvent<{ fileName: string; buffer: ArrayBuffer } | { type: 'cancel' }>) => {
    if ('type' in e.data && e.data.type === 'cancel') {
        cancelled = true
        return
    }
    if (!('fileName' in e.data)) return
    const { fileName, buffer } = e.data
    try {
        if (/\.xlsx$/i.test(fileName)) {
            report(5)
            const wb = new ExcelJS.Workbook()
            await wb.xlsx.load(buffer)
            report(50)

            const ws = wb.worksheets[0]
            if (!ws) throw new Error('No worksheets found in file')

            const totalRows = ws.rowCount || 1
            const lines: string[] = []
            let rowIdx = 0
            ws.eachRow({ includeEmpty: false }, (row) => {
                const values = (row.values as unknown[]).slice(1)
                lines.push(
                    values.map((v) => {
                        if (v === null || v === undefined) return ''
                        const s = String(v)
                        return s.includes(',') || s.includes('"') || s.includes('\n')
                            ? `"${s.replace(/"/g, '""')}"`
                            : s
                    }).join(','),
                )
                rowIdx++
                if (rowIdx % 2000 === 0) {
                    report(50 + Math.round((rowIdx / totalRows) * 30))
                }
            })
            report(80)

            const text = lines.join('\n')
            // parseCsv progress mapped to 80→100
            const { columns } = await parseCsv(text, 80, 0.2)
            self.postMessage({ type: 'done', columns })
        } else {
            report(5)
            const text = new TextDecoder().decode(buffer)
            report(10)
            // parseCsv progress mapped to 10→100
            const { columns } = await parseCsv(text, 10, 0.9)
            self.postMessage({ type: 'done', columns })
        }
    } catch (err) {
        self.postMessage({ type: 'error', error: String(err) })
    }
}
