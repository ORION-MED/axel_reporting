import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Chip,
    Divider,
    Drawer,
    FormControl,
    FormHelperText,
    IconButton,
    InputLabel,
    ListSubheader,
    Menu,
    MenuItem,
    OutlinedInput,
    Paper,
    Select,
    Skeleton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import OpenWithIcon from '@mui/icons-material/OpenWith'
import BarChartIcon from '@mui/icons-material/BarChart'
import ShowChartIcon from '@mui/icons-material/ShowChart'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot'
import PieChartIcon from '@mui/icons-material/PieChart'
import StackedLineChartIcon from '@mui/icons-material/StackedLineChart'
import AlignHorizontalLeftIcon from '@mui/icons-material/AlignHorizontalLeft'
import LayersIcon from '@mui/icons-material/Layers'
import PercentIcon from '@mui/icons-material/Percent'
import HexagonIcon from '@mui/icons-material/Hexagon'
import DonutLargeIcon from '@mui/icons-material/DonutLarge'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import MultilineChartIcon from '@mui/icons-material/MultilineChart'
import NumbersIcon from '@mui/icons-material/Numbers'
import TableChartIcon from '@mui/icons-material/TableChart'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat'
import FunctionsIcon from '@mui/icons-material/Functions'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import BubbleChartIcon from '@mui/icons-material/BubbleChart'
import GridViewIcon from '@mui/icons-material/GridView'
import EqualizerIcon from '@mui/icons-material/Equalizer'
import WaterfallChartIcon from '@mui/icons-material/WaterfallChart'
import DownloadIcon from '@mui/icons-material/Download'
import AddBoxIcon from '@mui/icons-material/AddBox'
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline'
import ImageIcon from '@mui/icons-material/Image'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import LeaderboardIcon from '@mui/icons-material/Leaderboard'
import HubIcon from '@mui/icons-material/Hub'
import CandlestickChartIcon from '@mui/icons-material/CandlestickChart'
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Funnel,
    FunnelChart,
    Label,
    LabelList,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    RadialBar,
    RadialBarChart,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip as RTooltip,
    Treemap,
    XAxis,
    YAxis,
    ZAxis,
    Sankey,
} from 'recharts'
import { toPng, toJpeg } from 'html-to-image'
import {
    DndContext,
    closestCenter,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DraggableAttributes,
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
    useSortable,
    arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTableStore } from '@entities/table'
import { ReportProblemButton } from '@features/support'
import { idbStorage, applyFilters } from '@shared/lib'
import type { ColumnConfig, ParsedRow, TableState } from '@shared/types'
import {
    loadDashboardWidgets, saveDashboardWidgets, loadLegacyDashboardWidgets,
    loadDashboardList, saveDashboardList,
    resolveScatterYField,
    type DashboardMeta,
} from '../model/dashboardStorage'
import { KPI_TYPES, PIE_FAMILY, TABLE_TYPES, prepareWidgetData, type PreparedWidgetData, type HeatmapData, type CalendarData, type SankeyData } from '../model/chartModel'
import type { AggFn, CalculatedField, ChartType, ColSpan, KpiCompareMode, SortBy, WidgetConfig } from '../model/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const SORT_BY_LABELS: Record<SortBy, string> = {
    none: 'Без сортировки',
    name_asc: 'По имени (А → Я)',
    value_asc: 'По значению ↑',
    value_desc: 'По значению ↓',
}

const AGG_LABELS: Record<AggFn, string> = {
    none: 'Без агрегации',
    sum: 'Сумма',
    mean: 'Среднее',
    median: 'Медиана',
    count: 'Количество',
    count_distinct: 'Уникальные значения',
    min: 'Минимум',
    max: 'Максимум',
}

const CHART_TYPE_HINTS: Partial<Record<ChartType, string>> = {
    bar:             'Сравнение значений по категориям. X: категория, Y: числа',
    bar_h:           'То же что столбчатый, но горизонтально — удобно для длинных подписей',
    bar_stacked:     'Части целого в каждой категории. X: категория, Y: несколько числовых полей',
    bar_stacked_pct: 'Доля каждой части в 100%. X: категория, Y: несколько числовых полей',
    line:            'Динамика во времени или по порядку. X: дата или категория, Y: числа',
    area:            'Линейный с закрашенной площадью — акцент на объём',
    composed:        'Bar + Line на одном графике. Первое поле Y → столбец, остальные → линии',
    scatter:         'Корреляция двух числовых переменных. X и Y: только числа',
    bubble:          'Scatter с третьим измерением через размер точки. X, Y, R: числа',
    pie:             'Доли от целого. X: категория, Y: числовое значение доли',
    radar:           'Многомерное сравнение категорий по радиальным осям',
    radialbar:       'Кольцевые полосы — сравнение нескольких категорий по кругу',
    funnel:          'Воронка — убывающие этапы процесса. X: этап, Y: значение',
    treemap:         'Иерархия вложенных прямоугольников — размер по значению',
    histogram:       'Распределение числового поля по интервалам. X: числовое поле',
    heatmap:         'Интенсивность значений по двум категориям. X, Y: категории, значение: число',
    waterfall:       'Нарастающий итог — прирост и убыль по шагам',
    calendar:        'Значения за каждый день на календарной сетке. X: дата, Y: число',
    pareto:          'ABC-анализ: столбцы по убыванию + накопленная линия %',
    sankey:          'Потоки между категориями. Source → Target, значение: число',
    boxplot:         'Квартили и выбросы числового поля по группам. X: категория, Y: число',
    kpi:             'Одно ключевое число — крупный показатель с трендом',
    table:           'Агрегированные данные в виде таблицы. X: строки, Y: столбцы',
}

const CHART_TYPES: { type: ChartType; label: string; icon: React.ReactNode; group: string }[] = [
    { type: 'bar', label: 'Столбчатый', icon: <BarChartIcon fontSize="small" />, group: 'Столбчатые' },
    { type: 'bar_h', label: 'Горизонтальный', icon: <AlignHorizontalLeftIcon fontSize="small" />, group: 'Столбчатые' },
    { type: 'bar_stacked', label: 'С накоплением', icon: <LayersIcon fontSize="small" />, group: 'Столбчатые' },
    { type: 'bar_stacked_pct', label: 'Нормированный', icon: <PercentIcon fontSize="small" />, group: 'Столбчатые' },
    { type: 'line', label: 'Линейный', icon: <ShowChartIcon fontSize="small" />, group: 'Линии' },
    { type: 'area', label: 'Площадной', icon: <StackedLineChartIcon fontSize="small" />, group: 'Линии' },
    { type: 'composed', label: 'Комбо (Bar+Line)', icon: <MultilineChartIcon fontSize="small" />, group: 'Линии' },
    { type: 'scatter', label: 'Точечный', icon: <ScatterPlotIcon fontSize="small" />, group: 'Прочие' },
    { type: 'pie', label: 'Круговой', icon: <PieChartIcon fontSize="small" />, group: 'Прочие' },
    { type: 'radar', label: 'Радар', icon: <HexagonIcon fontSize="small" />, group: 'Прочие' },
    { type: 'radialbar', label: 'Радиальный', icon: <DonutLargeIcon fontSize="small" />, group: 'Прочие' },
    { type: 'funnel', label: 'Воронка', icon: <FilterAltIcon fontSize="small" />, group: 'Прочие' },
    { type: 'treemap', label: 'Древовидный', icon: <AccountTreeIcon fontSize="small" />, group: 'Прочие' },
    { type: 'bubble', label: 'Пузырьковый', icon: <BubbleChartIcon fontSize="small" />, group: 'Прочие' },
    { type: 'histogram', label: 'Гистограмма', icon: <EqualizerIcon fontSize="small" />, group: 'Прочие' },
    { type: 'heatmap', label: 'Тепловая карта', icon: <GridViewIcon fontSize="small" />, group: 'Прочие' },
    { type: 'waterfall', label: 'Водопад', icon: <WaterfallChartIcon fontSize="small" />, group: 'Прочие' },
    { type: 'calendar', label: 'Календарь', icon: <CalendarMonthIcon fontSize="small" />, group: 'Прочие' },
    { type: 'pareto', label: 'Парето', icon: <LeaderboardIcon fontSize="small" />, group: 'Прочие' },
    { type: 'sankey', label: 'Сэнки', icon: <HubIcon fontSize="small" />, group: 'Прочие' },
    { type: 'boxplot', label: 'Ящик (Box Plot)', icon: <CandlestickChartIcon fontSize="small" />, group: 'Прочие' },
    { type: 'kpi', label: 'KPI-карточка', icon: <NumbersIcon fontSize="small" />, group: 'BI' },
    { type: 'table', label: 'Таблица', icon: <TableChartIcon fontSize="small" />, group: 'BI' },
]

const COLOR_SWATCHES: string[][] = [
    // Tableau 10 — gold standard для аналитики
    ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
    // Observable / D3 — современный веб-дизайн
    ['#4269d0', '#efb118', '#ff725c', '#6cc5b0', '#3ca951', '#ff8ab7', '#a463f2', '#97bbf5', '#9c6b4e', '#9498a0'],
    // Яркий — высокий контраст, хорошо различимы
    ['#ff595e', '#ffca3a', '#6a4c93', '#1982c4', '#8ac926', '#ff924c', '#c77dff', '#36949d', '#f72585', '#4cc9f0'],
    // Тёплый / Земной — мягкий профессиональный вид
    ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#457b9d'],
    // Пастельный — ненавязчивый, читаемый
    ['#a8d8ea', '#aa96da', '#fcbad3', '#dcedc1', '#a8e6cf', '#ffd3b6', '#c9b1ff', '#90caf9', '#f48fb1', '#80cbc4'],
    // Дальтоник-безопасный (Bang Wong)
    ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#000000', '#999999', '#44aa99'],
]

const SWATCH_LABELS = ['Tableau', 'Observable', 'Яркий', 'Тёплый', 'Пастельный', 'Для дальтоников']

const TYPE_GROUP: Record<string, string> = {
    number: 'Числовые',
    date: 'Дата / Время',
    datetime: 'Дата / Время',
    time: 'Дата / Время',
    string: 'Строковые',
}

function groupByType(columns: ColumnConfig[]): Array<[string, ColumnConfig[]]> {
    const map = new Map<string, ColumnConfig[]>()
    for (const col of columns) {
        const group = TYPE_GROUP[col.type] ?? 'Прочие'
        if (!map.has(group)) map.set(group, [])
        map.get(group)!.push(col)
    }
    return [...map.entries()]
}

const SPAN_OPTS: { value: ColSpan; label: string }[] = [
    { value: 3, label: '25%' },
    { value: 4, label: '33%' },
    { value: 6, label: '50%' },
    { value: 12, label: '100%' },
]

const HEIGHT_OPTIONS: { value: number; label: string }[] = [
    { value: 240, label: 'XS' },
    { value: 320, label: 'S' },
    { value: 420, label: 'M' },
    { value: 520, label: 'L' },
    { value: 640, label: 'XL' },
]

const FMT_TICK = (value: unknown) =>
    String(value).length > 14 ? `${String(value).slice(0, 13)}…` : String(value)

const FMT_LABEL = (value: unknown): string => {
    const n = Number(value)
    if (!Number.isFinite(n)) return ''
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`
    return n % 1 === 0 ? String(n) : n.toFixed(2)
}

function fmtKpi(v: number): string {
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`
    return v % 1 === 0 ? v.toLocaleString('ru') : v.toFixed(2)
}

const LEGEND_STYLE = { fontSize: 11, paddingTop: 8 }
const FMT_LEGEND = (value: string) => String(value).length > 22 ? `${String(value).slice(0, 21)}…` : String(value)

function createWidgetId(): string {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID()
    }
    return `widget_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

// ─── Cross-filter ─────────────────────────────────────────────────────────────

interface CrossFilter {
    sourceWidgetId: string
    tableId: string
    field: string
    value: unknown
}

// ─── Calculated fields ────────────────────────────────────────────────────────

const CALC_FIELDS_KEY = 'calc_fields_v1'

function loadCalcFields(): Record<string, CalculatedField[]> {
    try {
        const s = localStorage.getItem(CALC_FIELDS_KEY)
        return s ? JSON.parse(s) : {}
    } catch { return {} }
}

function saveCalcFields(cf: Record<string, CalculatedField[]>): void {
    try { localStorage.setItem(CALC_FIELDS_KEY, JSON.stringify(cf)) } catch { /**/ }
}

function evalFormula(formula: string, row: ParsedRow, fieldNames: string[]): number | null {
    const sorted = [...fieldNames].sort((a, b) => b.length - a.length)
    let expr = formula.trim()
    for (const name of sorted) {
        const val = Number(row[name])
        expr = expr.split(name).join(Number.isFinite(val) ? String(val) : '0')
    }
    if (!/^[\d\s+\-*/().e]+$/.test(expr)) return null
    try {
        const result = new Function(`return (${expr})`)()
        return typeof result === 'number' && Number.isFinite(result) ? result : null
    } catch { return null }
}

// ─── renderKpi ────────────────────────────────────────────────────────────────

function renderKpi(
    kpiData: { value: number; prevValue?: number; change?: number; groupLabel?: string; prevLabel?: string },
    height: number,
    metricLabel: string,
    palette: string[],
): React.ReactNode {
    return (
        <Box sx={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 3 }}>
            {kpiData.groupLabel && (
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                    {kpiData.groupLabel}
                </Typography>
            )}
            <Typography sx={{ fontSize: Math.min(64, Math.max(28, height / 3.5)), fontWeight: 700, lineHeight: 1, color: palette[0], letterSpacing: -1 }}>
                {fmtKpi(kpiData.value)}
            </Typography>
            <Typography variant="caption" color="text.disabled" noWrap>
                {metricLabel}
            </Typography>
            {kpiData.change != null && (
                <Chip
                    size="small"
                    color={kpiData.change > 0 ? 'success' : kpiData.change < 0 ? 'error' : 'default'}
                    icon={kpiData.change > 0
                        ? <TrendingUpIcon sx={{ fontSize: 14 }} />
                        : kpiData.change < 0
                            ? <TrendingDownIcon sx={{ fontSize: 14 }} />
                            : <TrendingFlatIcon sx={{ fontSize: 14 }} />
                    }
                    label={`${kpiData.change > 0 ? '+' : ''}${kpiData.change.toFixed(1)}% vs ${kpiData.prevLabel ?? ''}`}
                    sx={{ fontSize: '0.7rem' }}
                />
            )}
        </Box>
    )
}

// ─── renderChart ──────────────────────────────────────────────────────────────

interface ChartRenderParams {
    chartType: ChartType
    chartData: Array<Record<string, unknown>>
    pieData: Array<{ name: string; value: number }>
    yFields: string[]
    chartData100: Array<Record<string, unknown>>
    palette: string[]
    height: number
    showLabels: boolean
    scatterAxes?: { xField: string; yField: string }
    xAxisLabel?: string
    yAxisLabel?: string
    onXClick?: (value: unknown) => void
    activeCrossValue?: unknown
    heatmapData?: HeatmapData
    calendarData?: CalendarData
    sankeyData?: SankeyData
    rField?: string
}

function renderChart({
    chartType,
    chartData,
    pieData,
    yFields,
    chartData100,
    palette,
    height,
    showLabels,
    scatterAxes,
    xAxisLabel,
    yAxisLabel,
    onXClick,
    activeCrossValue,
    heatmapData,
    calendarData,
    sankeyData,
    rField,
}: ChartRenderParams) {
    const axisLabelStyle = { fontSize: 10, fill: '#888' }
    const clickStyle = onXClick ? { cursor: 'pointer' } : {}

    const cellOpacity = (xVal: unknown) =>
        activeCrossValue == null ? 1 : String(xVal) === String(activeCrossValue) ? 1 : 0.28

    const bottomMargin = 30
    // Show at most ~10 X labels; interval=0 means show all, interval=N means show every (N+1)-th
    const xInterval = chartData.length > 10 ? Math.ceil(chartData.length / 10) - 1 : 0

    const commonAxis = (
        <>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
            <XAxis
                dataKey="_x"
                tick={{ fontSize: 11 }}
                tickFormatter={FMT_TICK}
                interval={xInterval}
                height={30}
                label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottom', offset: -12, style: axisLabelStyle } : undefined}
            />
            <YAxis
                tick={{ fontSize: 11 }}
                width={yAxisLabel ? 78 : 64}
                label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', style: axisLabelStyle } : undefined}
            />
            <RTooltip />
            <Legend wrapperStyle={LEGEND_STYLE} formatter={FMT_LEGEND} />
        </>
    )

    switch (chartType) {
        case 'pie': {
            const top = pieData.slice(0, 20)
            const outerRadius = Math.min(Math.floor((height - 80) * 0.44), 150)
            const renderPieLabel = (props: any) => {
                const { cx, cy, midAngle, innerRadius, outerRadius: or, percent } = props as { cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number }
                if ((percent ?? 0) < 0.04) return null
                const R = Math.PI / 180
                const r = innerRadius + (or - innerRadius) * 0.58
                return (
                    <text
                        x={cx + r * Math.cos(-midAngle * R)}
                        y={cy + r * Math.sin(-midAngle * R)}
                        fill="#fff" textAnchor="middle" dominantBaseline="central"
                        fontSize={11} fontWeight={700}
                    >
                        {`${(percent * 100).toFixed(1)}%`}
                    </text>
                )
            }
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                        <Pie
                            data={top}
                            dataKey="value"
                            nameKey="name"
                            cx="50%" cy="45%"
                            outerRadius={Math.max(50, outerRadius)}
                            labelLine={false}
                            label={renderPieLabel}
                            onClick={(data) => onXClick?.(data?.name)}
                            style={clickStyle}
                        >
                            {top.map((entry, index) => (
                                <Cell key={index} fill={palette[index % palette.length]} opacity={cellOpacity(entry.name)} />
                            ))}
                        </Pie>
                        <RTooltip formatter={(value, name) => [value, name]} />
                        <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: 11, lineHeight: '18px', paddingTop: 8 }} formatter={(value) => String(value)} />
                    </PieChart>
                </ResponsiveContainer>
            )
        }
        case 'scatter': {
            const xName = xAxisLabel || scatterAxes?.xField || 'X'
            const yName = yAxisLabel || scatterAxes?.yField || 'Y'
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <ScatterChart margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="x" type="number" tick={{ fontSize: 11 }}>
                            <Label value={xName} position="insideBottom" offset={-10} style={{ fontSize: 11 }} />
                        </XAxis>
                        <YAxis dataKey="y" type="number" tick={{ fontSize: 11 }} width={64}>
                            <Label value={yName} angle={-90} position="insideLeft" style={{ fontSize: 11 }} />
                        </YAxis>
                        <RTooltip cursor={{ strokeDasharray: '3 3' }} />
                        {yFields.length > 1 && <Legend wrapperStyle={LEGEND_STYLE} formatter={FMT_LEGEND} />}
                        {yFields.map((yField, index) => {
                            const seriesData = chartData
                                .filter((d) => d[yField] != null)
                                .map((d) => ({ x: d.x as number, y: d[yField] as number }))
                            return <Scatter key={yField} name={yField} data={seriesData} fill={palette[index % palette.length]} opacity={0.65} />
                        })}
                    </ScatterChart>
                </ResponsiveContainer>
            )
        }
        case 'bar':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <BarChart data={chartData} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: bottomMargin }} onClick={(d) => d?.activeLabel != null && onXClick?.(d.activeLabel)} style={clickStyle}>
                        {commonAxis}
                        {yFields.map((yField, index) => (
                            <Bar key={yField} dataKey={yField} fill={palette[index % palette.length]} radius={[3, 3, 0, 0]}>
                                {activeCrossValue != null && chartData.map((entry, i) => (
                                    <Cell key={i} fill={palette[index % palette.length]} opacity={cellOpacity(entry._x)} />
                                ))}
                                {showLabels && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                            </Bar>
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            )
        case 'bar_h':
            return (
                <ResponsiveContainer width="100%" height={Math.max(height, chartData.length * 28 + 60)}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: showLabels ? 56 : 24, top: 10, bottom: 10 }} onClick={(d) => d?.activeLabel != null && onXClick?.(d.activeLabel)} style={clickStyle}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis
                            type="category"
                            dataKey="_x"
                            width={150}
                            tick={{ fontSize: 11 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => {
                                const text = String(value ?? '')
                                return text.length > 24 ? `${text.slice(0, 23)}...` : text
                            }}
                        />
                        <RTooltip />
                        <Legend wrapperStyle={LEGEND_STYLE} formatter={FMT_LEGEND} />
                        {yFields.map((yField, index) => (
                            <Bar key={yField} dataKey={yField} fill={palette[index % palette.length]} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                                {activeCrossValue != null && chartData.map((entry, i) => (
                                    <Cell key={i} fill={palette[index % palette.length]} opacity={cellOpacity(entry._x)} />
                                ))}
                                {showLabels && <LabelList dataKey={yField} position="right" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                            </Bar>
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            )
        case 'bar_stacked':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <BarChart data={chartData} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: bottomMargin }} onClick={(d) => d?.activeLabel != null && onXClick?.(d.activeLabel)} style={clickStyle}>
                        {commonAxis}
                        {yFields.map((yField, index) => (
                            <Bar key={yField} dataKey={yField} stackId="stack" fill={palette[index % palette.length]}>
                                {activeCrossValue != null && chartData.map((entry, i) => (
                                    <Cell key={i} fill={palette[index % palette.length]} opacity={cellOpacity(entry._x)} />
                                ))}
                                {showLabels && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                            </Bar>
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            )
        case 'bar_stacked_pct':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <BarChart data={chartData100} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: bottomMargin }} onClick={(d) => d?.activeLabel != null && onXClick?.(d.activeLabel)} style={clickStyle}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="_x" tick={{ fontSize: 11 }} tickFormatter={FMT_TICK} interval={xInterval} height={30} />
                        <YAxis tick={{ fontSize: 11 }} width={48} tickFormatter={(value) => `${value}%`} domain={[0, 100]} />
                        <RTooltip formatter={(value: number | undefined, name: string | undefined) => [`${value ?? 0}%`, name ?? '']} />
                        <Legend />
                        {yFields.map((yField, index) => (
                            <Bar key={yField} dataKey={yField} stackId="stack" fill={palette[index % palette.length]}>
                                {activeCrossValue != null && chartData100.map((entry, i) => (
                                    <Cell key={i} fill={palette[index % palette.length]} opacity={cellOpacity(entry._x)} />
                                ))}
                                {showLabels && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                            </Bar>
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            )
        case 'line':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <LineChart data={chartData} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: bottomMargin }} onClick={(d) => d?.activeLabel != null && onXClick?.(d.activeLabel)} style={clickStyle}>
                        {commonAxis}
                        {yFields.map((yField, index) => (
                            <Line key={yField} dataKey={yField} stroke={palette[index % palette.length]} dot={chartData.length < 100} strokeWidth={2}>
                                {showLabels && chartData.length <= 60 && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                            </Line>
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            )
        case 'area':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <AreaChart data={chartData} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: bottomMargin }} onClick={(d) => d?.activeLabel != null && onXClick?.(d.activeLabel)} style={clickStyle}>
                        {commonAxis}
                        {yFields.map((yField, index) => (
                            <Area key={yField} dataKey={yField} stroke={palette[index % palette.length]} fill={palette[index % palette.length]} fillOpacity={0.15} strokeWidth={2} dot={false}>
                                {showLabels && chartData.length <= 60 && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                            </Area>
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            )
        case 'composed':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <ComposedChart data={chartData} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: bottomMargin }} onClick={(d) => d?.activeLabel != null && onXClick?.(d.activeLabel)} style={clickStyle}>
                        {commonAxis}
                        {yFields.map((yField, index) =>
                            index === 0
                                ? <Bar key={yField} dataKey={yField} fill={palette[0]} radius={[3, 3, 0, 0]} yAxisId={0}>{showLabels && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}</Bar>
                                : <Line key={yField} dataKey={yField} stroke={palette[index % palette.length]} strokeWidth={2} dot={false} yAxisId={0}>{showLabels && chartData.length <= 60 && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}</Line>
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            )
        case 'radar': {
            const radarData = chartData.slice(0, 30).map((row) => {
                const out: Record<string, unknown> = { subject: String(row._x).length > 18 ? `${String(row._x).slice(0, 17)}…` : row._x }
                for (const yField of yFields) out[yField] = Number(row[yField]) || 0
                return out
            })
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <RadarChart cx="50%" cy="50%" outerRadius={Math.floor(height * 0.38)} data={radarData}>
                        <PolarGrid /><PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} /><PolarRadiusAxis tick={{ fontSize: 10 }} />
                        {yFields.map((yField, index) => <Radar key={yField} name={yField} dataKey={yField} stroke={palette[index % palette.length]} fill={palette[index % palette.length]} fillOpacity={0.2} />)}
                        <RTooltip /><Legend wrapperStyle={LEGEND_STYLE} formatter={FMT_LEGEND} />
                    </RadarChart>
                </ResponsiveContainer>
            )
        }
        case 'radialbar': {
            const radialBarData = pieData.slice(0, 12).map((item, index) => ({ name: item.name, value: item.value, fill: palette[index % palette.length] }))
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <RadialBarChart cx="50%" cy="50%" innerRadius="15%" outerRadius="90%" data={radialBarData}>
                        <RadialBar dataKey="value" label={{ position: 'insideStart', fill: '#fff', fontSize: 11 }} />
                        <RTooltip /><Legend iconSize={10} layout="horizontal" verticalAlign="bottom" wrapperStyle={LEGEND_STYLE} formatter={FMT_LEGEND} />
                    </RadialBarChart>
                </ResponsiveContainer>
            )
        }
        case 'funnel': {
            const funnelData = pieData.slice(0, 16).map((item, index) => ({ name: item.name, value: item.value, fill: palette[index % palette.length] }))
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <FunnelChart>
                        <RTooltip />
                        <Funnel dataKey="value" data={funnelData} isAnimationActive>
                            <LabelList position="right" fill="#555" stroke="none" dataKey="name" style={{ fontSize: 11 }} />
                        </Funnel>
                    </FunnelChart>
                </ResponsiveContainer>
            )
        }
        case 'treemap': {
            const treemapData = pieData.slice(0, 40).map((item, index) => ({ name: item.name, size: item.value, fill: palette[index % palette.length] }))
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <Treemap data={treemapData} dataKey="size" aspectRatio={4 / 3} stroke="#fff"
                        content={({ x, y, width, height: h, name, fill }: any) => (
                            <g>
                                <rect x={x} y={y} width={width} height={h} fill={fill} stroke="#fff" strokeWidth={2} rx={4} />
                                {width > 40 && h > 24 && (
                                    <text x={x + width / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fill="#fff" style={{ fontSize: Math.min(13, Math.max(9, width / 8)) }}>
                                        {String(name).length > 14 ? `${String(name).slice(0, 13)}…` : name}
                                    </text>
                                )}
                            </g>
                        )}
                    />
                </ResponsiveContainer>
            )
        }
        case 'bubble': {
            const xName = xAxisLabel || scatterAxes?.xField || 'X'
            const yName = yAxisLabel || scatterAxes?.yField || 'Y'
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <ScatterChart margin={{ left: 10, right: 20, top: 10, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="x" type="number" tick={{ fontSize: 11 }}>
                            <Label value={xName} position="insideBottom" offset={-10} style={{ fontSize: 11 }} />
                        </XAxis>
                        <YAxis dataKey="y" type="number" tick={{ fontSize: 11 }} width={64}>
                            <Label value={yName} angle={-90} position="insideLeft" style={{ fontSize: 11 }} />
                        </YAxis>
                        <ZAxis dataKey="r" type="number" range={[30, 900]} name={rField ?? 'r'} />
                        <RTooltip cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter data={chartData} fill={palette[0]} opacity={0.65} />
                    </ScatterChart>
                </ResponsiveContainer>
            )
        }
        case 'histogram':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <BarChart data={chartData} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="_x" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                        <YAxis tick={{ fontSize: 11 }} width={48} />
                        <RTooltip />
                        <Bar dataKey="count" fill={palette[0]} radius={[2, 2, 0, 0]}>
                            {showLabels && <LabelList dataKey="count" position="top" style={{ fontSize: 10 }} />}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            )
        case 'waterfall':
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <BarChart data={chartData} margin={{ left: 10, right: 10, top: showLabels ? 20 : 10, bottom: bottomMargin }} style={clickStyle}>
                        {commonAxis}
                        <Bar dataKey="base" fill="transparent" stackId="wf" isAnimationActive={false} legendType="none" />
                        <Bar dataKey="delta" stackId="wf" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                            {chartData.map((entry, i) => (
                                <Cell key={i} fill={entry.isPositive ? '#10b981' : '#ef4444'} opacity={activeCrossValue != null ? cellOpacity(entry._x) : 1} />
                            ))}
                            {showLabels && <LabelList dataKey="total" position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            )
        case 'heatmap': {
            if (!heatmapData || heatmapData.cells.length === 0) return null
            const { xLabels, yLabels, cells, min, max } = heatmapData
            const range = max - min || 1
            const CELL_W = Math.max(24, Math.min(80, Math.floor(560 / (xLabels.length + 1))))
            const CELL_H = Math.max(20, Math.min(60, Math.floor((height - 60) / (yLabels.length + 1))))
            const svgW = CELL_W * (xLabels.length + 1) + 8
            const svgH = CELL_H * (yLabels.length + 1) + 8
            const baseColor = palette[0] ?? '#3b82f6'
            const interpolate = (v: number) => {
                const t = (v - min) / range
                return `color-mix(in srgb, ${baseColor} ${Math.round(t * 100)}%, white)`
            }
            return (
                <Box sx={{ overflow: 'auto', maxHeight: height }}>
                    <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                        {xLabels.map((x, xi) => (
                            <text key={x} x={(xi + 1) * CELL_W + CELL_W / 2} y={CELL_H - 4} textAnchor="middle" fontSize={10} fill="#555">
                                {String(x).length > 8 ? String(x).slice(0, 7) + '…' : x}
                            </text>
                        ))}
                        {yLabels.map((y, yi) => (
                            <text key={y} x={CELL_W - 4} y={(yi + 1) * CELL_H + CELL_H / 2} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#555">
                                {String(y).length > 10 ? String(y).slice(0, 9) + '…' : y}
                            </text>
                        ))}
                        {cells.map(({ x, y, value }) => {
                            const xi = xLabels.indexOf(x)
                            const yi = yLabels.indexOf(y)
                            return (
                                <g key={`${x}:${y}`} onClick={() => onXClick?.(x)} style={clickStyle}>
                                    <rect x={(xi + 1) * CELL_W + 1} y={(yi + 1) * CELL_H + 1} width={CELL_W - 2} height={CELL_H - 2} fill={interpolate(value)} rx={3} />
                                    {CELL_W > 36 && CELL_H > 20 && (
                                        <text x={(xi + 1) * CELL_W + CELL_W / 2} y={(yi + 1) * CELL_H + CELL_H / 2} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="#333">
                                            {FMT_LABEL(value)}
                                        </text>
                                    )}
                                </g>
                            )
                        })}
                    </svg>
                </Box>
            )
        }
        case 'calendar': {
            if (!calendarData) return null
            const { grid, monthLabels, min, max, year } = calendarData
            const range = max - min || 1
            const CW = 14
            const CH = 13
            const TOP = 22
            const LEFT = 28
            const totalWeeks = grid.length
            const svgW = LEFT + totalWeeks * CW + 16
            const svgH = TOP + 7 * CH + 8
            const baseColor = palette[0] ?? '#3b82f6'
            const interpolate = (v: number) => {
                const t = (v - min) / range
                return `color-mix(in srgb, ${baseColor} ${Math.round(t * 100)}%, white)`
            }
            const DAY_LABELS = ['Пн', '', 'Ср', '', 'Пт', '', 'Вс']
            return (
                <Box sx={{ overflow: 'auto', maxHeight: height, p: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, ml: '28px' }}>{year}</Typography>
                    <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                        {DAY_LABELS.map((label, di) => label ? (
                            <text key={di} x={LEFT - 4} y={TOP + di * CH + CH / 2} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#888">{label}</text>
                        ) : null)}
                        {monthLabels.map(({ label, col }) => (
                            <text key={label} x={LEFT + col * CW + CW / 2} y={TOP - 6} fontSize={9} fill="#555" textAnchor="middle">{label}</text>
                        ))}
                        {grid.map((week, wi) =>
                            week.map((cell, di) => {
                                if (!cell) return null
                                const cx = LEFT + wi * CW
                                const cy = TOP + di * CH
                                const v = cell.value
                                return (
                                    <g key={`${wi}-${di}`}>
                                        <rect x={cx + 1} y={cy + 1} width={CW - 2} height={CH - 2} fill={v !== null ? interpolate(v) : '#f0f0f0'} rx={2} />
                                        <title>{cell.date}: {v !== null ? FMT_LABEL(v) : 'нет данных'}</title>
                                    </g>
                                )
                            })
                        )}
                    </svg>
                </Box>
            )
        }
        case 'pareto': {
            const yField = yFields[0] ?? ''
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <ComposedChart data={chartData} margin={{ left: 10, right: 48, top: showLabels ? 20 : 10, bottom: bottomMargin }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
                        <XAxis dataKey="_x" tick={{ fontSize: 11 }} tickFormatter={FMT_TICK} interval={xInterval} height={30} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={64} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={48} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <RTooltip formatter={(value, name) => name === 'cumPct' ? [`${value}%`, 'Накопл. %'] : [value, String(name)]} />
                        <Legend wrapperStyle={LEGEND_STYLE} formatter={(value) => value === 'cumPct' ? 'Накопл. %' : FMT_LEGEND(value)} />
                        <Bar yAxisId="left" dataKey={yField} fill={palette[0]} radius={[3, 3, 0, 0]}>
                            {showLabels && <LabelList dataKey={yField} position="top" style={{ fontSize: 10 }} formatter={FMT_LABEL} />}
                        </Bar>
                        <Line yAxisId="right" dataKey="cumPct" stroke={palette[1] ?? '#ef4444'} strokeWidth={2} dot={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            )
        }
        case 'sankey': {
            if (!sankeyData || sankeyData.nodes.length === 0) return null
            const nodePad = Math.max(4, Math.min(20, Math.floor((height - 32) / Math.max(1, sankeyData.nodes.length))))
            const SankeyNode = (props: any) => {
                const { x, y, width, height: nh, index, payload } = props as { x: number; y: number; width: number; height: number; index: number; payload: { name: string } }
                const col = palette[index % palette.length]
                const h = Math.max(2, nh)
                return (
                    <g>
                        <rect x={x} y={y} width={width} height={h} fill={col} rx={2} opacity={0.9} />
                        <text x={x + width + 6} y={y + h / 2} dy="0.35em" textAnchor="start" fontSize={11} fill="#555" style={{ userSelect: 'none' }}>
                            {String(payload?.name ?? '').slice(0, 22)}
                        </text>
                    </g>
                )
            }
            const SankeyLink = (props: any) => {
                const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth, index } = props as { sourceX: number; sourceY: number; sourceControlX: number; targetX: number; targetY: number; targetControlX: number; linkWidth: number; index: number }
                const col = palette[sankeyData.links[index]?.source % palette.length] ?? palette[0]
                return (
                    <path
                        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                        strokeWidth={Math.max(1, linkWidth)}
                        stroke={col + '66'}
                        fill={col + '22'}
                    />
                )
            }
            return (
                <ResponsiveContainer width="100%" height={height}>
                    <Sankey
                        width={600}
                        height={height - 4}
                        data={sankeyData}
                        nodeWidth={14}
                        nodePadding={nodePad}
                        margin={{ top: 8, right: 150, bottom: 8, left: 8 }}
                        node={<SankeyNode />}
                        link={<SankeyLink />}
                    >
                        <RTooltip />
                    </Sankey>
                </ResponsiveContainer>
            )
        }
        case 'boxplot': {
            if (!chartData.length) return null
            const allVals = chartData.flatMap(d => [d.min as number, d.max as number]).filter(Number.isFinite)
            const globalMin = Math.min(...allVals)
            const globalMax = Math.max(...allVals)
            const gRange = globalMax - globalMin || 1
            const PAD_L = 60, PAD_T = 16, PAD_B = 40, PAD_R = 16
            const BOX_W = Math.max(24, Math.min(60, Math.floor(500 / chartData.length)))
            const GAP = 12
            const svgW = PAD_L + chartData.length * (BOX_W + GAP) + PAD_R
            const svgH = height
            const plotH = svgH - PAD_T - PAD_B
            const toY = (v: number) => PAD_T + plotH - ((v - globalMin) / gRange) * plotH
            return (
                <Box sx={{ overflow: 'auto' }}>
                    <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                        {Array.from({ length: 6 }, (_, i) => {
                            const v = globalMin + (gRange * i) / 5
                            const y = toY(v)
                            return (
                                <g key={i}>
                                    <line x1={PAD_L} y1={y} x2={svgW - PAD_R} y2={y} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
                                    <text x={PAD_L - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#888">{FMT_LABEL(v)}</text>
                                </g>
                            )
                        })}
                        {chartData.map((d, i) => {
                            const cx = PAD_L + i * (BOX_W + GAP) + BOX_W / 2
                            const x1 = PAD_L + i * (BOX_W + GAP)
                            const x2 = x1 + BOX_W
                            const yMin = toY(d.min as number)
                            const yQ1 = toY(d.q1 as number)
                            const yMed = toY(d.median as number)
                            const yQ3 = toY(d.q3 as number)
                            const yMax = toY(d.max as number)
                            const col = palette[i % palette.length]
                            const hw = BOX_W * 0.25
                            return (
                                <g key={i}>
                                    <line x1={cx} y1={yMin} x2={cx} y2={yMax} stroke={col} strokeWidth={1.5} />
                                    <line x1={cx - hw} y1={yMin} x2={cx + hw} y2={yMin} stroke={col} strokeWidth={1.5} />
                                    <line x1={cx - hw} y1={yMax} x2={cx + hw} y2={yMax} stroke={col} strokeWidth={1.5} />
                                    <rect x={x1} y={yQ3} width={BOX_W} height={Math.abs(yQ1 - yQ3)} fill={col + '33'} stroke={col} strokeWidth={1.5} rx={2} />
                                    <line x1={x1} y1={yMed} x2={x2} y2={yMed} stroke={col} strokeWidth={2.5} />
                                    <text x={cx} y={svgH - PAD_B + 14} textAnchor="middle" fontSize={10} fill="#555">
                                        {String(d._x).length > 10 ? `${String(d._x).slice(0, 9)}…` : String(d._x)}
                                    </text>
                                </g>
                            )
                        })}
                    </svg>
                </Box>
            )
        }
        default:
            return null
    }
}

// ─── ChartCard ────────────────────────────────────────────────────────────────

interface ChartCardProps {
    widget: WidgetConfig
    tableState?: TableState
    prepared: PreparedWidgetData | null
    isRowsLoading: boolean
    onEdit: (id: string) => void
    onDelete: (id: string) => void
    onSpanChange: (id: string, span: ColSpan) => void
    onHeightChange: (id: string, height: number) => void
    onWidthChange: (id: string, widthPx: number | undefined) => void
    onCrossFilter: (field: string, value: unknown) => void
    activeCrossValue?: unknown
    isCrossFilterSource: boolean
    calcColumns?: ColumnConfig[]
    sortableRef?: (el: HTMLDivElement | null) => void
    sortableStyle?: React.CSSProperties
    dragListeners?: Record<string, (e: Event) => void>
    dragAttributes?: DraggableAttributes
    isDragging?: boolean
}

const VALID_SPANS: ColSpan[] = [3, 4, 6, 12]
const CHART_PAN_BASE_RATIO = 0.45

function ChartCard({
    widget, tableState, prepared, isRowsLoading,
    onEdit, onDelete, onSpanChange, onHeightChange, onWidthChange,
    onCrossFilter, activeCrossValue, isCrossFilterSource, calcColumns,
    sortableRef, sortableStyle, dragListeners, dragAttributes, isDragging,
}: ChartCardProps) {
    const [showControls, setShowControls] = useState(false)
    const [tablePage, setTablePage] = useState(0)
    const [tableRowsPerPage, setTableRowsPerPage] = useState(widget.tablePageSize ?? 20)
    const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null)
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [isPanning, setIsPanning] = useState(false)
    const zoomRef = useRef(1)
    const panRef = useRef({ x: 0, y: 0 })
    const isDraggingRef = useRef(false)
    const lastPosRef = useRef({ x: 0, y: 0 })
    const panDistanceRef = useRef(0)
    const suppressChartClickRef = useRef(false)
    const chartZoomRef = useRef<HTMLDivElement | null>(null)
    const cardRef = useRef<HTMLDivElement | null>(null)
    const setCardRef = useCallback((el: HTMLDivElement | null) => {
        cardRef.current = el
        sortableRef?.(el)
    }, [sortableRef])
    const startY = useRef(0)
    const startHeight = useRef(widget.height)

    useEffect(() => { setTableRowsPerPage(widget.tablePageSize ?? 20); setTablePage(0) }, [widget.tablePageSize])
    const startX = useRef(0)
    const startWidth = useRef(0)

    // Reset to page 0 when widget changes or data length changes (e.g. after filter applied)
    const tableDataLength = prepared?.status === 'ok' && prepared.tableData ? prepared.tableData.length : 0
    useEffect(() => { setTablePage(0) }, [widget.id, tableDataLength])
    const [selectedTableRows, setSelectedTableRows] = useState<Set<number>>(() => new Set())
    useEffect(() => { setSelectedTableRows(new Set()) }, [widget.id, tableDataLength])

    const onBottomMouseDown = (event: React.MouseEvent) => {
        event.preventDefault()
        startY.current = event.clientY
        startHeight.current = widget.height
        const onMove = (e: MouseEvent) => onHeightChange(widget.id, Math.round(Math.max(200, Math.min(800, startHeight.current + e.clientY - startY.current)) / 10) * 10)
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    const onRightMouseDown = (event: React.MouseEvent) => {
        event.preventDefault()
        startX.current = event.clientX
        startWidth.current = cardRef.current?.getBoundingClientRect().width ?? 300
        const gridWidth = cardRef.current?.parentElement?.getBoundingClientRect().width ?? 1200
        const onMove = (e: MouseEvent) => onWidthChange(widget.id, Math.round(Math.max(200, Math.min(gridWidth, startWidth.current + e.clientX - startX.current))))
        const onUp = (e: MouseEvent) => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            const finalWidth = Math.max(200, Math.min(gridWidth, startWidth.current + e.clientX - startX.current))
            const nearest = VALID_SPANS.reduce((prev, curr) => Math.abs(curr - finalWidth / (gridWidth / 12)) < Math.abs(prev - finalWidth / (gridWidth / 12)) ? curr : prev)
            onSpanChange(widget.id, nearest)
            onWidthChange(widget.id, undefined)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    const palette = COLOR_SWATCHES[widget.swatchIdx] ?? COLOR_SWATCHES[0]
    const allCols = [...(tableState?.columns ?? []), ...(calcColumns ?? [])]

    const xColLabel = allCols.find((c) => c.field === widget.xField)?.headerName ?? widget.xField
    const yColLabels = widget.yFields.map((f) => allCols.find((c) => c.field === f)?.headerName ?? f)
    const metaParts = [
        xColLabel && `X: ${widget.xAxisLabel || xColLabel}`,
        yColLabels.length > 0 && `Y: ${yColLabels.map((l, i) => widget.yAxisLabel && i === 0 ? widget.yAxisLabel : l).join(', ')}`,
        widget.aggFn !== 'none' && AGG_LABELS[widget.aggFn],
    ].filter(Boolean)

    const isKpi = KPI_TYPES.includes(widget.chartType)
    const isTable = TABLE_TYPES.includes(widget.chartType)

    const clampPan = useCallback((nextPan: { x: number; y: number }, nextZoom = zoomRef.current) => {
        const rect = chartZoomRef.current?.getBoundingClientRect()
        if (!rect) return nextPan
        const overflowX = Math.max(0, (rect.width * nextZoom - rect.width) / 2)
        const overflowY = Math.max(0, (rect.height * nextZoom - rect.height) / 2)
        const minTravelX = Math.max(48, rect.width * CHART_PAN_BASE_RATIO)
        const minTravelY = Math.max(48, rect.height * CHART_PAN_BASE_RATIO)
        const maxX = overflowX + minTravelX
        const maxY = overflowY + minTravelY
        return {
            x: Math.round(Math.max(-maxX, Math.min(maxX, nextPan.x))),
            y: Math.round(Math.max(-maxY, Math.min(maxY, nextPan.y))),
        }
    }, [])

    const setBoundedPan = useCallback((nextPan: { x: number; y: number }, nextZoom = zoomRef.current) => {
        const bounded = clampPan(nextPan, nextZoom)
        panRef.current = bounded
        setPan(bounded)
    }, [clampPan])

    const resetChartView = useCallback(() => {
        zoomRef.current = 1
        setZoom(1)
        setBoundedPan({ x: 0, y: 0 }, 1)
        setIsPanning(false)
    }, [setBoundedPan])

    const handleChartPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        if ((event.target as HTMLElement).closest('[data-chart-reset]')) return
        event.preventDefault()
        event.stopPropagation()
        isDraggingRef.current = true
        panDistanceRef.current = 0
        lastPosRef.current = { x: event.clientX, y: event.clientY }
        setIsPanning(true)
        try {
            event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
            // Pointer capture can fail if the pointer has already been released.
        }
    }, [])

    const finishChartPan = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
        if (!isDraggingRef.current) return
        isDraggingRef.current = false
        setIsPanning(false)
        if (event) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId)
            } catch {
                // Ignore release races during fast pointer cancellation.
            }
        }
        if (panDistanceRef.current > 4) {
            suppressChartClickRef.current = true
            window.setTimeout(() => {
                suppressChartClickRef.current = false
            }, 120)
        }
    }, [])

    const handleChartPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!isDraggingRef.current) return
        event.preventDefault()
        const dx = event.clientX - lastPosRef.current.x
        const dy = event.clientY - lastPosRef.current.y
        lastPosRef.current = { x: event.clientX, y: event.clientY }
        if (dx === 0 && dy === 0) return
        panDistanceRef.current += Math.abs(dx) + Math.abs(dy)
        setBoundedPan({ x: panRef.current.x + dx, y: panRef.current.y + dy })
    }, [setBoundedPan])

    const handleCrossFilterClick = useCallback((value: unknown) => {
        if (suppressChartClickRef.current) return
        onCrossFilter(widget.xField, value)
    }, [onCrossFilter, widget.xField])

    useEffect(() => {
        const el = chartZoomRef.current
        if (!el) return
        const handler = (e: WheelEvent) => {
            e.preventDefault()
            const current = zoomRef.current
            const next = Math.min(3, Math.max(0.4, Math.round((current + (e.deltaY > 0 ? -0.1 : 0.1)) * 10) / 10))
            zoomRef.current = next
            setZoom(next)
            setBoundedPan(panRef.current, next)
        }
        el.addEventListener('wheel', handler, { passive: false })
        return () => el.removeEventListener('wheel', handler)
    }, [isKpi, isTable, setBoundedPan])

    return (
        <Paper
            ref={setCardRef}
            variant="outlined"
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
            sx={{ borderRadius: 2, overflow: 'hidden', position: 'relative', gridColumn: widget.widthPx ? 'auto' : `span ${widget.span}`, width: widget.widthPx ? `${widget.widthPx}px` : undefined, minWidth: 200, opacity: isDragging ? 0.45 : 1, ...sortableStyle }}
        >
            {/* Header */}
            <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }} noWrap>
                        {widget.title || CHART_TYPES.find((ct) => ct.type === widget.chartType)?.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ mr: 0.5 }}>{tableState?.fileName ?? '—'}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.25, alignItems: 'center', opacity: showControls ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: showControls ? 'auto' : 'none' }}>
                        <Tooltip title="Перетащить" arrow>
                            <Box
                                component="button"
                                type="button"
                                aria-label="Перетащить виджет"
                                {...(dragListeners ?? {})}
                                {...(dragAttributes ?? {})}
                                sx={{ cursor: 'grab', touchAction: 'none', background: 'none', border: 'none', p: 0.5, borderRadius: 1, display: 'inline-flex', alignItems: 'center', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover' } }}
                            >
                                <DragIndicatorIcon sx={{ fontSize: 16 }} />
                            </Box>
                        </Tooltip>
                        <Tooltip title="Редактировать" arrow>
                            <IconButton size="small" onClick={() => onEdit(widget.id)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                        </Tooltip>
                        <Tooltip title="Удалить" arrow>
                            <IconButton size="small" color="error" onClick={() => onDelete(widget.id)}><DeleteOutlineIcon sx={{ fontSize: 16 }} /></IconButton>
                        </Tooltip>
                        <Tooltip title="Ещё" arrow>
                            <IconButton size="small" onClick={e => setMenuAnchor(e.currentTarget)}><MoreVertIcon sx={{ fontSize: 16 }} /></IconButton>
                        </Tooltip>
                    </Box>
                    <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
                        {prepared?.status === 'ok' && (() => {
                            const tableExportData = prepared.tableData && selectedTableRows.size > 0
                                ? prepared.tableData.filter((_, idx) => selectedTableRows.has(idx))
                                : prepared.tableData
                            const exportData = tableExportData ?? prepared.chartData
                            if (!exportData?.length) return null
                            return (
                                <MenuItem dense sx={{ fontSize: '0.8rem' }} onClick={() => {
                                    const headers = Object.keys(exportData[0])
                                    const rows = exportData.map(row => headers.map(h => {
                                        const v = row[h]
                                        return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v ?? '')
                                    }).join(','))
                                    const csv = [headers.join(','), ...rows].join('\n')
                                    const a = Object.assign(document.createElement('a'), {
                                        href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
                                        download: `${widget.title || widget.chartType}.csv`,
                                    })
                                    a.click()
                                    URL.revokeObjectURL(a.href)
                                    setMenuAnchor(null)
                                }}>
                                    <DownloadIcon sx={{ fontSize: 14, mr: 1 }} />{prepared.tableData && selectedTableRows.size > 0 ? 'Экспорт выбранных CSV' : 'Экспорт CSV'}
                                </MenuItem>
                            )
                        })()}
                        <Divider sx={{ my: 0.5 }} />
                        <MenuItem dense onClick={() => {
                            setMenuAnchor(null)
                            const el = cardRef.current
                            if (!el) return
                            void toPng(el, { cacheBust: true, backgroundColor: '#ffffff', pixelRatio: 2 }).then(url => {
                                Object.assign(document.createElement('a'), { href: url, download: `${widget.title || widget.chartType}.png` }).click()
                            })
                        }}>
                            <ImageIcon sx={{ fontSize: 14, mr: 1 }} />Сохранить как PNG
                        </MenuItem>
                        <MenuItem dense onClick={() => {
                            setMenuAnchor(null)
                            const el = cardRef.current
                            if (!el) return
                            void toJpeg(el, { cacheBust: true, backgroundColor: '#ffffff', pixelRatio: 2, quality: 0.95 }).then(url => {
                                Object.assign(document.createElement('a'), { href: url, download: `${widget.title || widget.chartType}.jpg` }).click()
                            })
                        }}>
                            <ImageIcon sx={{ fontSize: 14, mr: 1 }} />Сохранить как JPEG
                        </MenuItem>
                    </Menu>
                </Box>
                {metaParts.length > 0 && (
                    <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block', mt: 0.25 }}>
                        {metaParts.join(' · ')}
                    </Typography>
                )}
                {isCrossFilterSource && (
                    <Typography variant="caption" sx={{ color: 'primary.main', display: 'block', mt: 0.25 }}>
                        ● источник фильтра: {String(activeCrossValue)}
                    </Typography>
                )}
            </Box>

            {/* Body */}
            <Box sx={{ px: isTable ? 0 : 1, pb: isTable ? 0 : 2 }}>
                {isRowsLoading && (
                    <Box sx={{ px: 1.5, pb: 1.5 }}>
                        <Skeleton variant="rectangular" height={widget.height} sx={{ borderRadius: 1.5 }} animation="wave" />
                    </Box>
                )}

                {!isRowsLoading && prepared?.status === 'error' && (
                    <Box sx={{ px: 1, pb: 1 }}>
                        <Alert severity="error" sx={{ borderRadius: 2 }} action={<Stack direction="row" spacing={1}><Button color="inherit" size="small" onClick={() => onEdit(widget.id)}>Изменить</Button><Button color="inherit" size="small" onClick={() => onDelete(widget.id)}>Удалить</Button></Stack>}>
                            {prepared.message}
                        </Alert>
                    </Box>
                )}

                {!isRowsLoading && prepared?.status === 'ok' && (
                    <>
                        {prepared.rowsMeta.isTruncated && !isKpi && !isTable && (
                            <Alert severity="warning" sx={{ mb: 1, borderRadius: 2 }}>
                                График построен по первым {prepared.rowsMeta.usedRows} строкам из {prepared.rowsMeta.totalRows}.
                            </Alert>
                        )}

                        {/* KPI */}
                        {isKpi && prepared.kpiData && renderKpi(
                            prepared.kpiData,
                            widget.height,
                            allCols.find(c => c.field === prepared.yFields[0])?.headerName ?? prepared.yFields[0] ?? '',
                            palette,
                        )}

                        {/* Table */}
                        {isTable && prepared.tableData && (() => {
                            const tableData = prepared.tableData
                            const pageRows = tableData.slice(tablePage * tableRowsPerPage, (tablePage + 1) * tableRowsPerPage)
                            const selectedCount = selectedTableRows.size
                            const allSelected = tableData.length > 0 && selectedCount === tableData.length
                            const someSelected = selectedCount > 0 && selectedCount < tableData.length
                            const setAllRowsSelected = (checked: boolean) => {
                                setSelectedTableRows(checked ? new Set(tableData.map((_, idx) => idx)) : new Set())
                            }
                            const toggleRowSelected = (idx: number, checked: boolean) => {
                                setSelectedTableRows(prev => {
                                    const next = new Set(prev)
                                    if (checked) next.add(idx)
                                    else next.delete(idx)
                                    return next
                                })
                            }
                            const headerCols = [
                                { field: '_x', label: allCols.find(c => c.field === widget.xField)?.headerName ?? widget.xField },
                                ...prepared.yFields.map(f => ({ field: f, label: allCols.find(c => c.field === f)?.headerName ?? f })),
                            ]
                            return (
                                <Box>
                                    <Box sx={{ px: 1.5, py: 0.75, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                                        <Checkbox
                                            size="small"
                                            checked={allSelected}
                                            indeterminate={someSelected}
                                            onChange={(_, checked) => setAllRowsSelected(checked)}
                                            sx={{ p: 0.25 }}
                                        />
                                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                                            Выбрано: {selectedCount.toLocaleString('ru')} из {tableData.length.toLocaleString('ru')}
                                        </Typography>
                                        <Button size="small" onClick={() => setAllRowsSelected(true)} disabled={allSelected || tableData.length === 0}>Все</Button>
                                        <Button size="small" onClick={() => setAllRowsSelected(false)} disabled={selectedCount === 0}>Снять</Button>
                                    </Box>
                                    <TableContainer sx={{ maxHeight: Math.max(160, widget.height - 42) }}>
                                        <Table size="small" stickyHeader>
                                            <TableHead>
                                                <TableRow>
                                                    <TableCell sx={{ width: 42, p: 0.5 }}>
                                                        <Checkbox
                                                            size="small"
                                                            checked={allSelected}
                                                            indeterminate={someSelected}
                                                            onChange={(_, checked) => setAllRowsSelected(checked)}
                                                            sx={{ p: 0.25 }}
                                                        />
                                                    </TableCell>
                                                    {headerCols.map(hc => (
                                                        <TableCell key={hc.field} sx={{ fontWeight: 600, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{hc.label}</TableCell>
                                                    ))}
                                                </TableRow>
                                            </TableHead>
                                            <TableBody>
                                                {pageRows.map((row, idx) => (
                                                    <TableRow key={idx} hover selected={selectedTableRows.has(tablePage * tableRowsPerPage + idx)}>
                                                        <TableCell sx={{ width: 42, p: 0.5 }}>
                                                            <Checkbox
                                                                size="small"
                                                                checked={selectedTableRows.has(tablePage * tableRowsPerPage + idx)}
                                                                onChange={(_, checked) => toggleRowSelected(tablePage * tableRowsPerPage + idx, checked)}
                                                                sx={{ p: 0.25 }}
                                                            />
                                                        </TableCell>
                                                        {headerCols.map(hc => (
                                                            <TableCell key={hc.field} sx={{ fontSize: '0.72rem' }}>
                                                                {hc.field === '_x' ? String(row._x ?? '') : FMT_LABEL(row[hc.field])}
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                    <TablePagination
                                        component="div"
                                        count={tableData.length}
                                        page={tablePage}
                                        onPageChange={(_, p) => setTablePage(p)}
                                        rowsPerPage={tableRowsPerPage}
                                        onRowsPerPageChange={e => { setTableRowsPerPage(Number(e.target.value)); setTablePage(0) }}
                                        rowsPerPageOptions={[10, 20, 50, 100]}
                                        labelRowsPerPage="Строк:"
                                        sx={{ fontSize: '0.7rem', borderTop: '1px solid', borderColor: 'divider' }}
                                    />
                                </Box>
                            )
                        })()}

                        {/* Chart */}
                        {!isKpi && !isTable && (
                            <Box
                                ref={chartZoomRef}
                                onDoubleClick={resetChartView}
                                onPointerDown={handleChartPointerDown}
                                onPointerMove={handleChartPointerMove}
                                onPointerUp={finishChartPan}
                                onPointerCancel={finishChartPan}
                                sx={{
                                    position: 'relative',
                                    userSelect: 'none',
                                    height: widget.height,
                                    overflow: 'hidden',
                                    cursor: isPanning ? 'grabbing' : 'grab',
                                    touchAction: 'none',
                                    '& .recharts-label-list text, & .recharts-cartesian-axis-tick text, & .recharts-label, & .recharts-text': {
                                        pointerEvents: 'none',
                                    },
                                }}
                            >
                                {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
                                    <Box
                                        data-chart-reset="true"
                                        onClick={resetChartView}
                                        sx={{ position: 'absolute', top: 6, right: 10, zIndex: 10, bgcolor: 'rgba(0,0,0,0.08)', borderRadius: '10px', px: 1, py: 0.25, display: 'flex', alignItems: 'center', cursor: 'pointer', '&:hover': { bgcolor: 'rgba(0,0,0,0.15)' } }}
                                    >
                                        <Typography variant="caption" sx={{ fontSize: '0.65rem', lineHeight: 1, color: 'text.secondary' }}>
                                            {Math.round(zoom * 100)}%
                                        </Typography>
                                    </Box>
                                )}
                                <Box sx={{
                                    width: '100%', height: '100%',
                                    transform: (zoom !== 1 || pan.x !== 0 || pan.y !== 0) ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` : undefined,
                                    transformOrigin: 'center',
                                    willChange: zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? 'transform' : undefined,
                                }}>
                                    {renderChart({
                                        chartType: widget.chartType,
                                        chartData: prepared.chartData,
                                        pieData: prepared.pieData,
                                        yFields: prepared.yFields,
                                        chartData100: prepared.chartData100,
                                        palette,
                                        height: widget.height,
                                        showLabels: widget.showLabels ?? false,
                                        scatterAxes: prepared.scatterAxes,
                                        xAxisLabel: widget.xAxisLabel,
                                        yAxisLabel: widget.yAxisLabel,
                                        onXClick: handleCrossFilterClick,
                                        activeCrossValue: isCrossFilterSource ? activeCrossValue : undefined,
                                        heatmapData: prepared.heatmapData,
                                        calendarData: prepared.calendarData,
                                        sankeyData: prepared.sankeyData,
                                        rField: widget.rField,
                                    })}
                                </Box>
                            </Box>
                        )}
                    </>
                )}
            </Box>

            {/* Resize handles */}
            <Box onMouseDown={onBottomMouseDown} sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, cursor: 'ns-resize', opacity: showControls ? 1 : 0, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'primary.50', '&:hover': { bgcolor: 'primary.100' } }}>
                <OpenWithIcon sx={{ fontSize: 12, color: 'primary.main', transform: 'rotate(90deg)' }} />
            </Box>
            <Box onMouseDown={onRightMouseDown} sx={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 8, cursor: 'ew-resize', opacity: showControls ? 1 : 0, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'primary.50', '&:hover': { bgcolor: 'primary.100' } }}>
                <OpenWithIcon sx={{ fontSize: 12, color: 'primary.main' }} />
            </Box>
        </Paper>
    )
}

// ─── CalcFieldsDrawer ─────────────────────────────────────────────────────────

interface CalcFieldsDrawerProps {
    open: boolean
    onClose: () => void
    tableStates: TableState[]
    calcFields: Record<string, CalculatedField[]>
    rowsByTableId: Record<string, ParsedRow[] | undefined>
    onChange: (tableId: string, fields: CalculatedField[]) => void
}

function CalcFieldsDrawer({ open, onClose, tableStates, calcFields, rowsByTableId, onChange }: CalcFieldsDrawerProps) {
    const [editTableId, setEditTableId] = useState<string | null>(null)
    const [editFieldId, setEditFieldId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')
    const [editFormula, setEditFormula] = useState('')

    const startEdit = (tableId: string, field: CalculatedField | null) => {
        setEditTableId(tableId)
        setEditFieldId(field?.id ?? null)
        setEditName(field?.name ?? '')
        setEditFormula(field?.formula ?? '')
    }

    const cancelEdit = () => { setEditTableId(null); setEditFieldId(null) }

    const saveEdit = () => {
        if (!editTableId || !editName.trim() || !editFormula.trim()) return
        const existing = calcFields[editTableId] ?? []
        const next = editFieldId
            ? existing.map(f => f.id === editFieldId ? { ...f, name: editName.trim(), formula: editFormula.trim() } : f)
            : [...existing, { id: `calc_${Date.now()}`, name: editName.trim(), formula: editFormula.trim() }]
        onChange(editTableId, next)
        cancelEdit()
    }

    const deleteField = (tableId: string, id: string) => {
        onChange(tableId, (calcFields[tableId] ?? []).filter(f => f.id !== id))
    }

    const previewCols = editTableId ? (tableStates.find(s => s.id === editTableId)?.columns ?? []) : []
    const previewRows = editTableId ? (rowsByTableId[editTableId] ?? []).slice(0, 3) : []
    const previewValues = previewRows.map(row => evalFormula(editFormula, row, previewCols.map(c => c.field)))

    return (
        <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100vw', md: 480 }, display: 'flex', flexDirection: 'column' } } }}>
            <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
                <FunctionsIcon sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="subtitle1" fontWeight={700} flex={1}>Вычисляемые поля</Typography>
                <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
            </Box>
            <Box sx={{ p: 2.5, overflowY: 'auto', flex: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                    Добавляйте новые колонки по формуле. Используйте поля датасета и операторы +, -, *, /.
                </Typography>
                {tableStates.length === 0 && (
                    <Typography variant="body2" color="text.disabled">Нет загруженных датасетов</Typography>
                )}
                {tableStates.map(ts => {
                    const fields = calcFields[ts.id] ?? []
                    const isEditingThis = editTableId === ts.id
                    const cols = ts.columns
                    return (
                        <Box key={ts.id} sx={{ mb: 3 }}>
                            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 1 }}>
                                {ts.fileName}
                            </Typography>
                            {fields.map(cf => (
                                <Box key={cf.id} sx={{ display: 'flex', alignItems: 'center', mb: 0.75, p: 1.25, borderRadius: 1.5, border: '1px solid', borderColor: 'divider' }}>
                                    <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
                                        <Typography variant="body2" fontWeight={600} noWrap>{cf.name} <Typography component="span" variant="caption" color="primary.main">✱</Typography></Typography>
                                        <Typography variant="caption" color="text.disabled" noWrap sx={{ fontFamily: 'monospace', display: 'block' }}>{cf.formula}</Typography>
                                    </Box>
                                    <IconButton size="small" onClick={() => startEdit(ts.id, cf)}><EditIcon sx={{ fontSize: 15 }} /></IconButton>
                                    <IconButton size="small" color="error" onClick={() => deleteField(ts.id, cf.id)}><DeleteOutlineIcon sx={{ fontSize: 15 }} /></IconButton>
                                </Box>
                            ))}
                            {isEditingThis ? (
                                <Box sx={{ mt: 1, p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: 'primary.light', bgcolor: 'action.hover' }}>
                                    <TextField fullWidth size="small" label="Название поля" value={editName} onChange={e => setEditName(e.target.value)} sx={{ mb: 1.5 }} />
                                    <TextField
                                        fullWidth size="small" label="Формула" value={editFormula}
                                        onChange={e => setEditFormula(e.target.value)}
                                        helperText="Например: price * quantity или (revenue - cost) / revenue * 100"
                                        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.85rem' } } }}
                                        sx={{ mb: 1 }}
                                    />
                                    <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>Доступные поля (нажмите, чтобы вставить):</Typography>
                                    <Box sx={{ mb: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                        {cols.filter(c => c.type === 'number').map(col => (
                                            <Chip key={col.field} label={col.headerName} size="small" variant="outlined"
                                                onClick={() => setEditFormula(f => (f.endsWith(' ') || f === '' ? f : f + ' ') + col.field)}
                                                sx={{ cursor: 'pointer', fontSize: '0.65rem' }}
                                            />
                                        ))}
                                    </Box>
                                    {previewValues.some(v => v !== null) && (
                                        <Typography variant="caption" color="success.main" display="block" mb={1}>
                                            Пример: {previewValues.filter(v => v !== null).map(v => FMT_LABEL(v)).join(' / ')}
                                        </Typography>
                                    )}
                                    {editFormula.trim() && previewValues.every(v => v === null) && previewRows.length > 0 && (
                                        <Typography variant="caption" color="error.main" display="block" mb={1}>
                                            Формула не вычисляется — проверьте названия полей
                                        </Typography>
                                    )}
                                    <Stack direction="row" gap={1}>
                                        <Button size="small" variant="outlined" onClick={cancelEdit} sx={{ flex: 1 }}>Отмена</Button>
                                        <Button size="small" variant="contained" onClick={saveEdit} disabled={!editName.trim() || !editFormula.trim()} sx={{ flex: 2 }}>
                                            {editFieldId ? 'Сохранить' : 'Добавить'}
                                        </Button>
                                    </Stack>
                                </Box>
                            ) : (
                                <Button size="small" startIcon={<AddIcon />} onClick={() => startEdit(ts.id, null)} sx={{ mt: 0.5 }}>
                                    Добавить поле
                                </Button>
                            )}
                        </Box>
                    )
                })}
            </Box>
        </Drawer>
    )
}

// ─── ColTypeChip ─────────────────────────────────────────────────────────────

const COL_TYPE_META: Record<string, { label: string; color: string }> = {
    number:   { label: '#',  color: '#1976d2' },
    string:   { label: 'Aa', color: '#388e3c' },
    date:     { label: 'D/', color: '#e65100' },
    datetime: { label: 'DT', color: '#e65100' },
    time:     { label: 'T',  color: '#7b1fa2' },
}

function ColTypeChip({ type }: { type: string }) {
    const meta = COL_TYPE_META[type] ?? { label: '?', color: '#9e9e9e' }
    return (
        <Box component="span" sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 20, fontSize: '0.58rem', fontWeight: 700, fontFamily: 'monospace',
            color: meta.color, mr: 0.75, flexShrink: 0, letterSpacing: '-0.5px',
        }}>
            {meta.label}
        </Box>
    )
}

// ─── ChartConfigurator ────────────────────────────────────────────────────────

type ColStats = Record<string, { uniq: number; nullPct: number; min?: number; max?: number }>

interface ConfiguratorProps {
    open: boolean
    initial: WidgetConfig | null
    rowsByTableId: Record<string, ParsedRow[] | undefined>
    calcColumnsByTableId: Record<string, ColumnConfig[]>
    colStatsByTableId: Record<string, ColStats>
    onClose: () => void
    onSave: (widget: WidgetConfig) => void
}

function ChartConfigurator({ open, initial, rowsByTableId, calcColumnsByTableId, colStatsByTableId, onClose, onSave }: ConfiguratorProps) {
    const tableStates = useTableStore((store) => store.tableStates)
    const activeTableId = useTableStore((store) => store.activeTableId)

    const [title, setTitle] = useState('')
    const [tableId, setTableId] = useState('')
    const [chartType, setChartType] = useState<ChartType>('bar')
    const [xField, setXField] = useState('')
    const [yField, setYField] = useState('')
    const [yFields, setYFields] = useState<string[]>([])
    const [aggFn, setAggFn] = useState<AggFn>('none')
    const [sortBy, setSortBy] = useState<SortBy>('none')
    const [showLabels, setShowLabels] = useState(false)
    const [span, setSpan] = useState<ColSpan>(6)
    const [height, setHeight] = useState(320)
    const [swatchIdx, setSwatchIdx] = useState(0)
    const [xAxisLabel, setXAxisLabel] = useState('')
    const [yAxisLabel, setYAxisLabel] = useState('')
    const [kpiCompareMode, setKpiCompareMode] = useState<KpiCompareMode>('none')
    const [tablePageSize, setTablePageSize] = useState(20)
    const [xFieldSearch, setXFieldSearch] = useState('')
    const [yFieldSearch, setYFieldSearch] = useState('')
    const [rField, setRField] = useState('')
    const [histogramBins, setHistogramBins] = useState(20)
    const [targetField, setTargetField] = useState('')

    const initKeyRef = useRef<string | null>(null)

    useEffect(() => {
        const nextKey = open ? (initial?.id ?? '__new__') : null
        if (nextKey === initKeyRef.current) return
        initKeyRef.current = nextKey
        if (!open) return

        if (initial) {
            const resolvedScatterY = resolveScatterYField(initial)
            setTitle(initial.title)
            setTableId(initial.tableId)
            setChartType(initial.chartType)
            setXField(initial.xField)
            setYField(initial.chartType === 'heatmap' ? (initial.yField ?? '') : resolvedScatterY)
            setYFields(initial.chartType === 'bubble' ? (resolvedScatterY ? [resolvedScatterY] : []) : initial.yFields)
            setAggFn(initial.aggFn)
            setSortBy(initial.sortBy ?? 'none')
            setShowLabels(initial.showLabels ?? false)
            setSpan(initial.span)
            setHeight(initial.height)
            setSwatchIdx(initial.swatchIdx)
            setXAxisLabel(initial.xAxisLabel ?? '')
            setYAxisLabel(initial.yAxisLabel ?? '')
            setKpiCompareMode(initial.kpiCompareMode ?? 'none')
            setTablePageSize(initial.tablePageSize ?? 20)
            setRField(initial.rField ?? '')
            setHistogramBins(initial.histogramBins ?? 20)
            setTargetField(initial.targetField ?? '')
            return
        }

        setTitle('')
        setTableId(activeTableId ?? tableStates[0]?.id ?? '')
        setChartType('bar')
        setXField('')
        setYField('')
        setYFields([])
        setAggFn('none')
        setSortBy('none')
        setShowLabels(false)
        setSpan(6)
        setHeight(320)
        setSwatchIdx(0)
        setXAxisLabel('')
        setYAxisLabel('')
        setKpiCompareMode('none')
        setTablePageSize(20)
        setRField('')
        setHistogramBins(20)
        setTargetField('')
    }, [open, initial, activeTableId, tableStates])

    // Reset field selections when the user switches to a different table
    const prevTableIdRef = useRef<string | null>(null)
    useEffect(() => {
        if (!open) { prevTableIdRef.current = null; return }
        if (prevTableIdRef.current !== null && prevTableIdRef.current !== tableId) {
            setXField('')
            setYField('')
            setYFields([])
            setTargetField('')
        }
        prevTableIdRef.current = tableId
    }, [tableId, open])

    const activeState = tableStates.find((state) => state.id === tableId)
    const calcCols = useMemo(
        () => calcColumnsByTableId[tableId] ?? [],
        [calcColumnsByTableId, tableId],
    )
    const allColumns = useMemo(
        () => [...(activeState?.columns ?? []), ...calcCols],
        [activeState?.columns, calcCols],
    )
    const numericColumns = useMemo(
        () => allColumns.filter((column) => column.type === 'number'),
        [allColumns],
    )

    const colStats = colStatsByTableId[tableId] ?? ({} as ColStats)

    const isScatter = chartType === 'scatter'
    const isBubble = chartType === 'bubble'
    const isHistogram = chartType === 'histogram'
    const isHeatmap = chartType === 'heatmap'
    const isCalendar = chartType === 'calendar'
    const isPareto = chartType === 'pareto'
    const isSankey = chartType === 'sankey'
    const isBoxPlot = chartType === 'boxplot'

    const isPieFamily = PIE_FAMILY.includes(chartType)
    const isKpi = KPI_TYPES.includes(chartType)
    const isTable = TABLE_TYPES.includes(chartType)
    const isSingleY = isPieFamily || isKpi || isCalendar || isPareto || isSankey || isBoxPlot
    const isSingleValueY = isSingleY || isHeatmap || isBubble

    const xColumnOptions = (isScatter || isBubble) ? numericColumns : allColumns
    const aggNeedsNumericY = !['count', 'count_distinct'].includes(aggFn)
    const heatmapNeedsNumericValue = isHeatmap && !['none', 'count', 'count_distinct'].includes(aggFn)
    const yNeedsNumericValue = isScatter || isBubble || isBoxPlot || isKpi || heatmapNeedsNumericValue || (!isSankey && aggNeedsNumericY)
    const yColumnOptions = yNeedsNumericValue ? numericColumns : allColumns
    const yColumnOptionFields = useMemo(
        () => new Set((yNeedsNumericValue ? numericColumns : allColumns).map((column) => column.field)),
        [yNeedsNumericValue, numericColumns, allColumns],
    )
    const filteredYColumnOptions = yColumnOptions.filter(c => !yFieldSearch || c.headerName.toLowerCase().includes(yFieldSearch.toLowerCase()))
    const filteredYFieldValues = filteredYColumnOptions.map(c => c.field)
    const selectedFilteredYCount = filteredYFieldValues.filter(field => yFields.includes(field)).length
    const canSelectAllY = !isSingleValueY && filteredYFieldValues.length > 0 && selectedFilteredYCount < filteredYFieldValues.length
    const canClearAllY = !isSingleValueY && yFields.length > 0

    useEffect(() => {
        if (!activeState) return
        if (yField && !yColumnOptionFields.has(yField)) setYField('')
        if (yFields.some(field => !yColumnOptionFields.has(field))) {
            setYFields(prev => prev.filter(field => yColumnOptionFields.has(field)))
        }
    }, [activeState, yField, yFields, yColumnOptionFields])

    const previewData = useMemo(() => {
        if (!tableId || !xField) return null
        const previewState = tableStates.find((s) => s.id === tableId)
        if (!previewState) return null
        const previewRows = rowsByTableId[tableId] ?? []
        if (!previewRows.length) return null
        const mockWidget: WidgetConfig = {
            id: '__preview__', title: '', tableId, chartType,
            xField: isKpi && kpiCompareMode === 'none' ? (allColumns[0]?.field ?? xField) : xField,
            yField: isHeatmap ? yField : undefined,
            yFields: isSingleY ? (yField ? [yField] : []) : isSingleValueY ? (yFields[0] ? [yFields[0]] : []) : yFields,
            aggFn: isKpi && aggFn === 'none' ? 'sum' : aggFn,
            sortBy, showLabels, span: 6, height: 280, swatchIdx,
            kpiCompareMode: isKpi ? kpiCompareMode : undefined,
            rField: isBubble && rField ? rField : undefined,
            histogramBins: isHistogram ? histogramBins : undefined,
            targetField: isSankey && targetField ? targetField : undefined,
        }
        return prepareWidgetData(mockWidget, previewState, previewRows, calcCols)
    }, [tableId, xField, yField, yFields, chartType, aggFn, sortBy, showLabels, swatchIdx, isSingleY, isSingleValueY, isKpi, kpiCompareMode, isHeatmap, isBubble, isHistogram, rField, histogramBins, isSankey, targetField, tableStates, rowsByTableId, allColumns, calcCols])

    const canSave = useMemo(() => {
        if (!tableId) return false
        if (isKpi) return Boolean(yField)
        if (isTable) return Boolean(xField && yFields.length > 0)
        if (isHistogram) return Boolean(xField)
        if (isHeatmap) return Boolean(xField && yField && yFields.length > 0)
        if (isBubble) return Boolean(xField && yFields[0])
        if (isSankey) return Boolean(xField && targetField)
        if (!xField) return false
        if (isSingleY) return yField !== ''
        return yFields.length > 0
    }, [tableId, xField, isSingleY, isKpi, isTable, isHistogram, isHeatmap, isBubble, isSankey, targetField, yField, yFields])

    const missingLabel = useMemo(() => {
        if (!tableId) return 'Выберите датасет'
        if (isKpi && !yField) return 'Выберите метрику (поле Y)'
        if (isHistogram && !xField) return 'Выберите поле X'
        if (isSankey && !xField) return 'Выберите источник (Source)'
        if (isSankey && !targetField) return 'Выберите назначение (Target)'
        if (isHeatmap && !xField) return 'Выберите ось X'
        if (isHeatmap && !yField) return 'Выберите Y-категорию'
        if (isHeatmap && yFields.length === 0) return 'Выберите числовое значение'
        if (isBubble && yFields.length === 0) return 'Выберите ось Y'
        if (isTable && !xField) return 'Выберите колонку X'
        if ((isTable || !isSingleY) && yFields.length === 0) return 'Выберите хотя бы одно поле Y'
        if (!isKpi && !xField) return 'Выберите ось X'
        if (isSingleY && !yField) return 'Выберите значение Y'
        return ''
    }, [tableId, isKpi, isTable, isHistogram, isHeatmap, isBubble, isSankey, isSingleY, xField, yField, yFields, targetField])

    const xHelperText = useMemo(() => {
        if (isScatter || isBubble) return 'Числовое поле — горизонтальная ось'
        if (isKpi) return 'Поле для группировки по периодам'
        if (isCalendar) return 'Поле с датой'
        if (isSankey) return 'Колонка-источник потока'
        if (isPieFamily) return 'Категория — каждое уникальное значение станет сектором'
        return 'Категория для группировки — текст, дата или число'
    }, [isScatter, isBubble, isKpi, isCalendar, isSankey, isPieFamily])

    const yHelperText = useMemo(() => {
        if (isHeatmap) return 'Числовое поле — определяет интенсивность цвета'
        if (isSankey) return 'Числовое поле потока (необязательно)'
        if (chartType === 'composed') return 'Первое поле → столбец (Bar), остальные → линии (Line)'
        if (isKpi) return 'Числовое поле — будет агрегировано'
        if (isPieFamily) return 'Числовое поле — определяет размер сектора'
        if (aggFn === 'count' || aggFn === 'count_distinct') return 'Любое поле — Y покажет количество строк в группе'
        if (aggFn === 'none') return 'Числовое поле — значения берутся напрямую без агрегации'
        if (aggFn === 'sum') return 'Числовое поле — суммируется для каждого значения X'
        if (aggFn === 'mean') return 'Числовое поле — усредняется для каждого значения X'
        if (aggFn === 'median') return 'Числовое поле — медиана для каждого значения X'
        if (aggFn === 'min') return 'Числовое поле — минимум в каждой группе X'
        if (aggFn === 'max') return 'Числовое поле — максимум в каждой группе X'
        return 'Поле для построения значений'
    }, [isHeatmap, isSankey, chartType, isKpi, isPieFamily, aggFn])

    const dropdownMenuProps = {
        anchorOrigin: { vertical: 'bottom', horizontal: 'left' } as const,
        transformOrigin: { vertical: 'top', horizontal: 'left' } as const,
        PaperProps: { sx: { mt: 0.75, maxHeight: 420 } },
    }
    const fieldDropdownMenuProps = {
        ...dropdownMenuProps,
        autoFocus: false,
        PaperProps: {
            sx: {
                mt: 0.75,
                maxHeight: 420,
                width: { xs: 'calc(100vw - 32px)', sm: 360 },
                maxWidth: 'calc(100vw - 32px)',
                '& .MuiList-root': { py: 0.5 },
                '& .MuiMenuItem-root': { minWidth: 0, maxWidth: '100%' },
            },
        },
    }

    const saveWidget = () => {
        if (!canSave) return
        const widget: WidgetConfig = {
            id: initial?.id ?? createWidgetId(),
            title,
            tableId,
            chartType,
            xField: isKpi && kpiCompareMode === 'none' ? '' : xField,
            yField: isHeatmap ? yField : isBubble ? yFields[0] : undefined,
            yFields: isSingleY ? (yField ? [yField] : []) : isSingleValueY ? (yFields[0] ? [yFields[0]] : []) : yFields,
            aggFn: isKpi && aggFn === 'none' ? 'sum' : aggFn,
            sortBy,
            showLabels,
            span,
            height,
            swatchIdx,
            xAxisLabel: xAxisLabel.trim() || undefined,
            yAxisLabel: yAxisLabel.trim() || undefined,
            kpiCompareMode: isKpi ? kpiCompareMode : undefined,
            tablePageSize: isTable ? tablePageSize : undefined,
            rField: chartType === 'bubble' && rField ? rField : undefined,
            histogramBins: chartType === 'histogram' ? histogramBins : undefined,
            targetField: chartType === 'sankey' && targetField ? targetField : undefined,
        }
        onSave(widget)
    }

    return (
        <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100vw', md: 920 }, display: 'flex', flexDirection: 'column' } } }}>
            <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle1" fontWeight={700} flex={1}>{initial ? 'Редактировать график' : 'Новый график'}</Typography>
                <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
            </Box>

            <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Form */}
                <Box sx={{ width: 340, flexShrink: 0, overflowY: 'auto', px: 2.5, py: 2, borderRight: '1px solid', borderColor: 'divider' }}>
                    <TextField fullWidth size="small" label="Заголовок (необязательно)" value={title} onChange={e => setTitle(e.target.value)} sx={{ mb: 2 }} />

                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Датасет</InputLabel>
                        <Select value={tableId} label="Датасет" MenuProps={dropdownMenuProps}
                            onChange={e => { setTableId(e.target.value); setXField(''); setYField(''); setYFields([]) }}>
                            {tableStates.length === 0 && <MenuItem value="" disabled>— нет файлов —</MenuItem>}
                            {tableStates.map(ts => (
                                <MenuItem key={ts.id} value={ts.id}>
                                    <Box><Typography variant="body2" noWrap>{ts.fileName}</Typography><Typography variant="caption" color="text.secondary">{new Date(ts.uploadedAt).toLocaleDateString('ru')}</Typography></Box>
                                </MenuItem>
                            ))}
                        </Select>
                        {tableStates.length === 0 && <FormHelperText>Загрузите файл на странице Рабочее место</FormHelperText>}
                    </FormControl>

                    <Divider sx={{ my: 1.5 }} />
                    <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>Тип графика</Typography>
                    {(() => {
                        const groups = new Map<string, typeof CHART_TYPES>()
                        for (const ct of CHART_TYPES) {
                            if (!groups.has(ct.group)) groups.set(ct.group, [])
                            groups.get(ct.group)!.push(ct)
                        }
                        return [...groups.entries()].map(([group, types]) => (
                            <Box key={group} sx={{ mb: 1.5 }}>
                                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 0.5 }}>
                                    {group}
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {types.map(ct => {
                                        const active = chartType === ct.type
                                        return (
                                            <Tooltip key={ct.type} title={ct.label} arrow>
                                                <Box onClick={() => { setChartType(ct.type); setYField(''); setYFields([]) }}
                                                    sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 0.9, py: 0.5, borderRadius: 1.5, cursor: 'pointer', border: '1px solid', borderColor: active ? 'primary.main' : 'divider', bgcolor: active ? 'primary.main' : 'transparent', color: active ? '#fff' : 'text.secondary', fontSize: '0.68rem', fontWeight: active ? 600 : 400, transition: 'all 0.15s', '&:hover': { borderColor: 'primary.main', color: active ? '#fff' : 'primary.main' }, whiteSpace: 'nowrap' }}>
                                                    <Box sx={{ display: 'flex', '& svg': { fontSize: '0.85rem' } }}>{ct.icon}</Box>
                                                    {ct.label}
                                                </Box>
                                            </Tooltip>
                                        )
                                    })}
                                </Box>
                            </Box>
                        ))
                    })()}
                    {CHART_TYPE_HINTS[chartType] && (
                        <Box sx={{ mb: 1.5, px: 1, py: 0.75, bgcolor: 'action.hover', borderRadius: 1.5, borderLeft: '3px solid', borderColor: 'primary.main' }}>
                            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                                {CHART_TYPE_HINTS[chartType]}
                            </Typography>
                        </Box>
                    )}

                    {/* X field — hidden for KPI with no compare, and for pure KPI 'none' */}
                    {!isKpi || kpiCompareMode === 'prev_group' ? (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>{isKpi ? 'Группировка (ось X)' : isPieFamily ? 'Категория' : isSankey ? 'Источник (Source)' : isCalendar ? 'Поле даты' : 'Ось X'}</InputLabel>
                            <Select value={xField} label={isKpi ? 'Группировка (ось X)' : isPieFamily ? 'Категория' : isSankey ? 'Источник (Source)' : isCalendar ? 'Поле даты' : 'Ось X'}
                                MenuProps={fieldDropdownMenuProps} onChange={e => setXField(e.target.value)} disabled={!activeState}
                                onOpen={() => setXFieldSearch('')}
                                renderValue={value => {
                                    const col = xColumnOptions.find(c => c.field === value)
                                    return col ? col.headerName : String(value)
                                }}
                            >
                                <MenuItem disableRipple sx={{ p: 0, '&.Mui-focusVisible': { bgcolor: 'transparent' } }} onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}>
                                    <TextField
                                        size="small" fullWidth placeholder="Поиск поля…"
                                        value={xFieldSearch} onChange={e => setXFieldSearch(e.target.value)}
                                        onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}
                                        sx={{ px: 1, py: 0.5 }}
                                        autoFocus
                                    />
                                </MenuItem>
                                {groupByType(xColumnOptions.filter(c => !xFieldSearch || c.headerName.toLowerCase().includes(xFieldSearch.toLowerCase()))).flatMap(([group, cols]) => [
                                    <ListSubheader key={`g-${group}`} sx={{ lineHeight: '28px', fontSize: '0.68rem', bgcolor: 'background.paper' }}>{group} ({cols.length})</ListSubheader>,
                                    ...cols.map(col => {
                                        const stat = colStats[col.field]
                                        const highCard = stat && stat.uniq > 100 && !isPieFamily && !isScatter
                                        return (
                                            <MenuItem key={col.field} value={col.field}>
                                                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, mr: 1 }}>
                                                        <ColTypeChip type={col.type} />
                                                        <Typography variant="body2" noWrap>{col.headerName}</Typography>
                                                    </Box>
                                                    {stat && (
                                                        <Stack direction="row" gap={0.5} alignItems="center" flexShrink={0} sx={{ maxWidth: 106, overflow: 'hidden' }}>
                                                            <Typography variant="caption" noWrap sx={{ fontSize: '0.58rem', color: highCard ? 'warning.main' : 'text.disabled' }}>{stat.uniq.toLocaleString('ru')} уник.</Typography>
                                                            {stat.nullPct > 0 && <Typography variant="caption" noWrap sx={{ fontSize: '0.58rem', color: stat.nullPct > 30 ? 'error.main' : 'text.disabled' }}>{stat.nullPct}% null</Typography>}
                                                        </Stack>
                                                    )}
                                                </Stack>
                                            </MenuItem>
                                        )
                                    }),
                                ])}
                            </Select>
                        </FormControl>
                    ) : null}

                    {xField && colStats[xField] && !isScatter && !isPieFamily && !isKpi && !isTable && aggFn === 'none' && colStats[xField].uniq > 100 && (
                        <Alert severity="warning" sx={{ mb: 2, borderRadius: 1.5, py: 0.5 }}
                            action={<Button size="small" color="warning" onClick={() => setAggFn('count')}>COUNT</Button>}>
                            <Typography variant="caption">{colStats[xField].uniq.toLocaleString('ru')} уникальных значений — рекомендуется агрегация</Typography>
                        </Alert>
                    )}

                    {/* Y field */}
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>{isKpi ? 'Метрика' : isPieFamily || isHeatmap ? 'Значение' : isSankey ? 'Значение потока (необяз.)' : !isSingleValueY && !isTable ? 'Ось Y (можно несколько)' : 'Ось Y'}</InputLabel>
                        <Select
                            multiple={!isSingleValueY}
                            value={isSingleValueY ? (isSingleY ? yField : (yFields[0] ?? '')) : yFields}
                            label={isKpi ? 'Метрика' : isPieFamily || isHeatmap ? 'Значение' : isSankey ? 'Значение потока (необяз.)' : !isSingleValueY && !isTable ? 'Ось Y (можно несколько)' : 'Ось Y'}
                            MenuProps={fieldDropdownMenuProps}
                            input={<OutlinedInput label={isKpi ? 'Метрика' : isPieFamily || isHeatmap ? 'Значение' : !isSingleValueY && !isTable ? 'Ось Y (можно несколько)' : 'Ось Y'} />}
                            onChange={e => {
                                const value = e.target.value
                                if (isSingleY) { setYField(value as string) }
                                else if (isSingleValueY) { setYFields(value ? [value as string] : []) }
                                else { setYFields(typeof value === 'string' ? [value] : (value as string[])) }
                            }}
                            disabled={!activeState}
                            onOpen={() => setYFieldSearch('')}
                            renderValue={selected => {
                                const values = (Array.isArray(selected) ? selected : [selected]).filter(Boolean)
                                const visibleValues = values.slice(0, 3)
                                return <>
                                    {visibleValues.map(v => {
                                    const col = yColumnOptions.find(c => c.field === v)
                                    return <Chip key={v} label={col ? col.headerName : v} size="small" sx={{ mr: 0.3 }} />
                                    })}
                                    {values.length > visibleValues.length && (
                                        <Chip label={`+${values.length - visibleValues.length}`} size="small" sx={{ mr: 0.3 }} />
                                    )}
                                </>
                            }}
                        >
                            <MenuItem disableRipple sx={{ p: 0, '&.Mui-focusVisible': { bgcolor: 'transparent' } }} onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}>
                                <TextField
                                    size="small" fullWidth placeholder="Поиск поля…"
                                    value={yFieldSearch} onChange={e => setYFieldSearch(e.target.value)}
                                    onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}
                                    sx={{ px: 1, py: 0.5 }}
                                    autoFocus
                                />
                            </MenuItem>
                            {!isSingleValueY && (
                                <MenuItem
                                    disableRipple
                                    divider
                                    sx={{ px: 1, py: 0.75, '&.Mui-focusVisible': { bgcolor: 'transparent' } }}
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={e => e.stopPropagation()}
                                    onKeyDown={e => { if (e.key !== 'Escape') e.stopPropagation() }}
                                >
                                    <Stack direction="row" spacing={0.75} sx={{ width: '100%' }}>
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            disabled={!canSelectAllY}
                                            onClick={e => {
                                                e.stopPropagation()
                                                setYFields(prev => Array.from(new Set([...prev, ...filteredYFieldValues])))
                                            }}
                                            sx={{ flex: 1, minWidth: 0, px: 0.75, fontSize: '0.68rem' }}
                                        >
                                            {yFieldSearch ? 'Найденные' : 'Все'}
                                        </Button>
                                        <Button
                                            size="small"
                                            color="inherit"
                                            disabled={!canClearAllY}
                                            onClick={e => {
                                                e.stopPropagation()
                                                setYFields([])
                                            }}
                                            sx={{ flex: 1, minWidth: 0, px: 0.75, fontSize: '0.68rem' }}
                                        >
                                            Очистить
                                        </Button>
                                    </Stack>
                                </MenuItem>
                            )}
                            {filteredYColumnOptions.map(col => {
                                const isSelected = isSingleValueY ? (isSingleY ? yField === col.field : yFields[0] === col.field) : yFields.includes(col.field)
                                const stat = colStats[col.field]
                                return (
                                    <MenuItem key={col.field} value={col.field} selected={isSelected}>
                                        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ width: '100%' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, mr: 1 }}>
                                                <ColTypeChip type={col.type} />
                                                <Typography variant="body2" noWrap>{col.headerName}</Typography>
                                            </Box>
                                            <Stack direction="row" gap={0.5} alignItems="center" flexShrink={0} sx={{ maxWidth: 106, overflow: 'hidden' }}>
                                                {stat?.nullPct > 0 && <Typography variant="caption" noWrap sx={{ fontSize: '0.58rem', color: stat.nullPct > 30 ? 'error.main' : 'text.disabled' }}>{stat.nullPct}% null</Typography>}
                                                {stat?.min != null && <Typography variant="caption" noWrap sx={{ fontSize: '0.58rem', color: 'text.disabled', overflow: 'hidden', textOverflow: 'ellipsis' }}>{FMT_LABEL(stat.min)}–{FMT_LABEL(stat.max)}</Typography>}
                                                {isSelected && <CheckIcon sx={{ fontSize: 16, color: 'primary.main', ml: 0.5 }} />}
                                            </Stack>
                                        </Stack>
                                    </MenuItem>
                                )
                            })}
                        </Select>
                        {yColumnOptions.length === 0 && activeState && (
                            <FormHelperText error>Нет подходящих колонок</FormHelperText>
                        )}
                    </FormControl>

                    {/* Heatmap Y-category field */}
                    {isHeatmap && (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Y-категория</InputLabel>
                            <Select value={yField} label="Y-категория" MenuProps={dropdownMenuProps} onChange={e => setYField(e.target.value)} disabled={!activeState}>
                                <MenuItem value=""><em>— выберите —</em></MenuItem>
                                {allColumns.map(col => <MenuItem key={col.field} value={col.field}>{col.headerName}</MenuItem>)}
                            </Select>
                            <FormHelperText>Второй категориальный параметр (ось Y тепловой карты)</FormHelperText>
                        </FormControl>
                    )}

                    {/* Bubble size (R) field */}
                    {isBubble && (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Размер пузырьков (R)</InputLabel>
                            <Select value={rField} label="Размер пузырьков (R)" MenuProps={dropdownMenuProps} onChange={e => setRField(e.target.value)} disabled={!activeState}>
                                <MenuItem value=""><em>Не задано</em></MenuItem>
                                {numericColumns.map(col => <MenuItem key={col.field} value={col.field}>{col.headerName}</MenuItem>)}
                            </Select>
                            <FormHelperText>Числовое поле, определяющее размер пузырьков</FormHelperText>
                        </FormControl>
                    )}

                    {/* Histogram bins */}
                    {isHistogram && (
                        <TextField fullWidth size="small" type="number" label="Количество интервалов (bins)"
                            value={histogramBins}
                            onChange={e => setHistogramBins(Math.max(2, Math.min(200, Number(e.target.value) || 20)))}
                            slotProps={{ htmlInput: { min: 2, max: 200 } }}
                            helperText="От 2 до 200"
                            sx={{ mb: 2 }}
                        />
                    )}

                    {/* Sankey target (destination) field */}
                    {isSankey && (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Назначение (Target)</InputLabel>
                            <Select value={targetField} label="Назначение (Target)" MenuProps={dropdownMenuProps} onChange={e => setTargetField(e.target.value)} disabled={!activeState}>
                                <MenuItem value=""><em>— выберите —</em></MenuItem>
                                {allColumns.map(col => <MenuItem key={col.field} value={col.field}>{col.headerName}</MenuItem>)}
                            </Select>
                            <FormHelperText>Конечный узел потока</FormHelperText>
                        </FormControl>
                    )}

                    {/* KPI compare mode */}
                    {isKpi && (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Сравнение</InputLabel>
                            <Select value={kpiCompareMode} label="Сравнение" MenuProps={dropdownMenuProps} onChange={e => setKpiCompareMode(e.target.value as KpiCompareMode)}>
                                <MenuItem value="none">Без сравнения</MenuItem>
                                <MenuItem value="prev_group">vs предыдущая группа</MenuItem>
                            </Select>
                            <FormHelperText>Тренд относительно предыдущего периода</FormHelperText>
                        </FormControl>
                    )}

                    {/* Aggregation */}
                    {!isScatter && !isBoxPlot && (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Агрегация</InputLabel>
                            <Select value={aggFn} label="Агрегация" MenuProps={dropdownMenuProps} onChange={e => setAggFn(e.target.value as AggFn)}>
                                {(Object.keys(AGG_LABELS) as AggFn[])
                                    .filter(a => !isKpi || a !== 'none')
                                    .map(a => <MenuItem key={a} value={a}>{AGG_LABELS[a]}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}

                    {/* Sort */}
                    {!isKpi && !isSankey && !isCalendar && !isBoxPlot && !isPareto && (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Сортировка</InputLabel>
                            <Select value={sortBy} label="Сортировка" MenuProps={dropdownMenuProps} onChange={e => setSortBy(e.target.value as SortBy)}>
                                {(Object.keys(SORT_BY_LABELS) as SortBy[]).map(k => <MenuItem key={k} value={k}>{SORT_BY_LABELS[k]}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}

                    {/* Table page size */}
                    {isTable && (
                        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                            <InputLabel>Строк на страницу</InputLabel>
                            <Select value={tablePageSize} label="Строк на страницу" MenuProps={dropdownMenuProps} onChange={e => setTablePageSize(Number(e.target.value))}>
                                {[10, 20, 50, 100].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                            </Select>
                        </FormControl>
                    )}

                    {/* Axis labels */}
                    {!isPieFamily && !isKpi && !isTable && !isCalendar && !isSankey && !isBoxPlot && (
                        <>
                            <Divider sx={{ my: 1.5 }} />
                            <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>Подписи осей (необязательно)</Typography>
                            <TextField fullWidth size="small" label="Подпись оси X" value={xAxisLabel} onChange={e => setXAxisLabel(e.target.value)} sx={{ mb: 1.5 }} placeholder={allColumns.find(c => c.field === xField)?.headerName ?? ''} />
                            <TextField fullWidth size="small" label="Подпись оси Y" value={yAxisLabel} onChange={e => setYAxisLabel(e.target.value)} sx={{ mb: 2 }} placeholder={yFields[0] ? (allColumns.find(c => c.field === yFields[0])?.headerName ?? '') : ''} />
                        </>
                    )}

                    {/* Show labels */}
                    {!isPieFamily && !isKpi && !isTable && !isCalendar && !isSankey && !isBoxPlot && (
                        <>
                            <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>Подписи значений</Typography>
                            <Box sx={{ display: 'flex', gap: 0.75, mb: 2 }}>
                                {([false, true] as const).map(opt => (
                                    <Box key={String(opt)} onClick={() => setShowLabels(opt)}
                                        sx={{ px: 1.5, py: 0.5, borderRadius: 1.5, cursor: 'pointer', border: '1px solid', fontSize: '0.72rem', fontWeight: 600, borderColor: showLabels === opt ? 'primary.main' : 'divider', bgcolor: showLabels === opt ? 'primary.main' : 'transparent', color: showLabels === opt ? '#fff' : 'text.secondary' }}>
                                        {opt ? 'Показать' : 'Скрыть'}
                                    </Box>
                                ))}
                            </Box>
                        </>
                    )}

                    <Divider sx={{ my: 1.5 }} />
                    <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>Ширина</Typography>
                    <Box sx={{ display: 'flex', gap: 0.75, mb: 2 }}>
                        {SPAN_OPTS.map(opt => (
                            <Box key={opt.value} onClick={() => setSpan(opt.value)}
                                sx={{ px: 1.5, py: 0.5, borderRadius: 1.5, cursor: 'pointer', border: '1px solid', fontSize: '0.72rem', fontWeight: 600, borderColor: span === opt.value ? 'primary.main' : 'divider', bgcolor: span === opt.value ? 'primary.main' : 'transparent', color: span === opt.value ? '#fff' : 'text.secondary' }}>
                                {opt.label}
                            </Box>
                        ))}
                    </Box>

                    <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>Высота</Typography>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
                        {HEIGHT_OPTIONS.map(({ value: h, label: hl }) => (
                            <Tooltip key={h} title={`${h}px`} arrow>
                                <Box onClick={() => setHeight(h)}
                                    sx={{ px: 1.5, py: 0.5, borderRadius: 1.5, cursor: 'pointer', border: '1px solid', fontSize: '0.72rem', fontWeight: 600, borderColor: height === h ? 'primary.main' : 'divider', bgcolor: height === h ? 'primary.main' : 'transparent', color: height === h ? '#fff' : 'text.secondary' }}>
                                    {hl}
                                </Box>
                            </Tooltip>
                        ))}
                    </Box>

                    {!isTable && (
                        <>
                            <Typography variant="caption" color="text.secondary" display="block" mb={0.75}>Палитра цветов</Typography>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                {COLOR_SWATCHES.map((swatch, idx) => (
                                    <Tooltip key={idx} title={SWATCH_LABELS[idx]} arrow>
                                        <Box onClick={() => setSwatchIdx(idx)}
                                            sx={{ display: 'flex', gap: '3px', p: '4px', borderRadius: 1.5, cursor: 'pointer', border: '2px solid', borderColor: swatchIdx === idx ? 'primary.main' : 'transparent' }}>
                                            {swatch.slice(0, 5).map(color => <Box key={color} sx={{ width: 13, height: 13, borderRadius: '50%', bgcolor: color }} />)}
                                        </Box>
                                    </Tooltip>
                                ))}
                            </Box>
                        </>
                    )}
                </Box>

                {/* Preview panel */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
                    <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.65rem' }}>
                            Предварительный просмотр
                        </Typography>
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                        {!canSave ? (() => {
                            const items = [
                                {
                                    done: Boolean(tableId),
                                    label: 'Датасет',
                                    detail: tableId
                                        ? (tableStates.find(t => t.id === tableId)?.fileName ?? '—')
                                        : 'Выберите файл на странице Рабочее место',
                                },
                                {
                                    done: true,
                                    label: 'Тип графика',
                                    detail: (() => {
                                        const typeName = CHART_TYPES.find(ct => ct.type === chartType)?.label ?? chartType
                                        const hint = CHART_TYPE_HINTS[chartType]
                                        return hint ? `${typeName} — ${hint}` : typeName
                                    })(),
                                },
                                ...(!isKpi || kpiCompareMode !== 'none' ? [{
                                    done: Boolean(xField),
                                    label: isPieFamily ? 'Категория (X)' : isCalendar ? 'Поле даты (X)' : isSankey ? 'Источник (X)' : isHistogram ? 'Поле X' : 'Ось X',
                                    detail: xField
                                        ? (allColumns.find(c => c.field === xField)?.headerName ?? xField)
                                        : xHelperText,
                                }] : []),
                                {
                                    done: isSingleY ? Boolean(yField) : yFields.length > 0,
                                    label: isKpi ? 'Метрика (Y)' : isPieFamily ? 'Значение (Y)' : isSankey ? 'Поток (Y)' : 'Ось Y',
                                    detail: (isSingleY ? yField : yFields[0])
                                        ? (allColumns.find(c => c.field === (isSingleY ? yField : yFields[0]))?.headerName ?? '')
                                        : yHelperText,
                                },
                                ...(isHeatmap ? [{
                                    done: Boolean(yField),
                                    label: 'Y-категория',
                                    detail: yField
                                        ? (allColumns.find(c => c.field === yField)?.headerName ?? yField)
                                        : 'Второй категориальный параметр',
                                }] : []),
                                ...(isSankey ? [{
                                    done: Boolean(targetField),
                                    label: 'Назначение (Target)',
                                    detail: targetField
                                        ? (allColumns.find(c => c.field === targetField)?.headerName ?? targetField)
                                        : 'Колонка-цель потока',
                                }] : []),
                            ]
                            return (
                                <Box sx={{ pt: 1 }}>
                                    <Typography variant="caption" fontWeight={600} color="text.secondary"
                                        sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', mb: 2 }}>
                                        Заполните обязательные поля
                                    </Typography>
                                    <Stack spacing={1.5}>
                                        {items.map((item, i) => (
                                            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                                                <Box sx={{
                                                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0, mt: 0.1,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    bgcolor: item.done ? 'success.main' : 'action.disabledBackground',
                                                    fontSize: '0.65rem', fontWeight: 800, color: item.done ? '#fff' : 'text.disabled',
                                                }}>
                                                    {item.done ? '✓' : ''}
                                                </Box>
                                                <Box sx={{ minWidth: 0 }}>
                                                    <Typography variant="body2" fontWeight={item.done ? 600 : 400}
                                                        color={item.done ? 'text.primary' : 'text.secondary'}>
                                                        {item.label}
                                                    </Typography>
                                                    {item.detail && (
                                                        <Typography variant="caption" display="block"
                                                            color={item.done ? 'success.main' : 'text.disabled'}
                                                            sx={{ lineHeight: 1.4 }}>
                                                            {item.detail}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Box>
                            )
                        })() : !previewData ? (
                            <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography variant="body2" color="text.disabled">Загрузка данных…</Typography>
                            </Box>
                        ) : previewData.status === 'error' ? (
                            <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2 }}>
                                <Alert severity="warning" sx={{ borderRadius: 1.5, width: '100%' }}>{previewData.message}</Alert>
                            </Box>
                        ) : (
                            <Box sx={{
                                '& .recharts-label-list text, & .recharts-cartesian-axis-tick text, & .recharts-label, & .recharts-text': {
                                    pointerEvents: 'none',
                                },
                            }}>
                                {previewData.rowsMeta.isTruncated && !isKpi && (
                                    <Alert severity="info" sx={{ mb: 1.5, borderRadius: 1.5, py: 0.25 }}>
                                        <Typography variant="caption">Показаны первые {previewData.rowsMeta.usedRows.toLocaleString('ru')} из {previewData.rowsMeta.totalRows.toLocaleString('ru')} строк</Typography>
                                    </Alert>
                                )}
                                {isKpi && previewData.kpiData && renderKpi(
                                    previewData.kpiData, 280,
                                    allColumns.find(c => c.field === previewData.yFields[0])?.headerName ?? previewData.yFields[0] ?? '',
                                    COLOR_SWATCHES[swatchIdx] ?? COLOR_SWATCHES[0],
                                )}
                                {isTable && previewData.tableData && (() => {
                                    const headerCols = [
                                        { field: '_x', label: allColumns.find(c => c.field === xField)?.headerName ?? xField },
                                        ...previewData.yFields.map(f => ({ field: f, label: allColumns.find(c => c.field === f)?.headerName ?? f })),
                                    ]
                                    return (
                                        <TableContainer sx={{ maxHeight: 280 }}>
                                            <Table size="small" stickyHeader>
                                                <TableHead>
                                                    <TableRow>{headerCols.map(hc => <TableCell key={hc.field} sx={{ fontWeight: 600, fontSize: '0.72rem' }}>{hc.label}</TableCell>)}</TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {previewData.tableData.slice(0, 20).map((row, idx) => (
                                                        <TableRow key={idx} hover>
                                                            {headerCols.map(hc => <TableCell key={hc.field} sx={{ fontSize: '0.72rem' }}>{hc.field === '_x' ? String(row._x ?? '') : FMT_LABEL(row[hc.field])}</TableCell>)}
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </TableContainer>
                                    )
                                })()}
                                {!isKpi && !isTable && renderChart({
                                    chartType,
                                    chartData: previewData.chartData,
                                    pieData: previewData.pieData,
                                    yFields: previewData.yFields,
                                    chartData100: previewData.chartData100,
                                    palette: COLOR_SWATCHES[swatchIdx] ?? COLOR_SWATCHES[0],
                                    height: 280,
                                    showLabels,
                                    scatterAxes: previewData.scatterAxes,
                                    xAxisLabel,
                                    yAxisLabel,
                                    heatmapData: previewData.heatmapData,
                                    calendarData: previewData.calendarData,
                                    sankeyData: previewData.sankeyData,
                                    rField: isBubble ? rField : undefined,
                                })}
                            </Box>
                        )}
                    </Box>
                </Box>
            </Box>

            <Box sx={{ px: 2.5, py: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 1 }}>
                <Button variant="outlined" onClick={onClose} sx={{ flex: 1 }}>Закрыть</Button>
                <Tooltip title={!canSave ? missingLabel : ''} arrow placement="top">
                    <span style={{ flex: 2 }}>
                        <Button variant="contained" fullWidth disabled={!canSave} startIcon={<CheckIcon />} onClick={saveWidget}>
                            {initial ? 'Сохранить' : 'Добавить'}
                        </Button>
                    </span>
                </Tooltip>
            </Box>
        </Drawer>
    )
}

// ─── SortableChartCard ────────────────────────────────────────────────────────

function SortableChartCard(props: ChartCardProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.widget.id })
    return (
        <ChartCard
            {...props}
            sortableRef={setNodeRef}
            sortableStyle={{ transform: CSS.Transform.toString(transform), transition }}
            dragListeners={listeners as Record<string, (e: Event) => void> | undefined}
            dragAttributes={attributes}
            isDragging={isDragging}
        />
    )
}

// ─── Dashboard init ───────────────────────────────────────────────────────────

function getInitialDashboardState(): { dashboards: DashboardMeta[]; activeDashboardId: string; widgets: WidgetConfig[] } {
    let list = loadDashboardList()
    if (list.length === 0) {
        const id = `dash_${Date.now()}`
        list = [{ id, name: 'График 1' }]
        saveDashboardList(list)
        const legacy = loadLegacyDashboardWidgets()
        if (legacy.length > 0) saveDashboardWidgets(legacy, id)
    }
    const id = list[0].id
    return { dashboards: list, activeDashboardId: id, widgets: loadDashboardWidgets(id) }
}

// ─── DashboardPage ────────────────────────────────────────────────────────────

export const DashboardPage = () => {
    const loadFromStorage = useTableStore((store) => store.loadFromStorage)
    const tableStates = useTableStore((store) => store.tableStates)
    const setActiveTable = useTableStore((store) => store.setActiveTable)
    const activeTableId = useTableStore((store) => store.activeTableId)
    const activeRows = useTableStore((store) => store.rows)
    const [searchParams] = useSearchParams()

    const [initState] = useState(getInitialDashboardState)
    const [dashboards, setDashboards] = useState<DashboardMeta[]>(initState.dashboards)
    const [activeDashboardId, setActiveDashboardId] = useState<string>(initState.activeDashboardId)
    const [widgets, setWidgets] = useState<WidgetConfig[]>(initState.widgets)
    const [rowsByTableId, setRowsByTableId] = useState<Record<string, ParsedRow[] | undefined>>({})
    const [loadingTableIds, setLoadingTableIds] = useState<string[]>([])
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [crossFilter, setCrossFilter] = useState<CrossFilter | null>(null)
    const [calcFields, setCalcFields] = useState<Record<string, CalculatedField[]>>(loadCalcFields)
    const [calcDrawerOpen, setCalcDrawerOpen] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [renamingDashboardId, setRenamingDashboardId] = useState<string | null>(null)
    const [renamingName, setRenamingName] = useState('')
    const [exporting, setExporting] = useState(false)
    const [exportMenuAnchor, setExportMenuAnchor] = useState<null | HTMLElement>(null)
    const dashGridRef = useRef<HTMLDivElement | null>(null)

    const exportDashboard = async (format: 'png' | 'jpeg') => {
        const el = dashGridRef.current
        if (!el || exporting) return
        setExporting(true)
        try {
            const opts = { cacheBust: true, backgroundColor: '#ffffff', pixelRatio: 2 }
            const dataUrl = format === 'png' ? await toPng(el, opts) : await toJpeg(el, { ...opts, quality: 0.95 })
            const activeDash = dashboards.find(d => d.id === activeDashboardId)
            const name = activeDash?.name ?? 'dashboard'
            const a = Object.assign(document.createElement('a'), {
                href: dataUrl,
                download: `${name}.${format}`,
            })
            a.click()
        } finally {
            setExporting(false)
        }
    }

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (over && active.id !== over.id) {
            setWidgets(prev => {
                const from = prev.findIndex(w => w.id === active.id)
                const to = prev.findIndex(w => w.id === over.id)
                return arrayMove(prev, from, to)
            })
        }
    }

    useEffect(() => { loadFromStorage() }, [loadFromStorage])
    useEffect(() => { saveDashboardWidgets(widgets, activeDashboardId) }, [widgets, activeDashboardId])
    useEffect(() => { saveCalcFields(calcFields) }, [calcFields])

    const switchDashboard = (id: string) => {
        setActiveDashboardId(id)
        setWidgets(loadDashboardWidgets(id))
        setCrossFilter(null)
    }

    const createDashboard = () => {
        const id = `dash_${Date.now()}`
        const name = `График ${dashboards.length + 1}`
        const next = [...dashboards, { id, name }]
        setDashboards(next)
        saveDashboardList(next)
        switchDashboard(id)
    }

    const renameDashboard = (id: string, name: string) => {
        const next = dashboards.map(d => d.id === id ? { ...d, name: name.trim() || d.name } : d)
        setDashboards(next)
        saveDashboardList(next)
    }

    const deleteDashboard = (id: string) => {
        if (dashboards.length <= 1) return
        const next = dashboards.filter(d => d.id !== id)
        setDashboards(next)
        saveDashboardList(next)
        if (activeDashboardId === id) switchDashboard(next[0].id)
    }

    // Remove widgets whose source table was deleted
    useEffect(() => {
        const validIds = new Set(tableStates.map(s => s.id))
        setWidgets(prev => {
            const next = prev.filter(w => validIds.has(w.tableId))
            return next.length === prev.length ? prev : next
        })
        setCrossFilter(cf => cf && !validIds.has(cf.tableId) ? null : cf)
    }, [tableStates])

    useEffect(() => {
        const fromUrl = searchParams.get('tableId')
        if (fromUrl) setActiveTable(fromUrl)
    }, [searchParams, setActiveTable])

    useEffect(() => {
        if (!activeTableId) return
        setRowsByTableId((prev) => ({ ...prev, [activeTableId]: activeRows }))
    }, [activeTableId, activeRows])

    const requiredTableIds = useMemo(() => [...new Set(widgets.map(w => w.tableId).filter(Boolean))], [widgets])
    useEffect(() => {
        let cancelled = false
        const existingIds = new Set(tableStates.map(s => s.id))
        const idsToLoad = requiredTableIds.filter(id => existingIds.has(id) && !(id in rowsByTableId))
        if (idsToLoad.length === 0) return
        setLoadingTableIds(prev => [...new Set([...prev, ...idsToLoad])])
        Promise.all(idsToLoad.map(async id => ({ id, rows: (await idbStorage.getRows(id)) ?? [] })))
            .then(result => {
                if (cancelled) return
                setRowsByTableId(prev => {
                    const next = { ...prev }
                    for (const item of result) next[item.id] = item.rows
                    return next
                })
            })
            .finally(() => {
                if (cancelled) return
                setLoadingTableIds(prev => prev.filter(id => !idsToLoad.includes(id)))
            })
        return () => { cancelled = true }
    }, [requiredTableIds, rowsByTableId, tableStates])

    // Augment rows with calculated fields and apply table-level filters from WorkPage.
    // Uses Object.create(row) so original row properties are inherited via prototype —
    // avoids cloning every field for large datasets.
    const augmentedRowsByTableId = useMemo(() => {
        const result: Record<string, ParsedRow[] | undefined> = {}
        for (const [tableId, rows] of Object.entries(rowsByTableId)) {
            const ts = tableStates.find(s => s.id === tableId)
            const cfs = calcFields[tableId] ?? []
            const hasFilters = ts && Object.keys(ts.filters).length > 0

            let processed = rows
            if (processed?.length && hasFilters) {
                processed = applyFilters(processed, ts!.filters)
            }

            if (cfs.length === 0 || !processed?.length) { result[tableId] = processed; continue }
            const fieldNames = ts?.columns.map(c => c.field) ?? []
            result[tableId] = processed.map(row => {
                const aug = Object.create(row) as ParsedRow
                for (const cf of cfs) aug[cf.id] = evalFormula(cf.formula, row, fieldNames)
                return aug
            })
        }
        return result
    }, [rowsByTableId, calcFields, tableStates])

    // Apply cross-filter per widget
    const filteredRowsByWidgetId = useMemo(() => {
        const result: Record<string, ParsedRow[] | undefined> = {}
        for (const widget of widgets) {
            let rows = augmentedRowsByTableId[widget.tableId]
            if (rows && crossFilter && crossFilter.tableId === widget.tableId && crossFilter.sourceWidgetId !== widget.id) {
                const cfNum = Number(crossFilter.value)
                const cfIsNum = Number.isFinite(cfNum)
                rows = rows.filter(row => {
                    const v = row[crossFilter.field]
                    return cfIsNum
                        ? Number(v) === cfNum
                        : String(v ?? '') === String(crossFilter.value)
                })
            }
            result[widget.id] = rows
        }
        return result
    }, [widgets, augmentedRowsByTableId, crossFilter])

    // Calculated columns per table for configurator
    const calcColumnsByTableId = useMemo(() => {
        const result: Record<string, ColumnConfig[]> = {}
        for (const [tableId, cfs] of Object.entries(calcFields)) {
            result[tableId] = cfs.map(cf => ({
                field: cf.id,
                headerName: `${cf.name} ✱`,
                type: 'number' as const,
                visible: true,
            }))
        }
        return result
    }, [calcFields])

    // Prepare widget data centrally — avoids duplicate aggregation across cards
    const preparedDataByWidgetId = useMemo(() => {
        const result: Record<string, PreparedWidgetData | null> = {}
        for (const widget of widgets) {
            const rows = filteredRowsByWidgetId[widget.id]
            const tableState = tableStates.find(s => s.id === widget.tableId)
            const isLoading = loadingTableIds.includes(widget.tableId) && rowsByTableId[widget.tableId] === undefined
            result[widget.id] = isLoading ? null : prepareWidgetData(widget, tableState, rows ?? [], calcColumnsByTableId[widget.tableId])
        }
        return result
    }, [widgets, filteredRowsByWidgetId, tableStates, loadingTableIds, rowsByTableId, calcColumnsByTableId])

    // Column stats for configurator — computed once per table, not on every configurator open
    const colStatsByTableId = useMemo(() => {
        const result: Record<string, ColStats> = {}
        for (const ts of tableStates) {
            const rows = augmentedRowsByTableId[ts.id]
            const calcCols = calcColumnsByTableId[ts.id] ?? []
            const allColumns = [...ts.columns, ...calcCols]
            if (!rows?.length || !allColumns.length) { result[ts.id] = {}; continue }
            const sample = rows.length > 50_000 ? rows.slice(0, 50_000) : rows
            const numericFields = new Set(allColumns.filter(c => c.type === 'number').map(c => c.field))
            const uniqSets: Record<string, Set<string>> = {}
            const nullCounts: Record<string, number> = {}
            const mins: Record<string, number> = {}
            const maxes: Record<string, number> = {}
            for (const col of allColumns) {
                uniqSets[col.field] = new Set()
                nullCounts[col.field] = 0
                if (numericFields.has(col.field)) { mins[col.field] = Infinity; maxes[col.field] = -Infinity }
            }
            for (const row of sample) {
                for (const col of allColumns) {
                    const v = row[col.field]
                    if (v == null || v === '') { nullCounts[col.field]++ } else {
                        uniqSets[col.field].add(String(v))
                        if (numericFields.has(col.field)) {
                            const n = Number(v)
                            if (Number.isFinite(n)) {
                                if (n < mins[col.field]) mins[col.field] = n
                                if (n > maxes[col.field]) maxes[col.field] = n
                            }
                        }
                    }
                }
            }
            const stats: ColStats = {}
            for (const col of allColumns) {
                stats[col.field] = {
                    uniq: uniqSets[col.field].size,
                    nullPct: Math.round(nullCounts[col.field] / sample.length * 100),
                    ...(numericFields.has(col.field) && mins[col.field] !== Infinity ? { min: mins[col.field], max: maxes[col.field] } : {}),
                }
            }
            result[ts.id] = stats
        }
        return result
    }, [tableStates, augmentedRowsByTableId, calcColumnsByTableId])

    const editingWidget = editingId ? widgets.find(w => w.id === editingId) ?? null : null

    const handleSave = (widget: WidgetConfig) => {
        const normalized = {
            ...widget,
            yField: widget.chartType === 'heatmap'
                ? widget.yField
                : widget.chartType === 'bubble'
                    ? widget.yFields[0]
                    : undefined,
        }
        setWidgets(prev => {
            const idx = prev.findIndex(w => w.id === normalized.id)
            if (idx >= 0) { const next = [...prev]; next[idx] = normalized; return next }
            return [...prev, normalized]
        })
    }

    const handleEdit = (id: string) => { setEditingId(id); setDrawerOpen(true) }
    const handleDelete = (id: string) => { setDeletingId(id) }
    const confirmDelete = () => {
        if (!deletingId) return
        setWidgets(prev => prev.filter(w => w.id !== deletingId))
        setCrossFilter(cf => cf?.sourceWidgetId === deletingId ? null : cf)
        setDeletingId(null)
    }
    const handleSpanChange = (id: string, span: ColSpan) => setWidgets(prev => prev.map(w => w.id === id ? { ...w, span } : w))
    const handleHeightChange = (id: string, height: number) => setWidgets(prev => prev.map(w => w.id === id ? { ...w, height } : w))
    const handleWidthChange = (id: string, widthPx: number | undefined) => setWidgets(prev => prev.map(w => w.id === id ? { ...w, widthPx } : w))

    const handleCrossFilter = (widgetId: string, tableId: string, field: string, value: unknown) => {
        setCrossFilter(prev =>
            prev?.sourceWidgetId === widgetId && String(prev.value) === String(value)
                ? null
                : { sourceWidgetId: widgetId, tableId, field, value }
        )
    }

    const openCreate = () => { setEditingId(null); setDrawerOpen(true) }

    return (
        <Box sx={{ p: 3 }}>
            {/* Header */}
            <Box mb={2} display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
                <Box flex={1}>
                    <Typography variant="h5" fontWeight={700}>Визуализация</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {widgets.length > 0
                            ? `${widgets.length} ${widgets.length === 1 ? 'график' : widgets.length < 5 ? 'графика' : 'графиков'}`
                            : 'Нажмите «Создать», чтобы добавить первый график'}
                    </Typography>
                </Box>
                <ReportProblemButton sectionName="Визуализация" datasetId={activeTableId ?? undefined} />
                <Tooltip title="Вычисляемые поля" arrow>
                    <Button variant="outlined" startIcon={<FunctionsIcon />} onClick={() => setCalcDrawerOpen(true)} sx={{ borderRadius: 2 }}>
                        Поля{Object.values(calcFields).some(a => a.length > 0) ? ` (${Object.values(calcFields).reduce((s, a) => s + a.length, 0)})` : ''}
                    </Button>
                </Tooltip>
                {widgets.length > 0 && (
                    <Tooltip title="Экспорт страницы как изображение" arrow>
                        <Button
                            variant="outlined"
                            startIcon={<ImageIcon />}
                            disabled={exporting}
                            onClick={e => setExportMenuAnchor(e.currentTarget)}
                            sx={{ borderRadius: 2 }}
                        >
                            {exporting ? 'Экспорт…' : 'Экспорт'}
                        </Button>
                    </Tooltip>
                )}
                <Menu anchorEl={exportMenuAnchor} open={Boolean(exportMenuAnchor)} onClose={() => setExportMenuAnchor(null)}>
                    <MenuItem dense onClick={() => { setExportMenuAnchor(null); void exportDashboard('png') }}>
                        <ImageIcon sx={{ fontSize: 16, mr: 1 }} />PNG (без потерь)
                    </MenuItem>
                    <MenuItem dense onClick={() => { setExportMenuAnchor(null); void exportDashboard('jpeg') }}>
                        <ImageIcon sx={{ fontSize: 16, mr: 1 }} />JPEG (сжатый)
                    </MenuItem>
                </Menu>
                <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={tableStates.length === 0} sx={{ borderRadius: 2, px: 2.5 }}>
                    Создать
                </Button>
            </Box>

            {/* Dashboard tabs */}
            <Box mb={2} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}>
                {dashboards.map(d => {
                    const isActive = activeDashboardId === d.id
                    return (
                        <Chip
                            key={d.id}
                            size="small"
                            onClick={() => switchDashboard(d.id)}
                            variant={isActive ? 'filled' : 'outlined'}
                            color={isActive ? 'primary' : 'default'}
                            sx={{ fontWeight: isActive ? 600 : 400, cursor: 'pointer' }}
                            label={
                                isActive ? (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <span>{d.name}</span>
                                        <Tooltip title="Переименовать" arrow>
                                            <DriveFileRenameOutlineIcon
                                                sx={{ fontSize: 13, cursor: 'pointer', opacity: 0.8, '&:hover': { opacity: 1 } }}
                                                onClick={(e) => { e.stopPropagation(); setRenamingDashboardId(d.id); setRenamingName(d.name) }}
                                            />
                                        </Tooltip>
                                        {dashboards.length > 1 && (
                                            <Tooltip title="Удалить график" arrow>
                                                <CloseIcon
                                                    sx={{ fontSize: 13, cursor: 'pointer', opacity: 0.7, '&:hover': { opacity: 1, color: 'error.main' } }}
                                                    onClick={(e) => { e.stopPropagation(); deleteDashboard(d.id) }}
                                                />
                                            </Tooltip>
                                        )}
                                    </Box>
                                ) : d.name
                            }
                        />
                    )
                })}
                <Tooltip title="Новый график" arrow>
                    <IconButton size="small" onClick={createDashboard}><AddBoxIcon sx={{ fontSize: 18 }} /></IconButton>
                </Tooltip>
            </Box>

            {/* Rename dashboard dialog */}
            <Dialog open={Boolean(renamingDashboardId)} onClose={() => setRenamingDashboardId(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Переименовать график</DialogTitle>
                <DialogContent>
                    <TextField autoFocus fullWidth size="small" label="Название" value={renamingName}
                        onChange={e => setRenamingName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && renamingDashboardId) { renameDashboard(renamingDashboardId, renamingName); setRenamingDashboardId(null) } }}
                        sx={{ mt: 1 }} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenamingDashboardId(null)}>Отмена</Button>
                    <Button variant="contained" onClick={() => { if (renamingDashboardId) { renameDashboard(renamingDashboardId, renamingName); setRenamingDashboardId(null) } }}>Сохранить</Button>
                </DialogActions>
            </Dialog>

            {tableStates.length === 0 && (
                <Alert severity="info" sx={{ borderRadius: 2, mb: 2 }}>
                    Сначала загрузите датасет на странице <strong>Рабочее место</strong>.
                </Alert>
            )}

            {/* Cross-filter banner */}
            {crossFilter && (
                <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}
                    action={<Button size="small" onClick={() => setCrossFilter(null)}>Сбросить</Button>}>
                    Кросс-фильтр активен: <strong>{crossFilter.field} = {String(crossFilter.value)}</strong> — остальные графики отфильтрованы
                </Alert>
            )}

            {/* Widgets grid */}
            {widgets.length === 0 && tableStates.length > 0 ? (
                <Paper variant="outlined" onClick={openCreate} sx={{ borderRadius: 2, p: 8, textAlign: 'center', cursor: 'pointer', borderStyle: 'dashed', borderColor: 'divider', transition: 'border-color 0.15s, background 0.15s', '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' } }}>
                    <AddIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                    <Typography color="text.secondary">Нажмите, чтобы создать первый график</Typography>
                </Paper>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={widgets.map(w => w.id)} strategy={rectSortingStrategy}>
                        <Box ref={dashGridRef} sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 2 }}>
                            {widgets.map(widget => (
                                <SortableChartCard
                                    key={widget.id}
                                    widget={widget}
                                    tableState={tableStates.find(s => s.id === widget.tableId)}
                                    prepared={preparedDataByWidgetId[widget.id] ?? null}
                                    isRowsLoading={loadingTableIds.includes(widget.tableId) && rowsByTableId[widget.tableId] === undefined}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                    onSpanChange={handleSpanChange}
                                    onHeightChange={handleHeightChange}
                                    onWidthChange={handleWidthChange}
                                    onCrossFilter={(field, value) => handleCrossFilter(widget.id, widget.tableId, field, value)}
                                    activeCrossValue={crossFilter?.sourceWidgetId === widget.id ? crossFilter.value : undefined}
                                    isCrossFilterSource={crossFilter?.sourceWidgetId === widget.id}
                                    calcColumns={calcColumnsByTableId[widget.tableId]}
                                />
                            ))}
                            {widgets.length > 0 && (
                                <Paper variant="outlined" onClick={openCreate} sx={{ gridColumn: 'span 3', minHeight: 120, borderRadius: 2, borderStyle: 'dashed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.5, cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s', '&:hover': { bgcolor: 'action.hover', borderColor: 'primary.main' } }}>
                                    <AddIcon sx={{ color: 'text.disabled' }} />
                                    <Typography variant="caption" color="text.disabled">Добавить</Typography>
                                </Paper>
                            )}
                        </Box>
                    </SortableContext>
                </DndContext>
            )}

            <ChartConfigurator
                open={drawerOpen}
                initial={editingWidget}
                rowsByTableId={augmentedRowsByTableId}
                calcColumnsByTableId={calcColumnsByTableId}
                colStatsByTableId={colStatsByTableId}
                onClose={() => { setDrawerOpen(false); setEditingId(null) }}
                onSave={(widget) => { handleSave(widget); setDrawerOpen(false); setEditingId(null) }}
            />

            <CalcFieldsDrawer
                open={calcDrawerOpen}
                onClose={() => setCalcDrawerOpen(false)}
                tableStates={tableStates}
                calcFields={calcFields}
                rowsByTableId={augmentedRowsByTableId}
                onChange={(tableId, fields) => setCalcFields(prev => ({ ...prev, [tableId]: fields }))}
            />

            <Dialog open={Boolean(deletingId)} onClose={() => setDeletingId(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Удалить виджет?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {(() => {
                            const w = deletingId ? widgets.find(w => w.id === deletingId) : null
                            const label = w?.title || CHART_TYPES.find(ct => ct.type === w?.chartType)?.label || 'виджет'
                            return `«${label}» будет удалён без возможности восстановления.`
                        })()}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeletingId(null)}>Отмена</Button>
                    <Button onClick={confirmDelete} color="error" variant="contained" autoFocus>Удалить</Button>
                </DialogActions>
            </Dialog>
        </Box>
    )
}
