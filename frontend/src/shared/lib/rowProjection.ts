import type { ParsedRow } from '@shared/types'
import { clampProgress, type ProgressCallback } from './progress'

const DEFAULT_CHUNK_SIZE = 5000

function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function projectRows(
    rows: ParsedRow[],
    fields: Iterable<string>,
    signal?: AbortSignal,
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress?: ProgressCallback,
): Promise<ParsedRow[]> {
    const selectedFields = Array.from(new Set(fields)).filter((field) => field !== 'id')
    const projected = new Array<ParsedRow>(rows.length)

    for (let start = 0; start < rows.length; start += chunkSize) {
        if (signal?.aborted) {
            throw new DOMException('Projection aborted', 'AbortError')
        }
        const end = Math.min(start + chunkSize, rows.length)
        for (let i = start; i < end; i += 1) {
            const source = rows[i]
            const row: ParsedRow = { id: source.id }
            for (const field of selectedFields) {
                row[field] = source[field]
            }
            projected[i] = row
        }
        onProgress?.({
            stage: 'project',
            percent: clampProgress((end / Math.max(rows.length, 1)) * 100),
            label: 'Подготовка колонок',
        })
        if (end < rows.length) {
            await yieldToMain()
        }
    }

    return projected
}
