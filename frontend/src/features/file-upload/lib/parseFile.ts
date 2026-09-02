import type { ColumnConfig, ParsedRow } from '@shared/types'
import { uploadFile, runBackendProcessing } from '@shared/lib/api'
import { generateId, type ProgressCallback } from '@shared/lib'

export interface ParseResult {
    columns: ColumnConfig[]
    rows: ParsedRow[]
    uploadId: string
    jobId: string
}

export type ParseProgressStage = 'parsing' | 'uploading'
export type ParseProgressCallback = (stage: ParseProgressStage, percent: number, label?: string) => void

const PREVIEW_MAX_BYTES = Number(import.meta.env.VITE_UPLOAD_PREVIEW_MAX_BYTES) || 25 * 1024 * 1024

function canParsePreviewLocally(file: File): boolean {
    const name = file.name.toLowerCase()
    const mime = (file.type || '').toLowerCase()
    return name.endsWith('.csv')
        || name.endsWith('.xlsx')
        || mime === 'text/csv'
        || mime === 'application/csv'
        || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

function parseInWorker(
    fileName: string,
    buffer: ArrayBuffer,
    onParseProgress?: (pct: number) => void,
): Promise<{ columns: ColumnConfig[]; rows: ParsedRow[] }> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('./parseWorker.ts', import.meta.url),
            { type: 'module' },
        )
        let columns: ColumnConfig[] = []
        const rows: ParsedRow[] = []
        worker.onmessage = (e) => {
            const msg = e.data as { type: string; pct?: number; columns?: ColumnConfig[]; rows?: ParsedRow[]; error?: string }
            if (msg.type === 'progress') {
                onParseProgress?.(msg.pct ?? 0)
                return
            }
            if (msg.type === 'columns') {
                columns = msg.columns ?? []
                return
            }
            if (msg.type === 'rows') {
                rows.push(...(msg.rows ?? []))
                onParseProgress?.(msg.pct ?? 0)
                return
            }
            worker.terminate()
            if (msg.type === 'done') resolve({ columns: msg.columns ?? columns, rows })
            else reject(new Error(msg.error ?? 'Parse worker failed'))
        }
        worker.onerror = (err) => { worker.terminate(); reject(new Error(err.message || 'Parse worker failed')) }
        // Transfer the buffer — zero-copy, worker owns it now
        worker.postMessage({ fileName, buffer }, [buffer])
    })
}

export async function parseFile(file: File, onProgress?: ParseProgressCallback): Promise<ParseResult> {
    let columns: ColumnConfig[] = []
    let rows: ParsedRow[] = []
    const parsePreviewLocally = file.size <= PREVIEW_MAX_BYTES && canParsePreviewLocally(file)

    if (parsePreviewLocally) {
        onProgress?.('parsing', 0)
        const buffer = await file.arrayBuffer()
        const parsed = await parseInWorker(
            file.name,
            buffer,
            onProgress ? (pct) => onProgress('parsing', pct, 'Разбор данных') : undefined,
        )
        columns = parsed.columns
        rows = parsed.rows
        onProgress?.('parsing', 100)
    } else {
        onProgress?.('uploading', 0)
    }

    const { uploadId, jobId } = await uploadFile(
        file,
        onProgress ? (pct) => onProgress('uploading', pct, 'Загрузка файла') : undefined,
    )

    // Large files and formats that the browser worker cannot parse are read back from the server.
    if (!parsePreviewLocally) {
        const result = await runBackendProcessing(
            uploadId,
            [],
            [],
            onProgress
                ? (progress) => onProgress('uploading', progress.percent, progress.label)
                : undefined,
        )
        columns = result.columns
        rows = result.rows
    }

    return { columns, rows, uploadId, jobId }
}

export { generateId }
export type { ProgressCallback }
