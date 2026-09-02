import axios from 'axios'
import Papa from 'papaparse'
import type { ColumnConfig, ParsedRow, ProcessingEntry } from '@shared/types'
import { detectColumnType, parseValue } from '@shared/lib/columnUtils'
import { clampProgress, type ProgressCallback } from './progress'

export interface UploadResponse {
    uploadId: string
    jobId: string
}


export interface JobStatus {
    id: string
    jobType: string
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    progressPercent: number
    errorMessage: string | null
}

export interface ArtifactInfo {
    id: string
    jobId: string
    artifactType: string
    format: string
    s3Key: string
    sizeBytes: number | null
    createdAt: string
}

export interface ParseResult {
    columns: ColumnConfig[]
    rows: ParsedRow[]
}

// ─── Raw API calls ────────────────────────────────────────────────────────────

export async function uploadFile(
    file: File,
    onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
    const form = new FormData()
    form.append('file', file)
    const { data } = await axios.post<UploadResponse>('/api/upload', form, {
        onUploadProgress: onProgress
            ? (evt) => {
                  const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0
                  onProgress(pct)
              }
            : undefined,
    })
    return data
}

export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
    const { data } = await axios.get<JobStatus>(`/api/jobs/${jobId}`, signal ? { signal } : undefined)
    return data
}

export async function cancelJob(jobId: string): Promise<void> {
    await axios.delete(`/api/jobs/${jobId}`)
}

export async function getJobArtifacts(jobId: string): Promise<ArtifactInfo[]> {
    const { data } = await axios.get<ArtifactInfo[]>(`/api/jobs/${jobId}/artifacts`)
    return data
}

export async function downloadArtifactAsText(
    artifactId: string,
    onProgress?: (percent: number) => void,
): Promise<string> {
    const { data } = await axios.get<string>(`/api/artifacts/${artifactId}/download`, {
        responseType: 'text',
        onDownloadProgress: onProgress
            ? (evt) => {
                  const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0
                  onProgress(pct)
              }
            : undefined,
    })
    return data
}

export async function createProcessJob(
    uploadId: string,
    steps: ProcessingEntry[],
): Promise<string> {
    const { data } = await axios.post(`/api/uploads/${uploadId}/jobs`, {
        jobType: 'process',
        pipelineConfig: { steps, exportFormats: ['csv'] },
    })
    return data.id
}

// ─── Composite helpers ────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_000
const POLL_TIMEOUT_MS = Number(import.meta.env.VITE_JOB_POLL_TIMEOUT_MS) || 65 * 60 * 1_000

export async function pollJobUntilDone(
    jobId: string,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
): Promise<JobStatus> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
        if (signal?.aborted) throw new DOMException('Polling aborted', 'AbortError')
        const job = await getJobStatus(jobId, signal)
        if (onProgress && job.progressPercent > 0) {
            onProgress(job.progressPercent)
        }
        if (job.status === 'completed') {
            onProgress?.(100)
            return job
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
            throw new Error(job.errorMessage ?? `Job ${jobId} ${job.status}`)
        }
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, POLL_INTERVAL_MS)
            signal?.addEventListener('abort', () => {
                clearTimeout(timer)
                reject(new DOMException('Polling aborted', 'AbortError'))
            }, { once: true })
        })
    }
    throw new Error('Превышено время ожидания обработки файла')
}


export async function getProcessedCsvFromJob(jobId: string): Promise<string> {
    const artifacts = await getJobArtifacts(jobId)
    const csv = artifacts.find((a) => a.artifactType === 'processed_dataset' && a.format === 'csv')
    if (!csv) throw new Error('Processed CSV artifact not found')
    return downloadArtifactAsText(csv.id)
}

async function getProcessedCsvArtifact(jobId: string): Promise<ArtifactInfo> {
    const artifacts = await getJobArtifacts(jobId)
    const csv = artifacts.find((a) => a.artifactType === 'processed_dataset' && a.format === 'csv')
    if (!csv) throw new Error('Processed CSV artifact not found')
    return csv
}

export function parseCsvText(text: string): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
        Papa.parse<Record<string, string>>(text, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h: string) => h.trim(),
            transform: (v: string) => v.trim(),
            complete: (result: Papa.ParseResult<Record<string, string>>) => {
                const headers: string[] = result.meta.fields ?? []
                const rawData = result.data as Record<string, unknown>[]
                const columns: ColumnConfig[] = headers.map((header: string) => ({
                    field: header,
                    headerName: header,
                    type: detectColumnType(rawData.map((r) => r[header])),
                    visible: true,
                    width: 150,
                }))
                const rows: ParsedRow[] = rawData.map((row, idx) => {
                    const parsed: ParsedRow = { id: idx }
                    columns.forEach((col) => {
                        parsed[col.field] = parseValue(row[col.field], col.type)
                    })
                    return parsed
                })
                resolve({ columns, rows })
            },
            error: (err: Error) => reject(err),
        })
    })
}

export function parseCsvTextInWorker(text: string): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
        const buffer = new TextEncoder().encode(text).buffer
        let columns: ColumnConfig[] = []
        const rows: ParsedRow[] = []
        const worker = new Worker(
            new URL('../../features/file-upload/lib/parseWorker.ts', import.meta.url),
            { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent) => {
            const msg = e.data as { type: string; columns?: ColumnConfig[]; rows?: ParsedRow[]; error?: string }
            if (msg.type === 'progress') return
            if (msg.type === 'columns') {
                columns = msg.columns ?? []
                return
            }
            if (msg.type === 'rows') {
                rows.push(...(msg.rows ?? []))
                return
            }
            worker.terminate()
            if (msg.type === 'done') resolve({ columns: msg.columns ?? columns, rows })
            else reject(new Error(msg.error ?? 'CSV parse worker failed'))
        }
        worker.onerror = (err) => { worker.terminate(); reject(err) }
        worker.postMessage({ fileName: 'data.csv', buffer }, [buffer])
    })
}

export function parseCsvArtifactInWorker(
    artifactId: string,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(
            new URL('./csvStreamWorker.ts', import.meta.url),
            { type: 'module' },
        )
        const rows: ParsedRow[] = []
        let columns: ColumnConfig[] | null = null
        let settled = false
        let lastDownloadPct = 0

        const cleanup = () => {
            settled = true
            signal?.removeEventListener('abort', abortHandler)
            worker.terminate()
        }
        const fail = (err: unknown) => {
            if (settled) return
            cleanup()
            reject(err)
        }
        const abortHandler = () => fail(new DOMException('CSV download aborted', 'AbortError'))

        worker.onmessage = (event: MessageEvent) => {
            const msg = event.data as {
                type: string
                columns?: ColumnConfig[]
                rows?: ParsedRow[]
                error?: string
                phase?: 'reading' | 'typing' | 'rows'
                percent?: number
            }
            if (msg.type === 'progress') {
                if (msg.phase === 'rows' && typeof msg.percent === 'number') {
                    onProgress?.({
                        stage: 'parse',
                        percent: Math.min(100, Math.max(lastDownloadPct, 80 + Math.round(msg.percent * 0.2))),
                        label: 'Разбор результата',
                    })
                }
                return
            }
            if (msg.type === 'columns') {
                columns = msg.columns ?? []
                return
            }
            if (msg.type === 'rows') {
                rows.push(...(msg.rows ?? []))
                return
            }
            if (msg.type === 'done') {
                if (!columns) {
                    fail(new Error('CSV stream parser finished without columns'))
                    return
                }
                cleanup()
                onProgress?.({ stage: 'done', percent: 100, label: 'Готово' })
                resolve({ columns, rows })
                return
            }
            if (msg.type === 'error') {
                fail(new Error(msg.error ?? 'CSV stream parser failed'))
            }
        }
        worker.onerror = (err) => fail(err)

        if (signal?.aborted) {
            abortHandler()
            return
        }
        signal?.addEventListener('abort', abortHandler, { once: true })

        void (async () => {
            try {
                const response = await fetch(`/api/artifacts/${artifactId}/download`, { signal })
                if (!response.ok) throw new Error(`Artifact download failed: ${response.status}`)
                if (!response.body) throw new Error('Streaming downloads are not supported in this browser')

                const total = Number(response.headers.get('content-length')) || 0
                const reader = response.body.getReader()
                let loaded = 0
                while (true) {
                    if (signal?.aborted) throw new DOMException('CSV download aborted', 'AbortError')
                    const { done, value } = await reader.read()
                    if (done) break
                    loaded += value.byteLength
                    if (total > 0) {
                        lastDownloadPct = Math.min(80, Math.round((loaded / total) * 80))
                        onProgress?.({
                            stage: 'download',
                            percent: clampProgress(lastDownloadPct),
                            label: 'Скачивание результата',
                        })
                    }
                    const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
                    worker.postMessage({ type: 'chunk', buffer }, [buffer])
                }
                worker.postMessage({ type: 'finish' })
            } catch (err) {
                fail(err)
            }
        })()
    })
}

// Cache artifact lists per uploadId — avoids duplicate HTTP calls for stats + pvalue fetches
const ARTIFACTS_CACHE_TTL_MS = 30 * 60 * 1000
const _artifactsCache = new Map<string, { artifacts: ArtifactInfo[]; expiresAt: number }>()

async function getProfileJobArtifacts(uploadId: string): Promise<ArtifactInfo[]> {
    const cached = _artifactsCache.get(uploadId)
    if (cached && Date.now() < cached.expiresAt) return cached.artifacts
    const { data: jobs } = await axios.get<JobStatus[]>(`/api/uploads/${uploadId}/jobs`)
    const profileJob = jobs.find((j: JobStatus) => j.jobType === 'profile' && j.status === 'completed')
    if (!profileJob) throw new Error('Profile job not found or not completed')
    const artifacts = await getJobArtifacts(profileJob.id)
    _artifactsCache.set(uploadId, { artifacts, expiresAt: Date.now() + ARTIFACTS_CACHE_TTL_MS })
    return artifacts
}

export async function getDatasetOverviewArtifact(
    uploadId: string,
    onProgress?: (percent: number) => void,
): Promise<unknown> {
    const artifacts = await getProfileJobArtifacts(uploadId)
    const artifact = artifacts.find((a) => a.artifactType === 'dataset_overview')
    if (!artifact) throw new Error('Dataset overview artifact not found')
    const text = await downloadArtifactAsText(artifact.id, onProgress)
    return JSON.parse(text)
}

export async function getDatasetStatsArtifact(
    uploadId: string,
    onProgress?: (percent: number) => void,
): Promise<unknown> {
    const artifacts = await getProfileJobArtifacts(uploadId)
    const artifact = artifacts.find((a) => a.artifactType === 'dataset_stats')
    if (!artifact) throw new Error('Dataset stats artifact not found')
    const text = await downloadArtifactAsText(artifact.id, onProgress)
    return JSON.parse(text)
}

export async function getPvalueMatrixArtifact(uploadId: string): Promise<unknown> {
    let artifacts = await getProfileJobArtifacts(uploadId)
    let artifact = artifacts.find((a) => a.artifactType === 'pvalue_matrix')
    if (!artifact) {
        // pvalue_matrix is written by background worker after job completion —
        // retry once with a fresh fetch in case the cache was populated too early
        _artifactsCache.delete(uploadId)
        artifacts = await getProfileJobArtifacts(uploadId)
        artifact = artifacts.find((a) => a.artifactType === 'pvalue_matrix')
    }
    if (!artifact) throw new Error('P-value matrix artifact not found')
    const text = await downloadArtifactAsText(artifact.id)
    return JSON.parse(text)
}

export function invalidateArtifactsCache(uploadId?: string): void {
    if (uploadId) {
        _artifactsCache.delete(uploadId)
    } else {
        _artifactsCache.clear()
    }
}

export async function runBackendProcessing(
    uploadId: string,
    steps: ProcessingEntry[],
    existingColumns: ColumnConfig[],
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
): Promise<{ rows: ParsedRow[]; columns: ColumnConfig[] }> {
    // Always run through a backend process job — even for empty steps, the worker
    // loads the staging parquet and exports it as CSV, which is the only reliable
    // way to get the typed/original data back (staging_parquet, not staging_csv).
    const jobId = await createProcessJob(uploadId, steps)
    let abortHandler: (() => void) | undefined
    if (signal) {
        abortHandler = () => { cancelJob(jobId).catch(() => {}) }
        if (signal.aborted) {
            abortHandler()
            throw new DOMException('Processing aborted', 'AbortError')
        }
        signal.addEventListener('abort', abortHandler, { once: true })
    }

    let csvArtifact: ArtifactInfo
    try {
        await pollJobUntilDone(jobId, (percent) => onProgress?.({
            stage: 'backend',
            percent,
            label: 'Обработка на сервере',
        }), signal)
        if (signal?.aborted) throw new DOMException('Processing aborted', 'AbortError')
        csvArtifact = await getProcessedCsvArtifact(jobId)
    } catch (err) {
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
            cancelJob(jobId).catch(() => {})
        }
        throw err
    } finally {
        if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler)
        }
    }

    const { columns: parsed, rows } = await parseCsvArtifactInWorker(csvArtifact.id, onProgress, signal)
    const existingMap = new Map(existingColumns.map((c) => [c.field, c]))
    const columns = parsed.map((c) => existingMap.get(c.field) ?? c)
    return { rows, columns }
}

export async function savePublicationViaS3(
    title: string,
    description: string,
    tags: string[],
    workspaceState: unknown,
): Promise<void> {
    const { data: { uploadUrl, s3Key } } = await axios.post<{ uploadUrl: string; s3Key: string }>(
        '/api/publications/presign',
    )
    await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspaceState),
    }).then((res) => {
        if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`)
    })
    await axios.post('/api/publications', { title, description, tags, s3Key })
}
