import { useMemo, useState, useEffect, useCallback } from 'react'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, IHeaderParams, ICellRendererParams } from 'ag-grid-community'
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community'
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Collapse,
    IconButton,
    List,
    ListItem,
    ListItemText,
    Paper,
    Popover,
    Stack,
    Tooltip,
    Typography,
    Divider,
    Select,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Checkbox,
    FormControlLabel,
    FormGroup,
} from '@mui/material'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import FilterListIcon from '@mui/icons-material/FilterList'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff'
import UndoIcon from '@mui/icons-material/Undo'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import TuneIcon from '@mui/icons-material/Tune'
import CategoryIcon from '@mui/icons-material/Category'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import TimelineIcon from '@mui/icons-material/Timeline'
import BuildIcon from '@mui/icons-material/Build'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import SortIcon from '@mui/icons-material/Sort'
import FunctionsIcon from '@mui/icons-material/Functions'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import type { ProcessingEntry, ColumnFilter, ParsedRow } from '@shared/types'

type AggFunc = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
type AggEntry = { field: string; func: AggFunc }
type GroupConfig = { groupByFields: string[]; aggregates: AggEntry[] }

import { useTableStore } from '@entities/table'
import { formatFilterSummaryLabel, getBaseFilterField, projectRows } from '@shared/lib'
import { FilterSummaryBar, type FilterChipItem } from '@shared/ui/FilterSummaryBar'
import { ColumnManagerDialog } from '@features/column-manager'
import { FilterManagerDialog } from '@features/filter-manager'
import { ImputeDialog } from '@features/fill-nulls'
import { ScaleDialog } from '@features/scale-features'
import { EncodeDialog } from '@features/encode-features'
import { OutlierDialog } from '@features/remove-outliers'
import { TimeSeriesDialog } from '@features/timeseries'
import type { TsSection } from '@features/timeseries'

ModuleRegistry.registerModules([AllCommunityModule])

// ── Custom AG Grid header: name + sort arrow + type chip below ───────────────
interface CustomHeaderProps extends IHeaderParams {
    colType: string
    hasFilter: boolean
}

const CustomHeader = (props: CustomHeaderProps) => {
    const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(props.column.getSort() ?? null)
    const [hovered, setHovered] = useState(false)

    useEffect(() => {
        const onSortChanged = () => setSortDir(props.column.getSort() ?? null)
        props.column.addEventListener('sortChanged', onSortChanged)
        return () => props.column.removeEventListener('sortChanged', onSortChanged)
    }, [props.column])

    const handleClick = (e: React.MouseEvent) => props.progressSort(e.shiftKey)

    const TYPE_BADGE: Record<string, { bg: string; color: string }> = {
        number: { bg: '#e8f0fe', color: '#1a73e8' },
        date:   { bg: '#f3e8fd', color: '#8b31c7' },
        datetime:{ bg: '#e8f5fd', color: '#0277bd' },
        time:   { bg: '#fff3e0', color: '#e65100' },
        string: { bg: '#f1f3f4', color: '#5f6368' },
    }
    const badge = TYPE_BADGE[props.colType] ?? TYPE_BADGE.string

    return (
        <Box
            onClick={handleClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.3, py: 0.5, width: '100%', overflow: 'hidden', cursor: 'pointer', userSelect: 'none' }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflow: 'hidden' }}>
                <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, fontSize: '0.8rem', color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, letterSpacing: 0.1 }}
                    title={props.displayName}
                >
                    {props.displayName}
                </Typography>
                <Box sx={{ flexShrink: 0, width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {sortDir === 'asc' && <ArrowUpwardIcon sx={{ fontSize: 13, color: '#1976d2' }} />}
                    {sortDir === 'desc' && <ArrowDownwardIcon sx={{ fontSize: 13, color: '#1976d2' }} />}
                    {sortDir === null && hovered && <SortIcon sx={{ fontSize: 12, color: '#9e9e9e' }} />}
                </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mt: 0.3 }}>
                <Box component="span" sx={{ px: 0.6, py: 0.1, borderRadius: '4px', bgcolor: badge.bg, color: badge.color, fontSize: '0.58rem', fontWeight: 600, lineHeight: 1.6, letterSpacing: 0.2 }}>
                    {props.colType}
                </Box>
                {props.hasFilter && (
                    <Box component="span" sx={{ px: 0.6, py: 0.1, borderRadius: '4px', bgcolor: '#fff3e0', color: '#e65100', fontSize: '0.58rem', fontWeight: 600, lineHeight: 1.6 }}>
                        фильтр
                    </Box>
                )}
            </Box>
        </Box>
    )
}

// ── NULL cell renderer ────────────────────────────────────────────────────────
const NullCell = (props: ICellRendererParams) => {
    const val = props.value
    if (val === null || val === undefined || val === '') {
        return (
            <span style={{ color: '#bdbdbd', fontStyle: 'italic', fontSize: '0.78rem' }}>null</span>
        )
    }
    return <span style={{ color: '#1a1a2e' }}>{String(val)}</span>
}

// ── Shared AG Grid theme ──────────────────────────────────────────────────────
const gridTheme = themeQuartz.withParams({
    accentColor: '#1976d2',
    headerBackgroundColor: '#f8faff',
    headerTextColor: '#1a1a2e',
    headerFontSize: 13,
    headerFontWeight: 600,
    fontSize: 13,
    rowHeight: 36,
    headerHeight: 56,
    borderColor: '#e8ecf0',
    rowBorder: { style: 'solid', width: 1, color: '#f0f2f5' },
    columnBorder: { style: 'solid', width: 1, color: '#edf0f4' },
    rowHoverColor: '#f0f6ff',
    selectedRowBackgroundColor: '#dbeafe',
    oddRowBackgroundColor: '#ffffff',
    cellHorizontalPaddingScale: 1.1,
    fontFamily: '"Inter", "Roboto", "Helvetica Neue", sans-serif',
    wrapperBorderRadius: 0,
    borderRadius: 2,
})

export const DataTable = () => {
    const activeState = useTableStore((s) => s.getActiveState())
    const rows = useTableStore((s) => s.rows)
    const removeTable = useTableStore((s) => s.removeTable)

    const [colDialogOpen, setColDialogOpen] = useState(false)
    const [filterDialogOpen, setFilterDialogOpen] = useState(false)
    const [imputeOpen, setImputeOpen] = useState(false)
    const [scaleOpen, setScaleOpen] = useState(false)
    const [encodeOpen, setEncodeOpen] = useState(false)
    const [outlierOpen, setOutlierOpen] = useState(false)
    const [timeseriesOpen, setTimeseriesOpen] = useState(false)
    const [tsSection, setTsSection] = useState<TsSection>('fill')
    const [filterPopoverAnchor, setFilterPopoverAnchor] = useState<HTMLElement | null>(null)
    const [procPopoverAnchor, setProcPopoverAnchor] = useState<HTMLElement | null>(null)
    const [filterGroupOpen, setFilterGroupOpen] = useState(true)
    const [procGroupOpen, setProcGroupOpen] = useState(true)
    const [tsGroupOpen, setTsGroupOpen] = useState(true)
    // ── GROUP BY + агрегации ──────────────────────────────────────────────────
    const [groupConfig, setGroupConfig] = useState<GroupConfig | null>(null)
    const [aggGroupOpen, setAggGroupOpen] = useState(true)
    const [groupDialogOpen, setGroupDialogOpen] = useState(false)
    const [dlgGroupByFields, setDlgGroupByFields] = useState<string[]>([])
    const [dlgAggregates, setDlgAggregates] = useState<AggEntry[]>([])

    useEffect(() => {
        setGroupConfig(null)
    }, [activeState?.id])

    const hideNulls = useTableStore((s) => s.hideNulls)
    const setHideNulls = useTableStore((s) => s.setHideNulls)
    const clearAllFilters = useTableStore((s) => s.clearAllFilters)
    const removeProcessingStep = useTableStore((s) => s.removeProcessingStep)
    const setEditingEntry = useTableStore((s) => s.setEditingEntry)
    const setFilter = useTableStore((s) => s.setFilter)

    const processingHistory = activeState?.processingHistory ?? []
    const processingReady = !activeState?.profileJobId || activeState?.profileStatus === 'completed' || activeState?.profileStatus === 'failed'
    const tsCount = processingHistory.filter((e) => e.type === 'timeseries').length

    const handleEditEntry = (entry: ProcessingEntry) => {
        setEditingEntry(entry.id)
        setProcPopoverAnchor(null)
        if (entry.type === 'impute') setImputeOpen(true)
        else if (entry.type === 'scale') setScaleOpen(true)
        else if (entry.type === 'encode') setEncodeOpen(true)
        else if (entry.type === 'outliers') setOutlierOpen(true)
        else if (entry.type === 'timeseries') setTimeseriesOpen(true)
    }

    const handleProcessingDialogClose = (setter: (v: boolean) => void) => {
        setter(false)
        setEditingEntry(null)
    }

    const PROC_ICON: Record<string, JSX.Element> = {
        impute: <AutoFixHighIcon sx={{ fontSize: 14 }} />,
        scale: <TuneIcon sx={{ fontSize: 14 }} />,
        encode: <CategoryIcon sx={{ fontSize: 14 }} />,
        outliers: <QueryStatsIcon sx={{ fontSize: 14 }} />,
        timeseries: <TimelineIcon sx={{ fontSize: 14 }} />,
        window_split: <FunctionsIcon sx={{ fontSize: 14 }} />,
    }
    const PROC_COLOR: Record<string, 'warning' | 'info' | 'secondary' | 'error'> = {
        impute: 'warning',
        scale: 'info',
        encode: 'secondary',
        outliers: 'error',
        timeseries: 'info',
        window_split: 'info',
    }

    const PROC_TYPE_LABEL: Record<string, string> = {
        impute: 'Заполнить NULL',
        scale: 'Масштабировать',
        encode: 'Кодировать',
        outliers: 'Удалить выбросы',
        timeseries: 'Временные ряды',
        window_split: 'Окна по времени',
    }

    const ENCODE_METHOD_LABEL: Record<string, string> = {
        label: 'Label Encoding (авто)',
        ordinal: 'Ordinal Encoding',
        onehot: 'One-Hot Encoding',
        frequency: 'Frequency Encoding',
        count: 'Count Encoding',
        target: 'Target Encoding',
        loo: 'Leave-One-Out Encoding',
        woe: 'WoE Encoding',
    }

    const SCALE_METHOD_LABEL: Record<string, string> = {
        standard: 'Standard Scaler',
        minmax: 'Min-Max Scaler',
        robust: 'Robust Scaler',
        log: 'Log Transform',
        log1p: 'Log1p Transform',
        sqrt: 'Sqrt Transform',
    }

    const IMPUTE_METHOD_LABEL: Record<string, string> = {
        mean: 'Среднее',
        median: 'Медиана',
        mode: 'Мода',
        constant: 'Константа',
        ffill: 'Forward Fill',
        bfill: 'Backward Fill',
        knn: 'KNN',
    }

    const OUTLIER_METHOD_LABEL: Record<string, string> = {
        iqr: 'IQR',
        zscore: 'Z-Score',
        isolation: 'Isolation Forest',
    }

    const getFieldMethodLabel = (type: string, method: string): string => {
        if (type === 'encode') return ENCODE_METHOD_LABEL[method] ?? method
        if (type === 'scale') return SCALE_METHOD_LABEL[method] ?? method
        if (type === 'impute') return IMPUTE_METHOD_LABEL[method] ?? method
        if (type === 'outliers') return OUTLIER_METHOD_LABEL[method] ?? method
        return method
    }

    const getEncodeFieldHint = (cfg: Record<string, unknown>): string => {
        const method = cfg.method as string
        const targetField = cfg.targetField as string | undefined
        const labelMapping = cfg._labelMapping as Record<string, number> | undefined

        if (labelMapping && (method === 'label' || method === 'ordinal')) {
            const pairs = Object.entries(labelMapping)
            const shown = pairs.slice(0, 5).map(([v, code]) => `${v} → ${code}`)
            const extra = pairs.length > 5 ? ` +${pairs.length - 5}` : ''
            return shown.join(', ') + extra
        }

        if (method === 'label') return 'Алфавитная сортировка → 0, 1, 2...'
        if (method === 'ordinal') return 'Порядок задан вручную → 0, 1, 2...'
        if (method === 'onehot') return 'Бинарный столбец для каждого уникального значения'
        if (method === 'frequency') return 'Значение → его доля в датасете (0.0–1.0)'
        if (method === 'count') return 'Значение → количество вхождений'
        if (method === 'target') return `Среднее целевой переменной${targetField ? `: ${targetField}` : ''}`
        if (method === 'loo') return `Leave-One-Out по целевой${targetField ? `: ${targetField}` : ''}`
        if (method === 'woe') return `Weight of Evidence по целевой${targetField ? `: ${targetField}` : ''}`
        return method
    }

    const getProcFieldEntries = (entry: ProcessingEntry): Array<{ field: string; method: string }> => {
        if (entry.type === 'timeseries' || entry.type === 'window_split') return []
        return Object.entries(entry.config).map(([field, cfg]) => ({
            field,
            method: getFieldMethodLabel(entry.type, (cfg as Record<string, unknown>).method as string ?? '?'),
        }))
    }

    const columns = useMemo(() => activeState?.columns ?? [], [activeState?.columns])
    const filters = useMemo(() => activeState?.filters ?? {}, [activeState?.filters])
    const describeFilter = useCallback((fieldKey: string, filter: ColumnFilter): string => {
        const field = getBaseFilterField(fieldKey)
        const column = columns.find((candidate) => candidate.field === field)
        return formatFilterSummaryLabel({
            field: column?.headerName ?? field,
            operator: filter.operator,
            value: (filter as { value?: unknown }).value,
            valueFrom: (filter as { valueFrom?: unknown }).valueFrom,
            valueTo: (filter as { valueTo?: unknown }).valueTo,
        })
    }, [columns])

    const [filteredRows, setFilteredRows] = useState<ParsedRow[]>([])
    const [displayRows, setDisplayRows] = useState<ParsedRow[]>([])
    const [isFiltering, setIsFiltering] = useState(false)

    useEffect(() => {
        let cancelled = false
        const hasFilters = Object.keys(filters).length > 0
        const hasGroup = groupConfig && groupConfig.groupByFields.length > 0

        if (!hasFilters && !hideNulls && !hasGroup) {
            setDisplayRows(rows)
            setFilteredRows(rows)
            return
        }

        setIsFiltering(true)

        // 150ms debounce — prevents structured-clone of 100k rows on every keystroke
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            if (cancelled) return
            const visibleFields = columns.filter((c) => c.visible).map((c) => c.field)
            // Slim rows to only needed fields — reduces structured-clone from O(n×all_cols) to O(n×active_cols)
            const neededFields = new Set<string>([
                'id',
                ...visibleFields,
                ...Object.keys(filters).map(k => getBaseFilterField(k)),
                ...(groupConfig?.groupByFields ?? []),
                ...(groupConfig?.aggregates.map(a => a.field) ?? []),
            ])
            let slimRows: ParsedRow[]
            try {
                slimRows = await projectRows(rows, neededFields, controller.signal)
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') return
                setIsFiltering(false)
                return
            }
            if (cancelled) return
            const worker = new Worker(
                new URL('../../../shared/lib/filterWorker.ts', import.meta.url),
                { type: 'module' },
            )
            worker.onmessage = (e: MessageEvent<{ filteredRows: ParsedRow[]; displayRows: ParsedRow[] }>) => {
                worker.terminate()
                if (cancelled) return
                setFilteredRows(e.data.filteredRows)
                setDisplayRows(e.data.displayRows)
                setIsFiltering(false)
            }
            worker.onerror = () => { worker.terminate(); if (!cancelled) setIsFiltering(false) }
            worker.postMessage({ rows: slimRows, filters, hideNulls, visibleFields, groupConfig: groupConfig ?? null })
        }, 150)

        return () => { cancelled = true; controller.abort(); clearTimeout(timer); setIsFiltering(false) }
    }, [rows, filters, hideNulls, columns, groupConfig])

    // ── AG Grid column definitions ────────────────────────────────────────────
    // Tracks only which fields have active filters (not their values) — column defs
    // are regenerated only when filters are added/removed, not on every value change.
    const filterFieldsKey = useMemo(
        () => Object.keys(filters).map((k) => getBaseFilterField(k)).sort().join(','),
        [filters],
    )
    const filterFieldSet = useMemo(
        () => new Set(filterFieldsKey ? filterFieldsKey.split(',') : []),
        [filterFieldsKey],
    )

    const agColDefs = useMemo((): ColDef[] => {
        if (groupConfig && groupConfig.groupByFields.length > 0) {
            const cols: ColDef[] = []
            for (const f of groupConfig.groupByFields) {
                const col = columns.find(c => c.field === f)
                cols.push({ field: f, headerName: col?.headerName ?? f, minWidth: 100, flex: 1, cellRenderer: NullCell })
            }
            // Always show row count per group
            cols.push({
                field: '_count',
                headerName: 'Кол-во строк',
                minWidth: 120,
                flex: 1,
                cellRenderer: NullCell,
                sort: 'desc',
            })
            for (const { field, func } of groupConfig.aggregates) {
                const colKey = `${func}(${field})`
                const col = columns.find(c => c.field === field)
                cols.push({ field: colKey, headerName: `${func}(${col?.headerName ?? field})`, minWidth: 100, flex: 1, cellRenderer: NullCell })
            }
            return cols
        }

        return columns
            .filter(c => c.visible)
            .map(c => ({
                field: c.field,
                headerName: c.headerName,
                width: Math.max(120, c.headerName.length * 9 + 56),
                minWidth: 100,
                sortable: true,
                headerComponent: CustomHeader,
                headerComponentParams: {
                    colType: c.type,
                    hasFilter: filterFieldSet.has(c.field),
                },
                cellRenderer: NullCell,
            }))
    }, [columns, filterFieldSet, groupConfig])

    const handleOpenGroupDialog = () => {
        setDlgGroupByFields(groupConfig?.groupByFields ?? [])
        setDlgAggregates(groupConfig?.aggregates ?? [])
        setGroupDialogOpen(true)
    }

    const handleApplyGroup = () => {
        if (dlgGroupByFields.length === 0) {
            setGroupConfig(null)
        } else {
            setGroupConfig({
                groupByFields: dlgGroupByFields,
                aggregates: dlgAggregates.filter(a => !dlgGroupByFields.includes(a.field)),
            })
        }
        setGroupDialogOpen(false)
    }

    const activeFilterItems = useMemo<FilterChipItem[]>(() => {
        const filterItems = Object.entries(filters).map(([field, filter]) => ({
            id: `filter-${field}`,
            label: describeFilter(field, filter),
            onDelete: () => setFilter(field, null),
        }))
        const extra: FilterChipItem[] = []
        if (hideNulls) {
            extra.push({ id: 'hide-nulls', label: 'NULL скрыты', onDelete: () => setHideNulls(false) })
        }
        if (groupConfig && groupConfig.groupByFields.length > 0) {
            const groupLabel = `GROUP BY: ${groupConfig.groupByFields.map(f => columns.find(c => c.field === f)?.headerName ?? f).join(', ')}`
            extra.push({ id: 'group-by', label: groupLabel, onDelete: () => setGroupConfig(null) })
        }
        return [...filterItems, ...extra]
    }, [filters, hideNulls, groupConfig, columns, describeFilter, setFilter, setHideNulls])

    const activeFilterCount = activeFilterItems.length

    if (!activeState) return null

    return (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch', flex: 1, minHeight: 0 }}>
            <Paper
                elevation={0}
                sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    overflow: 'hidden',
                    minHeight: 0,
                }}
            >
                {/* ── Шапка с метриками ─────────────────────────────────── */}
                <Box
                    sx={{
                        flexShrink: 0,
                        px: 2,
                        py: 1.5,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        flexWrap: 'wrap',
                    }}
                >
                    <Typography variant="body2" color="text.secondary">
                        {groupConfig && groupConfig.groupByFields.length > 0
                            ? <>Групп: <b>{displayRows.length}</b> (из {filteredRows.length} строк)</>
                            : <>Строк: <b>{displayRows.length}</b>{displayRows.length !== rows.length && <span> (из {rows.length})</span>}</>
                        }
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        · Столбцов видно: <b>{agColDefs.length}</b> из <b>{columns.length}</b>
                    </Typography>
                    {groupConfig && groupConfig.groupByFields.length > 0 && (
                        <Chip label={`GROUP BY: ${groupConfig.groupByFields.length} / AGG: ${groupConfig.aggregates.length}`} size="small" color="secondary" variant="outlined" sx={{ cursor: 'default' }} />
                    )}
                    {activeFilterCount > 0 && (
                        <Chip
                            label={`${activeFilterCount} фильтр${activeFilterCount === 1 ? '' : activeFilterCount < 5 ? 'а' : 'ов'}`}
                            size="small"
                            color="warning"
                            variant="outlined"
                            onClick={(e) => setFilterPopoverAnchor(e.currentTarget)}
                            sx={{ cursor: 'pointer' }}
                        />
                    )}
                    {processingHistory.length > 0 && (
                        <Chip
                            label={`${processingHistory.length} обработк${processingHistory.length === 1 ? 'а' : processingHistory.length < 5 ? 'и' : 'ок'}`}
                            size="small"
                            color="primary"
                            variant="outlined"
                            onClick={(e) => setProcPopoverAnchor(e.currentTarget)}
                            sx={{ cursor: 'pointer' }}
                        />
                    )}
                </Box>

                <FilterSummaryBar
                    items={activeFilterItems}
                    onClearAll={() => { clearAllFilters(); setHideNulls(false) }}
                />

                {/* ── Попап: активные фильтры ───────────────────────────── */}
                <Popover
                    open={Boolean(filterPopoverAnchor)}
                    anchorEl={filterPopoverAnchor}
                    onClose={() => setFilterPopoverAnchor(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                    PaperProps={{ sx: { mt: 0.5, minWidth: 280, maxWidth: 380, borderRadius: 2 } }}
                >
                    <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle2" fontWeight={700}>Активные фильтры</Typography>
                        <Button size="small" variant="text" onClick={() => { setFilterPopoverAnchor(null); setFilterDialogOpen(true) }} sx={{ fontSize: '0.72rem', minWidth: 0, px: 1 }}>
                            + Добавить
                        </Button>
                    </Box>
                    <List dense disablePadding sx={{ pb: 1 }}>
                        {hideNulls && (
                            <ListItem sx={{ px: 2, py: 0.25 }} secondaryAction={
                                <Tooltip title="Удалить фильтр">
                                    <IconButton size="small" color="error" sx={{ p: 0.25 }} onClick={() => setHideNulls(false)}>
                                        <DeleteIcon sx={{ fontSize: 13 }} />
                                    </IconButton>
                                </Tooltip>
                            }>
                                <ListItemText primary="Скрыть строки с NULL" primaryTypographyProps={{ variant: 'body2', sx: { pr: 4, fontSize: '0.8rem' } }} />
                            </ListItem>
                        )}
                        {Object.entries(filters).map(([field, f]) => (
                            <ListItem key={field} sx={{ px: 2, py: 0.25 }} secondaryAction={
                                <Box sx={{ display: 'flex', gap: 0.25 }}>
                                    <Tooltip title="Редактировать фильтры">
                                        <IconButton size="small" sx={{ p: 0.25 }} onClick={() => { setFilterPopoverAnchor(null); setFilterDialogOpen(true) }}>
                                            <EditIcon sx={{ fontSize: 13 }} />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Удалить фильтр">
                                        <IconButton size="small" color="error" sx={{ p: 0.25 }} onClick={() => setFilter(field, null)}>
                                            <DeleteIcon sx={{ fontSize: 13 }} />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            }>
                                <ListItemText
                                    primary={describeFilter(field, f)}
                                    primaryTypographyProps={{ variant: 'body2', sx: { pr: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' } }}
                                />
                            </ListItem>
                        ))}
                    </List>
                </Popover>

                {/* ── Попап: применённые обработки ─────────────────────── */}
                <Popover
                    open={Boolean(procPopoverAnchor)}
                    anchorEl={procPopoverAnchor}
                    onClose={() => setProcPopoverAnchor(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                    PaperProps={{ sx: { mt: 0.5, minWidth: 320, maxWidth: 480, borderRadius: 2 } }}
                >
                    <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
                        <Typography variant="subtitle2" fontWeight={700}>Применённые обработки</Typography>
                    </Box>
                    <List dense disablePadding sx={{ pb: 1 }}>
                        {processingHistory.map((entry, idx) => {
                            const fieldEntries = getProcFieldEntries(entry)
                            return (
                                <Box key={entry.id}>
                                    {idx > 0 && <Divider sx={{ mx: 2, my: 0.5 }} />}
                                    {/* Заголовок операции */}
                                    <ListItem sx={{ px: 2, py: 0.5 }} secondaryAction={
                                        <Box sx={{ display: 'flex', gap: 0.25 }}>
                                            <Tooltip title="Изменить">
                                                <IconButton size="small" sx={{ p: 0.25 }} onClick={() => handleEditEntry(entry)}>
                                                    <EditIcon sx={{ fontSize: 13 }} />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Удалить шаг">
                                                <IconButton size="small" color="error" sx={{ p: 0.25 }} onClick={() => removeProcessingStep(entry.id)}>
                                                    <DeleteIcon sx={{ fontSize: 13 }} />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    }>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pr: 7 }}>
                                            <Box sx={{ color: `${PROC_COLOR[entry.type]}.main`, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                                {PROC_ICON[entry.type]}
                                            </Box>
                                            <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.82rem' }}>
                                                {PROC_TYPE_LABEL[entry.type] ?? entry.type}
                                            </Typography>
                                        </Box>
                                    </ListItem>
                                    {/* Строки field → метод */}
                                    {fieldEntries.length > 0 && (
                                        <Box sx={{ pl: 4, pr: 2, pb: 0.25 }}>
                                            {fieldEntries.map(({ field, method }) => (
                                                <Box key={field} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.15 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: '0.72rem', flexShrink: 0 }}>
                                                        {field}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.68rem' }}>→</Typography>
                                                    <Typography variant="caption" sx={{ fontSize: '0.72rem', color: `${PROC_COLOR[entry.type]}.main` }}>
                                                        {method}
                                                    </Typography>
                                                    {entry.type === 'encode' && (
                                                        <Tooltip
                                                            title={getEncodeFieldHint(entry.config[field] as Record<string, unknown>)}
                                                            placement="right"
                                                            arrow
                                                        >
                                                            <InfoOutlinedIcon sx={{ fontSize: 12, color: 'text.disabled', cursor: 'help', flexShrink: 0 }} />
                                                        </Tooltip>
                                                    )}
                                                </Box>
                                            ))}
                                        </Box>
                                    )}
                                    {/* Для timeseries / window_split — показываем label как раньше */}
                                    {fieldEntries.length === 0 && (
                                        <Box sx={{ pl: 4, pr: 2, pb: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>
                                                {entry.label}
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>
                            )
                        })}
                    </List>
                </Popover>

                {/* ── AG Grid ───────────────────────────────────────────── */}
                <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
                    {isFiltering && (
                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(255,255,255,0.5)', zIndex: 10 }}>
                            <CircularProgress size={36} />
                        </Box>
                    )}
                    <AgGridReact
                        theme={gridTheme}
                        rowData={displayRows}
                        columnDefs={agColDefs}
                        defaultColDef={{
                            resizable: true,
                            sortable: false,
                            suppressMovable: false,
                            suppressHeaderMenuButton: true,
                            suppressHeaderFilterButton: true,
                            minWidth: 100,
                        }}
                        onFirstDataRendered={(e) => e.api.autoSizeAllColumns(false)}
                        getRowId={(params) => String(params.data.id)}
                        pagination
                        paginationPageSize={25}
                        paginationPageSizeSelector={[10, 25, 50, 100]}
                        suppressCellFocus
                        animateRows={false}
                        suppressColumnVirtualisation={false}
                        noRowsOverlayComponent={() => (
                            <Typography variant="body2" color="text.secondary">Нет данных</Typography>
                        )}
                    />
                </Box>
            </Paper>

            {/* ── Сайдбар ───────────────────────────────────────────────── */}
            <Stack spacing={0.5} sx={{ flexShrink: 0, width: 220, pb: 1, overflowY: 'auto', alignSelf: 'stretch' }}>

                {/* ─── Фильтрация ─────────────────────────────────────── */}
                <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                    <Box onClick={() => setFilterGroupOpen((v) => !v)} sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', bgcolor: 'grey.50', borderBottom: filterGroupOpen ? '1px solid' : 'none', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FilterListIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                            <Typography variant="body2" fontWeight={600} sx={{ userSelect: 'none' }}>Фильтрация</Typography>
                            {activeFilterCount > 0 && (
                                <Chip label={activeFilterCount} size="small" color="warning" sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }} />
                            )}
                        </Box>
                        {filterGroupOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </Box>
                    <Collapse in={filterGroupOpen}>
                        <Stack spacing={0.5} sx={{ p: 0.75 }}>
                            <Button variant="outlined" startIcon={<FilterListIcon />} onClick={() => setFilterDialogOpen(true)} size="small" fullWidth sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Настроить фильтры
                            </Button>
                            <Button variant="outlined" startIcon={<ViewColumnIcon />} onClick={() => setColDialogOpen(true)} size="small" fullWidth sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Настроить столбцы
                            </Button>
                            <Button
                                variant={hideNulls ? 'contained' : 'outlined'}
                                color={hideNulls ? 'warning' : 'inherit'}
                                startIcon={hideNulls ? <UndoIcon /> : <FilterAltOffIcon />}
                                onClick={() => setHideNulls(!hideNulls)}
                                size="small" fullWidth
                                sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}
                                disableElevation
                            >
                                {hideNulls ? 'Возврат' : 'Очистить NULL'}
                            </Button>
                        </Stack>
                    </Collapse>
                </Paper>

                {/* ─── Обработка ──────────────────────────────────────── */}
                <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                    <Box onClick={() => setProcGroupOpen((v) => !v)} sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', bgcolor: 'grey.50', borderBottom: procGroupOpen ? '1px solid' : 'none', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TuneIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                            <Typography variant="body2" fontWeight={600} sx={{ userSelect: 'none' }}>Обработка</Typography>
                            {processingHistory.length > 0 && (
                                <Chip label={processingHistory.length} size="small" color="primary" sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }} />
                            )}
                        </Box>
                        {procGroupOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </Box>
                    <Collapse in={procGroupOpen}>
                        <Stack spacing={0.5} sx={{ p: 0.75 }}>
                            {activeState?.profileStatus === 'failed' && (
                                <Typography variant="caption" color="error" sx={{ display: 'block', pb: 0.25, wordBreak: 'break-word' }}>
                                    {activeState.profileError ?? 'Ошибка обработки файла на сервере'}
                                </Typography>
                            )}
                            {activeState?.profileJobId && !processingReady && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', pb: 0.25 }}>
                                    Ожидание загрузки на сервер...
                                </Typography>
                            )}
                            <Button variant="outlined" color="warning" startIcon={<AutoFixHighIcon />} onClick={() => setImputeOpen(true)} size="small" fullWidth disabled={!processingReady} sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Заполнить NULL
                            </Button>
                            <Button variant="outlined" color="info" startIcon={<TuneIcon />} onClick={() => setScaleOpen(true)} size="small" fullWidth disabled={!processingReady} sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Масштабировать
                            </Button>
                            <Button variant="outlined" color="secondary" startIcon={<CategoryIcon />} onClick={() => setEncodeOpen(true)} size="small" fullWidth disabled={!processingReady} sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Кодировать
                            </Button>
                            <Button variant="outlined" color="error" startIcon={<QueryStatsIcon />} onClick={() => setOutlierOpen(true)} size="small" fullWidth disabled={!processingReady} sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Удалить выбросы
                            </Button>
                        </Stack>
                    </Collapse>
                </Paper>

                {/* ─── Временные ряды ─────────────────────────────────── */}
                <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                    <Box onClick={() => setTsGroupOpen((v) => !v)} sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', bgcolor: 'grey.50', borderBottom: tsGroupOpen ? '1px solid' : 'none', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TimelineIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                            <Typography variant="body2" fontWeight={600} sx={{ userSelect: 'none' }}>Временные ряды</Typography>
                            {tsCount > 0 && (
                                <Chip label={tsCount} size="small" color="primary" sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }} />
                            )}
                        </Box>
                        {tsGroupOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </Box>
                    <Collapse in={tsGroupOpen}>
                        <Stack spacing={0.5} sx={{ p: 0.75 }}>
                            <Button variant="outlined" color="primary" startIcon={<BuildIcon />} onClick={() => { setTsSection('preprocess'); setTimeseriesOpen(true) }} size="small" fullWidth disabled={!processingReady} sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Предобработка
                            </Button>
                            <Button variant="outlined" color="primary" startIcon={<AutoFixHighIcon />} onClick={() => { setTsSection('fill'); setTimeseriesOpen(true) }} size="small" fullWidth disabled={!processingReady} sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Заполнение пропусков
                            </Button>
                        </Stack>
                    </Collapse>
                </Paper>

                {/* ─── Агрегация ──────────────────────────────────────── */}
                <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                    <Box onClick={() => setAggGroupOpen((v) => !v)} sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', bgcolor: 'grey.50', borderBottom: aggGroupOpen ? '1px solid' : 'none', borderColor: 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FunctionsIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                            <Typography variant="body2" fontWeight={600} sx={{ userSelect: 'none' }}>Агрегация</Typography>
                            {groupConfig && groupConfig.groupByFields.length > 0 && (
                                <Chip label="GROUP BY" size="small" color="secondary" sx={{ height: 18, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }} />
                            )}
                        </Box>
                        {aggGroupOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </Box>
                    <Collapse in={aggGroupOpen}>
                        <Stack spacing={0.5} sx={{ p: 0.75 }}>
                            {/* GROUP BY */}
                            {groupConfig && groupConfig.groupByFields.length > 0 && (
                                <Box sx={{ p: 0.75, bgcolor: 'secondary.50', borderRadius: 1, border: '1px solid', borderColor: 'secondary.200' }}>
                                    <Typography variant="caption" color="secondary.main" fontWeight={600} display="block">GROUP BY:</Typography>
                                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                                        {groupConfig.groupByFields.map(f => columns.find(c => c.field === f)?.headerName ?? f).join(', ')}
                                    </Typography>
                                    {groupConfig.aggregates.length > 0 && (
                                        <>
                                            <Typography variant="caption" color="secondary.main" fontWeight={600} display="block">Агрегации:</Typography>
                                            {groupConfig.aggregates.map(({ field, func }) => (
                                                <Typography key={field} variant="caption" color="text.secondary" display="block">
                                                    {func}({columns.find(c => c.field === field)?.headerName ?? field})
                                                </Typography>
                                            ))}
                                        </>
                                    )}
                                </Box>
                            )}
                            <Button variant="outlined" color="secondary" startIcon={<FunctionsIcon />} onClick={handleOpenGroupDialog} size="small" fullWidth sx={{ justifyContent: 'flex-start', whiteSpace: 'nowrap' }}>
                                Настроить GROUP BY
                            </Button>
                            {groupConfig && groupConfig.groupByFields.length > 0 && (
                                <Button size="small" variant="text" color="error" onClick={() => setGroupConfig(null)} sx={{ justifyContent: 'flex-start', fontSize: '0.72rem', py: 0, minHeight: 0 }}>
                                    Сбросить GROUP BY
                                </Button>
                            )}
                        </Stack>
                    </Collapse>
                </Paper>

                <Divider sx={{ my: 0.5 }} />

                <Tooltip title="Удалить таблицу" placement="left">
                    <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => removeTable(activeState.id)} sx={{ whiteSpace: 'nowrap', minWidth: 180, justifyContent: 'flex-start' }}>
                        Удалить
                    </Button>
                </Tooltip>
            </Stack>

            {/* ── Диалоги ───────────────────────────────────────────────── */}
            <ColumnManagerDialog open={colDialogOpen} onClose={() => setColDialogOpen(false)} />
            <FilterManagerDialog open={filterDialogOpen} onClose={() => setFilterDialogOpen(false)} />
            {imputeOpen && <ImputeDialog onClose={() => handleProcessingDialogClose(setImputeOpen)} />}
            {scaleOpen && <ScaleDialog onClose={() => handleProcessingDialogClose(setScaleOpen)} />}
            {encodeOpen && <EncodeDialog onClose={() => handleProcessingDialogClose(setEncodeOpen)} />}
            {outlierOpen && <OutlierDialog onClose={() => handleProcessingDialogClose(setOutlierOpen)} />}
            {timeseriesOpen && <TimeSeriesDialog defaultSection={tsSection} onClose={() => handleProcessingDialogClose(setTimeseriesOpen)} />}

            {/* ── Диалог GROUP BY ───────────────────────────────────────── */}
            <Dialog open={groupDialogOpen} onClose={() => setGroupDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>Настройка GROUP BY и агрегаций</DialogTitle>
                <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Box>
                        <Typography variant="subtitle2" fontWeight={700} gutterBottom>Группировать по (GROUP BY):</Typography>
                        <FormGroup row sx={{ gap: 0.5 }}>
                            {columns.filter(c => c.visible).map(col => (
                                <FormControlLabel
                                    key={col.field}
                                    control={
                                        <Checkbox
                                            size="small"
                                            checked={dlgGroupByFields.includes(col.field)}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    setDlgGroupByFields(f => [...f, col.field])
                                                    setDlgAggregates(a => a.filter(x => x.field !== col.field))
                                                } else {
                                                    setDlgGroupByFields(f => f.filter(x => x !== col.field))
                                                }
                                            }}
                                        />
                                    }
                                    label={<Typography variant="body2">{col.headerName}</Typography>}
                                />
                            ))}
                        </FormGroup>
                    </Box>
                    {dlgGroupByFields.length > 0 && (
                        <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Typography variant="subtitle2" fontWeight={700}>Агрегационные функции:</Typography>
                                <Typography variant="caption" color="text.secondary">(«Кол-во строк» добавляется автоматически)</Typography>
                            </Box>
                            <Stack spacing={0.75}>
                                {columns.filter(c => c.visible && !dlgGroupByFields.includes(c.field)).map(col => {
                                    const existing = dlgAggregates.find(a => a.field === col.field)
                                    return (
                                        <Box key={col.field} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                            <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {col.headerName}
                                            </Typography>
                                            <Select size="small" value={existing?.func ?? ''} displayEmpty sx={{ minWidth: 110, fontSize: '0.8rem' }}
                                                onChange={(e) => {
                                                    const func = e.target.value as string
                                                    if (!func) {
                                                        setDlgAggregates(a => a.filter(x => x.field !== col.field))
                                                    } else {
                                                        setDlgAggregates(a => [...a.filter(x => x.field !== col.field), { field: col.field, func: func as AggFunc }])
                                                    }
                                                }}
                                            >
                                                <MenuItem value=""><em>— нет —</em></MenuItem>
                                                <MenuItem value="COUNT">COUNT</MenuItem>
                                                <MenuItem value="SUM">SUM</MenuItem>
                                                <MenuItem value="AVG">AVG</MenuItem>
                                                <MenuItem value="MIN">MIN</MenuItem>
                                                <MenuItem value="MAX">MAX</MenuItem>
                                            </Select>
                                        </Box>
                                    )
                                })}
                            </Stack>
                        </Box>
                    )}
                    {dlgGroupByFields.length === 0 && (
                        <Typography variant="body2" color="text.secondary">Выберите хотя бы один столбец для GROUP BY.</Typography>
                    )}
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 1.5 }}>
                    <Button onClick={() => setGroupDialogOpen(false)} size="small">Отмена</Button>
                    {groupConfig && (
                        <Button onClick={() => { setGroupConfig(null); setGroupDialogOpen(false) }} size="small" color="error">Сбросить</Button>
                    )}
                    <Button onClick={handleApplyGroup} variant="contained" size="small" disabled={dlgGroupByFields.length === 0}>
                        Применить
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}
