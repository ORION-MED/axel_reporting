import Papa from 'papaparse'
import ExcelJS from 'exceljs'
import type { ColumnConfig, ParsedRow } from '@shared/types'

interface ExportMsg {
    type: 'csv' | 'xlsx'
    rows: ParsedRow[]
    columns: ColumnConfig[]
}

self.onmessage = async (e: MessageEvent<ExportMsg>) => {
    const { type, rows, columns } = e.data
    const visible = columns.filter((c) => c.visible)
    try {
        if (type === 'csv') {
            const fields = visible.map((c) => c.headerName)
            const data = rows.map((row) =>
                visible.map((col) => {
                    const v = row[col.field]
                    return v === null || v === undefined ? '' : v
                }),
            )
            const csv = Papa.unparse({ fields, data })
            const bytes = new TextEncoder().encode('﻿' + csv)
            self.postMessage({ ok: true, bytes: bytes.buffer, mimeType: 'text/csv;charset=utf-8;' }, { transfer: [bytes.buffer] })
        } else {
            const wb = new ExcelJS.Workbook()
            const ws = wb.addWorksheet('Data')
            ws.columns = visible.map((col) => ({ header: col.headerName, key: col.headerName }))
            for (const row of rows) {
                const obj: Record<string, unknown> = {}
                visible.forEach((col) => {
                    const v = row[col.field]
                    obj[col.headerName] = v === null || v === undefined ? '' : v
                })
                ws.addRow(obj)
            }
            const buffer = await wb.xlsx.writeBuffer()
            self.postMessage(
                { ok: true, bytes: buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                { transfer: [buffer] },
            )
        }
    } catch (err) {
        self.postMessage({ ok: false, error: String(err) })
    }
}
