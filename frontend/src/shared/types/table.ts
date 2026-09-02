export type ColumnType = 'number' | 'date' | 'datetime' | 'time' | 'string'

export type NumberOperator =
    | '>'
    | '<'
    | '=='
    | '<='
    | '>='
    | 'between'
    | 'isNull'
    | 'isNotNull'

export type DateOperator =
    | '>'
    | '<'
    | '=='
    | 'between'
    | 'isNull'
    | 'isNotNull'

export type StringOperator =
    | 'ilike'
    | 'categoryEquals'
    | 'categoryNotEquals'
    | 'isNull'
    | 'isNotNull'
    | '=='

export type FilterOperator = NumberOperator | DateOperator | StringOperator

export interface NumberFilter {
    type: 'number'
    operator: NumberOperator
    value?: number
    valueFrom?: number
    valueTo?: number
}

export interface DateFilter {
    type: 'date'
    operator: DateOperator
    value?: string
    valueFrom?: string
    valueTo?: string
}

export interface DatetimeFilter {
    type: 'datetime'
    operator: DateOperator
    value?: string
    valueFrom?: string
    valueTo?: string
}

export interface TimeFilter {
    type: 'time'
    operator: DateOperator
    value?: string
    valueFrom?: string
    valueTo?: string
}

export interface StringFilter {
    type: 'string'
    operator: StringOperator
    value?: string
}

export type ColumnFilter = NumberFilter | DateFilter | DatetimeFilter | TimeFilter | StringFilter

export interface ColumnConfig {
    field: string
    headerName: string
    type: ColumnType
    visible: boolean
    width?: number
}

export type ProcessingType = 'impute' | 'scale' | 'encode' | 'outliers' | 'timeseries' | 'window_split'

export interface ProcessingEntry {
    id: string
    type: ProcessingType
    label: string
    config: Record<string, unknown>
    appliedAt: string
}

export interface TableState {
    id: string
    fileName: string
    columns: ColumnConfig[]
    filters: Record<string, ColumnFilter>
    uploadedAt: string
    processingHistory?: ProcessingEntry[]
    originalColumns?: ColumnConfig[]
    uploadId?: string
    profileJobId?: string
    profileStatus?: 'pending' | 'running' | 'completed' | 'failed'
    profileError?: string | null
}

export interface ParsedRow {
    id: string | number
    [key: string]: unknown
}
