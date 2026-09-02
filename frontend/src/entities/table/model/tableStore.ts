import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { TableState, ColumnFilter, ParsedRow, ColumnConfig, ProcessingEntry, ProcessingType } from '@shared/types'
import { lsStorage, idbStorage, generateId, sessionGuard, imputeRows, scaleRows, encodeRows, removeOutlierRows, applyTimeSeries, applyWindowSplit, progressLabel } from '@shared/lib'
import type { ImputeConfig, ScaleConfig, EncodeConfig, OutlierConfig, TimeSeriesConfig, WindowSplitConfig, ProgressUpdate } from '@shared/lib'
import { runBackendProcessing, getJobStatus, cancelJob, invalidateArtifactsCache } from '@shared/lib/api'

// ─── Label helpers ───────────────────────────────────────────────────────────

function generateLabel(type: ProcessingType, config: Record<string, unknown>): string {
    const names: Record<ProcessingType, string> = {
        impute: 'Заполнить NULL',
        scale: 'Масштабировать',
        encode: 'Кодировать',
        outliers: 'Удалить выбросы',
        timeseries: 'Временные ряды',
        window_split: 'Окна по времени',
    }
    if (type === 'window_split') {
        const field = (config.field as string | undefined) ?? '?'
        const unit = (config.unit as string | undefined) ?? '?'
        return `${names.window_split}: ${field} → ${field}_${unit}`
    }
    if (type === 'timeseries') {
        const fields = (config.fields as string[] | undefined) ?? []
        const method = (config.method as string | undefined) ?? '?'
        const fieldsStr = fields.slice(0, 3).join(', ') + (fields.length > 3 ? ` +${fields.length - 3}` : '')
        return `${names.timeseries}: ${method} [${fieldsStr}]`
    }
    const entries = Object.entries(config)
    const parts = entries
        .slice(0, 3)
        .map(([field, cfg]) => `${field}→${(cfg as Record<string, unknown>).method ?? '?'}`)
    const extra = entries.length > 3 ? ` +${entries.length - 3}` : ''
    return `${names[type]}: ${parts.join(', ')}${extra}`
}

// ─── Local fallback replay (used when uploadId is not available) ──────────────

function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

async function replayStepsLocally(
    originalRows: ParsedRow[],
    originalColumns: ColumnConfig[],
    steps: ProcessingEntry[],
): Promise<{ rows: ParsedRow[]; columns: ColumnConfig[] }> {
    let rows = [...originalRows]
    let columns = [...originalColumns]
    for (const step of steps) {
        if (step.type === 'impute') {
            rows = imputeRows(rows, step.config as ImputeConfig)
        } else if (step.type === 'scale') {
            rows = scaleRows(rows, step.config as ScaleConfig)
        } else if (step.type === 'encode') {
            const { rows: nr, addedColumns } = encodeRows(rows, step.config as EncodeConfig, columns)
            rows = nr
            if (addedColumns.length) columns = [...columns, ...addedColumns]
        } else if (step.type === 'outliers') {
            const { rows: nr } = removeOutlierRows(rows, step.config as OutlierConfig)
            rows = nr
        } else if (step.type === 'timeseries') {
            rows = applyTimeSeries(rows, step.config as unknown as TimeSeriesConfig)
        } else if (step.type === 'window_split') {
            const { rows: nr, addedColumns } = applyWindowSplit(rows, step.config as unknown as WindowSplitConfig, columns)
            rows = nr
            if (addedColumns.length) columns = [...columns, ...addedColumns]
        }
        // yield between steps so the browser can process paint/input events
        await yieldToMain()
    }
    return { rows, columns }
}

// ─── Core processing helper ───────────────────────────────────────────────────

async function applyProcessingPipeline(
    tableId: string,
    activeState: TableState,
    currentRows: ParsedRow[],
    newHistory: ProcessingEntry[],
    onProgress?: (progress: ProgressUpdate) => void,
    signal?: AbortSignal,
): Promise<{ rows: ParsedRow[]; columns: ColumnConfig[] }> {
    const originalColumns = activeState.originalColumns ?? activeState.columns

    // Backend path: send full history to Python worker
    if (activeState.uploadId) {
        return runBackendProcessing(activeState.uploadId, newHistory, originalColumns, onProgress, signal)
    }

    // Local fallback: replay steps in browser
    if (newHistory.length === 0) {
        const originalRows = await idbStorage.getOriginalRows(tableId)
        return { rows: originalRows ?? currentRows, columns: originalColumns }
    }
    if ((activeState.processingHistory ?? []).length === 0) {
        await idbStorage.setOriginalRows(tableId, currentRows)
    }
    const originalRows = await idbStorage.getOriginalRows(tableId) ?? currentRows
    return replayStepsLocally(originalRows, originalColumns, newHistory)
}

// ─── Generic processing step runner ──────────────────────────────────────────

let _currentProcessingAbort: AbortController | null = null

async function runProcessingStep(
    type: ProcessingType,
    config: Record<string, unknown>,
    get: () => TableStore,
    set: (partial: Partial<TableStore>) => void,
    supportsEdit = true,
): Promise<void> {
    const { activeTableId, rows, tableStates, editingEntryId } = get()
    if (!activeTableId) return
    const activeState = tableStates.find((s) => s.id === activeTableId)
    if (!activeState) return

    // Cancel any in-flight processing before starting a new one
    _currentProcessingAbort?.abort()
    const controller = new AbortController()
    _currentProcessingAbort = controller

    set({ isLoading: true, processingProgress: 0, processingProgressLabel: 'Подготовка задачи', error: null })
    try {
        const history = activeState.processingHistory ?? []
        const newEntry: ProcessingEntry = {
            id: generateId(),
            type,
            label: generateLabel(type, config),
            config,
            appliedAt: new Date().toISOString(),
        }
        const newHistory = supportsEdit && editingEntryId
            ? history.map((e) => e.id === editingEntryId ? { ...newEntry, id: editingEntryId } : e)
            : [...history, newEntry]

        const onProgress = (progress: ProgressUpdate) => set({
            processingProgress: progress.percent,
            processingProgressLabel: progressLabel(progress),
        })
        const { rows: newRows, columns } = await applyProcessingPipeline(
            activeTableId, activeState, rows, newHistory, onProgress, controller.signal,
        )
        if (controller.signal.aborted) {
            set({ processingProgress: null, processingProgressLabel: null })
            return
        }
        await idbStorage.setRows(activeTableId, newRows, onProgress)
        const newState: TableState = {
            ...activeState,
            columns,
            originalColumns: activeState.originalColumns ?? activeState.columns,
            processingHistory: newHistory,
        }
        lsStorage.upsertTableState(newState)
        const successPartial: Partial<TableStore> = {
            rows: newRows,
            tableStates: tableStates.map((s) => s.id === activeTableId ? newState : s),
            isLoading: false,
            processingProgress: null,
            processingProgressLabel: null,
        }
        if (supportsEdit) successPartial.editingEntryId = null
        set(successPartial)
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        set({ error: String(e), isLoading: false, processingProgress: null, processingProgressLabel: null })
        throw e
    } finally {
        if (_currentProcessingAbort === controller) _currentProcessingAbort = null
    }
}

// ─── Background profile job tracking ─────────────────────────────────────────

type SetFn = (fn: (s: TableStore) => Partial<TableStore>) => void

// Guards against duplicate EventSource/polling per tableId
const _activeProfileSources = new Map<string, EventSource>()
const _activeFallbackPolls = new Set<string>()

function applyJobStatus(
    status: string,
    tableId: string,
    set: SetFn,
    get: () => TableStore,
    onTerminal?: () => void,
    errorMessage?: string | null,
) {
    const next: TableState['profileStatus'] =
        status === 'completed' ? 'completed'
        : status === 'failed' || status === 'cancelled' ? 'failed'
        : 'running'
    set((state) => ({
        tableStates: state.tableStates.map((s) =>
            s.id === tableId
                ? { ...s, profileStatus: next, ...(next === 'failed' ? { profileError: errorMessage ?? 'Ошибка обработки файла на сервере' } : {}) }
                : s,
        ),
    }))
    const target = get().tableStates.find((s) => s.id === tableId)
    if (target) lsStorage.upsertTableState(target)
    if ((next === 'completed' || next === 'failed') && onTerminal) onTerminal()
}

const POLL_FALLBACK_TIMEOUT_MS = Number(import.meta.env.VITE_PROFILE_POLL_TIMEOUT_MS) || 65 * 60 * 1000
const SSE_TIMEOUT_MS = Number(import.meta.env.VITE_PROFILE_SSE_TIMEOUT_MS) || 65 * 60 * 1000

function startPollingFallback(
    jobId: string,
    tableId: string,
    set: SetFn,
    get: () => TableStore,
) {
    if (_activeFallbackPolls.has(tableId)) return
    _activeFallbackPolls.add(tableId)

    const deadline = Date.now() + POLL_FALLBACK_TIMEOUT_MS
    const poll = async () => {
        if (!_activeFallbackPolls.has(tableId)) return
        if (Date.now() > deadline) {
            _activeFallbackPolls.delete(tableId)
            applyJobStatus('failed', tableId, set, get)
            return
        }
        try {
            const job = await getJobStatus(jobId)
            let done = false
            applyJobStatus(job.status, tableId, set, get, () => {
                done = true
                _activeFallbackPolls.delete(tableId)
            }, job.errorMessage)
            if (!done) setTimeout(poll, 1500)
        } catch {
            setTimeout(poll, 3000)
        }
    }
    setTimeout(poll, 1000)
}

function startProfilePolling(
    jobId: string,
    tableId: string,
    set: SetFn,
    get: () => TableStore,
) {
    // Close any existing EventSource for this table before opening a new one
    const existing = _activeProfileSources.get(tableId)
    if (existing) {
        existing.close()
        _activeProfileSources.delete(tableId)
    }

    const es = new EventSource(`/api/jobs/${jobId}/events`, { withCredentials: true })
    _activeProfileSources.set(tableId, es)

    let sseTimeoutId: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
        if (sseTimeoutId !== null) clearTimeout(sseTimeoutId)
        es.close()
        _activeProfileSources.delete(tableId)
    }

    sseTimeoutId = setTimeout(() => {
        cleanup()
        startPollingFallback(jobId, tableId, set, get)
    }, SSE_TIMEOUT_MS)

    es.onmessage = (e: MessageEvent) => {
        try {
            const job = JSON.parse(e.data as string) as { status: string; errorMessage?: string | null }
            if (job.status === 'not_found' || job.status === 'error') {
                cleanup()
                applyJobStatus('failed', tableId, set, get, undefined, job.errorMessage)
                return
            }
            applyJobStatus(job.status, tableId, set, get, cleanup, job.errorMessage)
        } catch { /* ignore malformed events */ }
    }

    es.onerror = () => {
        cleanup()
        startPollingFallback(jobId, tableId, set, get)
    }
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface TableStore {
    tableStates: TableState[]
    activeTableId: string | null
    rows: ParsedRow[]
    isLoading: boolean
    processingProgress: number | null
    processingProgressLabel: string | null
    error: string | null
    loadFromStorage: () => Promise<void>
    uploadTable: (fileName: string, columns: ColumnConfig[], rows: ParsedRow[], uploadId?: string, jobId?: string) => Promise<void>
    setActiveTable: (id: string) => Promise<void>
    removeTable: (id: string) => Promise<void>
    setColumnVisibility: (field: string, visible: boolean) => void
    setAllColumnsVisibility: (visible: boolean) => void
    setFilter: (field: string, filter: ColumnFilter | null) => void
    clearAllFilters: () => void
    hideNulls: boolean
    setHideNulls: (v: boolean) => void
    getActiveState: () => TableState | undefined
    imputeTable: (config: ImputeConfig) => Promise<void>
    scaleTable: (config: ScaleConfig) => Promise<void>
    encodeTable: (config: EncodeConfig) => Promise<void>
    removeOutliers: (config: OutlierConfig) => Promise<void>
    timeseriesTable: (config: TimeSeriesConfig) => Promise<void>
    windowSplitTable: (config: WindowSplitConfig) => Promise<void>
    editingEntryId: string | null
    setEditingEntry: (id: string | null) => void
    clearError: () => void
    removeProcessingStep: (entryId: string) => Promise<void>
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useTableStore = create<TableStore>()(
    subscribeWithSelector((set, get) => ({
        tableStates: [],
        activeTableId: null,
        rows: [],
        isLoading: false,
        processingProgress: null,
        processingProgressLabel: null,
        error: null,
        hideNulls: false,
        editingEntryId: null,


        loadFromStorage: async () => {
            set({ isLoading: true, error: null })
            try {
                await sessionGuard()
                const states = lsStorage.getTableStates()
                const activeId = lsStorage.getActiveTableId()
                if (states.length > 0) {
                    const resolvedId = activeId && states.find((s) => s.id === activeId)
                        ? activeId
                        : states[0].id
                    const rows = (await idbStorage.getRows(resolvedId)) ?? []
                    set({ tableStates: states, activeTableId: resolvedId, rows, isLoading: false })
                    // Restart SSE polling for any profile jobs still in progress
                    for (const state of states) {
                        if (state.profileJobId && state.profileStatus !== 'completed' && state.profileStatus !== 'failed') {
                            startProfilePolling(state.profileJobId, state.id, set as unknown as SetFn, get)
                        }
                    }
                } else {
                    set({ tableStates: [], activeTableId: null, rows: [], isLoading: false })
                }
            } catch (e) {
                set({ error: String(e), isLoading: false })
            }
        },


        uploadTable: async (fileName, columns, rows, uploadId, jobId) => {
            set({ isLoading: true, error: null })
            try {
                const id = generateId()
                const newState: TableState = {
                    id,
                    fileName,
                    columns,
                    filters: {},
                    uploadedAt: new Date().toISOString(),
                    ...(uploadId ? { uploadId } : {}),
                    ...(jobId ? { profileJobId: jobId, profileStatus: 'pending' } : {}),
                }
                await idbStorage.setRows(id, rows)
                lsStorage.upsertTableState(newState)
                lsStorage.setActiveTableId(id)
                set((s) => ({
                    tableStates: [...s.tableStates, newState],
                    activeTableId: id,
                    rows,
                    isLoading: false,
                }))
                if (jobId) startProfilePolling(jobId, id, set as unknown as SetFn, get)
            } catch (e) {
                set({ error: String(e), isLoading: false })
            }
        },


        setActiveTable: async (id) => {
            set({ isLoading: true, hideNulls: false })
            try {
                const rows = (await idbStorage.getRows(id)) ?? []
                lsStorage.setActiveTableId(id)
                set({ activeTableId: id, rows, isLoading: false, editingEntryId: null })
            } catch (e) {
                set({ error: String(e), isLoading: false })
            }
        },


        removeTable: async (id) => {
            // Stop any background tracking for this table
            const es = _activeProfileSources.get(id)
            if (es) { es.close(); _activeProfileSources.delete(id) }
            _activeFallbackPolls.delete(id)
            if (get().activeTableId === id) {
                _currentProcessingAbort?.abort()
                _currentProcessingAbort = null
            }

            // Cancel any active backend job for this table
            const tableState = get().tableStates.find((s) => s.id === id)
            if (tableState?.profileJobId) {
                cancelJob(tableState.profileJobId).catch(() => {})
            }
            if (tableState?.uploadId) invalidateArtifactsCache(tableState.uploadId)

            await idbStorage.deleteRows(id)
            await idbStorage.deleteOriginalRows(id)
            lsStorage.removeTableState(id)
            const remaining = get().tableStates.filter((s) => s.id !== id)
            const newActive = remaining.length > 0 ? remaining[0].id : null
            lsStorage.setActiveTableId(newActive)
            if (newActive) {
                const rows = (await idbStorage.getRows(newActive)) ?? []
                set({ tableStates: remaining, activeTableId: newActive, rows, hideNulls: false })
            } else {
                set({ tableStates: remaining, activeTableId: null, rows: [], hideNulls: false })
            }
        },


        setColumnVisibility: (field, visible) => {
            const { tableStates, activeTableId } = get()
            if (!activeTableId) return
            const updated = tableStates.map((s) => {
                if (s.id !== activeTableId) return s
                const newState: TableState = {
                    ...s,
                    columns: s.columns.map((c) => (c.field === field ? { ...c, visible } : c)),
                }
                lsStorage.upsertTableState(newState)
                return newState
            })
            set({ tableStates: updated })
        },


        setAllColumnsVisibility: (visible) => {
            const { tableStates, activeTableId } = get()
            if (!activeTableId) return
            const updated = tableStates.map((s) => {
                if (s.id !== activeTableId) return s
                const newState: TableState = {
                    ...s,
                    columns: s.columns.map((c) => ({ ...c, visible })),
                }
                lsStorage.upsertTableState(newState)
                return newState
            })
            set({ tableStates: updated })
        },


        setFilter: (field, filter) => {
            const { tableStates, activeTableId } = get()
            if (!activeTableId) return
            const updated = tableStates.map((s) => {
                if (s.id !== activeTableId) return s
                const newFilters = { ...s.filters }
                if (filter === null) {
                    delete newFilters[field]
                } else {
                    newFilters[field] = filter
                }
                const newState: TableState = { ...s, filters: newFilters }
                lsStorage.upsertTableState(newState)
                return newState
            })
            set({ tableStates: updated })
        },


        clearAllFilters: () => {
            const { tableStates, activeTableId } = get()
            if (!activeTableId) return
            const updated = tableStates.map((s) => {
                if (s.id !== activeTableId) return s
                const newState: TableState = { ...s, filters: {} }
                lsStorage.upsertTableState(newState)
                return newState
            })
            set({ tableStates: updated })
        },


        setHideNulls: (v) => set({ hideNulls: v }),

        setEditingEntry: (id) => set({ editingEntryId: id }),

        clearError: () => set({ error: null }),

        getActiveState: () => {
            const { tableStates, activeTableId } = get()
            return tableStates.find((s) => s.id === activeTableId)
        },


        // ─── Processing step handlers ─────────────────────────────────────────

        imputeTable: (config) =>
            runProcessingStep('impute', config as Record<string, unknown>, get, set),

        scaleTable: (config) =>
            runProcessingStep('scale', config as Record<string, unknown>, get, set),

        encodeTable: (config) =>
            runProcessingStep('encode', config as Record<string, unknown>, get, set),

        removeOutliers: (config) =>
            runProcessingStep('outliers', config as Record<string, unknown>, get, set),

        timeseriesTable: (config) =>
            runProcessingStep('timeseries', config as unknown as Record<string, unknown>, get, set, false),

        windowSplitTable: (config) =>
            runProcessingStep('window_split', config as unknown as Record<string, unknown>, get, set, false),


        removeProcessingStep: async (entryId) => {
            const { activeTableId, rows, tableStates } = get()
            if (!activeTableId) return
            const activeState = tableStates.find((s) => s.id === activeTableId)
            if (!activeState) return

            _currentProcessingAbort?.abort()
            const controller = new AbortController()
            _currentProcessingAbort = controller

            set({ isLoading: true, processingProgress: 0, processingProgressLabel: 'Подготовка задачи', error: null })
            try {
                const remaining = (activeState.processingHistory ?? []).filter((e) => e.id !== entryId)
                const onProgress = (progress: ProgressUpdate) => set({
                    processingProgress: progress.percent,
                    processingProgressLabel: progressLabel(progress),
                })
                const { rows: newRows, columns } = await applyProcessingPipeline(
                    activeTableId, activeState, rows, remaining, onProgress, controller.signal,
                )
                if (controller.signal.aborted) {
                    set({ processingProgress: null, processingProgressLabel: null })
                    return
                }
                await idbStorage.setRows(activeTableId, newRows, onProgress)
                const newState: TableState = { ...activeState, columns, processingHistory: remaining }
                lsStorage.upsertTableState(newState)
                set({ rows: newRows, tableStates: tableStates.map((s) => (s.id === activeTableId ? newState : s)), isLoading: false, processingProgress: null, processingProgressLabel: null })
            } catch (e) {
                if (e instanceof DOMException && e.name === 'AbortError') return
                set({ error: String(e), isLoading: false, processingProgress: null, processingProgressLabel: null })
                throw e
            } finally {
                if (_currentProcessingAbort === controller) _currentProcessingAbort = null
            }
        },
    })),
)
