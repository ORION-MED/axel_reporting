import { useEffect, useState, useMemo, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Box,
    Typography,
    Alert,
    IconButton,
    Chip,
    Stack,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Skeleton,
    Divider,
    Menu,
    MenuItem,
    TextField,
    Select,
    FormControl,
    InputLabel,
    Button,
    Checkbox,
    FormControlLabel,
    Collapse,
    Tooltip,
    Popover,
    LinearProgress,
    type SelectChangeEvent,
} from '@mui/material'
import { DataGrid, type GridColDef, type GridSortModel } from '@mui/x-data-grid'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import TableChartIcon from '@mui/icons-material/TableChart'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import SortIcon from '@mui/icons-material/Sort'
import FilterListIcon from '@mui/icons-material/FilterList'
import DeleteIcon from '@mui/icons-material/Delete'
import AddIcon from '@mui/icons-material/Add'
import JoinFullIcon from '@mui/icons-material/JoinFull'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import DownloadIcon from '@mui/icons-material/Download'
import PaletteIcon from '@mui/icons-material/Palette'
import WorkIcon from '@mui/icons-material/Work'
import ViewColumnIcon from '@mui/icons-material/ViewColumn'
import axios from 'axios'
import { formatFilterSummaryLabel, generateId, idbStorage, lsStorage, useNotify } from '@shared/lib'
import { groupIcd9Values, isIcdCategoryColumn } from '@shared/lib'
import { FILTER_KEY_DUPLICATE_SEPARATOR } from '@shared/lib'
import type { ColumnConfig, ColumnFilter, ParsedRow, TableState } from '@shared/types'
import { FilterSummaryBar, type FilterChipItem } from '@shared/ui/FilterSummaryBar'
import { DbFilterDialog } from './DbFilterDialog'


interface TableInfo {
    name: string
    comment: string | null
    estimated_rows: number
}

interface ColumnInfo {
    column_name: string
    data_type: string
    is_nullable: string
}

type ColType = 'number' | 'date' | 'datetime' | 'time' | 'string'

interface FilterDef {
    column: string
    operator: string
    value?: string
    valueFrom?: string
    valueTo?: string
    colType: ColType
}



// Функция pgTypeToColType



function pgTypeToColType(pgType: string): ColType {
    const t = pgType.toLowerCase()
    if (
        [
            'integer',
            'bigint',
            'smallint',
            'numeric',
            'real',
            'double precision',
            'decimal',
            'int4',
            'int8',
            'int2',
            'float4',
            'float8',
        ].includes(t)
    )
        return 'number'
    if (t === 'date') return 'date'
    if (
        [
            'timestamp without time zone',
            'timestamp with time zone',
            'timestamp',
            'timestamptz',
        ].includes(t)
    )
        return 'datetime'
    if (
        ['time without time zone', 'time with time zone', 'time', 'timetz'].includes(
            t,
        )
    )
        return 'time'
    return 'string'
}

const NUMBER_OPS = [
    { value: '>', label: '> (больше)' },
    { value: '<', label: '< (меньше)' },
    { value: '==', label: '== (равно)' },
    { value: '<=', label: '<= (не больше)' },
    { value: '>=', label: '>= (не меньше)' },
    { value: 'between', label: 'от A до B' },
    { value: 'isNull', label: 'IS NULL' },
    { value: 'isNotNull', label: 'IS NOT NULL' },
]

const DATE_OPS = [
    { value: '>', label: '> (позже)' },
    { value: '<', label: '< (раньше)' },
    { value: '==', label: '== (равно)' },
    { value: 'between', label: 'от A до B' },
    { value: 'isNull', label: 'IS NULL' },
    { value: 'isNotNull', label: 'IS NOT NULL' },
]

const STRING_OPS = [
    { value: 'ilike', label: 'ILIKE (содержит)' },
    { value: '==', label: '== (точное совпадение)' },
    { value: 'categoryEquals', label: 'Категория (включить)' },
    { value: 'categoryNotEquals', label: 'Категория (исключить)' },
    { value: 'isNull', label: 'IS NULL' },
    { value: 'isNotNull', label: 'IS NOT NULL' },
]

// Функция opsForType

function opsForType(t: ColType) {
    if (t === 'number') return NUMBER_OPS
    if (t === 'date' || t === 'datetime' || t === 'time') return DATE_OPS
    return STRING_OPS
}

// Функция needsNoValue

const needsNoValue = (op: string) => op === 'isNull' || op === 'isNotNull'
// Функция needsBetween
const needsBetween = (op: string) => op === 'between'

// Функция inputTypeFor

function inputTypeFor(c: ColType): string {
    if (c === 'date') return 'date'
    if (c === 'datetime') return 'datetime-local'
    if (c === 'time') return 'time'
    if (c === 'number') return 'number'
    return 'text'
}

// Функция filterLabel

function filterLabel(f: FilterDef): string {
    return formatFilterSummaryLabel({
        field: f.column,
        operator: f.operator,
        value: f.value,
        valueFrom: f.valueFrom,
        valueTo: f.valueTo,
    })
}

function mapFilterDefToColumnFilter(filter: FilterDef): ColumnFilter | null {
    if (filter.colType === 'number') {
        if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
            return { type: 'number', operator: filter.operator }
        }
        if (filter.operator === 'between') {
            const from = Number(filter.valueFrom)
            const to = Number(filter.valueTo)
            if (Number.isNaN(from) || Number.isNaN(to)) return null
            return { type: 'number', operator: 'between', valueFrom: from, valueTo: to }
        }
        if (
            filter.operator === '>' ||
            filter.operator === '<' ||
            filter.operator === '==' ||
            filter.operator === '<=' ||
            filter.operator === '>='
        ) {
            const value = Number(filter.value)
            if (Number.isNaN(value)) return null
            return { type: 'number', operator: filter.operator, value }
        }
        return null
    }

    if (filter.colType === 'date' || filter.colType === 'datetime' || filter.colType === 'time') {
        const type = filter.colType
        if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
            return { type, operator: filter.operator }
        }
        if (filter.operator === 'between') {
            if (!filter.valueFrom || !filter.valueTo) return null
            return {
                type,
                operator: 'between',
                valueFrom: filter.valueFrom,
                valueTo: filter.valueTo,
            }
        }
        if (filter.operator === '>' || filter.operator === '<' || filter.operator === '==') {
            if (!filter.value) return null
            return { type, operator: filter.operator, value: filter.value }
        }
        return null
    }

    if (filter.operator === 'isNull' || filter.operator === 'isNotNull') {
        return { type: 'string', operator: filter.operator }
    }
    if (
        filter.operator === 'ilike' ||
        filter.operator === '==' ||
        filter.operator === 'categoryEquals' ||
        filter.operator === 'categoryNotEquals'
    ) {
        if (!filter.value) return null
        return { type: 'string', operator: filter.operator, value: filter.value }
    }
    return null
}

function mapFiltersForWorkspace(filters: FilterDef[]): Record<string, ColumnFilter> {
    const mappedFilters: Record<string, ColumnFilter> = {}
    const duplicateCounter: Record<string, number> = {}

    for (const f of filters) {
        const converted = mapFilterDefToColumnFilter(f)
        if (!converted) continue

        if (!mappedFilters[f.column]) {
            mappedFilters[f.column] = converted
        } else {
            const nextIndex = (duplicateCounter[f.column] ?? 0) + 1
            duplicateCounter[f.column] = nextIndex
            mappedFilters[`${f.column}${FILTER_KEY_DUPLICATE_SEPARATOR}${nextIndex}`] = converted
        }
    }

    return mappedFilters
}

function buildColumnConfigs(
    rows: Record<string, unknown>[],
    typeMap: Record<string, ColType>,
): ColumnConfig[] {
    if (!rows.length) return []
    return Object.keys(rows[0])
        .filter((key) => key !== '__id')
        .map((key) => ({
            field: key,
            headerName: key,
            type: typeMap[key] ?? 'string',
            visible: true,
        }))
}

function ensureRowsHaveId(rows: Record<string, unknown>[]): ParsedRow[] {
    return rows.map((row, index) => {
        const existingId = row.id
        if (typeof existingId === 'string' || typeof existingId === 'number') {
            return row as ParsedRow
        }
        return {
            id: index + 1,
            ...row,
        } as ParsedRow
    })
}


const TABLE_COLORS = [
    { bg: '#e3f2fd', header: '#bbdefb', border: '#90caf9', text: '#1565c0' },
    { bg: '#fce4ec', header: '#f8bbd0', border: '#f48fb1', text: '#c62828' },
    { bg: '#e8f5e9', header: '#c8e6c9', border: '#a5d6a7', text: '#2e7d32' },
    { bg: '#fff3e0', header: '#ffe0b2', border: '#ffcc80', text: '#e65100' },
    { bg: '#f3e5f5', header: '#e1bee7', border: '#ce93d8', text: '#7b1fa2' },
    { bg: '#e0f7fa', header: '#b2ebf2', border: '#80deea', text: '#00695c' },
    { bg: '#fffde7', header: '#fff9c4', border: '#fff176', text: '#f57f17' },
    { bg: '#efebe9', header: '#d7ccc8', border: '#bcaaa4', text: '#4e342e' },
]


// Функция downloadBlob


function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
}

function parseFileNameFromDisposition(contentDisposition?: string | null): string | null {
    if (!contentDisposition) return null
    const starMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)
    if (starMatch?.[1]) {
        try {
            return decodeURIComponent(starMatch[1])
        } catch {
            return starMatch[1]
        }
    }
    const match = /filename="?([^";]+)"?/i.exec(contentDisposition)
    return match?.[1] ?? null
}

function getValidAnchorEl(el: HTMLElement | null | undefined): HTMLElement | null {
    if (!el) return null
    const doc = el.ownerDocument
    if (!doc?.body?.contains(el)) return null
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return null
    return el
}

async function extractAxiosErrorMessage(err: any, fallback: string): Promise<string> {
    const status = err?.response?.status
    if (status === 413) {
        return (
            'Экспорт слишком большой. Сузьте фильтры, уменьшите объём данных. '
        )
    }

    const responseData = err?.response?.data

    if (responseData instanceof Blob) {
        try {
            const text = await responseData.text()
            if (text) {
                try {
                    const parsed = JSON.parse(text)
                    if (parsed?.message) return String(parsed.message)
                } catch {
                    if (text.trim().length > 0) return text.trim()
                }
            }
        } catch {
            // ignore blob parsing errors
        }
    }

    if (typeof responseData?.message === 'string' && responseData.message.trim()) {
        return responseData.message
    }

    if (typeof err?.message === 'string' && err.message.trim()) {
        return err.message
    }

    return fallback
}

const SIDEBAR_W = 280
const PAGE_SIZE = 20
const EXPORT_BATCH_SIZE = 2000
const MAX_WORK_TRANSFER_ROWS = 100000
const SINGLE_GROUP_SENTINEL = '__single_group__'
const JOIN_GROUP_SENTINEL = '__join_group__'


const DATABASE_CONFIG = {
    eicu: { title: 'eICU-CRD', apiBasePath: '/api/eicu' },
    mimic: { title: 'MIMIC-IV 3.1', apiBasePath: '/api/mimic' },
    picdb: { title: 'PICDB', apiBasePath: '/api/picdb' },
} as const

export type ClinicalDatabaseKey = keyof typeof DATABASE_CONFIG

interface DatabaseExplorerPageProps {
    databaseKey: ClinicalDatabaseKey
}

export const DatabaseExplorerPage = ({ databaseKey }: DatabaseExplorerPageProps) => {
    const navigate = useNavigate()
    const { title, apiBasePath } = DATABASE_CONFIG[databaseKey]


    const [viewMode, setViewMode] = useState<'single' | 'join'>('single')

    const [tables, setTables] = useState<TableInfo[]>([])
    const [tablesLoading, setTablesLoading] = useState(true)
    const [tablesError, setTablesError] = useState<string | null>(null)


    const [selected, setSelected] = useState<string | null>(null)
    const [tableColumns, setTableColumns] = useState<ColumnInfo[]>([])
    const [rows, setRows] = useState<Record<string, unknown>[]>([])
    const [total, setTotal] = useState(0)
    const [gridCols, setGridCols] = useState<GridColDef[]>([])
    const [dataLoading, setDataLoading] = useState(false)
    const [dataError, setDataError] = useState<string | null>(null)
    const [singleTaskProgress, setSingleTaskProgress] = useState<number | null>(null)
    const [singleTaskLabel, setSingleTaskLabel] = useState('')
    const [paginationModel, setPaginationModel] = useState({
        page: 0,
        pageSize: PAGE_SIZE,
    })

    const [sortModel, setSortModel] = useState<GridSortModel>([])

    const [filters, setFilters] = useState<FilterDef[]>([])
    const [draftCol, setDraftCol] = useState('')
    const [draftOp, setDraftOp] = useState('')
    const [draftVal, setDraftVal] = useState('')
    const [draftCategoryVals, setDraftCategoryVals] = useState<string[]>([])
    const [draftFrom, setDraftFrom] = useState('')
    const [draftTo, setDraftTo] = useState('')

    const [categoryValues, setCategoryValues] = useState<string[]>([])
    const [categoryLoading, setCategoryLoading] = useState(false)
    const [expandedCategoryGroups, setExpandedCategoryGroups] = useState<Record<string, boolean>>({})
    const [singleCategorySelectOpen, setSingleCategorySelectOpen] = useState(false)

    const [filterDialogOpen, setFilterDialogOpen] = useState(false)
    const [joinFilterDialogOpen, setJoinFilterDialogOpen] = useState(false)
    const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
    const [menuMode, setMenuMode] = useState<'main' | 'sort' | 'filter'>('main')
    const [downloadAnchor, setDownloadAnchor] = useState<null | HTMLElement>(null)
    const [joinDownloadAnchor, setJoinDownloadAnchor] = useState<null | HTMLElement>(null)


    const [joinSelected, setJoinSelected] = useState<string[]>([])
    const [joinColumnsMap, setJoinColumnsMap] = useState<Record<string, ColumnInfo[]>>({})
    const [joinPickedCols, setJoinPickedCols] = useState<Record<string, string[]>>({})
    const [joinExpanded, setJoinExpanded] = useState<Record<string, boolean>>({})
    const [joinRows, setJoinRows] = useState<Record<string, unknown>[]>([])
    const [joinTotal, setJoinTotal] = useState(0)
    const [joinGridCols, setJoinGridCols] = useState<GridColDef[]>([])
    const [joinColumnVisibilityModel, setJoinColumnVisibilityModel] = useState<Record<string, boolean>>({})
    const [joinLoading, setJoinLoading] = useState(false)
    const [joinError, setJoinError] = useState<string | null>(null)
    const [joinTaskProgress, setJoinTaskProgress] = useState<number | null>(null)
    const [joinTaskLabel, setJoinTaskLabel] = useState('')
    const [joinPagination, setJoinPagination] = useState({ page: 0, pageSize: PAGE_SIZE })
    const [joinSortModel, setJoinSortModel] = useState<GridSortModel>([])
    const [firstStayOnly, setFirstStayOnly] = useState(false)
    const [joinTableColors, setJoinTableColors] = useState<Record<string, number>>({})
    const [colorAnchor, setColorAnchor] = useState<{ el: HTMLElement; table: string } | null>(null)

    const [joinFilters, setJoinFilters] = useState<FilterDef[]>([])
    const [joinMenuAnchor, setJoinMenuAnchor] = useState<null | HTMLElement>(null)
    const [joinMenuMode, setJoinMenuMode] = useState<'main' | 'filter' | 'columns'>('main')

    const { showError } = useNotify()
    useEffect(() => { if (dataError) showError(dataError) }, [dataError, showError])
    useEffect(() => { if (joinError) showError(joinError) }, [joinError, showError])

    const safeMenuAnchor = useMemo(() => getValidAnchorEl(menuAnchor), [menuAnchor])
    const safeDownloadAnchor = useMemo(() => getValidAnchorEl(downloadAnchor), [downloadAnchor])
    const safeJoinMenuAnchor = useMemo(() => getValidAnchorEl(joinMenuAnchor), [joinMenuAnchor])
    const safeJoinDownloadAnchor = useMemo(() => getValidAnchorEl(joinDownloadAnchor), [joinDownloadAnchor])
    const safeColorAnchorEl = useMemo(() => getValidAnchorEl(colorAnchor?.el ?? null), [colorAnchor])
    const [joinDraftCol, setJoinDraftCol] = useState('')
    const [joinDraftOp, setJoinDraftOp] = useState('')
    const [joinDraftVal, setJoinDraftVal] = useState('')
    const [joinDraftCategoryVals, setJoinDraftCategoryVals] = useState<string[]>([])
    const [joinDraftFrom, setJoinDraftFrom] = useState('')
    const [joinDraftTo, setJoinDraftTo] = useState('')
    const [joinCategoryValues, setJoinCategoryValues] = useState<string[]>([])
    const [joinCategoryLoading, setJoinCategoryLoading] = useState(false)
    const [expandedJoinCategoryGroups, setExpandedJoinCategoryGroups] = useState<Record<string, boolean>>({})
    const [joinCategorySelectOpen, setJoinCategorySelectOpen] = useState(false)

    // Функция draftColInfo

    const draftColInfo = tableColumns.find((c) => c.column_name === draftCol)
    const draftColType: ColType = draftColInfo
        ? pgTypeToColType(draftColInfo.data_type)
        : 'string'
    const draftOps = opsForType(draftColType)

    // JOIN: плоский список всех колонок из всех выбранных таблиц в формате "tableName.col"
    const joinAllColumns = useMemo(() =>
        joinSelected.flatMap((name) =>
            (joinColumnsMap[name] || []).map((c) => ({
                column_name: `${name}.${c.column_name}`,
                data_type: c.data_type,
                _tableName: name,
                _colName: c.column_name,
            }))
        ),
        [joinSelected, joinColumnsMap],
    )
    const joinDraftColInfo = joinAllColumns.find((c) => c.column_name === joinDraftCol)
    const joinDraftColType: ColType = joinDraftColInfo ? pgTypeToColType(joinDraftColInfo.data_type) : 'string'
    const joinDraftOps = opsForType(joinDraftColType)
    const joinIType = inputTypeFor(joinDraftColType)
    const joinNeedsShrink = joinIType !== 'text' && joinIType !== 'number'

    useEffect(() => {
        setDraftOp('')
        setDraftVal('')
        setDraftCategoryVals([])
        setDraftFrom('')
        setDraftTo('')
    }, [draftCol])
    useEffect(() => {
        setDraftVal('')
        setDraftCategoryVals([])
        setDraftFrom('')
        setDraftTo('')
        setCategoryValues([])
        setExpandedCategoryGroups({})
        setSingleCategorySelectOpen(false)

        if ((draftOp === 'categoryEquals' || draftOp === 'categoryNotEquals') && draftCol && selected) {
            setCategoryLoading(true)
            axios
                .get<string[]>(
                    `${apiBasePath}/tables/${selected}/columns/${draftCol}/distinct`,
                )
                .then(({ data }) =>
                    setCategoryValues(
                        (Array.isArray(data) ? data : [])
                            .map((v) => String(v ?? '').trim())
                            .filter((v) => v.length > 0),
                    ),
                )
                .catch(() => setCategoryValues([]))
                .finally(() => setCategoryLoading(false))
        }
    }, [apiBasePath, draftOp, draftCol, selected])

    useEffect(() => {
        setJoinDraftOp('')
        setJoinDraftVal('')
        setJoinDraftCategoryVals([])
        setJoinDraftFrom('')
        setJoinDraftTo('')
    }, [joinDraftCol])
    useEffect(() => {
        setJoinDraftVal('')
        setJoinDraftCategoryVals([])
        setJoinDraftFrom('')
        setJoinDraftTo('')
        setJoinCategoryValues([])
        setExpandedJoinCategoryGroups({})
        setJoinCategorySelectOpen(false)
        if ((joinDraftOp === 'categoryEquals' || joinDraftOp === 'categoryNotEquals') && joinDraftCol) {
            const dotIdx = joinDraftCol.indexOf('.')
            if (dotIdx > 0) {
                const tName = joinDraftCol.substring(0, dotIdx)
                const cName = joinDraftCol.substring(dotIdx + 1)
                setJoinCategoryLoading(true)
                axios
                    .get<string[]>(`${apiBasePath}/tables/${tName}/columns/${cName}/distinct`)
                    .then(({ data }) =>
                        setJoinCategoryValues(
                            (Array.isArray(data) ? data : [])
                                .map((v) => String(v ?? '').trim())
                                .filter((v) => v.length > 0),
                        ),
                    )
                    .catch(() => setJoinCategoryValues([]))
                    .finally(() => setJoinCategoryLoading(false))
            }
        }
    }, [apiBasePath, joinDraftOp, joinDraftCol])



    useEffect(() => {
        ; (async () => {
            setTablesLoading(true)
            setTablesError(null)
            try {
                const { data } = await axios.get<TableInfo[]>(`${apiBasePath}/tables`)
                setTables(data)
            } catch (err: any) {
                setTablesError(
                    err?.response?.data?.message ||
                    err.message ||
                    'Ошибка загрузки таблиц',
                )
            } finally {
                setTablesLoading(false)
            }
        })()
    }, [apiBasePath])

    useEffect(() => {
        if (!selected) return
            ; (async () => {
                try {
                    const { data } = await axios.get<ColumnInfo[]>(
                        `${apiBasePath}/tables/${selected}/columns`,
                    )
                    setTableColumns(data)
                } catch {

                }
            })()
    }, [apiBasePath, selected])

    // Возвращает data

    const fetchData = useCallback(async () => {
        if (!selected) return
        setDataLoading(true)
        setDataError(null)
        try {
            const params: Record<string, string | number> = {
                limit: paginationModel.pageSize,
                offset: paginationModel.page * paginationModel.pageSize,
            }
            if (sortModel.length > 0) {
                params.sortField = sortModel[0].field
                params.sortDir = sortModel[0].sort ?? 'asc'
            }
            if (filters.length > 0) {
                params.filters = JSON.stringify(filters)
            }
            if (firstStayOnly) {
                params.firstStayOnly = 'true'
            }
            const { data } = await axios.get(
                `${apiBasePath}/tables/${selected}/data`,
                { params },
            )
            setTotal(data.total)
            setRows(data.rows)
            if (data.rows.length > 0) {
                setGridCols(
                    Object.keys(data.rows[0]).map((key) => ({
                        field: key,
                        headerName: key,
                        minWidth: 130,
                        flex: 1,
                        sortable: true,
                    })),
                )
            }
        } catch (err: any) {
            setDataError(
                err?.response?.data?.message ||
                err.message ||
                'Ошибка загрузки данных',
            )
        } finally {
            setDataLoading(false)
        }
    }, [apiBasePath, selected, paginationModel, sortModel, filters, firstStayOnly])

    useEffect(() => {
        fetchData()
    }, [fetchData])



    // Обрабатывает событие/действие select



    const handleSelect = (name: string) => {
        if (name === selected) return
        setSelected(name)
        setGridCols([])
        setRows([])
        setTotal(0)
        setSortModel([])
        setFilters([])
        setDataError(null)
        setPaginationModel({ page: 0, pageSize: PAGE_SIZE })
        setFirstStayOnly(false)
        setDraftCol('')
        setDraftOp('')
        setDraftVal('')
        setDraftCategoryVals([])
        setDraftFrom('')
        setDraftTo('')
        setCategoryValues([])
        setExpandedCategoryGroups({})
        setSingleCategorySelectOpen(false)
    }

    const loadJoinColumns = useCallback(async (tableName: string): Promise<ColumnInfo[]> => {
        const cached = joinColumnsMap[tableName]
        if (cached) {
            return cached
        }
        try {
            const { data } = await axios.get<ColumnInfo[]>(`${apiBasePath}/tables/${tableName}/columns`)
            setJoinColumnsMap((prev) => ({ ...prev, [tableName]: data }))
            return data
        } catch {
            return []
        }
    }, [apiBasePath, joinColumnsMap])

    const selectJoinTableWithAllColumns = useCallback(async (tableName: string) => {
        setJoinSelected((prev) => (prev.includes(tableName) ? prev : [...prev, tableName]))
        const cols = await loadJoinColumns(tableName)
        setJoinPickedCols((prev) => ({
            ...prev,
            [tableName]: cols.map((c) => c.column_name),
        }))
    }, [loadJoinColumns])

    const unselectJoinTable = useCallback((tableName: string) => {
        setJoinSelected((prev) => prev.filter((n) => n !== tableName))
        setJoinPickedCols((prev) => {
            const copy = { ...prev }
            delete copy[tableName]
            return copy
        })
        setJoinExpanded((prev) => {
            const copy = { ...prev }
            delete copy[tableName]
            return copy
        })
    }, [])

    const handleJoinCheckboxChange = useCallback(async (tableName: string, checked: boolean) => {
        if (!checked) {
            unselectJoinTable(tableName)
            return
        }
        await selectJoinTableWithAllColumns(tableName)
    }, [selectJoinTableWithAllColumns, unselectJoinTable])

    const handleJoinRowClick = useCallback(async (tableName: string) => {
        const isSelected = joinSelected.includes(tableName)
        if (!isSelected) {
            await selectJoinTableWithAllColumns(tableName)
            setJoinExpanded((prev) => ({ ...prev, [tableName]: true }))
            return
        }
        setJoinExpanded((prev) => ({
            ...prev,
            [tableName]: !prev[tableName],
        }))
    }, [joinSelected, selectJoinTableWithAllColumns])

    // Функция toggleJoinColumn

    const toggleJoinColumn = (table: string, col: string) => {
        setJoinPickedCols((prev) => {
            const current = prev[table] || []
            if (current.includes(col)) {
                return { ...prev, [table]: current.filter((c) => c !== col) }
            }
            return { ...prev, [table]: [...current, col] }
        })
    }

    // Функция toggleAllColumnsForTable

    const toggleAllColumnsForTable = (table: string) => {
        const cols = joinColumnsMap[table] || []
        const picked = joinPickedCols[table] || []
        if (picked.length === cols.length) {
            setJoinPickedCols((prev) => ({ ...prev, [table]: [] }))
        } else {
            setJoinPickedCols((prev) => ({
                ...prev,
                [table]: cols.map((c) => c.column_name),
            }))
        }
    }

    // Функция switchToJoinMode

    const switchToJoinMode = () => {
        setViewMode('join')
        setSelected(null)
        setGridCols([])
        setRows([])
        setTotal(0)
        setJoinRows([])
        setJoinTotal(0)
        setJoinGridCols([])
        setJoinColumnVisibilityModel({})
        setJoinError(null)
    }

    // Функция switchToSingleMode

    const switchToSingleMode = () => {
        setViewMode('single')
        setJoinSelected([])
        setJoinPickedCols({})
        setJoinExpanded({})
        setJoinRows([])
        setJoinTotal(0)
        setJoinGridCols([])
        setJoinColumnVisibilityModel({})
        setJoinError(null)
    }

    // Возвращает join data

    const fetchJoinData = useCallback(async () => {
        if (joinSelected.length < 2) return

        // Функция tablesDef

        const tablesDef = joinSelected.map((name) => ({
            name,
            columns: joinPickedCols[name] || [],
        }))
        // Проверяет any cols
        const hasAnyCols = tablesDef.some((t) => t.columns.length > 0)
        if (!hasAnyCols) return

        setJoinLoading(true)
        setJoinError(null)
        try {
            const body: any = {
                tables: tablesDef,
                limit: joinPagination.pageSize,
                offset: joinPagination.page * joinPagination.pageSize,
            }
            if (joinSortModel.length > 0) {
                body.sortField = joinSortModel[0].field
                body.sortDir = joinSortModel[0].sort ?? 'asc'
            }
            if (firstStayOnly) {
                body.firstStayOnly = true
            }
            if (joinFilters.length > 0) {
                body.filters = joinFilters
            }
            const { data } = await axios.post(`${apiBasePath}/join`, body)
            setJoinTotal(data.total)

            const rowsWithId: Record<string, unknown>[] = data.rows.map(
                (row: Record<string, unknown>, index: number) => {
                    const stayKey = Object.keys(row).find((k) =>
                        k.toLowerCase().endsWith('patientunitstayid'),
                    )
                    const stayVal = stayKey ? row[stayKey] : undefined
                    const base =
                        (typeof stayVal === 'string' || typeof stayVal === 'number'
                            ? stayVal
                            : 'row') + '_' + index
                    return { __id: base, ...row }
                },
            )
            setJoinRows(rowsWithId)

            if (rowsWithId.length > 0) {

                const tableIndexMap = new Map<string, number>()
                joinSelected.forEach((name, idx) => tableIndexMap.set(name, idx))

                const nextJoinGridCols = Object.keys(rowsWithId[0])
                    .filter((key) => key !== '__id')
                    .map((key) => {

                        const dotIdx = key.indexOf('.')
                        const tableName = dotIdx > 0 ? key.substring(0, dotIdx) : ''
                        const colName = dotIdx > 0 ? key.substring(dotIdx + 1) : key
                        const tIdx = tableIndexMap.get(tableName) ?? 0
                        const colorClass = `join-col-t${tIdx}`

                        return {
                            field: key,
                            headerName: colName,
                            description: `${tableName}.${colName}`,
                            minWidth: 140,
                            flex: 1,
                            sortable: true,
                            headerClassName: colorClass,
                            cellClassName: colorClass,
                        }
                    })

                setJoinGridCols(nextJoinGridCols)
                setJoinColumnVisibilityModel((prev) => {
                    const next: Record<string, boolean> = {}
                    nextJoinGridCols.forEach((col) => {
                        next[col.field] = prev[col.field] ?? true
                    })
                    return next
                })
            }
        } catch (err: any) {
            setJoinError(
                err?.response?.data?.message || err.message || 'Ошибка JOIN запроса',
            )
        } finally {
            setJoinLoading(false)
        }
    }, [apiBasePath, joinSelected, joinPickedCols, joinPagination, joinSortModel, firstStayOnly, joinFilters])


    useEffect(() => {
        if (viewMode === 'join' && joinRows.length > 0) {
            fetchJoinData()
        }

    }, [fetchJoinData, joinRows.length, viewMode])

    // Функция openMenu

    const openMenu = (e: React.MouseEvent<HTMLElement>) => {
        setMenuAnchor(e.currentTarget)
        setMenuMode('main')
    }
    // Функция closeMenu
    const closeMenu = () => {
        setMenuAnchor(null)
        setMenuMode('main')
    }

    const fetchAllSingleRows = useCallback(async (onProgress?: (v: number) => void) => {
        if (!selected) return [] as Record<string, unknown>[]

        const allRows: Record<string, unknown>[] = []
        let offset = 0
        let totalRows = 0

        onProgress?.(0)

        while (offset === 0 || offset < totalRows) {
            const params: Record<string, string | number> = {
                limit: EXPORT_BATCH_SIZE,
                offset,
                includeTotal: offset === 0 ? 'true' : 'false',
            }
            if (sortModel.length > 0) {
                params.sortField = sortModel[0].field
                params.sortDir = sortModel[0].sort ?? 'asc'
            }
            if (filters.length > 0) {
                params.filters = JSON.stringify(filters)
            }
            if (firstStayOnly) {
                params.firstStayOnly = 'true'
            }

            const { data } = await axios.get(`${apiBasePath}/tables/${selected}/data`, {
                params,
            })

            if (offset === 0) {
                totalRows = Number(data.total) || 0
            }
            const batchRows: Record<string, unknown>[] = Array.isArray(data.rows)
                ? data.rows
                : []

            allRows.push(...batchRows)
            offset += batchRows.length

            if (totalRows > 0) {
                const pct = Math.min(100, Math.round((allRows.length / totalRows) * 100))
                onProgress?.(pct)
            } else if (batchRows.length === 0) {
                onProgress?.(100)
            }

            const reachedEndByTotal = totalRows > 0 && allRows.length >= totalRows
            const reachedEndByBatch = batchRows.length < EXPORT_BATCH_SIZE
            if (reachedEndByTotal || reachedEndByBatch) break
        }

        onProgress?.(100)

        return allRows
    }, [apiBasePath, selected, sortModel, filters, firstStayOnly])

    const fetchAllJoinRows = useCallback(async (onProgress?: (v: number) => void) => {
        if (joinSelected.length < 2) return [] as Record<string, unknown>[]

        const tablesDef = joinSelected.map((name) => ({
            name,
            columns: joinPickedCols[name] || [],
        }))
        const hasAnyCols = tablesDef.some((t) => t.columns.length > 0)
        if (!hasAnyCols) return []

        const allRows: Record<string, unknown>[] = []
        let offset = 0
        let totalRows = 0

        onProgress?.(0)

        while (offset === 0 || offset < totalRows) {
            const body: any = {
                tables: tablesDef,
                limit: EXPORT_BATCH_SIZE,
                offset,
                includeTotal: offset === 0,
            }
            if (joinSortModel.length > 0) {
                body.sortField = joinSortModel[0].field
                body.sortDir = joinSortModel[0].sort ?? 'asc'
            }
            if (firstStayOnly) {
                body.firstStayOnly = true
            }
            if (joinFilters.length > 0) {
                body.filters = joinFilters
            }

            const { data } = await axios.post(`${apiBasePath}/join`, body)
            if (offset === 0) {
                totalRows = Number(data.total) || 0
            }
            const batchRows: Record<string, unknown>[] = Array.isArray(data.rows)
                ? data.rows
                : []

            allRows.push(...batchRows)
            offset += batchRows.length

            if (totalRows > 0) {
                const pct = Math.min(100, Math.round((allRows.length / totalRows) * 100))
                onProgress?.(pct)
            } else if (batchRows.length === 0) {
                onProgress?.(100)
            }

            const reachedEndByTotal = totalRows > 0 && allRows.length >= totalRows
            const reachedEndByBatch = batchRows.length < EXPORT_BATCH_SIZE
            if (reachedEndByTotal || reachedEndByBatch) break
        }

        onProgress?.(100)

        return allRows
    }, [apiBasePath, joinSelected, joinPickedCols, joinSortModel, firstStayOnly, joinFilters])

    const estimateSingleTotalRows = useCallback(async (): Promise<number | null> => {
        if (!selected) return null

        const params: Record<string, string | number> = {
            limit: 1,
            offset: 0,
            includeTotal: 'true',
        }
        if (sortModel.length > 0) {
            params.sortField = sortModel[0].field
            params.sortDir = sortModel[0].sort ?? 'asc'
        }
        if (filters.length > 0) {
            params.filters = JSON.stringify(filters)
        }
        if (firstStayOnly) {
            params.firstStayOnly = 'true'
        }

        const { data } = await axios.get(`${apiBasePath}/tables/${selected}/data`, { params })
        return Number(data.total) || 0
    }, [apiBasePath, selected, sortModel, filters, firstStayOnly])

    const estimateJoinTotalRows = useCallback(async (): Promise<number | null> => {
        if (joinSelected.length < 2) return null

        const tablesDef = joinSelected.map((name) => ({
            name,
            columns: joinPickedCols[name] || [],
        }))
        const hasAnyCols = tablesDef.some((t) => t.columns.length > 0)
        if (!hasAnyCols) return null

        const body: any = {
            tables: tablesDef,
            limit: 1,
            offset: 0,
            includeTotal: true,
        }
        if (joinSortModel.length > 0) {
            body.sortField = joinSortModel[0].field
            body.sortDir = joinSortModel[0].sort ?? 'asc'
        }
        if (firstStayOnly) {
            body.firstStayOnly = true
        }
        if (joinFilters.length > 0) {
            body.filters = joinFilters
        }

        const { data } = await axios.post(`${apiBasePath}/join`, body)
        return Number(data.total) || 0
    }, [apiBasePath, joinSelected, joinPickedCols, joinSortModel, firstStayOnly, joinFilters])

    const appendSnapshotToWorkspace = useCallback(
        async (
            fileName: string,
            rows: Record<string, unknown>[],
            columns: ColumnConfig[],
            filterDefs: FilterDef[],
        ) => {
            const existingStates = lsStorage.getTableStates()
            const id = generateId()
            const mappedFilters = mapFiltersForWorkspace(filterDefs)

            const tableState: TableState = {
                id,
                fileName,
                columns,
                filters: mappedFilters,
                uploadedAt: new Date().toISOString(),
            }

            await idbStorage.setRows(id, ensureRowsHaveId(rows))
            lsStorage.setTableStates([...existingStates, tableState])
            lsStorage.setActiveTableId(id)
            navigate('/work')
        },
        [navigate],
    )

    const transferSingleSnapshotToWork = useCallback(async () => {
        if (!selected) return
        setDataLoading(true)
        setDataError(null)
        setSingleTaskLabel('Перенос снимка в рабочее место')
        setSingleTaskProgress(0)
        try {
            const totalRows = await estimateSingleTotalRows()
            if (totalRows !== null && totalRows > MAX_WORK_TRANSFER_ROWS) {
                setDataError(
                    `Снимок слишком большой (${totalRows.toLocaleString()} строк). ` +
                    `Для переноса в рабочее место максимум ${MAX_WORK_TRANSFER_ROWS.toLocaleString()} строк. ` +
                    'Используйте серверный экспорт CSV/Excel.',
                )
                return
            }

            const allRows = await fetchAllSingleRows(setSingleTaskProgress)

            const singleTypeMap: Record<string, ColType> = {}
            tableColumns.forEach((c) => {
                singleTypeMap[c.column_name] = pgTypeToColType(c.data_type)
            })
            const columns = buildColumnConfigs(allRows, singleTypeMap)

            await appendSnapshotToWorkspace(selected, allRows, columns, filters)
        } catch (err: any) {
            setDataError(
                err?.response?.data?.message || err.message || 'Ошибка переноса снимка в рабочее место',
            )
        } finally {
            setDataLoading(false)
            setSingleTaskProgress(null)
        }
    }, [
        selected,
        estimateSingleTotalRows,
        fetchAllSingleRows,
        tableColumns,
        appendSnapshotToWorkspace,
        filters,
    ])

    const transferJoinSnapshotToWork = useCallback(async () => {
        if (joinSelected.length < 2) return
        setJoinLoading(true)
        setJoinError(null)
        setJoinTaskLabel('Перенос JOIN снимка в рабочее место')
        setJoinTaskProgress(0)
        try {
            const totalRows = await estimateJoinTotalRows()
            if (totalRows !== null && totalRows > MAX_WORK_TRANSFER_ROWS) {
                setJoinError(
                    `JOIN-снимок слишком большой (${totalRows.toLocaleString()} строк). ` +
                    `Для переноса в рабочее место максимум ${MAX_WORK_TRANSFER_ROWS.toLocaleString()} строк. ` +
                    'Используйте серверный экспорт CSV/Excel.',
                )
                return
            }

            const allRows = await fetchAllJoinRows(setJoinTaskProgress)

            const joinTypeMap: Record<string, ColType> = {}
            joinSelected.forEach((tableName) => {
                const cols = joinColumnsMap[tableName] || []
                cols.forEach((c) => {
                    joinTypeMap[`${tableName}.${c.column_name}`] = pgTypeToColType(c.data_type)
                })
            })
            const columns = buildColumnConfigs(allRows, joinTypeMap)
            const fileName = `join_${joinSelected.join('_')}`

            await appendSnapshotToWorkspace(fileName, allRows, columns, joinFilters)
        } catch (err: any) {
            setJoinError(
                err?.response?.data?.message || err.message || 'Ошибка переноса JOIN снимка в рабочее место',
            )
        } finally {
            setJoinLoading(false)
            setJoinTaskProgress(null)
        }
    }, [
        joinSelected,
        estimateJoinTotalRows,
        fetchAllJoinRows,
        joinColumnsMap,
        appendSnapshotToWorkspace,
        joinFilters,
    ])

    const exportSingleTable = useCallback(
        async (format: 'csv' | 'excel') => {
            if (!selected) return
            setDownloadAnchor(null)
            setDataLoading(true)
            setDataError(null)
            setSingleTaskLabel(format === 'csv' ? 'Экспорт CSV' : 'Экспорт Excel')
            setSingleTaskProgress(15)

            try {
                const params: Record<string, string> = {
                    format: format === 'csv' ? 'csv' : 'xlsx',
                }
                if (sortModel.length > 0) {
                    params.sortField = sortModel[0].field
                    params.sortDir = sortModel[0].sort ?? 'asc'
                }
                if (filters.length > 0) {
                    params.filters = JSON.stringify(filters)
                }
                if (firstStayOnly) {
                    params.firstStayOnly = 'true'
                }

                const response = await axios.get(`${apiBasePath}/tables/${selected}/export`, {
                    params,
                    responseType: 'blob',
                })
                setSingleTaskProgress(100)
                const fallback = `${selected}.${format === 'csv' ? 'csv' : 'xlsx'}`
                const fileName = parseFileNameFromDisposition(
                    response.headers['content-disposition'],
                ) || fallback
                downloadBlob(response.data as Blob, fileName)
            } catch (err: any) {
                setDataError(await extractAxiosErrorMessage(err, 'Ошибка экспорта данных'))
            } finally {
                setDataLoading(false)
                setSingleTaskProgress(null)
            }
        },
        [apiBasePath, selected, sortModel, filters, firstStayOnly],
    )

    const exportJoinTable = useCallback(
        async (format: 'csv' | 'excel') => {
            if (joinSelected.length < 2) return
            setJoinDownloadAnchor(null)
            setJoinLoading(true)
            setJoinError(null)
            setJoinTaskLabel(format === 'csv' ? 'Экспорт JOIN CSV' : 'Экспорт JOIN Excel')
            setJoinTaskProgress(15)

            try {
                const body: any = {
                    tables: joinSelected.map((name) => ({
                        name,
                        columns: joinPickedCols[name] || [],
                    })),
                    format: format === 'csv' ? 'csv' : 'xlsx',
                }
                if (joinSortModel.length > 0) {
                    body.sortField = joinSortModel[0].field
                    body.sortDir = joinSortModel[0].sort ?? 'asc'
                }
                if (firstStayOnly) {
                    body.firstStayOnly = true
                }
                if (joinFilters.length > 0) {
                    body.filters = joinFilters
                }

                const response = await axios.post(`${apiBasePath}/join/export`, body, {
                    responseType: 'blob',
                })
                setJoinTaskProgress(100)
                const fallback = `join_${joinSelected.join('_')}.${format === 'csv' ? 'csv' : 'xlsx'}`
                const fileName = parseFileNameFromDisposition(
                    response.headers['content-disposition'],
                ) || fallback
                downloadBlob(response.data as Blob, fileName)
            } catch (err: any) {
                setJoinError(await extractAxiosErrorMessage(err, 'Ошибка экспорта JOIN данных'))
            } finally {
                setJoinLoading(false)
                setJoinTaskProgress(null)
            }
        },
        [apiBasePath, joinSelected, joinPickedCols, joinSortModel, firstStayOnly, joinFilters],
    )

    // Функция addFilter

    const addFilter = () => {
        if (!draftCol || !draftOp) return
        if (!needsNoValue(draftOp)) {
            if (needsBetween(draftOp)) {
                if (!draftFrom || !draftTo) return
            } else if (draftOp === 'categoryEquals' || draftOp === 'categoryNotEquals') {
                if (draftCategoryVals.length === 0) return
            } else if (!draftVal) return
        }
        if (draftOp === 'categoryEquals' || draftOp === 'categoryNotEquals') {
            const fs: FilterDef[] = draftCategoryVals.map((value) => ({
                column: draftCol,
                operator: draftOp,
                colType: draftColType,
                value,
            }))
            setFilters((prev) => [...prev, ...fs])
        } else {
            const f: FilterDef = {
                column: draftCol,
                operator: draftOp,
                colType: draftColType,
                ...(needsBetween(draftOp)
                    ? { valueFrom: draftFrom, valueTo: draftTo }
                    : needsNoValue(draftOp)
                        ? {}
                        : { value: draftVal }),
            }
            setFilters((prev) => [...prev, f])
        }
        setDraftCol('')
        setDraftOp('')
        setDraftVal('')
        setDraftCategoryVals([])
        setDraftFrom('')
        setDraftTo('')
        setPaginationModel({ page: 0, pageSize: PAGE_SIZE })
    }

    // Удаляет filter

    const removeFilter = (idx: number) => {
        setFilters((prev) => prev.filter((_, i) => i !== idx))
        setPaginationModel({ page: 0, pageSize: PAGE_SIZE })
    }

    const addJoinFilter = () => {
        if (!joinDraftCol || !joinDraftOp) return
        if (!needsNoValue(joinDraftOp)) {
            if (needsBetween(joinDraftOp)) {
                if (!joinDraftFrom || !joinDraftTo) return
            } else if (joinDraftOp === 'categoryEquals' || joinDraftOp === 'categoryNotEquals') {
                if (joinDraftCategoryVals.length === 0) return
            } else if (!joinDraftVal) return
        }
        if (joinDraftOp === 'categoryEquals' || joinDraftOp === 'categoryNotEquals') {
            const fs: FilterDef[] = joinDraftCategoryVals.map((value) => ({
                column: joinDraftCol,
                operator: joinDraftOp,
                colType: joinDraftColType,
                value,
            }))
            setJoinFilters((prev) => [...prev, ...fs])
        } else {
            const f: FilterDef = {
                column: joinDraftCol,
                operator: joinDraftOp,
                colType: joinDraftColType,
                ...(needsBetween(joinDraftOp)
                    ? { valueFrom: joinDraftFrom, valueTo: joinDraftTo }
                    : needsNoValue(joinDraftOp)
                        ? {}
                        : { value: joinDraftVal }),
            }
            setJoinFilters((prev) => [...prev, f])
        }
        setJoinDraftCol('')
        setJoinDraftOp('')
        setJoinDraftVal('')
        setJoinDraftCategoryVals([])
        setJoinDraftFrom('')
        setJoinDraftTo('')
        setJoinPagination({ page: 0, pageSize: PAGE_SIZE })
    }

    const removeJoinFilter = (idx: number) => {
        setJoinFilters((prev) => prev.filter((_, i) => i !== idx))
        setJoinPagination({ page: 0, pageSize: PAGE_SIZE })
    }

    const sortableFields = useMemo(
        () => gridCols.map((c) => c.field),
        [gridCols],
    )

    const iType = inputTypeFor(draftColType)
    const needsShrink = iType !== 'text' && iType !== 'number'



    const joinHasEnoughTables = joinSelected.length >= 2
    const joinHasAnyCols = joinSelected.some(
        (t) => (joinPickedCols[t] || []).length > 0,
    )

    const shouldGroupSingleCategories = useMemo(
        () => isIcdCategoryColumn(draftCol),
        [draftCol],
    )

    const groupedCategoryValues = useMemo(
        () => (shouldGroupSingleCategories ? groupIcd9Values(categoryValues) : []),
        [categoryValues, shouldGroupSingleCategories],
    )

    const shouldGroupJoinCategories = useMemo(
        () => isIcdCategoryColumn(joinDraftCol),
        [joinDraftCol],
    )

    const groupedJoinCategoryValues = useMemo(
        () => (shouldGroupJoinCategories ? groupIcd9Values(joinCategoryValues) : []),
        [joinCategoryValues, shouldGroupJoinCategories],
    )

    const handleSingleCategoryMultiChange = useCallback((values: string[]) => {
        const groupKey = values.find((v) => v.startsWith(SINGLE_GROUP_SENTINEL))
        if (groupKey) {
            const key = groupKey.slice(SINGLE_GROUP_SENTINEL.length)
            setExpandedCategoryGroups((prev) => ({ ...prev, [key]: !prev[key] }))
            return
        }
        setDraftCategoryVals(values.filter((v) => !v.startsWith(SINGLE_GROUP_SENTINEL)))
    }, [])

    const handleJoinCategoryMultiChange = useCallback((values: string[]) => {
        const groupKey = values.find((v) => v.startsWith(JOIN_GROUP_SENTINEL))
        if (groupKey) {
            const key = groupKey.slice(JOIN_GROUP_SENTINEL.length)
            setExpandedJoinCategoryGroups((prev) => ({ ...prev, [key]: !prev[key] }))
            return
        }
        setJoinDraftCategoryVals(values.filter((v) => !v.startsWith(JOIN_GROUP_SENTINEL)))
    }, [])

    const toggleSingleGroupSelection = useCallback((groupKey: string) => {
        const group = groupedCategoryValues.find((g) => g.key === groupKey)
        if (!group) return
        const allSelected = group.values.every((v) => draftCategoryVals.includes(v))
        if (allSelected) {
            setDraftCategoryVals((prev) => prev.filter((v) => !group.values.includes(v)))
        } else {
            setDraftCategoryVals((prev) => Array.from(new Set([...prev, ...group.values])))
        }
    }, [groupedCategoryValues, draftCategoryVals])

    const toggleJoinGroupSelection = useCallback((groupKey: string) => {
        const group = groupedJoinCategoryValues.find((g) => g.key === groupKey)
        if (!group) return
        const allSelected = group.values.every((v) => joinDraftCategoryVals.includes(v))
        if (allSelected) {
            setJoinDraftCategoryVals((prev) => prev.filter((v) => !group.values.includes(v)))
        } else {
            setJoinDraftCategoryVals((prev) => Array.from(new Set([...prev, ...group.values])))
        }
    }, [groupedJoinCategoryValues, joinDraftCategoryVals])

    const selectAllSingleCategories = useCallback(() => {
        setDraftCategoryVals(categoryValues)
    }, [categoryValues])

    const clearSingleCategories = useCallback(() => {
        setDraftCategoryVals([])
    }, [])

    const selectAllJoinCategories = useCallback(() => {
        setJoinDraftCategoryVals(joinCategoryValues)
    }, [joinCategoryValues])

    const clearJoinCategories = useCallback(() => {
        setJoinDraftCategoryVals([])
    }, [])

    const totalPickedCols = joinSelected.reduce(
        (sum, t) => sum + (joinPickedCols[t] || []).length,
        0,
    )

    const visibleJoinColsCount = useMemo(
        () => joinGridCols.filter((c) => joinColumnVisibilityModel[c.field] !== false).length,
        [joinGridCols, joinColumnVisibilityModel],
    )

    const setAllJoinColumnsVisibility = useCallback((visible: boolean) => {
        setJoinColumnVisibilityModel(
            Object.fromEntries(joinGridCols.map((c) => [c.field, visible])),
        )
    }, [joinGridCols])

    const joinColorSx = useMemo(() => {
        const styles: Record<string, any> = {}
        joinSelected.forEach((name, idx) => {
            const colorIdx = joinTableColors[name] ?? idx
            const c = TABLE_COLORS[colorIdx % TABLE_COLORS.length]
            styles[`& .join-col-t${idx}.MuiDataGrid-columnHeader`] = {
                bgcolor: c.header,
                color: c.text,
                borderRight: `2px solid ${c.border}`,
            }
            styles[`& .join-col-t${idx}.MuiDataGrid-cell`] = {
                bgcolor: c.bg,
                borderRight: `1px solid ${c.border}`,
            }
        })
        return styles
    }, [joinSelected, joinTableColors])

    const disableFirstStayOnly = useCallback(() => {
        setFirstStayOnly(false)
        setPaginationModel((p) => ({ ...p, page: 0 }))
        setJoinPagination((p) => ({ ...p, page: 0 }))
    }, [])

    const singleFilterItems = useMemo<FilterChipItem[]>(() => {
        const items = filters.map((f, i) => ({
            id: `single-filter-${i}`,
            label: filterLabel(f),
            onDelete: () => removeFilter(i),
        }))

        if (firstStayOnly) {
            items.push({
                id: 'single-first-stay',
                label: 'Первое ICU пребывание',
                onDelete: disableFirstStayOnly,
            })
        }

        return items
    }, [filters, firstStayOnly, disableFirstStayOnly])

    const joinFilterItems = useMemo<FilterChipItem[]>(() => {
        const items = joinFilters.map((f, i) => ({
            id: `join-filter-${i}`,
            label: filterLabel(f),
            onDelete: () => removeJoinFilter(i),
        }))

        if (firstStayOnly) {
            items.push({
                id: 'join-first-stay',
                label: 'Первое ICU пребывание',
                onDelete: disableFirstStayOnly,
            })
        }

        return items
    }, [joinFilters, firstStayOnly, disableFirstStayOnly])

    const clearSingleFilterItems = useCallback(() => {
        setFilters([])
        disableFirstStayOnly()
    }, [disableFirstStayOnly])

    const clearJoinFilterItems = useCallback(() => {
        setJoinFilters([])
        disableFirstStayOnly()
    }, [disableFirstStayOnly])

    return (
        <>
        <Box
            sx={{
                display: 'flex',
                height: '100%',
                overflow: 'hidden',
            }}
        >
            { }
            <Box
                sx={{
                    width: SIDEBAR_W,
                    flexShrink: 0,
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: 'background.paper',
                }}
            >
                <Box
                    sx={{
                        px: 1.5,
                        py: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                    }}
                >
                    <IconButton size="small" onClick={() => navigate('/database')}>
                        <ArrowBackIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="subtitle1" fontWeight={700} noWrap>
                        {title}
                    </Typography>
                    {!tablesLoading && (
                        <Chip
                            label={tables.length}
                            size="small"
                            color="primary"
                            variant="outlined"
                            sx={{ ml: 'auto' }}
                        />
                    )}
                </Box>

                { }

                <Box sx={{ px: 1, pb: 1, display: 'flex', gap: 0.5 }}>
                    <Button
                        size="small"
                        variant={viewMode === 'single' ? 'contained' : 'outlined'}
                        onClick={switchToSingleMode}
                        disableElevation
                        sx={{ width: '50%', textTransform: 'none', fontSize: '0.75rem' }}
                    >
                        Таблица
                    </Button>
                    <Button
                        size="small"
                        variant={viewMode === 'join' ? 'contained' : 'outlined'}
                        onClick={switchToJoinMode}
                        startIcon={<JoinFullIcon sx={{ fontSize: 16 }} />}
                        disableElevation
                        sx={{ width: '50%', textTransform: 'none', fontSize: '0.75rem' }}
                    >
                        JOIN
                    </Button>
                </Box>

                <Divider />

                { }
                {viewMode === 'join' && (
                    <Box sx={{ px: 1.5, py: 1, bgcolor: 'primary.50' }}>
                        <Typography variant="caption" color="primary.main" fontWeight={600}>
                            Выберите 2+ таблицы и нужные столбцы
                        </Typography>
                        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                            JOIN по patientunitstayid
                        </Typography>
                        {joinSelected.length > 0 && (
                            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                                <Chip
                                    label={`${joinSelected.length} табл.`}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.65rem' }}
                                />
                                <Chip
                                    label={`${totalPickedCols} стол.`}
                                    size="small"
                                    color="secondary"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.65rem' }}
                                />
                            </Stack>
                        )}
                    </Box>
                )}

                <Box sx={{ flex: 1, overflow: 'auto' }}>
                    {tablesError && (
                        <Alert severity="error" sx={{ m: 1 }}>
                            {tablesError}
                        </Alert>
                    )}
                    {tablesLoading ? (
                        <Stack spacing={0.5} sx={{ p: 1 }}>
                            {Array.from({ length: 12 }).map((_, i) => (
                                <Skeleton key={i} variant="rounded" height={36} />
                            ))}
                        </Stack>
                    ) : (
                        <List dense disablePadding>
                            {tables.map((t) => {
                                const isJoinSelected = joinSelected.includes(t.name)
                                const isExpanded = joinExpanded[t.name] ?? false
                                const tableCols = joinColumnsMap[t.name] || []
                                const pickedCols = joinPickedCols[t.name] || []
                                const joinIdx = joinSelected.indexOf(t.name)
                                const tColorIdx = joinTableColors[t.name] ?? joinIdx
                                const tColor = isJoinSelected ? TABLE_COLORS[tColorIdx % TABLE_COLORS.length] : null

                                return (
                                    <Box key={t.name}>
                                        <ListItemButton
                                            selected={
                                                viewMode === 'single'
                                                    ? t.name === selected
                                                    : isJoinSelected
                                            }
                                            onClick={() => {
                                                if (viewMode === 'join') {
                                                    void handleJoinRowClick(t.name)
                                                    return
                                                }
                                                handleSelect(t.name)
                                            }}
                                            sx={{
                                                borderRadius: 1,
                                                mx: 0.5,
                                                my: 0.25,
                                                '&.Mui-selected': {
                                                    bgcolor: (viewMode === 'join' && tColor) ? tColor.bg : 'primary.50',
                                                    color: (viewMode === 'join' && tColor) ? tColor.text : 'primary.main',
                                                    '&:hover': { bgcolor: (viewMode === 'join' && tColor) ? tColor.header : 'primary.100' },
                                                },
                                            }}
                                        >
                                            {viewMode === 'join' && (
                                                <Checkbox
                                                    size="small"
                                                    checked={isJoinSelected}
                                                    sx={{ p: 0.25, mr: 0.5 }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                                        void handleJoinCheckboxChange(
                                                            t.name,
                                                            e.target.checked,
                                                        )
                                                    }}
                                                />
                                            )}
                                            <ListItemIcon
                                                sx={{ minWidth: 30, color: 'inherit' }}
                                            >
                                                <TableChartIcon fontSize="small" />
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={t.name}
                                                primaryTypographyProps={{
                                                    fontSize: '0.813rem',
                                                    fontWeight:
                                                        (viewMode === 'single' && t.name === selected) ||
                                                            (viewMode === 'join' && isJoinSelected)
                                                            ? 600
                                                            : 400,
                                                    noWrap: true,
                                                }}
                                            />
                                            {viewMode === 'join' && isJoinSelected && pickedCols.length > 0 && (
                                                <Chip
                                                    label={pickedCols.length}
                                                    size="small"
                                                    color="secondary"
                                                    sx={{ height: 18, fontSize: '0.65rem', mr: 0.5 }}
                                                />
                                            )}
                                            {viewMode === 'join' && isJoinSelected && (
                                                <IconButton
                                                    size="small"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setJoinExpanded((prev) => ({
                                                            ...prev,
                                                            [t.name]: !prev[t.name],
                                                        }))
                                                    }}
                                                    sx={{ p: 0.25 }}
                                                >
                                                    {isExpanded ? (
                                                        <ExpandLessIcon sx={{ fontSize: 16 }} />
                                                    ) : (
                                                        <ExpandMoreIcon sx={{ fontSize: 16 }} />
                                                    )}
                                                </IconButton>
                                            )}
                                            {viewMode === 'single' && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.disabled"
                                                    sx={{
                                                        ml: 0.5,
                                                        flexShrink: 0,
                                                        fontSize: '0.7rem',
                                                    }}
                                                >
                                                    {Number(t.estimated_rows).toLocaleString()}
                                                </Typography>
                                            )}
                                        </ListItemButton>

                                        { }
                                        {viewMode === 'join' && isJoinSelected && (
                                            <Collapse in={isExpanded}>
                                                <Box sx={{ pl: 4, pr: 1, pb: 0.5 }}>
                                                    <Box
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            mb: 0.25,
                                                        }}
                                                    >
                                                        <Checkbox
                                                            size="small"
                                                            checked={
                                                                tableCols.length > 0 &&
                                                                pickedCols.length === tableCols.length
                                                            }
                                                            indeterminate={
                                                                pickedCols.length > 0 &&
                                                                pickedCols.length < tableCols.length
                                                            }
                                                            onChange={() => toggleAllColumnsForTable(t.name)}
                                                            sx={{ p: 0.25 }}
                                                        />
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ cursor: 'pointer' }}
                                                            onClick={() => toggleAllColumnsForTable(t.name)}
                                                        >
                                                            Все столбцы
                                                        </Typography>
                                                    </Box>
                                                    {tableCols.map((col) => (
                                                        <Box
                                                            key={col.column_name}
                                                            sx={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                            }}
                                                        >
                                                            <Checkbox
                                                                size="small"
                                                                checked={pickedCols.includes(col.column_name)}
                                                                onChange={() =>
                                                                    toggleJoinColumn(t.name, col.column_name)
                                                                }
                                                                sx={{ p: 0.25 }}
                                                            />
                                                            <Typography
                                                                variant="caption"
                                                                sx={{
                                                                    cursor: 'pointer',
                                                                    fontSize: '0.75rem',
                                                                }}
                                                                onClick={() =>
                                                                    toggleJoinColumn(t.name, col.column_name)
                                                                }
                                                            >
                                                                {col.column_name}
                                                            </Typography>
                                                            <Chip
                                                                label={pgTypeToColType(col.data_type)}
                                                                size="small"
                                                                sx={{
                                                                    ml: 0.5,
                                                                    height: 16,
                                                                    fontSize: '0.6rem',
                                                                }}
                                                                variant="outlined"
                                                            />
                                                        </Box>
                                                    ))}
                                                </Box>
                                            </Collapse>
                                        )}
                                    </Box>
                                )
                            })}
                        </List>
                    )}
                </Box>

                { }
                {
                    viewMode === 'join' && (
                        <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                            <Tooltip
                                title={
                                    !joinHasEnoughTables
                                        ? 'Выберите минимум 2 таблицы'
                                        : !joinHasAnyCols
                                            ? 'Выберите хотя бы один столбец'
                                            : 'Выполнить JOIN запрос'
                                }
                            >
                                <span>
                                    <Button
                                        variant="contained"
                                        fullWidth
                                        disableElevation
                                        disabled={!joinHasEnoughTables || !joinHasAnyCols}
                                        startIcon={<PlayArrowIcon />}
                                        onClick={() => {
                                            setJoinPagination({ page: 0, pageSize: PAGE_SIZE })
                                            fetchJoinData()
                                        }}
                                        sx={{ textTransform: 'none' }}
                                    >
                                        Выполнить JOIN
                                    </Button>
                                </span>
                            </Tooltip>
                        </Box>
                    )
                }
            </Box >

            { }
            < Box
                sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    overflow: 'hidden',
                }}
            >
                { }
                {
                    viewMode === 'join' ? (
                        joinRows.length === 0 && !joinLoading ? (
                            <Box
                                sx={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexDirection: 'column',
                                    gap: 1,
                                }}
                            >
                                <JoinFullIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                                <Typography variant="body1" color="text.secondary">
                                    {joinSelected.length < 2
                                        ? 'Выберите минимум 2 таблицы слева'
                                        : !joinHasAnyCols
                                            ? 'Раскройте таблицы и отметьте нужные столбцы'
                                            : 'Нажмите «Выполнить JOIN»'}
                                </Typography>
                                {joinError && (
                                    <Alert severity="error" sx={{ mt: 1, maxWidth: 500 }}>
                                        {joinError}
                                    </Alert>
                                )}
                            </Box>
                        ) : (
                            <>
                                { }
                                <Box
                                    sx={{
                                        px: 2,
                                        py: 1,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        bgcolor: 'background.paper',
                                    }}
                                >
                                    <JoinFullIcon color="primary" fontSize="small" />
                                    <Typography variant="subtitle1" fontWeight={600} sx={{ mr: 0.5 }}>
                                        Используются:
                                    </Typography>
                                    { }
                                    {joinSelected.map((name, idx) => {
                                        const colorIdx = joinTableColors[name] ?? idx
                                        const c = TABLE_COLORS[colorIdx % TABLE_COLORS.length]
                                        return (
                                            <Box key={name} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                                <Chip
                                                    label={name}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: c.header,
                                                        color: c.text,
                                                        fontWeight: 600,
                                                        fontSize: '0.75rem',
                                                        border: `1px solid ${c.border}`,
                                                    }}
                                                />
                                                <Tooltip title="Изменить цвет">
                                                    <IconButton
                                                        size="small"
                                                        sx={{ p: 0.25, color: c.text }}
                                                        onClick={(e) => setColorAnchor({ el: e.currentTarget, table: name })}
                                                    >
                                                        <PaletteIcon sx={{ fontSize: 14 }} />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        )
                                    })}
                                    {!joinLoading && (
                                        <Chip
                                            label={`${joinTotal.toLocaleString()} записей`}
                                            size="small"
                                            variant="outlined"
                                        />
                                    )}
                                    {joinFilters.length > 0 && (
                                        <Chip
                                            label={`${joinFilters.length} фильтр${joinFilters.length > 1 ? 'а' : ''}`}
                                            size="small"
                                            color="warning"
                                            variant="outlined"
                                            onDelete={() => {
                                                setJoinFilters([])
                                                setJoinPagination((p) => ({ ...p, page: 0 }))
                                            }}
                                        />
                                    )}
                                    <Box sx={{ flex: 1 }} />
                                    { }
                                    <Tooltip title="Фильтры JOIN">
                                        <IconButton
                                            size="small"
                                            onClick={(e) => { setJoinMenuAnchor(e.currentTarget); setJoinMenuMode('main') }}
                                            color={joinFilters.length > 0 || firstStayOnly ? 'warning' : 'default'}
                                        >
                                            <FilterListIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Menu
                                        anchorEl={safeJoinMenuAnchor}
                                        open={Boolean(safeJoinMenuAnchor)}
                                        onClose={() => { setJoinMenuAnchor(null); setJoinMenuMode('main') }}
                                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                                        sx={{ '& .MuiPaper-root': { minWidth: 320, maxWidth: 420 } }}
                                    >
                                        {joinMenuMode === 'main' && [
                                            <MenuItem key="columns" onClick={() => setJoinMenuMode('columns')}>
                                                <ListItemIcon><ViewColumnIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>Колонки</ListItemText>
                                                {joinGridCols.length > 0 && (
                                                    <Chip label={`${visibleJoinColsCount}/${joinGridCols.length}`} size="small" color="primary" />
                                                )}
                                            </MenuItem>,
                                            <MenuItem key="filter" onClick={() => { setJoinMenuAnchor(null); setJoinMenuMode('main'); setJoinFilterDialogOpen(true) }}>
                                                <ListItemIcon><FilterListIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>Фильтры</ListItemText>
                                                {joinFilters.length > 0 && (
                                                    <Chip label={joinFilters.length} size="small" color="warning" />
                                                )}
                                            </MenuItem>,
                                        ]}
                                        {joinMenuMode === 'columns' && [
                                            <MenuItem key="back" onClick={() => setJoinMenuMode('main')} sx={{ color: 'text.secondary' }}>
                                                <ListItemIcon><ArrowBackIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>Назад</ListItemText>
                                            </MenuItem>,
                                            <Divider key="c0" />,
                                            <Box key="columns-actions" sx={{ px: 2, py: 1, display: 'flex', gap: 1 }}>
                                                <Button size="small" onClick={() => setAllJoinColumnsVisibility(true)}>
                                                    Показать все
                                                </Button>
                                                <Button size="small" color="inherit" onClick={() => setAllJoinColumnsVisibility(false)}>
                                                    Скрыть все
                                                </Button>
                                            </Box>,
                                            <Divider key="c1" />,
                                            <Box key="columns-list" sx={{ maxHeight: 300, overflow: 'auto' }}>
                                                {joinGridCols.map((col) => (
                                                    <MenuItem
                                                        key={`jc-${col.field}`}
                                                        onClick={() =>
                                                            setJoinColumnVisibilityModel((prev) => ({
                                                                ...prev,
                                                                [col.field]: prev[col.field] === false,
                                                            }))
                                                        }
                                                    >
                                                        <Checkbox
                                                            size="small"
                                                            checked={joinColumnVisibilityModel[col.field] !== false}
                                                            sx={{ p: 0.25, mr: 0.75 }}
                                                        />
                                                        <ListItemText
                                                            primary={col.description || col.field}
                                                            primaryTypographyProps={{
                                                                variant: 'body2',
                                                                sx: {
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    whiteSpace: 'nowrap',
                                                                },
                                                            }}
                                                        />
                                                    </MenuItem>
                                                ))}
                                            </Box>,
                                        ]}
                                        {joinMenuMode === 'filter' && [
                                            <MenuItem key="back" onClick={() => setJoinMenuMode('main')} sx={{ color: 'text.secondary' }}>
                                                <ListItemIcon><ArrowBackIcon fontSize="small" /></ListItemIcon>
                                                <ListItemText>Назад</ListItemText>
                                            </MenuItem>,
                                            <Divider key="d0" />,

                                            <Box key="first-stay" sx={{ px: 2, py: 0.5 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Checkbox
                                                            size="small"
                                                            checked={firstStayOnly}
                                                            onChange={(e) => {
                                                                setFirstStayOnly(e.target.checked)
                                                                setPaginationModel((p) => ({ ...p, page: 0 }))
                                                                setJoinPagination((p) => ({ ...p, page: 0 }))
                                                            }}
                                                        />
                                                    }
                                                    label={<Typography variant="body2">Только первое пребывание в ICU</Typography>}
                                                />
                                            </Box>,

                                            <Divider key="d1" />,

                                            ...joinFilters.map((f, i) => (
                                                <MenuItem key={`jf-${i}`} sx={{ py: 0.5 }}>
                                                    <ListItemText>
                                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500, fontSize: '0.8rem' }}>
                                                            {filterLabel(f)}
                                                        </Typography>
                                                    </ListItemText>
                                                    <IconButton size="small" onClick={() => removeJoinFilter(i)} color="error" sx={{ ml: 1 }}>
                                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                                    </IconButton>
                                                </MenuItem>
                                            )),

                                            joinFilters.length > 0 && (
                                                <Box key="clear-all" sx={{ px: 2, pt: 0.5 }}>
                                                    <Button size="small" color="error" onClick={() => { setJoinFilters([]); setJoinPagination((p) => ({ ...p, page: 0 })) }}>
                                                        Очистить все фильтры
                                                    </Button>
                                                </Box>
                                            ),

                                            <Divider key="d2" sx={{ my: 1 }} />,

                                            <Box key="add-form" sx={{ px: 2, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                                                <Typography variant="subtitle2">Добавить фильтр</Typography>

                                                <FormControl size="small" fullWidth>
                                                    <InputLabel>Столбец</InputLabel>
                                                    <Select
                                                        value={joinDraftCol}
                                                        label="Столбец"
                                                        onChange={(e: SelectChangeEvent) => setJoinDraftCol(e.target.value)}
                                                    >
                                                        {joinAllColumns.map((c) => {
                                                            const ct = pgTypeToColType(c.data_type)
                                                            return (
                                                                <MenuItem key={c.column_name} value={c.column_name}>
                                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                        {c.column_name}
                                                                        <Chip label={ct} size="small" sx={{ height: 18, fontSize: '0.65rem' }}
                                                                            color={ct === 'number' ? 'primary' : ct === 'date' ? 'secondary' : ct === 'datetime' ? 'info' : ct === 'time' ? 'warning' : 'default'}
                                                                            variant="outlined" />
                                                                    </Box>
                                                                </MenuItem>
                                                            )
                                                        })}
                                                    </Select>
                                                </FormControl>

                                                {joinDraftCol && (
                                                    <FormControl size="small" fullWidth>
                                                        <InputLabel>Оператор</InputLabel>
                                                        <Select value={joinDraftOp} label="Оператор" onChange={(e: SelectChangeEvent) => setJoinDraftOp(e.target.value)}>
                                                            {joinDraftOps.map((op) => (
                                                                <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>
                                                            ))}
                                                        </Select>
                                                    </FormControl>
                                                )}

                                                {joinDraftOp && !needsNoValue(joinDraftOp) && (
                                                    (joinDraftOp === 'categoryEquals' || joinDraftOp === 'categoryNotEquals') ? (
                                                        <FormControl size="small" fullWidth>
                                                            <InputLabel>Категория</InputLabel>
                                                            <Select
                                                                multiple
                                                                value={joinDraftCategoryVals}
                                                                label="Категория"
                                                                MenuProps={{ disablePortal: true }}
                                                                open={joinCategorySelectOpen}
                                                                onOpen={() => setJoinCategorySelectOpen(true)}
                                                                onClose={() => setJoinCategorySelectOpen(false)}
                                                                renderValue={(selected) => {
                                                                    const count = (selected as string[]).length
                                                                    return count === 0 ? 'Выберите коды' : `${count} выбрано`
                                                                }}
                                                                onChange={(e: SelectChangeEvent<string[]>) => handleJoinCategoryMultiChange(e.target.value as string[])}
                                                                disabled={joinCategoryLoading}>
                                                                {shouldGroupJoinCategories
                                                                    ? groupedJoinCategoryValues.flatMap((group) => {
                                                                        const expanded = expandedJoinCategoryGroups[group.key] ?? false
                                                                        const selectedInGroup = group.values.filter((v) => joinDraftCategoryVals.includes(v)).length
                                                                        return [
                                                                            <MenuItem
                                                                                key={`join-group-${group.key}`}
                                                                                value={`${JOIN_GROUP_SENTINEL}${group.key}`}
                                                                                sx={{ cursor: 'pointer', userSelect: 'none' }}
                                                                            >
                                                                                <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
                                                                                    <Checkbox
                                                                                        size="small"
                                                                                        checked={selectedInGroup > 0 && selectedInGroup === group.values.length}
                                                                                        indeterminate={selectedInGroup > 0 && selectedInGroup < group.values.length}
                                                                                        sx={{ p: 0.25, mr: 0.75 }}
                                                                                        onClick={(e) => e.stopPropagation()}
                                                                                        onChange={() => toggleJoinGroupSelection(group.key)}
                                                                                    />
                                                                                    <Typography variant="body2">
                                                                                        {group.label} ({group.values.length})
                                                                                    </Typography>
                                                                                    <Box sx={{ ml: 'auto' }}>{expanded ? '▾' : '▸'}</Box>
                                                                                </Box>
                                                                            </MenuItem>,
                                                                            ...(expanded
                                                                                ? group.values.map((v) => (
                                                                                    <MenuItem key={v} value={v}>
                                                                                        <Checkbox size="small" checked={joinDraftCategoryVals.includes(v)} sx={{ p: 0.25, mr: 0.75 }} />
                                                                                        {v}
                                                                                    </MenuItem>
                                                                                ))
                                                                                : []),
                                                                        ]
                                                                    })
                                                                    : joinCategoryValues.map((v) => (
                                                                        <MenuItem key={v} value={v}>
                                                                            <Checkbox size="small" checked={joinDraftCategoryVals.includes(v)} sx={{ p: 0.25, mr: 0.75 }} />
                                                                            {v}
                                                                        </MenuItem>
                                                                    ))}
                                                                {shouldGroupJoinCategories && groupedJoinCategoryValues.length > 0 && <Divider />}
                                                                {shouldGroupJoinCategories && (
                                                                    <Box sx={{ px: 1, py: 0.5, display: 'flex', gap: 0.5, position: 'sticky', bottom: 0, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider', zIndex: 1 }}>
                                                                        <Button
                                                                            size="small"
                                                                            onMouseDown={(e) => e.preventDefault()}
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                selectAllJoinCategories()
                                                                            }}
                                                                        >
                                                                            Выбрать все
                                                                        </Button>
                                                                        <Button
                                                                            size="small"
                                                                            color="inherit"
                                                                            onMouseDown={(e) => e.preventDefault()}
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                clearJoinCategories()
                                                                            }}
                                                                        >
                                                                            Очистить
                                                                        </Button>
                                                                        <Button
                                                                            size="small"
                                                                            variant="contained"
                                                                            onMouseDown={(e) => e.preventDefault()}
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                setJoinCategorySelectOpen(false)
                                                                                addJoinFilter()
                                                                            }}
                                                                        >
                                                                            Добавить
                                                                        </Button>
                                                                    </Box>
                                                                )}
                                                            </Select>
                                                            {joinCategoryLoading && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>Загрузка значений...</Typography>}
                                                        </FormControl>
                                                    ) : needsBetween(joinDraftOp) ? (
                                                        <Box sx={{ display: 'flex', gap: 1 }}>
                                                            <TextField label="От" type={joinIType} value={joinDraftFrom}
                                                                onChange={(e) => setJoinDraftFrom(e.target.value)}
                                                                size="small" fullWidth
                                                                InputLabelProps={joinNeedsShrink ? { shrink: true } : undefined}
                                                                inputProps={joinIType === 'time' ? { step: 1 } : undefined} />
                                                            <TextField label="До" type={joinIType} value={joinDraftTo}
                                                                onChange={(e) => setJoinDraftTo(e.target.value)}
                                                                size="small" fullWidth
                                                                InputLabelProps={joinNeedsShrink ? { shrink: true } : undefined}
                                                                inputProps={joinIType === 'time' ? { step: 1 } : undefined} />
                                                        </Box>
                                                    ) : (
                                                        <TextField
                                                            label={joinDraftOp === 'ilike' ? 'Шаблон (например: word)' : 'Значение'}
                                                            type={joinIType} value={joinDraftVal}
                                                            onChange={(e) => setJoinDraftVal(e.target.value)}
                                                            onKeyDown={(e) => { if (e.key === 'Enter') { addJoinFilter(); e.preventDefault() } }}
                                                            size="small" fullWidth
                                                            InputLabelProps={joinNeedsShrink ? { shrink: true } : undefined}
                                                            inputProps={joinIType === 'time' ? { step: 1 } : undefined}
                                                            helperText={joinDraftOp === 'ilike' ? 'Поиск без учёта регистра' : undefined} />
                                                    )
                                                )}

                                                {joinDraftCol && joinDraftOp && (
                                                    (joinDraftOp !== 'categoryEquals' && joinDraftOp !== 'categoryNotEquals') ||
                                                    !shouldGroupJoinCategories
                                                ) && (
                                                    <Button
                                                        variant="contained"
                                                        startIcon={<AddIcon />}
                                                        onClick={addJoinFilter}
                                                        disableElevation
                                                        fullWidth
                                                        size="small"
                                                    >
                                                        {(joinDraftOp === 'categoryEquals' || joinDraftOp === 'categoryNotEquals')
                                                            ? 'Применить'
                                                            : 'Добавить'}
                                                    </Button>
                                                )}
                                            </Box>,
                                        ]}
                                    </Menu>
                                    <Tooltip title="Скачать">
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={(e) => setJoinDownloadAnchor(e.currentTarget)}
                                                disabled={joinRows.length === 0 || joinTaskProgress !== null}
                                            >
                                                <DownloadIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title="Перенести в рабочее место">
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={() => void transferJoinSnapshotToWork()}
                                                disabled={!joinHasEnoughTables || !joinHasAnyCols || joinTaskProgress !== null}
                                            >
                                                <WorkIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Menu
                                        anchorEl={safeJoinDownloadAnchor}
                                        open={Boolean(safeJoinDownloadAnchor)}
                                        onClose={() => setJoinDownloadAnchor(null)}
                                    >
                                        <MenuItem onClick={() => void exportJoinTable('csv')}>
                                            Скачать CSV
                                        </MenuItem>
                                        <MenuItem onClick={() => void exportJoinTable('excel')}>
                                            Скачать Excel
                                        </MenuItem>
                                    </Menu>
                                </Box>

                                <FilterSummaryBar
                                    items={joinFilterItems}
                                    onClearAll={clearJoinFilterItems}
                                />

                                {joinTaskProgress !== null && (
                                    <Box
                                        sx={{
                                            px: 2,
                                            py: 0.75,
                                            borderBottom: '1px solid',
                                            borderColor: 'divider',
                                            bgcolor: 'background.paper',
                                        }}
                                    >
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                            {joinTaskLabel}: {joinTaskProgress}%
                                        </Typography>
                                        <LinearProgress variant="determinate" value={joinTaskProgress} />
                                    </Box>
                                )}

                                { /* Color picker popover */}
                                <Popover
                                    open={Boolean(safeColorAnchorEl)}
                                    anchorEl={safeColorAnchorEl}
                                    onClose={() => setColorAnchor(null)}
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                                    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                                >
                                    <Box sx={{ p: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 28px)', gap: 0.5 }}>
                                        {TABLE_COLORS.map((c, i) => (
                                            <Box
                                                key={i}
                                                onClick={() => {
                                                    if (colorAnchor) {
                                                        setJoinTableColors((prev) => ({ ...prev, [colorAnchor.table]: i }))
                                                        setColorAnchor(null)
                                                    }
                                                }}
                                                sx={{
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: 1,
                                                    bgcolor: c.header,
                                                    border: `2px solid ${c.border}`,
                                                    cursor: 'pointer',
                                                    '&:hover': { opacity: 0.8, transform: 'scale(1.1)' },
                                                    transition: 'all 0.1s',
                                                }}
                                            />
                                        ))}
                                    </Box>
                                </Popover>

                                {joinError && (
                                    <Alert severity="error" sx={{ m: 1 }}>
                                        {joinError}
                                    </Alert>
                                )}

                                <Box sx={{ flex: 1, minHeight: 0 }}>
                                    <DataGrid
                                        rows={joinRows}
                                        columns={joinGridCols}
                                        columnVisibilityModel={joinColumnVisibilityModel}
                                        onColumnVisibilityModelChange={(model) =>
                                            setJoinColumnVisibilityModel(model as Record<string, boolean>)
                                        }
                                        getRowId={(_row: Record<string, unknown>) => _row.__id as string | number}
                                        rowCount={joinTotal}
                                        loading={joinLoading}
                                        paginationMode="server"
                                        paginationModel={joinPagination}
                                        onPaginationModelChange={setJoinPagination}
                                        sortingMode="server"
                                        sortModel={joinSortModel}
                                        onSortModelChange={setJoinSortModel}
                                        pageSizeOptions={[PAGE_SIZE]}
                                        density="compact"
                                        disableColumnMenu
                                        sx={{
                                            height: '100%',
                                            border: 'none',
                                            bgcolor: 'background.paper',
                                            '& .MuiDataGrid-columnHeaders': {
                                                borderBottom: '2px solid',
                                                borderColor: 'divider',
                                            },
                                            '& .MuiDataGrid-columnHeader': {
                                                fontWeight: 600,
                                                fontSize: '0.75rem',
                                            },
                                            '& .MuiDataGrid-row:hover': {
                                                bgcolor: 'action.hover',
                                            },

                                            ...joinColorSx,
                                        }}
                                        localeText={{
                                            noRowsLabel: 'Нет данных',
                                            MuiTablePagination: {
                                                labelDisplayedRows: ({ from, to, count }) =>
                                                    `${from}–${to} из ${count.toLocaleString()}`,
                                                labelRowsPerPage: '',
                                            },
                                        }}
                                    />
                                </Box>
                            </>
                        )
                    ) :
                        !selected ? (
                            <Box
                                sx={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <Typography variant="body1" color="text.secondary">
                                    Выберите таблицу слева
                                </Typography>
                            </Box>
                        ) : (
                            <>
                                { }
                                <Box
                                    sx={{
                                        px: 2,
                                        py: 1,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        bgcolor: 'background.paper',
                                    }}
                                >
                                    <TableChartIcon color="primary" fontSize="small" />
                                    <Typography variant="subtitle1" fontWeight={600}>
                                        {selected}
                                    </Typography>
                                    {!dataLoading && (
                                        <Chip
                                            label={`${total.toLocaleString()} записей`}
                                            size="small"
                                            variant="outlined"
                                        />
                                    )}
                                    {filters.length > 0 && (
                                        <Chip
                                            label={`${filters.length} фильтр${filters.length > 1 ? 'а' : ''}`}
                                            size="small"
                                            color="warning"
                                            variant="outlined"
                                            onDelete={() => {
                                                setFilters([])
                                                setPaginationModel((p) => ({
                                                    ...p,
                                                    page: 0,
                                                }))
                                            }}
                                        />
                                    )}
                                    <Box sx={{ flex: 1 }} />
                                    { }
                                    <Tooltip title="Скачать">
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={(e) => setDownloadAnchor(e.currentTarget)}
                                                disabled={!selected || singleTaskProgress !== null}
                                            >
                                                <DownloadIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title="Перенести в рабочее место">
                                        <span>
                                            <IconButton
                                                size="small"
                                                onClick={() => void transferSingleSnapshotToWork()}
                                                disabled={!selected || singleTaskProgress !== null}
                                            >
                                                <WorkIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Menu
                                        anchorEl={safeDownloadAnchor}
                                        open={Boolean(safeDownloadAnchor)}
                                        onClose={() => setDownloadAnchor(null)}
                                    >
                                        <MenuItem onClick={() => void exportSingleTable('csv')}>
                                            Скачать CSV
                                        </MenuItem>
                                        <MenuItem onClick={() => void exportSingleTable('excel')}>
                                            Скачать Excel
                                        </MenuItem>
                                    </Menu>
                                    <IconButton size="small" onClick={openMenu}>
                                        <MoreVertIcon fontSize="small" />
                                    </IconButton>

                                    { }
                                    <Menu
                                        anchorEl={safeMenuAnchor}
                                        open={Boolean(safeMenuAnchor)}
                                        onClose={closeMenu}
                                        anchorOrigin={{
                                            vertical: 'bottom',
                                            horizontal: 'right',
                                        }}
                                        transformOrigin={{
                                            vertical: 'top',
                                            horizontal: 'right',
                                        }}
                                        slotProps={{
                                            paper: {
                                                sx: { minWidth: 320, maxWidth: 420 },
                                            },
                                        }}
                                    >
                                        { }
                                        {menuMode === 'main' && [
                                            <MenuItem
                                                key="sort"
                                                onClick={() => setMenuMode('sort')}
                                            >
                                                <ListItemIcon>
                                                    <SortIcon fontSize="small" />
                                                </ListItemIcon>
                                                <ListItemText>Сортировка</ListItemText>
                                                {sortModel.length > 0 && (
                                                    <Chip
                                                        label={`${sortModel[0].field} ${sortModel[0].sort}`}
                                                        size="small"
                                                        sx={{ ml: 1 }}
                                                    />
                                                )}
                                            </MenuItem>,
                                            <MenuItem
                                                key="filter"
                                                onClick={() => { closeMenu(); setFilterDialogOpen(true) }}
                                            >
                                                <ListItemIcon>
                                                    <FilterListIcon fontSize="small" />
                                                </ListItemIcon>
                                                <ListItemText>Фильтры</ListItemText>
                                                {filters.length > 0 && (
                                                    <Chip
                                                        label={filters.length}
                                                        size="small"
                                                        color="warning"
                                                        sx={{ ml: 1 }}
                                                    />
                                                )}
                                            </MenuItem>,
                                        ]}

                                        { }
                                        {menuMode === 'sort' && [
                                            <MenuItem
                                                key="back"
                                                onClick={() => setMenuMode('main')}
                                                sx={{ color: 'text.secondary' }}
                                            >
                                                <ListItemIcon>
                                                    <ArrowBackIcon fontSize="small" />
                                                </ListItemIcon>
                                                <ListItemText>Назад</ListItemText>
                                            </MenuItem>,
                                            <Divider key="d1" />,
                                            <MenuItem
                                                key="clear-sort"
                                                onClick={() => {
                                                    setSortModel([])
                                                    closeMenu()
                                                }}
                                                disabled={sortModel.length === 0}
                                                sx={{ color: 'error.main' }}
                                            >
                                                <ListItemText>
                                                    Сбросить сортировку
                                                </ListItemText>
                                            </MenuItem>,
                                            <Divider key="d2" />,
                                            ...sortableFields.map((field) => (
                                                <MenuItem
                                                    key={field}
                                                    selected={
                                                        sortModel[0]?.field === field
                                                    }
                                                    onClick={() => {
                                                        const cur = sortModel[0]
                                                        setSortModel([
                                                            {
                                                                field,
                                                                sort:
                                                                    cur?.field === field
                                                                        ? cur.sort ===
                                                                            'asc'
                                                                            ? 'desc'
                                                                            : 'asc'
                                                                        : 'asc',
                                                            },
                                                        ])
                                                        closeMenu()
                                                    }}
                                                >
                                                    <ListItemText>{field}</ListItemText>
                                                    {sortModel[0]?.field === field && (
                                                        <Chip
                                                            label={sortModel[0].sort}
                                                            size="small"
                                                            color="primary"
                                                            sx={{ ml: 1 }}
                                                        />
                                                    )}
                                                </MenuItem>
                                            )),
                                        ]}

                                        { }
                                        {menuMode === 'filter' && [
                                            <MenuItem
                                                key="back"
                                                onClick={() => setMenuMode('main')}
                                                sx={{ color: 'text.secondary' }}
                                            >
                                                <ListItemIcon>
                                                    <ArrowBackIcon fontSize="small" />
                                                </ListItemIcon>
                                                <ListItemText>Назад</ListItemText>
                                            </MenuItem>,
                                            <Divider key="d1" />,

                                            <Box key="first-stay" sx={{ px: 2, py: 0.5 }}>
                                                <FormControlLabel
                                                    control={
                                                        <Checkbox
                                                            size="small"
                                                            checked={firstStayOnly}
                                                            onChange={(e) => {
                                                                setFirstStayOnly(e.target.checked)
                                                                setPaginationModel((p) => ({ ...p, page: 0 }))
                                                                setJoinPagination((p) => ({ ...p, page: 0 }))
                                                            }}
                                                        />
                                                    }
                                                    label={
                                                        <Typography variant="body2">
                                                            Только первое пребывание в ICU
                                                        </Typography>
                                                    }
                                                />
                                            </Box>,

                                            <Divider key="d1b" />,


                                            ...filters.map((f, i) => (
                                                <MenuItem key={`af-${i}`} sx={{ py: 0.5 }}>
                                                    <ListItemText>
                                                        <Typography
                                                            variant="body2"
                                                            sx={{
                                                                fontFamily: 'monospace',
                                                                fontWeight: 500,
                                                                fontSize: '0.8rem',
                                                            }}
                                                        >
                                                            {filterLabel(f)}
                                                        </Typography>
                                                    </ListItemText>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => removeFilter(i)}
                                                        color="error"
                                                        sx={{ ml: 1 }}
                                                    >
                                                        <DeleteIcon
                                                            sx={{ fontSize: 16 }}
                                                        />
                                                    </IconButton>
                                                </MenuItem>
                                            )),

                                            filters.length > 0 && (
                                                <Box
                                                    key="clear-all"
                                                    sx={{ px: 2, pt: 0.5 }}
                                                >
                                                    <Button
                                                        size="small"
                                                        color="error"
                                                        onClick={() => {
                                                            setFilters([])
                                                            setPaginationModel((p) => ({
                                                                ...p,
                                                                page: 0,
                                                            }))
                                                        }}
                                                    >
                                                        Очистить все фильтры
                                                    </Button>
                                                </Box>
                                            ),

                                            <Divider key="d2" sx={{ my: 1 }} />,


                                            <Box
                                                key="add-form"
                                                sx={{
                                                    px: 2,
                                                    pb: 1.5,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: 1.25,
                                                }}
                                            >
                                                <Typography variant="subtitle2">
                                                    Добавить фильтр
                                                </Typography>

                                                { }
                                                <FormControl size="small" fullWidth>
                                                    <InputLabel>Столбец</InputLabel>
                                                    <Select
                                                        value={draftCol}
                                                        label="Столбец"
                                                        onChange={(
                                                            e: SelectChangeEvent,
                                                        ) => setDraftCol(e.target.value)}
                                                    >
                                                        {tableColumns.map((c) => {
                                                            const ct =
                                                                pgTypeToColType(
                                                                    c.data_type,
                                                                )
                                                            return (
                                                                <MenuItem
                                                                    key={
                                                                        c.column_name
                                                                    }
                                                                    value={
                                                                        c.column_name
                                                                    }
                                                                >
                                                                    <Box
                                                                        sx={{
                                                                            display:
                                                                                'flex',
                                                                            alignItems:
                                                                                'center',
                                                                            gap: 1,
                                                                        }}
                                                                    >
                                                                        {
                                                                            c.column_name
                                                                        }
                                                                        <Chip
                                                                            label={ct}
                                                                            size="small"
                                                                            sx={{
                                                                                height: 18,
                                                                                fontSize:
                                                                                    '0.65rem',
                                                                            }}
                                                                            color={
                                                                                ct ===
                                                                                    'number'
                                                                                    ? 'primary'
                                                                                    : ct ===
                                                                                        'date'
                                                                                        ? 'secondary'
                                                                                        : ct ===
                                                                                            'datetime'
                                                                                            ? 'info'
                                                                                            : ct ===
                                                                                                'time'
                                                                                                ? 'warning'
                                                                                                : 'default'
                                                                            }
                                                                            variant="outlined"
                                                                        />
                                                                    </Box>
                                                                </MenuItem>
                                                            )
                                                        })}
                                                    </Select>
                                                </FormControl>

                                                { }
                                                {draftCol && (
                                                    <FormControl
                                                        size="small"
                                                        fullWidth
                                                    >
                                                        <InputLabel>
                                                            Оператор
                                                        </InputLabel>
                                                        <Select
                                                            value={draftOp}
                                                            label="Оператор"
                                                            onChange={(
                                                                e: SelectChangeEvent,
                                                            ) =>
                                                                setDraftOp(
                                                                    e.target.value,
                                                                )
                                                            }
                                                        >
                                                            {draftOps.map((op) => (
                                                                <MenuItem
                                                                    key={op.value}
                                                                    value={op.value}
                                                                >
                                                                    {op.label}
                                                                </MenuItem>
                                                            ))}
                                                        </Select>
                                                    </FormControl>
                                                )}

                                                { }
                                                {draftOp &&
                                                    !needsNoValue(draftOp) &&
                                                    (draftOp === 'categoryEquals' || draftOp === 'categoryNotEquals' ? (
                                                        <FormControl
                                                            size="small"
                                                            fullWidth
                                                        >
                                                            <InputLabel>
                                                                Категория
                                                            </InputLabel>
                                                            <Select
                                                                multiple
                                                                value={draftCategoryVals}
                                                                label="Категория"
                                                                MenuProps={{ disablePortal: true }}
                                                                open={singleCategorySelectOpen}
                                                                onOpen={() => setSingleCategorySelectOpen(true)}
                                                                onClose={() => setSingleCategorySelectOpen(false)}
                                                                renderValue={(selected) => {
                                                                    const count = (selected as string[]).length
                                                                    return count === 0 ? 'Выберите коды' : `${count} выбрано`
                                                                }}
                                                                onChange={(
                                                                    e: SelectChangeEvent<string[]>,
                                                                ) =>
                                                                    handleSingleCategoryMultiChange(e.target.value as string[])
                                                                }
                                                                disabled={
                                                                    categoryLoading
                                                                }
                                                            >
                                                                {shouldGroupSingleCategories
                                                                    ? groupedCategoryValues.flatMap((group) => {
                                                                        const expanded = expandedCategoryGroups[group.key] ?? false
                                                                        const selectedInGroup = group.values.filter((v) => draftCategoryVals.includes(v)).length
                                                                        return [
                                                                            <MenuItem
                                                                                key={`single-group-${group.key}`}
                                                                                value={`${SINGLE_GROUP_SENTINEL}${group.key}`}
                                                                                sx={{ cursor: 'pointer', userSelect: 'none' }}
                                                                            >
                                                                                <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
                                                                                    <Checkbox
                                                                                        size="small"
                                                                                        checked={selectedInGroup > 0 && selectedInGroup === group.values.length}
                                                                                        indeterminate={selectedInGroup > 0 && selectedInGroup < group.values.length}
                                                                                        sx={{ p: 0.25, mr: 0.75 }}
                                                                                        onClick={(e) => e.stopPropagation()}
                                                                                        onChange={() => toggleSingleGroupSelection(group.key)}
                                                                                    />
                                                                                    <Typography variant="body2">
                                                                                        {group.label} ({group.values.length})
                                                                                    </Typography>
                                                                                    <Box sx={{ ml: 'auto' }}>{expanded ? '▾' : '▸'}</Box>
                                                                                </Box>
                                                                            </MenuItem>,
                                                                            ...(expanded
                                                                                ? group.values.map((v) => (
                                                                                    <MenuItem
                                                                                        key={v}
                                                                                        value={v}
                                                                                    >
                                                                                        <Checkbox size="small" checked={draftCategoryVals.includes(v)} sx={{ p: 0.25, mr: 0.75 }} />
                                                                                        {v}
                                                                                    </MenuItem>
                                                                                ))
                                                                                : []),
                                                                        ]
                                                                    })
                                                                    : categoryValues.map((v) => (
                                                                        <MenuItem key={v} value={v}>
                                                                            <Checkbox size="small" checked={draftCategoryVals.includes(v)} sx={{ p: 0.25, mr: 0.75 }} />
                                                                            {v}
                                                                        </MenuItem>
                                                                    ))}
                                                                {shouldGroupSingleCategories && groupedCategoryValues.length > 0 && <Divider />}
                                                                {shouldGroupSingleCategories && (
                                                                    <Box sx={{ px: 1, py: 0.5, display: 'flex', gap: 0.5, position: 'sticky', bottom: 0, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider', zIndex: 1 }}>
                                                                        <Button
                                                                            size="small"
                                                                            onMouseDown={(e) => e.preventDefault()}
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                selectAllSingleCategories()
                                                                            }}
                                                                        >
                                                                            Выбрать все
                                                                        </Button>
                                                                        <Button
                                                                            size="small"
                                                                            color="inherit"
                                                                            onMouseDown={(e) => e.preventDefault()}
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                clearSingleCategories()
                                                                            }}
                                                                        >
                                                                            Очистить
                                                                        </Button>
                                                                        <Button
                                                                            size="small"
                                                                            variant="contained"
                                                                            onMouseDown={(e) => e.preventDefault()}
                                                                            onClick={(e) => {
                                                                                e.preventDefault()
                                                                                e.stopPropagation()
                                                                                setSingleCategorySelectOpen(false)
                                                                                addFilter()
                                                                            }}
                                                                        >
                                                                            Добавить
                                                                        </Button>
                                                                    </Box>
                                                                )}
                                                            </Select>
                                                            {categoryLoading && (
                                                                <Typography
                                                                    variant="caption"
                                                                    color="text.secondary"
                                                                    sx={{ mt: 0.5 }}
                                                                >
                                                                    Загрузка значений...
                                                                </Typography>
                                                            )}
                                                        </FormControl>
                                                    ) : needsBetween(draftOp) ? (
                                                        <Box
                                                            sx={{
                                                                display: 'flex',
                                                                gap: 1,
                                                            }}
                                                        >
                                                            <TextField
                                                                label="От"
                                                                type={iType}
                                                                value={draftFrom}
                                                                onChange={(e) =>
                                                                    setDraftFrom(
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                size="small"
                                                                fullWidth
                                                                InputLabelProps={
                                                                    needsShrink
                                                                        ? {
                                                                            shrink: true,
                                                                        }
                                                                        : undefined
                                                                }
                                                                inputProps={
                                                                    iType === 'time'
                                                                        ? { step: 1 }
                                                                        : undefined
                                                                }
                                                            />
                                                            <TextField
                                                                label="До"
                                                                type={iType}
                                                                value={draftTo}
                                                                onChange={(e) =>
                                                                    setDraftTo(
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                size="small"
                                                                fullWidth
                                                                InputLabelProps={
                                                                    needsShrink
                                                                        ? {
                                                                            shrink: true,
                                                                        }
                                                                        : undefined
                                                                }
                                                                inputProps={
                                                                    iType === 'time'
                                                                        ? { step: 1 }
                                                                        : undefined
                                                                }
                                                            />
                                                        </Box>
                                                    ) : (
                                                        <TextField
                                                            label={
                                                                draftOp === 'ilike'
                                                                    ? 'Шаблон (например: word)'
                                                                    : 'Значение'
                                                            }
                                                            type={iType}
                                                            value={draftVal}
                                                            onChange={(e) =>
                                                                setDraftVal(
                                                                    e.target.value,
                                                                )
                                                            }
                                                            onKeyDown={(e) => {
                                                                if (
                                                                    e.key === 'Enter'
                                                                ) {
                                                                    addFilter()
                                                                    e.preventDefault()
                                                                }
                                                            }}
                                                            size="small"
                                                            fullWidth
                                                            InputLabelProps={
                                                                needsShrink
                                                                    ? { shrink: true }
                                                                    : undefined
                                                            }
                                                            inputProps={
                                                                iType === 'time'
                                                                    ? { step: 1 }
                                                                    : undefined
                                                            }
                                                            helperText={
                                                                draftOp === 'ilike'
                                                                    ? 'Поиск без учёта регистра'
                                                                    : undefined
                                                            }
                                                        />
                                                    ))}

                                                {draftCol && draftOp && (
                                                    (draftOp !== 'categoryEquals' && draftOp !== 'categoryNotEquals') ||
                                                    !shouldGroupSingleCategories
                                                ) && (
                                                    <Button
                                                        variant="contained"
                                                        startIcon={<AddIcon />}
                                                        onClick={addFilter}
                                                        disableElevation
                                                        fullWidth
                                                        size="small"
                                                    >
                                                        {(draftOp === 'categoryEquals' || draftOp === 'categoryNotEquals')
                                                            ? 'Применить'
                                                            : 'Добавить'}
                                                    </Button>
                                                )}

                                                {draftCol && draftOp && (draftOp === 'categoryEquals' || draftOp === 'categoryNotEquals') && (
                                                    <Button
                                                        variant="contained"
                                                        startIcon={<AddIcon />}
                                                        onClick={addFilter}
                                                        disableElevation
                                                        fullWidth
                                                        size="small"
                                                    >
                                                        Применить фильтр
                                                    </Button>
                                                )}
                                            </Box>,
                                        ]}
                                    </Menu>
                                </Box>

                                <FilterSummaryBar
                                    items={singleFilterItems}
                                    onClearAll={clearSingleFilterItems}
                                />

                                {singleTaskProgress !== null && (
                                    <Box
                                        sx={{
                                            px: 2,
                                            py: 0.75,
                                            borderBottom: '1px solid',
                                            borderColor: 'divider',
                                            bgcolor: 'background.paper',
                                        }}
                                    >
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                            {singleTaskLabel}: {singleTaskProgress}%
                                        </Typography>
                                        <LinearProgress variant="determinate" value={singleTaskProgress} />
                                    </Box>
                                )}

                                {dataError && (
                                    <Alert severity="error" sx={{ m: 1 }}>
                                        {dataError}
                                    </Alert>
                                )}

                                { }
                                <Box sx={{ flex: 1, minHeight: 0 }}>
                                    <DataGrid
                                        rows={rows}
                                        columns={gridCols}
                                        getRowId={(
                                            _row: Record<string, unknown>,
                                        ) => {
                                            const keys = Object.keys(_row)
                                            return _row[keys[0]] as string | number
                                        }}
                                        rowCount={total}
                                        loading={dataLoading}
                                        paginationMode="server"
                                        paginationModel={paginationModel}
                                        onPaginationModelChange={setPaginationModel}
                                        sortingMode="server"
                                        sortModel={sortModel}
                                        onSortModelChange={setSortModel}
                                        pageSizeOptions={[PAGE_SIZE]}
                                        density="compact"
                                        disableColumnMenu
                                        sx={{
                                            height: '100%',
                                            border: 'none',
                                            bgcolor: 'background.paper',
                                            '& .MuiDataGrid-columnHeaders': {
                                                bgcolor: 'grey.50',
                                                borderBottom: '2px solid',
                                                borderColor: 'divider',
                                            },
                                            '& .MuiDataGrid-columnHeader': {
                                                fontWeight: 600,
                                                fontSize: '0.813rem',
                                            },
                                            '& .MuiDataGrid-row:hover': {
                                                bgcolor: 'action.hover',
                                            },
                                        }}
                                        localeText={{
                                            noRowsLabel: 'Нет данных',
                                            MuiTablePagination: {
                                                labelDisplayedRows: ({ from, to, count }) =>
                                                    `${from}–${to} из ${count.toLocaleString()}`,
                                                labelRowsPerPage: '',
                                            },
                                        }}
                                    />
                                </Box>
                            </>
                        )
                }
            </Box >
        </Box >

        <DbFilterDialog
            open={filterDialogOpen}
            onClose={() => setFilterDialogOpen(false)}
            columns={tableColumns}
            filters={filters}
            onAddFilters={(newFilters) => {
                setFilters((prev) => [...prev, ...newFilters])
                setPaginationModel({ page: 0, pageSize: PAGE_SIZE })
            }}
            onRemove={(idx) => {
                setFilters((prev) => prev.filter((_, i) => i !== idx))
                setPaginationModel({ page: 0, pageSize: PAGE_SIZE })
            }}
            onClear={() => {
                setFilters([])
                setPaginationModel({ page: 0, pageSize: PAGE_SIZE })
            }}
            fetchDistinct={(col) =>
                axios
                    .get<string[]>(`${apiBasePath}/tables/${selected}/columns/${col}/distinct`)
                    .then(({ data }) =>
                        (Array.isArray(data) ? data : [])
                            .map((v) => String(v ?? '').trim())
                            .filter((v) => v.length > 0),
                    )
            }
        />

        <DbFilterDialog
            open={joinFilterDialogOpen}
            onClose={() => setJoinFilterDialogOpen(false)}
            columns={joinAllColumns.map((c) => ({ column_name: c.column_name, data_type: c.data_type }))}
            filters={joinFilters}
            onAddFilters={(newFilters) => {
                setJoinFilters((prev) => [...prev, ...newFilters])
                setJoinPagination({ page: 0, pageSize: PAGE_SIZE })
            }}
            onRemove={(idx) => {
                setJoinFilters((prev) => prev.filter((_, i) => i !== idx))
                setJoinPagination({ page: 0, pageSize: PAGE_SIZE })
            }}
            onClear={() => {
                setJoinFilters([])
                setJoinPagination({ page: 0, pageSize: PAGE_SIZE })
            }}
            fetchDistinct={(col) => {
                const dotIdx = col.indexOf('.')
                if (dotIdx < 0) return Promise.resolve([])
                const tName = col.substring(0, dotIdx)
                const cName = col.substring(dotIdx + 1)
                return axios
                    .get<string[]>(`${apiBasePath}/tables/${tName}/columns/${cName}/distinct`)
                    .then(({ data }) =>
                        (Array.isArray(data) ? data : [])
                            .map((v) => String(v ?? '').trim())
                            .filter((v) => v.length > 0),
                    )
            }}
        />
        </>
    )
}

