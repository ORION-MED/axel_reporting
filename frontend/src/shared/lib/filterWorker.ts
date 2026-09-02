import { applyFilters } from './filterUtils'
import type { ColumnFilter, ParsedRow } from '@shared/types'

type AggFunc = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
type AggEntry = { field: string; func: AggFunc }
type GroupConfig = { groupByFields: string[]; aggregates: AggEntry[] }

interface FilterMsg {
    rows: ParsedRow[]
    filters: Record<string, ColumnFilter>
    hideNulls: boolean
    visibleFields: string[]
    groupConfig: GroupConfig | null
}

self.onmessage = (e: MessageEvent<FilterMsg>) => {
    const { rows, filters, hideNulls, visibleFields, groupConfig } = e.data

    const afterFilters = applyFilters(rows, filters)
    const filtered = hideNulls
        ? afterFilters.filter((row) =>
            visibleFields.every((f) => row[f] !== null && row[f] !== undefined && row[f] !== '')
        )
        : afterFilters

    let display: ParsedRow[]
    if (!groupConfig || groupConfig.groupByFields.length === 0) {
        display = filtered
    } else {
        const groups = new Map<string, ParsedRow[]>()
        for (const row of filtered) {
            const key = groupConfig.groupByFields.map(f => String(row[f] ?? '')).join('\x00')
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key)!.push(row)
        }
        const result: ParsedRow[] = []
        let idx = 0
        for (const groupRows of groups.values()) {
            const aggRow: ParsedRow = { id: `agg_${idx++}` }
            for (const f of groupConfig.groupByFields) aggRow[f] = groupRows[0][f]
            // Always include row count per group
            aggRow['_count'] = groupRows.length
            for (const { field, func } of groupConfig.aggregates) {
                const colKey = `${func}(${field})`
                if (func === 'COUNT') {
                    aggRow[colKey] = groupRows.length
                } else {
                    const nums = groupRows
                        .map(r => r[field])
                        .filter(v => v != null && v !== '')
                        .map(v => Number(v))
                        .filter(v => !isNaN(v))
                    if (func === 'SUM') aggRow[colKey] = nums.reduce((a, b) => a + b, 0)
                    else if (func === 'AVG') aggRow[colKey] = nums.length ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4) : null
                    else if (func === 'MIN') aggRow[colKey] = nums.length ? nums.reduce((a, b) => (a < b ? a : b)) : null
                    else if (func === 'MAX') aggRow[colKey] = nums.length ? nums.reduce((a, b) => (a > b ? a : b)) : null
                }
            }
            result.push(aggRow)
        }
        display = result
    }

    self.postMessage({ filteredRows: filtered, displayRows: display })
}
