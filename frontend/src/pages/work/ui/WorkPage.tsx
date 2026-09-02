import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    Box,
    Typography,
    Alert,
    Tabs,
    Tab,
    Paper,
    Skeleton,
    Stack,
    Chip,
    IconButton,
    Tooltip,
    Button,
    ButtonGroup,
    Divider,
    LinearProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Slider,
    Switch,
    FormControlLabel,
    ToggleButtonGroup,
    ToggleButton,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    TextField,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import SaveIcon from '@mui/icons-material/Save'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import { useTableStore } from '@entities/table'
import { FileUploadZone } from '@features/file-upload'
import { DataTable } from '@widgets/data-table'
import { ReportProblemButton } from '@features/support'
import { exportToCSV, exportToExcel, getBaseFilterField, idbStorage, lsStorage, projectRows, useNotify, savePublicationViaS3 } from '@shared/lib'
import type { TableState, ParsedRow } from '@shared/types'
import axios from 'axios'

const MAX_PUBLICATION_ROWS = 100000

interface PublicationWorkspaceState {
    tables?: TableState[]
    tablesData?: Record<string, ParsedRow[]>
    activeTableId?: string | null
    hideNulls?: boolean
}

interface PublicationData {
    id: number
    title: string
    workspaceState: PublicationWorkspaceState | null
}

export const WorkPage = () => {
    const { showError, showWarning } = useNotify()
    const loadFromStorage = useTableStore((s) => s.loadFromStorage)
    const tableStates = useTableStore((s) => s.tableStates)
    const activeTableId = useTableStore((s) => s.activeTableId)
    const setActiveTable = useTableStore((s) => s.setActiveTable)
    const removeTable = useTableStore((s) => s.removeTable)
    const isLoading = useTableStore((s) => s.isLoading)
    const processingProgress = useTableStore((s) => s.processingProgress)
    const processingProgressLabel = useTableStore((s) => s.processingProgressLabel)
    const rows = useTableStore((s) => s.rows)
    const hideNulls = useTableStore((s) => s.hideNulls)
    const setHideNullsStore = useTableStore((s) => s.setHideNulls)

    const [searchParams] = useSearchParams()
    const publicationId = searchParams.get('publicationId')
    const appendParam = searchParams.get('append')

    const [pubDialogOpen, setPubDialogOpen] = useState(false)
    const [pubTitle, setPubTitle] = useState('')
    const [pubDescription, setPubDescription] = useState('')
    const [pubTagsInput, setPubTagsInput] = useState('')
    const [pubSaving, setPubSaving] = useState(false)
    const [pubError, setPubError] = useState<string | null>(null)
    const [taskProgress, setTaskProgress] = useState<number | null>(null)
    const [mountedWhileLoading, setMountedWhileLoading] = useState(() => isLoading)

    useEffect(() => {
        if (!isLoading) setMountedWhileLoading(false)
    }, [isLoading])
    const [taskLabel, setTaskLabel] = useState('')

    // ML split dialog
    const [splitOpen, setSplitOpen] = useState(false)
    const [splitProcessing, setSplitProcessing] = useState(false)
    const [splitMode, setSplitMode] = useState<'2' | '3'>('2')
    const [trainPct, setTrainPct] = useState(70)
    const [testPct, setTestPct] = useState(20)
    const [shuffleSplit, setShuffleSplit] = useState(true)
    const [splitMethod, setSplitMethod] = useState<'random' | 'stratified' | 'timebased' | 'group' | 'kfold'>('random')
    const [splitTargetCol, setSplitTargetCol] = useState('')
    const [splitDateCol, setSplitDateCol] = useState('')
    const [splitGroupCol, setSplitGroupCol] = useState('')
    const [splitK, setSplitK] = useState(5)
    const [randomSeed, setRandomSeed] = useState(42)
    const validPct = splitMode === '3' ? Math.max(0, 100 - trainPct - testPct) : 0

    const activeState = tableStates.find((s) => s.id === activeTableId)

    const dateCols = useMemo(
        () => activeState?.columns.filter((c) => c.type === 'date' || c.type === 'datetime') ?? [],
        [activeState],
    )
    const stringCols = useMemo(
        () => activeState?.columns.filter((c) => c.type === 'string') ?? [],
        [activeState],
    )

    useEffect(() => {
        if (!splitOpen) return
        if (stringCols.length > 0) {
            if (!splitTargetCol) setSplitTargetCol(stringCols[0].field)
            if (!splitGroupCol) setSplitGroupCol(stringCols[0].field)
        }
        if (dateCols.length > 0 && !splitDateCol) setSplitDateCol(dateCols[0].field)
    }, [splitOpen, stringCols, dateCols, splitTargetCol, splitGroupCol, splitDateCol])

    const [filteredRows, setFilteredRows] = useState<ParsedRow[]>([])

    useEffect(() => {
        if (!activeState) { setFilteredRows([]); return }
        const hasFilters = Object.keys(activeState.filters).length > 0
        if (!hasFilters && !hideNulls) { setFilteredRows(rows); return }

        const controller = new AbortController()
        const visibleFields = activeState.columns.filter((c) => c.visible).map((c) => c.field)
        const worker = new Worker(
            new URL('../../../shared/lib/filterWorker.ts', import.meta.url),
            { type: 'module' },
        )
        let cancelled = false
        worker.onmessage = (e: MessageEvent<{ filteredRows: ParsedRow[] }>) => {
            worker.terminate()
            if (!cancelled) setFilteredRows(e.data.filteredRows)
        }
        worker.onerror = () => worker.terminate()
        const neededFields = new Set<string>([
            'id',
            ...visibleFields,
            ...Object.keys(activeState.filters).map((k) => getBaseFilterField(k)),
        ])
        projectRows(rows, neededFields, controller.signal)
            .then((slimRows) => {
                if (!cancelled) worker.postMessage({ rows: slimRows, filters: activeState.filters, hideNulls, visibleFields, groupConfig: null })
            })
            .catch((err) => {
                worker.terminate()
                if (!(err instanceof DOMException && err.name === 'AbortError')) setFilteredRows([])
            })
        return () => { cancelled = true; controller.abort(); worker.terminate() }
    }, [rows, activeState, hideNulls])

    const stripExt = (name: string) => name.replace(/\.[^/.]+$/, '')

    const handleDownloadCSV = () => {
        if (!activeState) return
        exportToCSV(filteredRows, activeState.columns, activeState.fileName)
    }

    const handleDownloadSplit = () => {
        if (!activeState) return
        setSplitProcessing(true)
        const worker = new Worker(
            new URL('../../../shared/lib/splitWorker.ts', import.meta.url),
            { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent) => {
            worker.terminate()
            const msg = e.data as { type: string; zipBytes?: Uint8Array; error?: string }
            setSplitProcessing(false)
            if (msg.type === 'error') { showError(msg.error ?? 'Ошибка при создании разбивки датасета'); return }
            const blob = new Blob([msg.zipBytes!.buffer as ArrayBuffer], { type: 'application/zip' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${stripExt(activeState.fileName)}_split.zip`
            a.click()
            URL.revokeObjectURL(url)
            setSplitOpen(false)
        }
        worker.onerror = () => { worker.terminate(); setSplitProcessing(false); showError('Ошибка при создании разбивки датасета') }
        worker.postMessage({
            rows: filteredRows,
            splitMethod,
            splitMode,
            trainPct,
            testPct,
            shuffleSplit,
            randomSeed,
            splitTargetCol,
            splitDateCol,
            splitGroupCol,
            splitK,
            visibleCols: activeState.columns
                .filter((c) => c.visible)
                .map((c) => ({ field: c.field, headerName: c.headerName })),
            fileName: activeState.fileName,
        })
    }

    const handleDownloadExcel = async () => {
        if (!activeState) return
        await exportToExcel(filteredRows, activeState.columns, activeState.fileName,
            () => showWarning('Не удалось создать XLSX — файл загружен в формате CSV'))
    }

    useEffect(() => {
        if (publicationId) {
            const controller = new AbortController()
            ;(async () => {
                try {
                    setTaskLabel('Загрузка публикации в рабочее место')
                    setTaskProgress(5)
                    const { data } = await axios.get<PublicationData>(
                        `/api/publications/${publicationId}`,
                        { signal: controller.signal },
                    )
                    if (controller.signal.aborted) return
                    setTaskProgress(20)
                    const ws = data.workspaceState
                    if (!ws || !ws.tables || ws.tables.length === 0) {
                        await loadFromStorage()
                        if (controller.signal.aborted) return
                        setTaskProgress(null)
                        return
                    }

                    setTaskProgress(35)
                    const incomingTables = ws.tables
                    const incomingData = ws.tablesData || {}
                    const publicationTitle = data.title.trim().length > 0
                        ? data.title.trim()
                        : `pub ${publicationId}`

                    const shouldAppend = appendParam !== 'false'
                    const existingTables = shouldAppend ? lsStorage.getTableStates() : []
                    const existingIds = new Set(existingTables.map((t) => t.id))

                    if (!shouldAppend) {
                        await idbStorage.clear()
                        if (controller.signal.aborted) return
                    }

                    const remap = new Map<string, string>()
                    const mergedTables: TableState[] = [...existingTables]

                    for (let i = 0; i < incomingTables.length; i++) {
                        if (controller.signal.aborted) return
                        const t = incomingTables[i]
                        const appendedFileName = `${t.fileName} (${publicationTitle})`

                        if (shouldAppend) {
                            const existingSame = mergedTables.find((s) => s.fileName === appendedFileName)
                            if (existingSame) {
                                remap.set(t.id, existingSame.id)
                                const pct = 35 + Math.round(((i + 1) / Math.max(incomingTables.length, 1)) * 45)
                                setTaskProgress(Math.min(pct, 80))
                                continue
                            }
                        }

                        let newId = t.id
                        while (existingIds.has(newId)) {
                            newId = `${t.id}_${Date.now()}_${i}`
                        }
                        existingIds.add(newId)
                        remap.set(t.id, newId)

                        const newState: TableState = {
                            ...t,
                            id: newId,
                            fileName: shouldAppend ? appendedFileName : t.fileName,
                            uploadedAt: new Date().toISOString(),
                        }
                        mergedTables.push(newState)

                        const dataRows = incomingData[t.id] || []
                        await idbStorage.setRows(newId, dataRows)
                        if (controller.signal.aborted) return

                        const pct = 35 + Math.round(((i + 1) / Math.max(incomingTables.length, 1)) * 45)
                        setTaskProgress(Math.min(pct, 80))
                    }

                    if (controller.signal.aborted) return
                    const incomingActive = ws.activeTableId || incomingTables[0].id
                    const resolvedActive = remap.get(incomingActive) || remap.get(incomingTables[0].id) || mergedTables[0]?.id || null

                    lsStorage.setTableStates(mergedTables)
                    lsStorage.setActiveTableId(resolvedActive)

                    await loadFromStorage()
                    if (controller.signal.aborted) return
                    if (!shouldAppend) {
                        setHideNullsStore(Boolean(ws.hideNulls))
                    }
                    setTaskProgress(100)
                } catch (err) {
                    if (axios.isCancel(err)) return
                    await loadFromStorage()
                } finally {
                    if (!controller.signal.aborted) setTaskProgress(null)
                }
            })()
            return () => controller.abort()
        } else if (useTableStore.getState().tableStates.length === 0) {
            // Only load from storage on cold start (empty store).
            // Zustand store is a global singleton that persists across navigation,
            // so re-reading LS/IDB on every mount would overwrite in-memory state.
            loadFromStorage()
        }
    }, [publicationId, appendParam, loadFromStorage, setHideNullsStore])

    // Обрабатывает событие/действие tab change

    const handleTabChange = (_: React.SyntheticEvent, newId: string) => {
        setActiveTable(newId)
    }

    const handleOpenPublicationDialog = () => {
        if (!tableStates.length) return
        setPubTitle(activeState?.fileName || 'Публикация')
        setPubDescription('')
        setPubTagsInput('')
        setPubError(null)
        setPubDialogOpen(true)
    }

    const handleConfirmSavePublication = async () => {
        if (!activeState || !pubTitle.trim()) return
        setPubSaving(true)
        setPubError(null)
        setTaskLabel('Сохранение публикации')
        setTaskProgress(5)
        try {
            const activeRows = (await idbStorage.getRows(activeState.id)) ?? []
            const totalRows = activeRows.length
            setTaskProgress(70)

            if (totalRows > MAX_PUBLICATION_ROWS) {
                setPubError(
                    `Публикация слишком большая (${totalRows.toLocaleString()} строк). ` +
                    `Лимит для публикации — ${MAX_PUBLICATION_ROWS.toLocaleString()} строк. ` +
                    'Сохраните данные через экспорт CSV/Excel.',
                )
                return
            }

            const tags = Array.from(
                new Set(
                    pubTagsInput
                        .split(',')
                        .map((t) => t.trim())
                        .filter((t) => t.length > 0),
                ),
            )

            const workspaceState = {
                tables: [activeState] as TableState[],
                tablesData: {
                    [activeState.id]: activeRows,
                },
                activeTableId: activeState.id,
                hideNulls,
            }

            setTaskProgress(80)
            await savePublicationViaS3(
                pubTitle.trim(),
                pubDescription.trim(),
                tags,
                workspaceState,
            )
            setTaskProgress(100)
            setPubDialogOpen(false)
        } catch (err: any) {
            setPubError(
                err?.response?.data?.message || err?.message || 'Не удалось сохранить публикацию',
            )
        } finally {
            setPubSaving(false)
            setTaskProgress(null)
        }
    }

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* ── Фиксированная шапка ───────────────────────────────────── */}
            <Box sx={{ flexShrink: 0, px: 3, pt: 2, pb: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 2,
                        flexWrap: 'wrap',
                    }}
                >
                    <Box>
                        <Typography variant="h6" fontWeight={700}>
                            Рабочее место для анализа данных
                        </Typography>
                        {tableStates.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                Загрузите CSV, Excel или ODS файл для анализа и фильтрации данных
                            </Typography>
                        )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {tableStates.length > 0 && (
                            <Button
                                variant="outlined"
                                startIcon={<SaveIcon />}
                                onClick={handleOpenPublicationDialog}
                                size="small"
                            >
                                Сохранить как публикацию
                            </Button>
                        )}
                        <ReportProblemButton
                            sectionName="Рабочее место"
                            datasetId={activeTableId ?? undefined}
                            publicationId={publicationId ?? undefined}
                        />
                    </Box>
                </Box>

                {taskProgress !== null && (
                    <Box
                        sx={{
                            p: 1.5,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.5,
                            bgcolor: 'background.paper',
                        }}
                    >
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            {taskLabel}: {taskProgress}%
                        </Typography>
                        <LinearProgress variant="determinate" value={taskProgress} />
                    </Box>
                )}

                <FileUploadZone compact={tableStates.length > 0} />
            </Box>

            {/* ── Растягивающаяся область с таблицей ───────────────────── */}
            {tableStates.length > 0 ? (
                <Box sx={{ flex: 1, px: 3, pb: 3, pt: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <Paper
                        elevation={0}
                        sx={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid', borderColor: 'divider', borderRadius: 2, minHeight: 0, overflow: 'hidden' }}
                    >
                        <Tabs
                            value={activeTableId ?? false}
                            onChange={handleTabChange}
                            variant="scrollable"
                            scrollButtons="auto"
                            sx={{ flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider', px: 1 }}
                        >
                            {tableStates.map((state) => (
                                <Tab
                                    key={state.id}
                                    value={state.id}
                                    label={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {state.fileName}
                                            </span>
                                            {Object.keys(state.filters).length > 0 && (
                                                <Chip
                                                    label={Object.keys(state.filters).length}
                                                    size="small"
                                                    color="warning"
                                                    sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                                                />
                                            )}
                                            <Tooltip title="Закрыть файл">
                                                <IconButton
                                                    component="span"
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        removeTable(state.id)
                                                    }}
                                                    sx={{ p: 0.25, ml: 0.25 }}
                                                >
                                                    <CloseIcon sx={{ fontSize: 14 }} />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    }
                                    sx={{ minHeight: 48, textTransform: 'none' }}
                                />
                            ))}
                        </Tabs>

                        <Box sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            {isLoading && processingProgress === null ? (
                                <Stack spacing={1}>
                                    <Skeleton variant="rectangular" height={40} />
                                    <Skeleton variant="rectangular" height={400} />
                                </Stack>
                            ) : processingProgress !== null && mountedWhileLoading ? (
                                // Вернулись на страницу пока идёт обработка — не монтируем AG Grid
                                // до завершения, чтобы избежать двойного фриза
                                <Stack spacing={1}>
                                    <Box sx={{ mb: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                            {processingProgressLabel ?? 'Обработка данных'}: {processingProgress}%
                                        </Typography>
                                        <LinearProgress variant="determinate" value={processingProgress} />
                                    </Box>
                                    <Skeleton variant="rectangular" height={400} />
                                </Stack>
                            ) : (
                                <>
                                    {processingProgress !== null && (
                                        <Box sx={{ mb: 2 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                                {processingProgressLabel ?? 'Обработка данных'}: {processingProgress}%
                                            </Typography>
                                            <LinearProgress variant="determinate" value={processingProgress} />
                                        </Box>
                                    )}
                                    <DataTable />
                                </>
                            )}
                        </Box>

                        {!isLoading && activeState && (
                            <>
                                <Divider />
                                <Box
                                    sx={{
                                        flexShrink: 0,
                                        px: 2,
                                        py: 1.5,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <DownloadIcon fontSize="small" color="action" />
                                        <Typography variant="body2" color="text.secondary">
                                            Скачать
                                            {Object.keys(activeState.filters).length > 0
                                                ? ` (с фильтрами, ${filteredRows.length} строк)`
                                                : ` (${filteredRows.length} строк)`}
                                            :
                                        </Typography>
                                    </Box>
                                    <ButtonGroup size="small" variant="outlined">
                                        <Button
                                            startIcon={<DownloadIcon />}
                                            onClick={handleDownloadCSV}
                                        >
                                            CSV
                                        </Button>
                                        <Button
                                            startIcon={<DownloadIcon />}
                                            onClick={handleDownloadExcel}
                                        >
                                            Excel
                                        </Button>
                                    </ButtonGroup>
                                    <Tooltip title="Разделить на train/test/valid и скачать ZIP">
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            startIcon={<CallSplitIcon />}
                                            onClick={() => setSplitOpen(true)}
                                        >
                                            Разделить
                                        </Button>
                                    </Tooltip>
                                </Box>
                            </>
                        )}
                    </Paper>
                </Box>
            ) : (
                !isLoading && (
                    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                            Загруженных файлов нет. Перетащите CSV, Excel или ODS файл выше.
                        </Typography>
                    </Box>
                )
            )}

            {/* ── Диалог разбивки train/test/valid ─────────────────────── */}
            <Dialog open={splitOpen} onClose={() => setSplitOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>Разделить на выборки</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 1 }}>

                    {/* Метод разбивки */}
                    <Box>
                        <Typography variant="body2" fontWeight={600} mb={1}>Метод разбивки</Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                            {([
                                { value: 'random' as const, label: 'Случайный', desc: 'Перемешать и разбить по пропорции', available: true },
                                { value: 'stratified' as const, label: 'Стратифицированный', desc: 'Пропорции классов сохраняются в каждой выборке', available: stringCols.length > 0, unavailMsg: 'Нет строковых колонок' },
                                { value: 'timebased' as const, label: 'Временной', desc: 'Сортировка по дате, без перемешивания', available: dateCols.length > 0, unavailMsg: 'Нет колонок с датой' },
                                { value: 'group' as const, label: 'Групповой', desc: 'Все строки группы попадают в одну выборку', available: stringCols.length > 0, unavailMsg: 'Нет строковых колонок' },
                            ] as { value: typeof splitMethod; label: string; desc: string; available: boolean; unavailMsg?: string }[]).map(({ value, label, desc, available, unavailMsg }) => (
                                <Box
                                    key={value}
                                    onClick={() => available && setSplitMethod(value)}
                                    sx={{
                                        p: 1.5, borderRadius: 1.5, border: '2px solid',
                                        borderColor: splitMethod === value ? 'primary.main' : 'divider',
                                        bgcolor: splitMethod === value ? 'primary.50' : 'background.paper',
                                        cursor: available ? 'pointer' : 'not-allowed',
                                        opacity: available ? 1 : 0.45, transition: 'all 0.15s',
                                        '&:hover': available ? { borderColor: splitMethod === value ? 'primary.main' : 'primary.light' } : {},
                                    }}
                                >
                                    <Typography variant="body2" fontWeight={700}>{label}</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block">{desc}</Typography>
                                    {!available && unavailMsg && (
                                        <Typography variant="caption" color="error.main" display="block">{unavailMsg}</Typography>
                                    )}
                                </Box>
                            ))}
                            {/* K-Fold — полная ширина */}
                            <Box
                                onClick={() => setSplitMethod('kfold')}
                                sx={{
                                    gridColumn: '1 / -1', p: 1.5, borderRadius: 1.5, border: '2px solid',
                                    borderColor: splitMethod === 'kfold' ? 'primary.main' : 'divider',
                                    bgcolor: splitMethod === 'kfold' ? 'primary.50' : 'background.paper',
                                    cursor: 'pointer', transition: 'all 0.15s',
                                    '&:hover': { borderColor: splitMethod === 'kfold' ? 'primary.main' : 'primary.light' },
                                }}
                            >
                                <Typography variant="body2" fontWeight={700}>K-Fold кросс-валидация</Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    Данные делятся на K равных фолдов — каждый становится отдельным CSV-файлом
                                </Typography>
                            </Box>
                        </Box>
                    </Box>

                    {/* Колонка для метода */}
                    {splitMethod === 'stratified' && (
                        <FormControl size="small" fullWidth>
                            <InputLabel>Целевая переменная (классы)</InputLabel>
                            <Select value={splitTargetCol} label="Целевая переменная (классы)" onChange={(e) => setSplitTargetCol(e.target.value)}>
                                {stringCols.map((c) => <MenuItem key={c.field} value={c.field}>{c.headerName}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}
                    {splitMethod === 'timebased' && (
                        <FormControl size="small" fullWidth>
                            <InputLabel>Колонка с датой</InputLabel>
                            <Select value={splitDateCol} label="Колонка с датой" onChange={(e) => setSplitDateCol(e.target.value)}>
                                {dateCols.map((c) => <MenuItem key={c.field} value={c.field}>{c.headerName}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}
                    {splitMethod === 'group' && (
                        <FormControl size="small" fullWidth>
                            <InputLabel>Колонка с ID группы</InputLabel>
                            <Select value={splitGroupCol} label="Колонка с ID группы" onChange={(e) => setSplitGroupCol(e.target.value)}>
                                {stringCols.map((c) => <MenuItem key={c.field} value={c.field}>{c.headerName}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}

                    {/* K-Fold: число фолдов */}
                    {splitMethod === 'kfold' && (
                        <Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                <Typography variant="body2" fontWeight={600}>Число фолдов (K)</Typography>
                                <Typography variant="body2" color="primary.main" fontWeight={700}>{splitK}</Typography>
                            </Box>
                            <Slider value={splitK} min={2} max={10} step={1} onChange={(_, v) => setSplitK(v as number)} marks valueLabelDisplay="off" />
                        </Box>
                    )}

                    {/* Режим разбивки (скрыт для K-Fold) */}
                    {splitMethod !== 'kfold' && (
                        <Box>
                            <Typography variant="body2" fontWeight={600} mb={1}>Режим разбивки</Typography>
                            <ToggleButtonGroup value={splitMode} exclusive onChange={(_, v) => { if (v) setSplitMode(v) }} size="small" fullWidth>
                                <ToggleButton value="2">Train / Test</ToggleButton>
                                <ToggleButton value="3">Train / Test / Valid</ToggleButton>
                            </ToggleButtonGroup>
                        </Box>
                    )}

                    {/* Слайдеры пропорций (скрыты для K-Fold) */}
                    {splitMethod !== 'kfold' && (
                        <>
                            <Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                    <Typography variant="body2" fontWeight={600}>Train</Typography>
                                    <Typography variant="body2" color="primary.main" fontWeight={700}>{trainPct}%</Typography>
                                </Box>
                                <Slider
                                    value={trainPct} min={10} max={splitMode === '2' ? 90 : 85} step={5}
                                    onChange={(_, v) => {
                                        const next = v as number
                                        setTrainPct(next)
                                        if (splitMode === '3' && next + testPct > 95) setTestPct(Math.max(5, 95 - next))
                                    }}
                                    marks valueLabelDisplay="off"
                                />
                            </Box>
                            {splitMode === '3' && (
                                <Box>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                        <Typography variant="body2" fontWeight={600}>Test</Typography>
                                        <Typography variant="body2" color="warning.main" fontWeight={700}>{testPct}%</Typography>
                                    </Box>
                                    <Slider value={testPct} min={5} max={Math.max(5, 95 - trainPct - 5)} step={5} onChange={(_, v) => setTestPct(v as number)} marks valueLabelDisplay="off" color="warning" />
                                </Box>
                            )}
                        </>
                    )}

                    {/* Preview cards */}
                    {splitMethod === 'kfold' ? (
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {Array.from({ length: splitK }, (_, i) => {
                                const base = Math.floor(filteredRows.length / splitK)
                                const extra = filteredRows.length % splitK
                                const rowCount = i < extra ? base + 1 : base
                                return (
                                    <Box key={i} sx={{ flex: '1 1 auto', minWidth: 52, p: 1, borderRadius: 1.5, bgcolor: 'grey.100', border: '1px solid', borderColor: 'grey.300', textAlign: 'center' }}>
                                        <Typography variant="caption" fontWeight={600} display="block">Fold {i + 1}</Typography>
                                        <Typography variant="caption" color="text.secondary">~{rowCount} строк</Typography>
                                    </Box>
                                )
                            })}
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            {(
                                [
                                    { name: 'Train', pct: trainPct, color: 'primary' },
                                    { name: 'Test', pct: splitMode === '2' ? 100 - trainPct : testPct, color: 'warning' },
                                    ...(splitMode === '3' ? [{ name: 'Valid', pct: validPct, color: 'success' }] : []),
                                ] as { name: string; pct: number; color: string }[]
                            ).map(({ name, pct, color }) => (
                                <Box key={name} sx={{ flex: 1, p: 1.5, borderRadius: 1.5, bgcolor: `${color}.50`, border: '1px solid', borderColor: `${color}.200`, textAlign: 'center' }}>
                                    <Typography variant="caption" color={`${color}.main`} fontWeight={600} display="block">{name}</Typography>
                                    <Typography variant="body2" fontWeight={700}>{pct}%</Typography>
                                    <Typography variant="caption" color="text.secondary">~{Math.round(filteredRows.length * pct / 100)} строк</Typography>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* Shuffle toggle (только для random) */}
                    {splitMethod === 'random' && (
                        <FormControlLabel
                            control={<Switch checked={shuffleSplit} onChange={(e) => setShuffleSplit(e.target.checked)} size="small" />}
                            label={<Typography variant="body2">Перемешать строки перед разбивкой</Typography>}
                        />
                    )}
                    {splitMethod === 'timebased' && (
                        <Typography variant="caption" color="text.secondary">
                            Строки сортируются по выбранной дате — перемешивание отключено во избежание утечки данных.
                        </Typography>
                    )}
                    {splitMethod === 'group' && (
                        <Typography variant="caption" color="text.secondary">
                            Группы перемешиваются целиком — порядок строк внутри групп сохраняется.
                        </Typography>
                    )}

                    {/* Random seed (для всех методов с перемешиванием) */}
                    {(splitMethod !== 'timebased' && (splitMethod !== 'random' || shuffleSplit)) && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Typography variant="body2" sx={{ flexShrink: 0 }}>Random seed</Typography>
                            <TextField
                                size="small"
                                type="number"
                                value={randomSeed}
                                onChange={(e) => setRandomSeed(Math.max(0, parseInt(e.target.value) || 0))}
                                inputProps={{ min: 0 }}
                                sx={{ width: 100 }}
                            />
                            <Typography variant="caption" color="text.secondary">для воспроизводимости результата</Typography>
                        </Box>
                    )}

                    <Typography variant="caption" color="text.secondary">
                        {splitMethod === 'kfold'
                            ? <>Результат — ZIP с {splitK} файлами: <em>{stripExt(activeState?.fileName ?? 'file')}_fold_1.csv</em> … _fold_{splitK}.csv</>
                            : <>Результат — ZIP с {splitMode === '2' ? '2' : '3'} файлами: <em>{stripExt(activeState?.fileName ?? 'file')}_train.csv</em> и др.</>
                        }
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button size="small" onClick={() => setSplitOpen(false)} disabled={splitProcessing}>Отмена</Button>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={splitProcessing ? undefined : <DownloadIcon />}
                        onClick={handleDownloadSplit}
                        disabled={
                            splitProcessing ||
                            filteredRows.length === 0 ||
                            (splitMethod === 'stratified' && !splitTargetCol) ||
                            (splitMethod === 'timebased' && !splitDateCol) ||
                            (splitMethod === 'group' && !splitGroupCol) ||
                            (splitMethod === 'kfold' && filteredRows.length < splitK)
                        }
                    >
                        {splitProcessing ? 'Обработка...' : 'Скачать ZIP'}
                    </Button>
                </DialogActions>
            </Dialog>

            {pubDialogOpen && (
                <Box
                    sx={{
                        position: 'fixed',
                        inset: 0,
                        bgcolor: 'rgba(0,0,0,0.35)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1300,
                    }}
                    onClick={() => !pubSaving && setPubDialogOpen(false)}
                >
                    <Paper
                        sx={{ p: 3, borderRadius: 2, width: 400, maxWidth: '90%' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Typography variant="h6" fontWeight={600} gutterBottom>
                            Сохранить как публикацию
                        </Typography>
                        {pubError && (
                            <Alert severity="error" sx={{ mb: 1.5 }}>
                                {pubError}
                            </Alert>
                        )}
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                            <Box>
                                <Typography variant="body2" gutterBottom>
                                    Название
                                </Typography>
                                <input
                                    style={{ width: '100%', padding: '8px 10px' }}
                                    value={pubTitle}
                                    onChange={(e) => setPubTitle(e.target.value)}
                                />
                            </Box>
                            <Box>
                                <Typography variant="body2" gutterBottom>
                                    Описание (необязательно)
                                </Typography>
                                <textarea
                                    style={{ width: '100%', minHeight: 80, padding: '8px 10px' }}
                                    value={pubDescription}
                                    onChange={(e) => setPubDescription(e.target.value)}
                                />
                            </Box>
                            <Box>
                                <Typography variant="body2" gutterBottom>
                                    Теги (через запятую, необязательно)
                                </Typography>
                                <input
                                    style={{ width: '100%', padding: '8px 10px' }}
                                    placeholder="например: cardiology, ICU, demo"
                                    value={pubTagsInput}
                                    onChange={(e) => setPubTagsInput(e.target.value)}
                                />
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                                <Button
                                    size="small"
                                    onClick={() => !pubSaving && setPubDialogOpen(false)}
                                >
                                    Отмена
                                </Button>
                                <Button
                                    size="small"
                                    variant="contained"
                                    onClick={handleConfirmSavePublication}
                                    disabled={pubSaving || !pubTitle.trim()}
                                >
                                    Сохранить
                                </Button>
                            </Box>
                        </Box>
                    </Paper>
                </Box>
            )}
        </Box>
    )
}
