import type { TableState, ParsedRow, ColumnConfig } from '@shared/types'
import type { AggFn, ChartType, SortBy, WidgetConfig, WidgetFilter } from './types'
import { resolveScatterYField } from './dashboardStorage'

export const MAX_ROWS = 5000
export const PIE_FAMILY: ChartType[] = ['pie', 'radialbar', 'funnel', 'treemap']
export const KPI_TYPES: ChartType[] = ['kpi']
export const TABLE_TYPES: ChartType[] = ['table']
export const NEEDS_NUM_Y: ChartType[] = ['scatter', 'pie', 'radialbar', 'funnel', 'treemap', 'radar']

export interface WidgetRowsMeta {
    totalRows: number
    usedRows: number
    isTruncated: boolean
}

export type WidgetErrorCode =
    | 'table_not_found'
    | 'invalid_config'
    | 'x_field_missing'
    | 'y_field_missing'
    | 'insufficient_data'

export interface HeatmapData {
    xLabels: string[]
    yLabels: string[]
    cells: Array<{ x: string; y: string; value: number }>
    min: number
    max: number
}

export interface CalendarData {
    year: number
    // grid[weekIndex][dayIndex 0=Mon…6=Sun] = { date: 'YYYY-MM-DD', value } | null
    grid: Array<Array<{ date: string; value: number | null } | null>>
    monthLabels: Array<{ label: string; col: number }>
    min: number
    max: number
}

export interface SankeyData {
    nodes: Array<{ name: string }>
    links: Array<{ source: number; target: number; value: number }>
}

export type PreparedWidgetData =
    | {
        status: 'ok'
        chartData: Array<Record<string, unknown>>
        chartData100: Array<Record<string, unknown>>
        pieData: Array<{ name: string; value: number }>
        yFields: string[]
        rowsMeta: WidgetRowsMeta
        scatterAxes?: { xField: string; yField: string }
        kpiData?: { value: number; prevValue?: number; change?: number; groupLabel?: string; prevLabel?: string }
        tableData?: Array<Record<string, unknown>>
        heatmapData?: HeatmapData
        calendarData?: CalendarData
        sankeyData?: SankeyData
    }
    | {
        status: 'error'
        code: WidgetErrorCode
        message: string
    }

// Aggregates a mixed-type value array into a single number or string.
// Used by both aggregate() and aggregatePie() to avoid logic duplication.
function computeGroupValue(rawVals: unknown[], aggFn: AggFn): number | string | null {
    if (aggFn === 'count') return rawVals.length
    if (aggFn === 'count_distinct') return new Set(rawVals.map(String)).size
    if (aggFn === 'min' || aggFn === 'max') {
        const nums = rawVals.filter((v) => !Number.isNaN(Number(v))).map(Number)
        if (nums.length > 0) {
            return aggFn === 'min'
                ? nums.reduce((a, b) => (b < a ? b : a), Infinity)
                : nums.reduce((a, b) => (b > a ? b : a), -Infinity)
        }
        // fallback: lexicographic min/max (useful for date strings)
        const strs = rawVals.map(String).sort()
        return aggFn === 'min' ? strs[0] : strs[strs.length - 1]
    }
    const nums = rawVals.filter((v) => !Number.isNaN(Number(v))).map(Number)
    if (nums.length === 0) return null
    return computeAgg(nums, aggFn)
}

function aggregate(
    rows: ParsedRow[],
    xField: string,
    yFields: string[],
    aggFn: AggFn,
): Array<Record<string, unknown>> {
    if (aggFn === 'none') {
        return rows.map((row) => {
            const obj: Record<string, unknown> = { _x: row[xField] ?? '' }
            for (const yField of yFields) {
                const value = row[yField]
                obj[yField] = value != null && value !== '' && !Number.isNaN(Number(value)) ? Number(value) : null
            }
            return obj
        })
    }

    const groups = new Map<string, ParsedRow[]>()
    for (const row of rows) {
        const key = String(row[xField] ?? '(пусто)')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
    }

    return [...groups.entries()].map(([key, groupRows]) => {
        const out: Record<string, unknown> = { _x: key }
        for (const yField of yFields) {
            const rawVals = groupRows.map((row) => row[yField]).filter((v) => v != null && v !== '')
            const result = computeGroupValue(rawVals, aggFn)
            out[yField] = typeof result === 'number' ? Math.round(result * 1e4) / 1e4 : result
        }
        return out
    })
}

function aggregateStacked100(
    rows: ParsedRow[],
    xField: string,
    yFields: string[],
    aggFn: AggFn,
): Array<Record<string, unknown>> {
    const base = aggregate(rows, xField, yFields, aggFn)
    return base.map((row) => {
        const total = yFields.reduce((sum, yField) => sum + (Number(row[yField]) || 0), 0)
        const out: Record<string, unknown> = { _x: row._x }

        for (const yField of yFields) {
            out[yField] = total === 0 ? 0 : Math.round(((Number(row[yField]) || 0) / total) * 1000) / 10
        }

        return out
    })
}

function aggregatePie(
    rows: ParsedRow[],
    nameField: string,
    valueField: string,
    aggFn: AggFn,
): Array<{ name: string; value: number }> {
    const groups = new Map<string, unknown[]>()

    for (const row of rows) {
        const name = String(row[nameField] ?? '(пусто)')
        const value = row[valueField]
        if (!groups.has(name)) groups.set(name, [])
        if (value != null && value !== '') groups.get(name)!.push(value)
    }

    const mode: AggFn = aggFn === 'none' ? 'count' : aggFn

    return [...groups.entries()]
        .map(([name, rawVals]) => {
            const result = computeGroupValue(rawVals, mode)
            return { name, value: typeof result === 'number' ? Math.round(result * 1e4) / 1e4 : 0 }
        })
        .sort((a, b) => b.value - a.value)
}

function applySortBy(
    data: Array<Record<string, unknown>>,
    sortBy: SortBy,
    yFields: string[],
): Array<Record<string, unknown>> {
    if (sortBy === 'none') return data
    const sorted = [...data]
    if (sortBy === 'name_asc') {
        sorted.sort((a, b) => String(a._x).localeCompare(String(b._x), 'ru'))
    } else if (sortBy === 'value_asc') {
        sorted.sort((a, b) => {
            const av = yFields.reduce((s, f) => s + (Number(a[f]) || 0), 0)
            const bv = yFields.reduce((s, f) => s + (Number(b[f]) || 0), 0)
            return av - bv
        })
    } else if (sortBy === 'value_desc') {
        sorted.sort((a, b) => {
            const av = yFields.reduce((s, f) => s + (Number(a[f]) || 0), 0)
            const bv = yFields.reduce((s, f) => s + (Number(b[f]) || 0), 0)
            return bv - av
        })
    }
    return sorted
}

function applySortByPie(
    data: Array<{ name: string; value: number }>,
    sortBy: SortBy,
): Array<{ name: string; value: number }> {
    if (sortBy === 'none' || sortBy === 'value_desc') return data
    const sorted = [...data]
    if (sortBy === 'name_asc') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    else if (sortBy === 'value_asc') sorted.sort((a, b) => a.value - b.value)
    return sorted
}

function reorderByX(
    data: Array<Record<string, unknown>>,
    xOrder: string[],
): Array<Record<string, unknown>> {
    const orderMap = new Map(xOrder.map((x, i) => [x, i]))
    return [...data].sort((a, b) => (orderMap.get(String(a._x)) ?? 0) - (orderMap.get(String(b._x)) ?? 0))
}

function isNumericColumn(tableState: TableState, field: string): boolean {
    return tableState.columns.some((column) => column.field === field && column.type === 'number')
}

function makeRowsMeta(rows: ParsedRow[], aggFn: AggFn): { limitedRows: ParsedRow[]; rowsMeta: WidgetRowsMeta } {
    const totalRows = rows.length
    // Limit only for raw (no aggregation) rendering — aggregated result is always small
    const limit = aggFn === 'none' ? MAX_ROWS : totalRows
    const usedRows = Math.min(totalRows, limit)

    return {
        limitedRows: rows.slice(0, limit),
        rowsMeta: {
            totalRows,
            usedRows,
            isTruncated: totalRows > usedRows,
        },
    }
}

function validateCommon(widget: WidgetConfig, tableState: TableState): PreparedWidgetData | null {
    if (!widget.xField) {
        return { status: 'error', code: 'invalid_config', message: 'Некорректная конфигурация: не задано поле X.' }
    }

    if (!tableState.columns.some((column) => column.field === widget.xField)) {
        return { status: 'error', code: 'x_field_missing', message: `Поле X "${widget.xField}" не найдено в таблице.` }
    }

    return null
}

function computeAgg(values: number[], aggFn: AggFn): number {
    if (values.length === 0) return 0
    const fn = aggFn === 'none' ? 'sum' : aggFn
    if (fn === 'sum') return values.reduce((a, b) => a + b, 0)
    if (fn === 'mean') return values.reduce((a, b) => a + b, 0) / values.length
    if (fn === 'median') {
        const sorted = [...values].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }
    if (fn === 'count') return values.length
    if (fn === 'count_distinct') return new Set(values).size
    if (fn === 'min') return values.reduce((a, b) => (b < a ? b : a), Infinity)
    if (fn === 'max') return values.reduce((a, b) => (b > a ? b : a), -Infinity)
    return values.reduce((a, b) => a + b, 0)
}

function applyWidgetFilters(rows: ParsedRow[], filters: WidgetFilter[], tableState: TableState): ParsedRow[] {
    let result = rows
    for (const f of filters) {
        if (!tableState.columns.some(c => c.field === f.field)) continue
        if (f.type === 'select' && f.values?.length) {
            const set = new Set(f.values)
            result = result.filter(row => set.has(String(row[f.field] ?? '')))
        } else if (f.type === 'range') {
            result = result.filter(row => {
                const v = Number(row[f.field])
                if (!Number.isFinite(v)) return false
                if (f.min !== null && f.min !== undefined && v < f.min) return false
                if (f.max !== null && f.max !== undefined && v > f.max) return false
                return true
            })
        }
    }
    return result
}

function prepareHistogram(
    rows: ParsedRow[],
    xField: string,
    bins: number,
): Array<Record<string, unknown>> {
    const values = rows.map(r => Number(r[xField])).filter(v => Number.isFinite(v))
    if (values.length === 0) return []
    const min = values.reduce((a, b) => b < a ? b : a, Infinity)
    const max = values.reduce((a, b) => b > a ? b : a, -Infinity)
    if (min === max) return [{ _x: String(min), count: values.length }]
    const binSize = (max - min) / bins
    const counts = new Array<number>(bins).fill(0)
    for (const v of values) {
        const i = Math.min(bins - 1, Math.floor((v - min) / binSize))
        counts[i]++
    }
    return counts.map((count, i) => {
        const lo = min + i * binSize
        const hi = lo + binSize
        return { _x: `${lo.toFixed(2)}–${hi.toFixed(2)}`, count }
    })
}

function prepareHeatmap(
    rows: ParsedRow[],
    xField: string,
    yField: string,
    valueField: string,
    aggFn: AggFn,
): HeatmapData {
    const groups = new Map<string, Map<string, unknown[]>>()
    for (const row of rows) {
        const x = String(row[xField] ?? '(пусто)')
        const y = String(row[yField] ?? '(пусто)')
        const v = row[valueField]
        if (!groups.has(x)) groups.set(x, new Map())
        const yMap = groups.get(x)!
        if (!yMap.has(y)) yMap.set(y, [])
        if (v != null && v !== '') yMap.get(y)!.push(v)
    }

    const xLabels = [...groups.keys()]
    const ySet = new Set<string>()
    for (const yMap of groups.values()) for (const y of yMap.keys()) ySet.add(y)
    const yLabels = [...ySet]

    const cells: HeatmapData['cells'] = []
    let minVal = Infinity, maxVal = -Infinity

    for (const x of xLabels) {
        for (const y of yLabels) {
            const rawVals = groups.get(x)?.get(y) ?? []
            const result = computeGroupValue(rawVals, aggFn === 'none' ? 'count' : aggFn)
            const value = typeof result === 'number' ? Math.round(result * 1e4) / 1e4 : 0
            cells.push({ x, y, value })
            if (value < minVal) minVal = value
            if (value > maxVal) maxVal = value
        }
    }

    return { xLabels, yLabels, cells, min: minVal === Infinity ? 0 : minVal, max: maxVal === -Infinity ? 0 : maxVal }
}

function prepareWaterfall(
    rows: ParsedRow[],
    xField: string,
    yField: string,
    aggFn: AggFn,
): Array<Record<string, unknown>> {
    const groups = new Map<string, unknown[]>()
    for (const row of rows) {
        const key = String(row[xField] ?? '(пусто)')
        const v = row[yField]
        if (!groups.has(key)) groups.set(key, [])
        if (v != null && v !== '') groups.get(key)!.push(v)
    }

    let running = 0
    return [...groups.entries()].map(([key, rawVals]) => {
        const result = computeGroupValue(rawVals, aggFn === 'none' ? 'sum' : aggFn)
        const delta = typeof result === 'number' ? result : 0
        const base = delta >= 0 ? running : running + delta
        running += delta
        return { _x: key, base: Math.round(base * 1e4) / 1e4, delta: Math.abs(Math.round(delta * 1e4) / 1e4), isPositive: delta >= 0, total: Math.round(running * 1e4) / 1e4 }
    })
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = p * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function prepareBoxPlot(
    rows: ParsedRow[],
    xField: string,
    yField: string,
): Array<Record<string, unknown>> {
    const groups = new Map<string, number[]>()
    for (const row of rows) {
        const key = String(row[xField] ?? '(пусто)')
        const v = Number(row[yField])
        if (Number.isFinite(v)) {
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key)!.push(v)
        }
    }
    return [...groups.entries()].map(([key, vals]) => {
        const sorted = [...vals].sort((a, b) => a - b)
        const q1 = percentile(sorted, 0.25)
        const median = percentile(sorted, 0.5)
        const q3 = percentile(sorted, 0.75)
        const iqr = q3 - q1
        const wLow = q1 - 1.5 * iqr
        const wHigh = q3 + 1.5 * iqr
        const whiskerLow = sorted.find(v => v >= wLow) ?? sorted[0]
        const whiskerHigh = [...sorted].reverse().find(v => v <= wHigh) ?? sorted[sorted.length - 1]
        return { _x: key, min: whiskerLow, q1, median, q3, max: whiskerHigh }
    })
}

function preparePareto(
    rows: ParsedRow[],
    xField: string,
    yField: string,
    aggFn: AggFn,
): Array<Record<string, unknown>> {
    const raw = aggregate(rows, xField, [yField], aggFn === 'none' ? 'sum' : aggFn)
    const sorted = [...raw].sort((a, b) => (Number(b[yField]) || 0) - (Number(a[yField]) || 0))
    const total = sorted.reduce((s, r) => s + (Number(r[yField]) || 0), 0)
    let cumulative = 0
    return sorted.map(r => {
        cumulative += Number(r[yField]) || 0
        return { ...r, cumPct: total > 0 ? Math.round((cumulative / total) * 1000) / 10 : 0 }
    })
}

function prepareSankey(
    rows: ParsedRow[],
    sourceField: string,
    targetField: string,
    valueField: string | undefined,
    aggFn: AggFn,
): SankeyData {
    const nodeNames: string[] = []
    const nodeIndex = new Map<string, number>()
    const getOrAdd = (name: string): number => {
        if (!nodeIndex.has(name)) {
            nodeIndex.set(name, nodeNames.length)
            nodeNames.push(name)
        }
        return nodeIndex.get(name)!
    }

    const linkVals = new Map<string, { source: number; target: number; vals: unknown[] }>()

    for (const row of rows) {
        const src = String(row[sourceField] ?? '(пусто)')
        const tgt = String(row[targetField] ?? '(пусто)')
        const si = getOrAdd(src)
        const ti = getOrAdd(tgt)
        if (si === ti) continue
        const key = `${si}-${ti}`
        if (!linkVals.has(key)) linkVals.set(key, { source: si, target: ti, vals: [] })
        const entry = linkVals.get(key)!
        if (valueField) {
            const v = row[valueField]
            if (v != null && v !== '') entry.vals.push(v)
        } else {
            entry.vals.push(1)
        }
    }

    const nodes = nodeNames.map(name => ({ name }))
    const links: SankeyData['links'] = []
    const effectiveAgg: AggFn = valueField ? (aggFn === 'none' ? 'sum' : aggFn) : 'count'

    for (const { source, target, vals } of linkVals.values()) {
        if (vals.length === 0) continue
        const result = computeGroupValue(vals, effectiveAgg)
        const value = typeof result === 'number' ? Math.max(0, Math.round(result * 1e4) / 1e4) : 0
        if (value > 0) links.push({ source, target, value })
    }

    return { nodes, links }
}

function prepareCalendar(
    rows: ParsedRow[],
    dateField: string,
    valueField: string,
    aggFn: AggFn,
): CalendarData | null {
    const dayMap = new Map<string, unknown[]>()
    for (const row of rows) {
        const raw = String(row[dateField] ?? '')
        const m = raw.match(/^(\d{4}-\d{2}-\d{2})/)
        if (!m) continue
        const date = m[1]
        const v = row[valueField]
        if (!dayMap.has(date)) dayMap.set(date, [])
        if (v != null && v !== '') dayMap.get(date)!.push(v)
    }
    if (dayMap.size === 0) return null

    const yearCounts = new Map<number, number>()
    for (const date of dayMap.keys()) {
        const y = Number(date.slice(0, 4))
        yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1)
    }
    const year = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]

    const dayValues = new Map<string, number>()
    let minVal = Infinity, maxVal = -Infinity
    for (const [date, rawVals] of dayMap.entries()) {
        if (!date.startsWith(String(year))) continue
        const result = computeGroupValue(rawVals, aggFn === 'none' ? 'sum' : aggFn)
        const value = typeof result === 'number' ? Math.round(result * 1e4) / 1e4 : 0
        dayValues.set(date, value)
        if (value < minVal) minVal = value
        if (value > maxVal) maxVal = value
    }

    const jan1 = new Date(year, 0, 1)
    const jan1Dow = (jan1.getDay() + 6) % 7 // 0=Mon, 6=Sun
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    const daysInYear = isLeap ? 366 : 365
    const totalWeeks = Math.ceil((daysInYear + jan1Dow) / 7)

    const grid: CalendarData['grid'] = []
    for (let w = 0; w < totalWeeks; w++) {
        const week: Array<{ date: string; value: number | null } | null> = []
        for (let d = 0; d < 7; d++) {
            const dayNum = w * 7 + d - jan1Dow
            if (dayNum < 0 || dayNum >= daysInYear) {
                week.push(null)
            } else {
                const dt = new Date(year, 0, dayNum + 1)
                const dateStr = `${year}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
                week.push({ date: dateStr, value: dayValues.get(dateStr) ?? null })
            }
        }
        grid.push(week)
    }

    const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек']
    const monthLabels: CalendarData['monthLabels'] = []
    const seenMonths = new Set<number>()
    for (let w = 0; w < totalWeeks; w++) {
        for (let d = 0; d < 7; d++) {
            const cell = grid[w][d]
            if (cell) {
                const month = Number(cell.date.slice(5, 7)) - 1
                if (!seenMonths.has(month)) {
                    seenMonths.add(month)
                    monthLabels.push({ label: monthNames[month], col: w })
                }
            }
        }
    }

    return {
        year,
        grid,
        monthLabels,
        min: minVal === Infinity ? 0 : minVal,
        max: maxVal === -Infinity ? 0 : maxVal,
    }
}

export function prepareWidgetData(
    widget: WidgetConfig,
    tableState: TableState | undefined,
    rows: ParsedRow[],
    calcColumns?: ColumnConfig[],
): PreparedWidgetData {
    if (!tableState) {
        return { status: 'error', code: 'table_not_found', message: 'Исходная таблица не найдена. Возможно, она была удалена.' }
    }

    const effectiveState: TableState = calcColumns?.length
        ? { ...tableState, columns: [...tableState.columns, ...calcColumns] }
        : tableState

    // Apply per-widget filters before any aggregation
    const filteredRows = widget.widgetFilters?.length
        ? applyWidgetFilters(rows, widget.widgetFilters, effectiveState)
        : rows

    if (filteredRows.length === 0) {
        return { status: 'error', code: 'insufficient_data', message: 'Недостаточно данных: таблица не содержит строк.' }
    }

    const { limitedRows, rowsMeta } = makeRowsMeta(filteredRows, widget.aggFn)

    // Histogram — numeric distribution, no aggregation required
    if (widget.chartType === 'histogram') {
        if (!widget.xField) {
            return { status: 'error', code: 'invalid_config', message: 'Выберите числовое поле для гистограммы.' }
        }
        if (!isNumericColumn(effectiveState, widget.xField)) {
            return { status: 'error', code: 'invalid_config', message: 'Гистограмма требует числового поля.' }
        }
        const bins = widget.histogramBins ?? 20
        const chartData = prepareHistogram(filteredRows, widget.xField, bins)
        if (chartData.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет числовых данных для гистограммы.' }
        }
        return { status: 'ok', chartData, chartData100: [], pieData: [], yFields: ['count'], rowsMeta }
    }

    // Heatmap — two categorical axes + numeric intensity
    if (widget.chartType === 'heatmap') {
        const yCatField = widget.yField
        const valueField = widget.yFields[0]
        if (!widget.xField || !yCatField || !valueField) {
            return { status: 'error', code: 'invalid_config', message: 'Для тепловой карты выберите поле X, поле Y (категории) и поле значения.' }
        }
        if (!effectiveState.columns.some(c => c.field === widget.xField)) {
            return { status: 'error', code: 'x_field_missing', message: `Поле X "${widget.xField}" не найдено.` }
        }
        if (!effectiveState.columns.some(c => c.field === yCatField)) {
            return { status: 'error', code: 'y_field_missing', message: `Поле Y "${yCatField}" не найдено.` }
        }
        if (!effectiveState.columns.some(c => c.field === valueField)) {
            return { status: 'error', code: 'y_field_missing', message: `Поле значения "${valueField}" не найдено.` }
        }
        const heatmapData = prepareHeatmap(filteredRows, widget.xField, yCatField, valueField, widget.aggFn)
        if (heatmapData.cells.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет данных для тепловой карты.' }
        }
        return { status: 'ok', chartData: [], chartData100: [], pieData: [], yFields: [valueField], rowsMeta, heatmapData }
    }

    // Waterfall — running total bridge chart
    if (widget.chartType === 'waterfall') {
        if (!widget.xField || !widget.yFields[0]) {
            return { status: 'error', code: 'invalid_config', message: 'Для водопада выберите поле X и поле значения Y.' }
        }
        if (!effectiveState.columns.some(c => c.field === widget.xField)) {
            return { status: 'error', code: 'x_field_missing', message: `Поле X "${widget.xField}" не найдено.` }
        }
        const chartData = prepareWaterfall(filteredRows, widget.xField, widget.yFields[0], widget.aggFn)
        if (chartData.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет данных для водопада.' }
        }
        return { status: 'ok', chartData, chartData100: [], pieData: [], yFields: widget.yFields, rowsMeta }
    }

    // Calendar heatmap — date field + value field
    if (widget.chartType === 'calendar') {
        if (!widget.xField || !widget.yFields[0]) {
            return { status: 'error', code: 'invalid_config', message: 'Для календаря выберите поле даты (X) и поле значения (Y).' }
        }
        if (!effectiveState.columns.some(c => c.field === widget.xField)) {
            return { status: 'error', code: 'x_field_missing', message: `Поле даты "${widget.xField}" не найдено.` }
        }
        const calendarData = prepareCalendar(filteredRows, widget.xField, widget.yFields[0], widget.aggFn)
        if (!calendarData) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет дат формата ГГГГ-ММ-ДД для построения календаря.' }
        }
        return { status: 'ok', chartData: [], chartData100: [], pieData: [], yFields: widget.yFields, rowsMeta, calendarData }
    }

    // Pareto — bars sorted desc + cumulative % line
    if (widget.chartType === 'pareto') {
        if (!widget.xField || !widget.yFields[0]) {
            return { status: 'error', code: 'invalid_config', message: 'Для диаграммы Парето выберите поле X и поле Y.' }
        }
        if (!effectiveState.columns.some(c => c.field === widget.xField)) {
            return { status: 'error', code: 'x_field_missing', message: `Поле X "${widget.xField}" не найдено.` }
        }
        if (!effectiveState.columns.some(c => c.field === widget.yFields[0])) {
            return { status: 'error', code: 'y_field_missing', message: `Поле Y "${widget.yFields[0]}" не найдено.` }
        }
        const chartData = preparePareto(filteredRows, widget.xField, widget.yFields[0], widget.aggFn)
        if (chartData.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет данных для диаграммы Парето.' }
        }
        return { status: 'ok', chartData, chartData100: [], pieData: [], yFields: widget.yFields, rowsMeta }
    }

    // Sankey — flow diagram
    if (widget.chartType === 'sankey') {
        if (!widget.xField || !widget.targetField) {
            return { status: 'error', code: 'invalid_config', message: 'Для диаграммы Сэнки выберите поле источника (X) и поле назначения.' }
        }
        if (!effectiveState.columns.some(c => c.field === widget.xField)) {
            return { status: 'error', code: 'x_field_missing', message: `Поле источника "${widget.xField}" не найдено.` }
        }
        if (!effectiveState.columns.some(c => c.field === widget.targetField)) {
            return { status: 'error', code: 'y_field_missing', message: `Поле назначения "${widget.targetField}" не найдено.` }
        }
        const sankeyData = prepareSankey(filteredRows, widget.xField, widget.targetField, widget.yFields[0], widget.aggFn)
        if (sankeyData.links.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет связей для диаграммы Сэнки.' }
        }
        return { status: 'ok', chartData: [], chartData100: [], pieData: [], yFields: widget.yFields, rowsMeta, sankeyData }
    }

    // Box plot — statistical distribution per category
    if (widget.chartType === 'boxplot') {
        if (!widget.xField || !widget.yFields[0]) {
            return { status: 'error', code: 'invalid_config', message: 'Для ящика с усами выберите поле группировки (X) и числовое поле (Y).' }
        }
        if (!effectiveState.columns.some(c => c.field === widget.xField)) {
            return { status: 'error', code: 'x_field_missing', message: `Поле X "${widget.xField}" не найдено.` }
        }
        if (!effectiveState.columns.some(c => c.field === widget.yFields[0])) {
            return { status: 'error', code: 'y_field_missing', message: `Поле Y "${widget.yFields[0]}" не найдено.` }
        }
        if (!isNumericColumn(effectiveState, widget.yFields[0])) {
            return { status: 'error', code: 'invalid_config', message: 'Ящик с усами требует числового поля Y.' }
        }
        const chartData = prepareBoxPlot(filteredRows, widget.xField, widget.yFields[0])
        if (chartData.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет числовых данных для ящика с усами.' }
        }
        return { status: 'ok', chartData, chartData100: [], pieData: [], yFields: widget.yFields, rowsMeta }
    }

    // Require aggregation for all chart types except scatter/bubble and table
    if (widget.aggFn === 'none' && widget.chartType !== 'scatter' && widget.chartType !== 'bubble' && widget.chartType !== 'table') {
        return { status: 'error', code: 'invalid_config', message: 'Выберите агрегацию (Сумма, Среднее, Количество…) для отображения графика.' }
    }

    // KPI widget — special handling, xField optional
    if (widget.chartType === 'kpi') {
        const yField = widget.yFields[0]
        if (!yField) {
            return { status: 'error', code: 'invalid_config', message: 'Не задано поле метрики для KPI.' }
        }
        if (!effectiveState.columns.some(c => c.field === yField)) {
            return { status: 'error', code: 'y_field_missing', message: `Поле "${yField}" не найдено в таблице.` }
        }
        const kpiNeedsNumeric = widget.aggFn === 'sum' || widget.aggFn === 'mean' || widget.aggFn === 'median'
        if (kpiNeedsNumeric && !isNumericColumn(effectiveState, yField)) {
            return { status: 'error', code: 'invalid_config', message: `Агрегация "${widget.aggFn}" требует числового поля для KPI.` }
        }

        const kpiCompareMode = widget.kpiCompareMode ?? 'none'

        if (kpiCompareMode === 'prev_group' && widget.xField) {
            const groups = new Map<string, number[]>()
            for (const row of limitedRows) {
                const key = String(row[widget.xField] ?? '(пусто)')
                const val = Number(row[yField])
                if (Number.isFinite(val)) {
                    if (!groups.has(key)) groups.set(key, [])
                    groups.get(key)!.push(val)
                }
            }
            const sortedKeys = [...groups.keys()].sort()
            if (sortedKeys.length >= 2) {
                const lastKey = sortedKeys[sortedKeys.length - 1]
                const prevKey = sortedKeys[sortedKeys.length - 2]
                const currentValue = computeAgg(groups.get(lastKey)!, widget.aggFn)
                const prevValue = computeAgg(groups.get(prevKey)!, widget.aggFn)
                const change = prevValue !== 0 ? ((currentValue - prevValue) / Math.abs(prevValue)) * 100 : undefined
                return {
                    status: 'ok',
                    chartData: [],
                    chartData100: [],
                    pieData: [],
                    yFields: [yField],
                    rowsMeta,
                    kpiData: { value: currentValue, prevValue, change, groupLabel: lastKey, prevLabel: prevKey },
                }
            }
        }

        const nums = limitedRows.map(r => Number(r[yField])).filter(v => Number.isFinite(v))
        if (nums.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Нет числовых данных для KPI.' }
        }
        return {
            status: 'ok',
            chartData: [],
            chartData100: [],
            pieData: [],
            yFields: [yField],
            rowsMeta,
            kpiData: { value: computeAgg(nums, widget.aggFn) },
        }
    }

    // Table widget
    if (widget.chartType === 'table') {
        if (!widget.xField && widget.yFields.length === 0) {
            return { status: 'error', code: 'invalid_config', message: 'Не выбраны поля для таблицы.' }
        }
        const commonError = validateCommon(widget, effectiveState)
        if (commonError) return commonError

        const yFields = widget.yFields
        const missingY = yFields.find(f => !effectiveState.columns.some(c => c.field === f))
        if (missingY) {
            return { status: 'error', code: 'y_field_missing', message: `Поле "${missingY}" не найдено в таблице.` }
        }
        const tableRaw = aggregate(limitedRows, widget.xField, yFields, widget.aggFn)
        const tableSorted = applySortBy(tableRaw, widget.sortBy ?? 'none', yFields)
        return {
            status: 'ok',
            chartData: tableSorted,
            chartData100: [],
            pieData: [],
            yFields,
            rowsMeta,
            tableData: tableSorted,
        }
    }

    const commonError = validateCommon(widget, effectiveState)
    if (commonError) return commonError

    const isPieFamily = PIE_FAMILY.includes(widget.chartType)

    if (widget.chartType === 'scatter' || widget.chartType === 'bubble') {
        const resolvedY = resolveScatterYField(widget)
        const scatterYFields = widget.chartType === 'bubble'
            ? (resolvedY ? [resolvedY] : [])
            : widget.yFields.length > 0
                ? widget.yFields
                : resolvedY ? [resolvedY] : []

        if (scatterYFields.length === 0) {
            return { status: 'error', code: 'invalid_config', message: 'Некорректная конфигурация: не задано поле Y.' }
        }

        if (!isNumericColumn(effectiveState, widget.xField)) {
            return { status: 'error', code: 'invalid_config', message: 'Для этого типа необходимо выбрать числовые поля X и Y.' }
        }

        for (const yf of scatterYFields) {
            if (!effectiveState.columns.some((col) => col.field === yf)) {
                return { status: 'error', code: 'y_field_missing', message: `Поле Y "${yf}" не найдено в таблице.` }
            }
            if (!isNumericColumn(effectiveState, yf)) {
                return { status: 'error', code: 'invalid_config', message: `Поле "${yf}" должно быть числовым.` }
            }
        }

        const rField = widget.chartType === 'bubble' ? widget.rField : undefined
        if (rField && !effectiveState.columns.some(c => c.field === rField)) {
            return { status: 'error', code: 'invalid_config', message: `Поле размера "${rField}" не найдено в таблице.` }
        }
        if (rField && !isNumericColumn(effectiveState, rField)) {
            return { status: 'error', code: 'invalid_config', message: `Поле размера "${rField}" должно быть числовым.` }
        }

        const chartData = limitedRows
            .map((row) => {
                const x = Number(row[widget.xField])
                if (!Number.isFinite(x)) return null
                const obj: Record<string, unknown> = { x }
                for (const yf of scatterYFields) {
                    const y = Number(row[yf])
                    obj[yf] = Number.isFinite(y) ? y : null
                }
                if (widget.chartType === 'bubble') {
                    const y = Number(row[scatterYFields[0]])
                    if (!Number.isFinite(y)) return null
                    obj.y = y
                }
                if (rField) {
                    const r = Number(row[rField])
                    obj.r = Number.isFinite(r) ? r : 0
                } else if (widget.chartType === 'bubble') {
                    obj.r = 1
                }
                return obj
            })
            .filter((point): point is Record<string, unknown> => point !== null)

        if (chartData.length < 2) {
            return { status: 'error', code: 'insufficient_data', message: 'Недостаточно валидных числовых точек.' }
        }

        return {
            status: 'ok',
            chartData,
            chartData100: [],
            pieData: [],
            yFields: scatterYFields,
            rowsMeta,
            scatterAxes: { xField: widget.xField, yField: scatterYFields[0] },
        }
    }

    if (isPieFamily) {
        const yField = widget.yFields[0]
        if (!yField) {
            return { status: 'error', code: 'invalid_config', message: 'Некорректная конфигурация: не задано поле значения.' }
        }

        if (!effectiveState.columns.some((column) => column.field === yField)) {
            return { status: 'error', code: 'y_field_missing', message: `Поле Y "${yField}" не найдено в таблице.` }
        }

        const pieNeedsNumeric = widget.aggFn === 'sum' || widget.aggFn === 'mean' || widget.aggFn === 'median'
        if (pieNeedsNumeric && !isNumericColumn(effectiveState, yField)) {
            return {
                status: 'error',
                code: 'invalid_config',
                message: `Агрегация "${widget.aggFn}" требует числового поля значения.`,
            }
        }

        const pieDataRaw = aggregatePie(limitedRows, widget.xField, yField, widget.aggFn)
        if (pieDataRaw.length === 0) {
            return { status: 'error', code: 'insufficient_data', message: 'Недостаточно данных для построения графика.' }
        }

        return {
            status: 'ok',
            chartData: [],
            chartData100: [],
            pieData: applySortByPie(pieDataRaw, widget.sortBy ?? 'none'),
            yFields: [yField],
            rowsMeta,
        }
    }

    if (!widget.yFields.length) {
        return { status: 'error', code: 'invalid_config', message: 'Некорректная конфигурация: не выбраны поля Y.' }
    }

    if (widget.chartType === 'bar_stacked_pct' && widget.yFields.length < 2) {
        return { status: 'error', code: 'invalid_config', message: 'Нормированный график требует минимум 2 поля Y — иначе каждая серия всегда будет 100%.' }
    }

    const missingYField = widget.yFields.find((yField) => !effectiveState.columns.some((column) => column.field === yField))
    if (missingYField) {
        return { status: 'error', code: 'y_field_missing', message: `Поле Y "${missingYField}" не найдено в таблице.` }
    }

    const needsNumericValue = widget.aggFn === 'sum' || widget.aggFn === 'mean' || widget.aggFn === 'median'
    if (needsNumericValue) {
        const invalidY = widget.yFields.find((yField) => !isNumericColumn(effectiveState, yField))
        if (invalidY) {
            return {
                status: 'error',
                code: 'invalid_config',
                message: `Агрегация "${widget.aggFn}" требует числового поля, но "${invalidY}" не является числовым.`,
            }
        }
    }

    const chartDataRaw = aggregate(limitedRows, widget.xField, widget.yFields, widget.aggFn)

    if (chartDataRaw.length === 0) {
        return { status: 'error', code: 'insufficient_data', message: 'Недостаточно данных для построения графика.' }
    }

    const sortedChartData = applySortBy(chartDataRaw, widget.sortBy ?? 'none', widget.yFields)

    let chartData100: Array<Record<string, unknown>> = []
    if (widget.chartType === 'bar_stacked_pct') {
        const raw100 = aggregateStacked100(limitedRows, widget.xField, widget.yFields, widget.aggFn)
        const xOrder = sortedChartData.map((row) => String(row._x))
        chartData100 = reorderByX(raw100, xOrder)
    }

    return {
        status: 'ok',
        chartData: sortedChartData,
        chartData100,
        pieData: [],
        yFields: widget.yFields,
        rowsMeta,
    }
}
