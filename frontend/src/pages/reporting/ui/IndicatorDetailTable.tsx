import { type ReactNode } from 'react'
import {
    Chip,
    InputAdornment,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'

/**
 * Generic, config-driven breakdown table for indicator detail dialogs (roadmap step 2.3).
 * Replaces a table hardcoded per indicator: give it a row shape, a column config and a
 * filter config, and it renders search + filter chips + table + empty state the same way
 * for any indicator. InstitutionDetailsDialog (6.1.3.2.7) is the first consumer — the
 * indicator-specific summary header and per-row actions stay in the caller, only the
 * "search/filter/list" pattern itself is generic here.
 */
export interface IndicatorDetailColumn<Row> {
    key: string
    header: string
    align?: 'left' | 'right'
    width?: number | string
    render: (row: Row) => ReactNode
}

export interface IndicatorDetailFilterOption<Filter extends string> {
    value: Filter
    label: string
}

interface IndicatorDetailTableProps<Row, Filter extends string> {
    rows: Row[]
    getRowId: (row: Row) => string
    columns: Array<IndicatorDetailColumn<Row>>
    filters: Array<IndicatorDetailFilterOption<Filter>>
    activeFilter: Filter
    onFilterChange: (filter: Filter) => void
    searchValue: string
    onSearchChange: (value: string) => void
    searchPlaceholder: string
    emptyMessage: string
    rowCountLabel?: (count: number) => string
    toolbarExtra?: ReactNode
    tableMinWidth?: number
}

export function IndicatorDetailTable<Row, Filter extends string>({
    rows,
    getRowId,
    columns,
    filters,
    activeFilter,
    onFilterChange,
    searchValue,
    onSearchChange,
    searchPlaceholder,
    emptyMessage,
    rowCountLabel,
    toolbarExtra,
    tableMinWidth = 1040,
}: IndicatorDetailTableProps<Row, Filter>) {
    return (
        <Stack spacing={1} sx={{ minHeight: 0, flex: 1 }}>
            <Paper variant="outlined" sx={{ p: 1 }}>
                <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={0.75}
                    alignItems={{ xs: 'stretch', md: 'center' }}
                >
                    <TextField
                        size="small"
                        value={searchValue}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={searchPlaceholder}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon fontSize="small" />
                                </InputAdornment>
                            ),
                        }}
                        sx={{ flex: 1, minWidth: { md: 320 } }}
                    />
                    {toolbarExtra}
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ minWidth: 68, textAlign: { md: 'right' } }}
                    >
                        {rowCountLabel ? rowCountLabel(rows.length) : `${rows.length} строк`}
                    </Typography>
                </Stack>
                {/* Фильтры опциональны: карточка МО (рекомендации 27.07, п.9.6) управляет
                    выборкой вкладками, поэтому строку чипов там не показываем. */}
                {filters.length > 0 && (
                    <Stack
                        direction="row"
                        spacing={0.6}
                        flexWrap="wrap"
                        useFlexGap
                        alignItems="center"
                        sx={{ mt: 0.75 }}
                    >
                        {filters.map((filter) => (
                            <Chip
                                key={filter.value}
                                size="small"
                                clickable
                                color={activeFilter === filter.value ? 'primary' : 'default'}
                                variant={activeFilter === filter.value ? 'filled' : 'outlined'}
                                label={filter.label}
                                onClick={() => onFilterChange(filter.value)}
                            />
                        ))}
                    </Stack>
                )}
            </Paper>

            <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}
            >
                <Table stickyHeader size="small" sx={{ minWidth: tableMinWidth }}>
                    <TableHead>
                        <TableRow>
                            {columns.map((column) => (
                                <TableCell
                                    key={column.key}
                                    align={column.align}
                                    sx={{ width: column.width }}
                                >
                                    {column.header}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={columns.length}>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        align="center"
                                        sx={{ py: 3 }}
                                    >
                                        {emptyMessage}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {rows.map((row) => (
                            <TableRow key={getRowId(row)} hover>
                                {columns.map((column) => (
                                    <TableCell
                                        key={column.key}
                                        align={column.align}
                                        sx={{ verticalAlign: 'top' }}
                                    >
                                        {column.render(row)}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Stack>
    )
}
