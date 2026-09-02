import type { WidgetConfig, ChartType, AggFn, ColSpan, SortBy, KpiCompareMode, WidgetFilter } from './types'

// ─── Keys ────────────────────────────────────────────────────────────────────

const DASHBOARD_LIST_KEY = 'dashboard:list:v1'
const widgetsKey = (id: string) => `dashboard:widgets:v2:${id}`
const LEGACY_WIDGETS_KEY = 'dashboard:widgets:v1'
const filtersKey = (id: string) => `dashboard:filters:v1:${id}`

// ─── Allowed values ───────────────────────────────────────────────────────────

const ALLOWED_CHART_TYPES: ChartType[] = [
    'bar', 'bar_h', 'bar_stacked', 'bar_stacked_pct',
    'line', 'area', 'scatter', 'bubble', 'pie', 'radar', 'radialbar',
    'funnel', 'treemap', 'composed', 'histogram', 'heatmap', 'waterfall',
    'calendar', 'pareto', 'sankey', 'boxplot',
    'kpi', 'table',
]

const ALLOWED_AGG_FN: AggFn[] = ['none', 'sum', 'mean', 'median', 'count', 'count_distinct', 'min', 'max']
const ALLOWED_SPANS: ColSpan[] = [3, 4, 6, 12]
const ALLOWED_SORT_BY: SortBy[] = ['none', 'name_asc', 'value_asc', 'value_desc']

// ─── Dashboard list ───────────────────────────────────────────────────────────

export interface DashboardMeta {
    id: string
    name: string
}

export interface SavedFilters {
    globalFilters: Record<string, Record<string, string[]>>
    rangeFilters: Record<string, Record<string, [number | null, number | null]>>
}

export function loadDashboardList(): DashboardMeta[] {
    try {
        const raw = localStorage.getItem(DASHBOARD_LIST_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed
            .filter((d): d is DashboardMeta => d && typeof d.id === 'string' && typeof d.name === 'string')
    } catch {
        return []
    }
}

export function saveDashboardList(list: DashboardMeta[]): void {
    localStorage.setItem(DASHBOARD_LIST_KEY, JSON.stringify(list))
}

// ─── Filter persistence ───────────────────────────────────────────────────────

export function loadDashboardFilters(dashboardId: string): SavedFilters {
    try {
        const raw = localStorage.getItem(filtersKey(dashboardId))
        if (!raw) return { globalFilters: {}, rangeFilters: {} }
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object') return { globalFilters: {}, rangeFilters: {} }
        const p = parsed as Record<string, unknown>
        return {
            globalFilters: (p.globalFilters && typeof p.globalFilters === 'object')
                ? p.globalFilters as SavedFilters['globalFilters']
                : {},
            rangeFilters: (p.rangeFilters && typeof p.rangeFilters === 'object')
                ? p.rangeFilters as SavedFilters['rangeFilters']
                : {},
        }
    } catch {
        return { globalFilters: {}, rangeFilters: {} }
    }
}

export function saveDashboardFilters(dashboardId: string, filters: SavedFilters): void {
    localStorage.setItem(filtersKey(dashboardId), JSON.stringify(filters))
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

export function resolveScatterYField(widget: Pick<WidgetConfig, 'chartType' | 'xField' | 'yFields' | 'yField'>): string {
    if (widget.chartType !== 'scatter' && widget.chartType !== 'bubble') {
        return widget.yField ?? widget.yFields[0] ?? ''
    }

    if (widget.yField && widget.yField !== widget.xField) {
        return widget.yField
    }

    if (widget.yFields.length >= 2 && widget.yFields[0] === widget.xField) {
        return widget.yFields[1]
    }

    return widget.yFields.find((field) => field !== widget.xField) ?? widget.yFields[0] ?? ''
}

function normalizeWidgetFilter(raw: unknown): WidgetFilter | null {
    if (!raw || typeof raw !== 'object') return null
    const src = raw as Partial<WidgetFilter>
    if (typeof src.field !== 'string' || !src.field) return null
    if (src.type === 'select') {
        return {
            field: src.field,
            type: 'select',
            values: Array.isArray(src.values)
                ? src.values.filter((v): v is string => typeof v === 'string')
                : [],
        }
    }
    if (src.type === 'range') {
        return {
            field: src.field,
            type: 'range',
            min: typeof src.min === 'number' ? src.min : null,
            max: typeof src.max === 'number' ? src.max : null,
        }
    }
    return null
}

function normalizeWidget(raw: unknown): WidgetConfig | null {
    if (!raw || typeof raw !== 'object') return null

    const src = raw as Partial<WidgetConfig>
    if (!src.id || !src.tableId) return null

    const chartType = ALLOWED_CHART_TYPES.includes(src.chartType as ChartType)
        ? (src.chartType as ChartType)
        : 'bar'

    const aggFn = ALLOWED_AGG_FN.includes(src.aggFn as AggFn)
        ? (src.aggFn as AggFn)
        : 'none'

    const span = ALLOWED_SPANS.includes(src.span as ColSpan)
        ? (src.span as ColSpan)
        : 6

    const height = Number(src.height)
    const swatchIdx = Number(src.swatchIdx)

    const yFields = Array.isArray(src.yFields)
        ? src.yFields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
        : []

    const sortBy = ALLOWED_SORT_BY.includes(src.sortBy as SortBy) ? (src.sortBy as SortBy) : 'none'

    const ALLOWED_KPI_COMPARE: KpiCompareMode[] = ['none', 'prev_group']
    const kpiCompareMode = ALLOWED_KPI_COMPARE.includes(src.kpiCompareMode as KpiCompareMode)
        ? (src.kpiCompareMode as KpiCompareMode)
        : undefined

    const tablePageSizeRaw = Number(src.tablePageSize)
    const tablePageSize = Number.isFinite(tablePageSizeRaw) && tablePageSizeRaw > 0
        ? tablePageSizeRaw
        : undefined

    const histogramBinsRaw = Number(src.histogramBins)
    const histogramBins = Number.isFinite(histogramBinsRaw) && histogramBinsRaw >= 2 && histogramBinsRaw <= 200
        ? Math.round(histogramBinsRaw)
        : undefined

    const widgetFilters = Array.isArray(src.widgetFilters)
        ? src.widgetFilters.map(normalizeWidgetFilter).filter((f): f is WidgetFilter => f !== null)
        : undefined

    const normalized: WidgetConfig = {
        id: String(src.id),
        title: typeof src.title === 'string' ? src.title : '',
        tableId: String(src.tableId),
        chartType,
        xField: typeof src.xField === 'string' ? src.xField : '',
        yFields,
        yField: typeof src.yField === 'string' && src.yField.trim() ? src.yField : undefined,
        aggFn,
        span,
        height: Number.isFinite(height) ? Math.max(200, Math.min(800, Math.round(height))) : 320,
        swatchIdx: Number.isFinite(swatchIdx) ? Math.max(0, Math.round(swatchIdx)) : 0,
        sortBy,
        showLabels: typeof src.showLabels === 'boolean' ? src.showLabels : false,
        ...(kpiCompareMode !== undefined ? { kpiCompareMode } : {}),
        ...(tablePageSize !== undefined ? { tablePageSize } : {}),
        ...(typeof src.xAxisLabel === 'string' && src.xAxisLabel ? { xAxisLabel: src.xAxisLabel } : {}),
        ...(typeof src.yAxisLabel === 'string' && src.yAxisLabel ? { yAxisLabel: src.yAxisLabel } : {}),
        ...(typeof src.widthPx === 'number' && src.widthPx > 0 ? { widthPx: src.widthPx } : {}),
        ...(typeof src.rField === 'string' && src.rField ? { rField: src.rField } : {}),
        ...(histogramBins !== undefined ? { histogramBins } : {}),
        ...(widgetFilters?.length ? { widgetFilters } : {}),
        ...(typeof src.targetField === 'string' && src.targetField ? { targetField: src.targetField } : {}),
    }

    if (normalized.chartType === 'scatter') {
        const legacyFields = normalized.yFields.length >= 2 && normalized.yFields[0] === normalized.xField
            ? normalized.yFields.slice(1)
            : normalized.yFields
        const yFields = legacyFields.filter((field) => field && field !== normalized.xField)
        if (yFields.length === 0) {
            const yField = resolveScatterYField(normalized)
            normalized.yFields = yField ? [yField] : []
        } else {
            normalized.yFields = yFields
        }
        normalized.yField = undefined
    }

    if (normalized.chartType === 'bubble') {
        const yField = resolveScatterYField(normalized)
        normalized.yField = yField
        normalized.yFields = yField ? [yField] : []
    }

    return normalized
}

// ─── Widget persistence ───────────────────────────────────────────────────────

export function loadLegacyDashboardWidgets(): WidgetConfig[] {
    try {
        const raw = localStorage.getItem(LEGACY_WIDGETS_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.map(normalizeWidget).filter((w): w is WidgetConfig => w !== null)
    } catch {
        return []
    }
}

export function loadDashboardWidgets(dashboardId: string): WidgetConfig[] {
    try {
        const raw = localStorage.getItem(widgetsKey(dashboardId))
        if (!raw) return []
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.map(normalizeWidget).filter((w): w is WidgetConfig => w !== null)
    } catch {
        return []
    }
}

export function saveDashboardWidgets(widgets: WidgetConfig[], dashboardId: string): void {
    localStorage.setItem(widgetsKey(dashboardId), JSON.stringify(widgets))
}
