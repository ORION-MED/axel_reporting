import { openDB, type IDBPDatabase } from 'idb'
import type { ParsedRow } from '@shared/types'
import { clampProgress, type ProgressCallback } from './progress'

const DB_NAME = 'dashboard-db'
const DB_VERSION = 1
const STORE_NAME = 'table-data'
const CHUNK_SIZE = 250

let dbInstance: IDBPDatabase | null = null


// Возвращает db


const getDb = async () => {
    if (dbInstance) return dbInstance
    dbInstance = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME)
            }
        },
    })
    return dbInstance
}

interface ChunkMeta {
    chunked: true
    count: number
    totalRows?: number
}

const chunkMetaKey = (tableId: string) => `${tableId}__chunks_meta`
const chunkKey = (tableId: string, index: number) => `${tableId}__chunk_${index}`

function isLargeCloneError(error: unknown): boolean {
    const message = String((error as Error | undefined)?.message || '').toLowerCase()
    return (
        message.includes('cannot be cloned') ||
        message.includes('out of memory') ||
        message.includes('data clone')
    )
}

async function clearChunkedRows(tableId: string): Promise<void> {
    const db = await getDb()
    const meta = (await db.get(STORE_NAME, chunkMetaKey(tableId))) as ChunkMeta | undefined
    if (meta?.chunked && meta.count > 0) {
        for (let i = 0; i < meta.count; i++) {
            await db.delete(STORE_NAME, chunkKey(tableId, i))
        }
    }
    await db.delete(STORE_NAME, chunkMetaKey(tableId))
}

async function putRowsChunked(tableId: string, rows: ParsedRow[], onProgress?: ProgressCallback): Promise<void> {
    const db = await getDb()
    await db.delete(STORE_NAME, tableId)
    await clearChunkedRows(tableId)

    const chunks: ParsedRow[][] = []
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        chunks.push(rows.slice(i, i + CHUNK_SIZE))
    }

    for (let i = 0; i < chunks.length; i++) {
        await db.put(STORE_NAME, chunks[i], chunkKey(tableId, i))
        onProgress?.({
            stage: 'save',
            percent: clampProgress(((i + 1) / Math.max(chunks.length, 1)) * 100),
            label: 'Сохранение данных',
        })
    }

    const meta: ChunkMeta = { chunked: true, count: chunks.length, totalRows: rows.length }
    await db.put(STORE_NAME, meta, chunkMetaKey(tableId))
}

async function getRowsAny(tableId: string): Promise<ParsedRow[] | undefined> {
    const db = await getDb()
    const direct = await db.get(STORE_NAME, tableId)
    if (Array.isArray(direct)) {
        return direct as ParsedRow[]
    }

    const meta = (await db.get(STORE_NAME, chunkMetaKey(tableId))) as ChunkMeta | undefined
    if (!meta?.chunked || meta.count <= 0) {
        return undefined
    }

    const merged: ParsedRow[] = []
    for (let i = 0; i < meta.count; i++) {
        const chunk = (await db.get(STORE_NAME, chunkKey(tableId, i))) as ParsedRow[] | undefined
        if (Array.isArray(chunk) && chunk.length > 0) {
            merged.push(...chunk)
        }
    }
    return merged
}

async function deleteRowsAny(tableId: string): Promise<void> {
    const db = await getDb()
    await db.delete(STORE_NAME, tableId)
    await clearChunkedRows(tableId)
}

export const idbStorage = {

    async setRows(tableId: string, rows: ParsedRow[], onProgress?: ProgressCallback): Promise<void> {
        const db = await getDb()
        try {
            await db.put(STORE_NAME, rows, tableId)
            await clearChunkedRows(tableId)
            onProgress?.({ stage: 'save', percent: 100, label: 'Сохранение данных' })
        } catch (error) {
            if (!isLargeCloneError(error)) {
                throw error
            }
            await putRowsChunked(tableId, rows, onProgress)
        }
    },


    async getRows(tableId: string): Promise<ParsedRow[] | undefined> {
        return getRowsAny(tableId)
    },

    async getRowCount(tableId: string): Promise<number> {
        const db = await getDb()
        const direct = await db.get(STORE_NAME, tableId)
        if (Array.isArray(direct)) return direct.length
        const meta = (await db.get(STORE_NAME, chunkMetaKey(tableId))) as ChunkMeta | undefined
        return meta?.totalRows ?? 0
    },

    async getRowsPage(tableId: string, offset: number, limit: number): Promise<ParsedRow[]> {
        const db = await getDb()
        const direct = await db.get(STORE_NAME, tableId)
        if (Array.isArray(direct)) return (direct as ParsedRow[]).slice(offset, offset + limit)

        const meta = (await db.get(STORE_NAME, chunkMetaKey(tableId))) as ChunkMeta | undefined
        if (!meta?.chunked || meta.count <= 0 || limit <= 0) return []

        const firstChunk = Math.floor(offset / CHUNK_SIZE)
        const lastChunk = Math.min(meta.count - 1, Math.floor((offset + limit - 1) / CHUNK_SIZE))
        const result: ParsedRow[] = []
        for (let i = firstChunk; i <= lastChunk; i++) {
            const chunk = (await db.get(STORE_NAME, chunkKey(tableId, i))) as ParsedRow[] | undefined
            if (!Array.isArray(chunk)) continue
            const chunkStart = i * CHUNK_SIZE
            const start = Math.max(0, offset - chunkStart)
            const end = Math.min(chunk.length, offset + limit - chunkStart)
            result.push(...chunk.slice(start, end))
        }
        return result
    },


    async deleteRows(tableId: string): Promise<void> {
        await deleteRowsAny(tableId)
    },


    async clear(): Promise<void> {
        const db = await getDb()
        await db.clear(STORE_NAME)
    },

    // ─── Оригинальные строки для undo-процессинга ────────────────────

    async setOriginalRows(tableId: string, rows: ParsedRow[], onProgress?: ProgressCallback): Promise<void> {
        const origKey = `${tableId}__orig`
        const db = await getDb()
        try {
            await db.put(STORE_NAME, rows, origKey)
            await clearChunkedRows(origKey)
            onProgress?.({ stage: 'save', percent: 100, label: 'Сохранение исходных данных' })
        } catch (error) {
            if (!isLargeCloneError(error)) {
                throw error
            }
            await putRowsChunked(origKey, rows, onProgress)
        }
    },

    async getOriginalRows(tableId: string): Promise<ParsedRow[] | undefined> {
        return getRowsAny(`${tableId}__orig`)
    },

    async deleteOriginalRows(tableId: string): Promise<void> {
        await deleteRowsAny(`${tableId}__orig`)
    },
}
