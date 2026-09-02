export type ChartType =
    | 'bar' | 'bar_h' | 'bar_stacked' | 'bar_stacked_pct'
    | 'line' | 'area'
    | 'scatter' | 'bubble'
    | 'pie'
    | 'radar'
    | 'radialbar'
    | 'funnel'
    | 'treemap'
    | 'composed'
    | 'histogram'
    | 'heatmap'
    | 'waterfall'
    | 'calendar'
    | 'pareto'
    | 'sankey'
    | 'boxplot'
    | 'kpi'
    | 'table'

export type AggFn = 'none' | 'sum' | 'mean' | 'median' | 'count' | 'count_distinct' | 'min' | 'max'

export type ColSpan = 3 | 4 | 6 | 12

export type SortBy = 'none' | 'name_asc' | 'value_asc' | 'value_desc'

export type KpiCompareMode = 'none' | 'prev_group'

export interface CalculatedField {
    id: string
    name: string
    formula: string
}

export interface WidgetFilter {
    field: string
    type: 'select' | 'range'
    values?: string[]
    min?: number | null
    max?: number | null
}

export interface WidgetConfig {
    id: string
    title: string
    tableId: string
    chartType: ChartType
    xField: string
    yFields: string[]
    yField?: string
    aggFn: AggFn
    span: ColSpan
    height: number
    widthPx?: number
    swatchIdx: number
    sortBy: SortBy
    showLabels: boolean
    xAxisLabel?: string
    yAxisLabel?: string
    kpiCompareMode?: KpiCompareMode
    tablePageSize?: number
    // bubble
    rField?: string
    // histogram
    histogramBins?: number
    // per-widget filters
    widgetFilters?: WidgetFilter[]
    // sankey
    targetField?: string
}
