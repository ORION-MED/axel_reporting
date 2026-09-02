import { columnStats } from './dataTransforms'
import { missingReport } from './impute'
import { previewOutliers } from './outliers'
import type { ColumnStats } from './dataTransforms'
import type { MissingInfo } from './impute'
import type { OutlierConfig, OutlierPreview } from './outliers'
import type { ParsedRow } from '@shared/types'

type InMsg =
    | { type: 'columnStats'; rows: ParsedRow[]; fields: string[] }
    | { type: 'uniqueValues'; rows: ParsedRow[]; fields: string[] }
    | { type: 'missingReport'; rows: ParsedRow[] }
    | { type: 'previewOutliers'; rows: ParsedRow[]; config: OutlierConfig }
    | { type: 'cancel' }

type OutMsg =
    | { type: 'columnStats'; ok: true; result: Record<string, ColumnStats | null> }
    | { type: 'uniqueValues'; ok: true; result: { counts: Record<string, number>; sorted: Record<string, string[]> } }
    | { type: 'missingReport'; ok: true; result: MissingInfo[] }
    | { type: 'previewOutliers'; ok: true; result: OutlierPreview[] }
    | { ok: false; error: string }

let cancelled = false
const yieldToWorker = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const checkCancelled = () => {
    if (cancelled) throw new DOMException('Worker cancelled', 'AbortError')
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
    const { type } = e.data
    if (type === 'cancel') {
        cancelled = true
        return
    }
    cancelled = false
    try {
        if (type === 'columnStats') {
            const { rows, fields } = e.data
            const result: Record<string, ColumnStats | null> = {}
            for (const field of fields) {
                checkCancelled()
                result[field] = columnStats(rows, field)
                await yieldToWorker()
            }
            self.postMessage({ type, ok: true, result } satisfies OutMsg)
        } else if (type === 'uniqueValues') {
            const { rows, fields } = e.data
            const counts: Record<string, number> = {}
            const sorted: Record<string, string[]> = {}
            for (const field of fields) {
                checkCancelled()
                const vals = [
                    ...new Set(
                        rows
                            .map((r) => r[field])
                            .filter((v) => v !== null && v !== undefined && v !== '')
                            .map(String),
                    ),
                ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                counts[field] = vals.length
                sorted[field] = vals
                await yieldToWorker()
            }
            self.postMessage({ type, ok: true, result: { counts, sorted } } satisfies OutMsg)
        } else if (type === 'missingReport') {
            const { rows } = e.data
            checkCancelled()
            const result: MissingInfo[] = missingReport(rows)
            self.postMessage({ type, ok: true, result } satisfies OutMsg)
        } else if (type === 'previewOutliers') {
            const { rows, config } = e.data
            checkCancelled()
            const result: OutlierPreview[] = previewOutliers(rows, config)
            self.postMessage({ type, ok: true, result } satisfies OutMsg)
        } else {
            self.postMessage({ ok: false, error: `Unknown type: ${(e.data as { type: string }).type}` } satisfies OutMsg)
        }
    } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
            self.postMessage({ ok: false, error: String(err) } satisfies OutMsg)
        }
    }
}
