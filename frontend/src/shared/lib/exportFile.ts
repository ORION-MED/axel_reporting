import type { ColumnConfig, ParsedRow } from '@shared/types'

function stripExt(name: string) {
    return name.replace(/\.[^/.]+$/, '')
}

function triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
}

function runExportWorker(
    type: 'csv' | 'xlsx',
    rows: ParsedRow[],
    columns: ColumnConfig[],
    fileName: string,
    mimeType: string,
    onDone?: () => void,
    onError?: () => void,
) {
    const worker = new Worker(
        new URL('./exportWorker.ts', import.meta.url),
        { type: 'module' },
    )
    worker.onmessage = (e: MessageEvent) => {
        worker.terminate()
        const msg = e.data as { ok: boolean; bytes?: ArrayBuffer; mimeType?: string; error?: string }
        if (!msg.ok) { onError?.(); return }
        const blob = new Blob([msg.bytes!], { type: msg.mimeType ?? mimeType })
        triggerDownload(blob, fileName)
        onDone?.()
    }
    worker.onerror = () => { worker.terminate(); onError?.() }
    worker.postMessage({ type, rows, columns })
}

export function exportToCSV(rows: ParsedRow[], columns: ColumnConfig[], fileName: string): void {
    runExportWorker('csv', rows, columns, `${stripExt(fileName)}_filtered.csv`, 'text/csv;charset=utf-8;')
}

export function exportToExcel(
    rows: ParsedRow[],
    columns: ColumnConfig[],
    fileName: string,
    onFallback?: () => void,
): Promise<void> {
    return new Promise((resolve) => {
        runExportWorker(
            'xlsx',
            rows,
            columns,
            `${stripExt(fileName)}_filtered.xlsx`,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            resolve,
            () => {
                // fallback to CSV on Excel failure
                exportToCSV(rows, columns, fileName)
                onFallback?.()
                resolve()
            },
        )
    })
}
