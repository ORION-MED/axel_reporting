import { useState, useEffect, useMemo } from 'react'
import { DateTime } from 'luxon'
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    ListSubheader,
    TextField,
    Box,
    Typography,
    Chip,
    Divider,
    IconButton,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction,
    Paper,
    Alert,
    Stack,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import FilterListIcon from '@mui/icons-material/FilterList'
import AddIcon from '@mui/icons-material/Add'
import { useTableStore } from '@entities/table'
import type {
    ColumnConfig,
    ColumnFilter,
    DatetimeFilter,
    TimeFilter,
    NumberOperator,
    DateOperator,
    StringOperator,
} from '@shared/types'
import { getBaseFilterField, groupIcd9Values, isIcdCategoryColumn } from '@shared/lib'

interface Props {
    open: boolean
    onClose: () => void
}

const NUMBER_OPERATORS: { value: NumberOperator; label: string }[] = [
    { value: '>', label: 'Больше чем' },
    { value: '<', label: 'Меньше чем' },
    { value: '==', label: 'Равно' },
    { value: '<=', label: 'Не больше чем' },
    { value: '>=', label: 'Не меньше чем' },
    { value: 'between', label: 'В диапазоне' },
    { value: 'isNull', label: 'Не заполнено' },
    { value: 'isNotNull', label: 'Заполнено' },
]

const DATE_OPERATORS: { value: DateOperator; label: string }[] = [
    { value: '>', label: 'Позже чем' },
    { value: '<', label: 'Раньше чем' },
    { value: '==', label: 'Равно' },
    { value: 'between', label: 'В диапазоне' },
    { value: 'isNull', label: 'Не заполнено' },
    { value: 'isNotNull', label: 'Заполнено' },
]

const STRING_OPERATORS: { value: StringOperator; label: string }[] = [
    { value: 'ilike', label: 'Содержит' },
    { value: '==', label: 'Равно' },
    { value: 'categoryEquals', label: 'Одно из значений' },
    { value: 'isNull', label: 'Не заполнено' },
    { value: 'isNotNull', label: 'Заполнено' },
]

const needsNoValue = (op: string) => op === 'isNull' || op === 'isNotNull'
const needsBetween = (op: string) => op === 'between'

function buildFilter(col: ColumnConfig, operator: string, value: string, valueFrom: string, valueTo: string): ColumnFilter | null {
    if (col.type === 'number') {
        const op = operator as NumberOperator
        if (needsNoValue(op)) return { type: 'number', operator: op }
        if (needsBetween(op)) {
            const from = parseFloat(valueFrom)
            const to = parseFloat(valueTo)
            if (isNaN(from) || isNaN(to)) return null
            return { type: 'number', operator: op, valueFrom: from, valueTo: to }
        }
        const v = parseFloat(value)
        if (isNaN(v)) return null
        return { type: 'number', operator: op, value: v }
    }
    if (col.type === 'date') {
        const op = operator as DateOperator
        if (needsNoValue(op)) return { type: 'date', operator: op }
        if (needsBetween(op)) {
            if (!valueFrom || !valueTo) return null
            return { type: 'date', operator: op, valueFrom, valueTo }
        }
        if (!value) return null
        return { type: 'date', operator: op, value }
    }
    if (col.type === 'datetime') {
        const op = operator as DateOperator
        if (needsNoValue(op)) return { type: 'datetime', operator: op } satisfies DatetimeFilter
        if (needsBetween(op)) {
            if (!valueFrom || !valueTo) return null
            return { type: 'datetime', operator: op, valueFrom, valueTo } satisfies DatetimeFilter
        }
        if (!value) return null
        return { type: 'datetime', operator: op, value } satisfies DatetimeFilter
    }
    if (col.type === 'time') {
        const op = operator as DateOperator
        if (needsNoValue(op)) return { type: 'time', operator: op } satisfies TimeFilter
        if (needsBetween(op)) {
            if (!valueFrom || !valueTo) return null
            return { type: 'time', operator: op, valueFrom, valueTo } satisfies TimeFilter
        }
        if (!value) return null
        return { type: 'time', operator: op, value } satisfies TimeFilter
    }
    if (col.type === 'string') {
        const op = operator as StringOperator
        if (needsNoValue(op)) return { type: 'string', operator: op }
        if (!value) return null
        return { type: 'string', operator: op, value }
    }
    return null
}


function fmtDate(iso?: string): string {
    if (!iso) return '?'
    const dt = DateTime.fromISO(iso, { zone: 'utc' })
    return dt.isValid ? dt.toFormat('dd.MM.yyyy') : iso
}


function fmtDatetime(iso?: string): string {
    if (!iso) return '?'
    const dt = DateTime.fromISO(iso, { zone: 'utc' })
    return dt.isValid ? dt.toFormat('dd.MM.yyyy HH:mm') : iso
}

function filterToLabel(field: string, filter: ColumnFilter): string {
    const normalizedField = getBaseFilterField(field)
    if (filter.type === 'number') {
        if (filter.operator === 'isNull') return `${normalizedField} IS NULL`
        if (filter.operator === 'isNotNull') return `${normalizedField} IS NOT NULL`
        if (filter.operator === 'between') return `${normalizedField} от ${filter.valueFrom} до ${filter.valueTo}`
        return `${normalizedField} ${filter.operator} ${filter.value}`
    }
    if (filter.type === 'date') {
        if (filter.operator === 'isNull') return `${normalizedField} IS NULL`
        if (filter.operator === 'isNotNull') return `${normalizedField} IS NOT NULL`
        if (filter.operator === 'between')
            return `${normalizedField} от ${fmtDate(filter.valueFrom)} до ${fmtDate(filter.valueTo)}`
        return `${normalizedField} ${filter.operator} ${fmtDate(filter.value)}`
    }
    if (filter.type === 'datetime') {
        if (filter.operator === 'isNull') return `${normalizedField} IS NULL`
        if (filter.operator === 'isNotNull') return `${normalizedField} IS NOT NULL`
        if (filter.operator === 'between')
            return `${normalizedField} от ${fmtDatetime(filter.valueFrom)} до ${fmtDatetime(filter.valueTo)}`
        return `${normalizedField} ${filter.operator} ${fmtDatetime(filter.value)}`
    }
    if (filter.type === 'time') {
        if (filter.operator === 'isNull') return `${normalizedField} IS NULL`
        if (filter.operator === 'isNotNull') return `${normalizedField} IS NOT NULL`
        if (filter.operator === 'between')
            return `${normalizedField} от ${filter.valueFrom ?? '?'} до ${filter.valueTo ?? '?'}`
        return `${normalizedField} ${filter.operator} ${filter.value ?? '?'}`
    }
    if (filter.type === 'string') {
        if (filter.operator === 'isNull') return `${normalizedField} IS NULL`
        if (filter.operator === 'isNotNull') return `${normalizedField} IS NOT NULL`
        if (filter.operator === 'ilike') return `lower(${normalizedField}) ILIKE '${filter.value}'`
        return `${normalizedField} ${filter.operator} '${filter.value}'`
    }
    return normalizedField
}

export const FilterManagerDialog = ({ open, onClose }: Props) => {
    const activeState = useTableStore((s) => s.getActiveState())
    const allRows = useTableStore((s) => s.rows)
    const setFilter = useTableStore((s) => s.setFilter)
    const clearAllFilters = useTableStore((s) => s.clearAllFilters)

    const [selectedField, setSelectedField] = useState('')
    const [operator, setOperator] = useState('')
    const [value, setValue] = useState('')
    const [valueFrom, setValueFrom] = useState('')
    const [valueTo, setValueTo] = useState('')
    const [validationError, setValidationError] = useState<string | null>(null)
    const [expandedCategoryGroups, setExpandedCategoryGroups] = useState<Record<string, boolean>>({})
    const [categorySelectOpen, setCategorySelectOpen] = useState(false)

    const columns = activeState?.columns ?? []
    const activeFilters = activeState?.filters ?? {}

    const selectedCol = columns.find((c) => c.field === selectedField)
    const selectedColumnField = selectedCol?.field


    const [uniqueValues, setUniqueValues] = useState<string[]>([])

    useEffect(() => {
        if (!selectedColumnField) {
            setUniqueValues([])
            return
        }
        let cancelled = false
        const field = selectedColumnField
        const id = setTimeout(() => {
            if (cancelled) return
            const vals = Array.from(
                new Set(
                    allRows
                        .map((r) => r[field])
                        .filter((v) => v !== null && v !== undefined && v !== '')
                        .map((v) => String(v))
                )
            ).sort()
            if (!cancelled) setUniqueValues(vals)
        }, 0)
        return () => { cancelled = true; clearTimeout(id) }
    }, [selectedColumnField, allRows])

    const shouldGroupCategoryValues = isIcdCategoryColumn(selectedField)
    const groupedUniqueValues = useMemo(
        () => shouldGroupCategoryValues ? groupIcd9Values(uniqueValues) : [],
        [shouldGroupCategoryValues, uniqueValues],
    )

    const operators =
        selectedCol?.type === 'number'
            ? NUMBER_OPERATORS
            : selectedCol?.type === 'date' || selectedCol?.type === 'datetime' || selectedCol?.type === 'time'
                ? DATE_OPERATORS
                : STRING_OPERATORS


    useEffect(() => {
        setOperator('')
        setValue('')
        setValueFrom('')
        setValueTo('')
        setValidationError(null)
        setExpandedCategoryGroups({})
        setCategorySelectOpen(false)
    }, [selectedField])


    useEffect(() => {
        setValue('')
        setValueFrom('')
        setValueTo('')
        setValidationError(null)
    }, [operator])

    const handleAddFilter = () => {
        if (!selectedCol || !operator) {
            setValidationError('Выберите столбец и оператор')
            return
        }
        const filter = buildFilter(selectedCol, operator, value, valueFrom, valueTo)
        if (!filter) {
            setValidationError('Заполните значение для фильтра')
            return
        }
        setFilter(selectedCol.field, filter)
        setValidationError(null)
        setSelectedField('')
        setOperator('')
        setValue('')
        setValueFrom('')
        setValueTo('')
    }

    const inputType =
        selectedCol?.type === 'date' ? 'date' :
            selectedCol?.type === 'datetime' ? 'datetime-local' :
                selectedCol?.type === 'time' ? 'time' :
                    'text'
    const needsShrink = inputType !== 'text'
    const timeInputProps = inputType === 'time' ? { step: 1 } : undefined

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FilterListIcon color="primary" />
                <Box sx={{ flex: 1 }}>
                    Настроить фильтры
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
                        Активных фильтров: {Object.keys(activeFilters).length}
                    </Typography>
                </Box>
                <IconButton size="small" onClick={onClose}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                <Stack spacing={2}>
                    {Object.keys(activeFilters).length > 0 && (
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Активные фильтры
                            </Typography>
                            <Paper variant="outlined" sx={{ borderRadius: 1 }}>
                                <List disablePadding dense>
                                    {Object.entries(activeFilters).map(([field, filter], idx, arr) => (
                                        <Box key={field}>
                                            <ListItem sx={{ py: 0.75 }}>
                                                <ListItemText
                                                    primary={
                                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                                                            {filterToLabel(field, filter)}
                                                        </Typography>
                                                    }
                                                />
                                                <ListItemSecondaryAction>
                                                    <IconButton
                                                        size="small"
                                                        edge="end"
                                                        onClick={() => setFilter(field, null)}
                                                        color="error"
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </ListItemSecondaryAction>
                                            </ListItem>
                                            {idx < arr.length - 1 && <Divider />}
                                        </Box>
                                    ))}
                                </List>
                            </Paper>
                            <Button
                                size="small"
                                color="error"
                                onClick={clearAllFilters}
                                sx={{ mt: 1 }}
                            >
                                Очистить все фильтры
                            </Button>
                        </Box>
                    )}

                    <Divider />

                    <Typography variant="subtitle2">Добавить фильтр</Typography>

                    <FormControl fullWidth size="small">
                        <InputLabel>Столбец</InputLabel>
                        <Select
                            value={selectedField}
                            label="Столбец"
                            onChange={(e) => setSelectedField(e.target.value)}
                        >
                            {columns.map((col) => (
                                <MenuItem key={col.field} value={col.field}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        {col.headerName}
                                        <Chip
                                            label={col.type}
                                            size="small"
                                            sx={{ height: 18, fontSize: '0.65rem' }}
                                        />
                                    </Box>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {selectedField && (
                        <FormControl fullWidth size="small">
                            <InputLabel>Оператор</InputLabel>
                            <Select
                                value={operator}
                                label="Оператор"
                                onChange={(e) => setOperator(e.target.value)}
                            >
                                {operators.map((op) => (
                                    <MenuItem key={op.value} value={op.value}>
                                        {op.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}

                    {operator && !needsNoValue(operator) && (
                        <>
                            {needsBetween(operator) ? (
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    <TextField
                                        label="От"
                                        type={inputType}
                                        value={valueFrom}
                                        onChange={(e) => setValueFrom(e.target.value)}
                                        size="small"
                                        fullWidth
                                        InputLabelProps={needsShrink ? { shrink: true } : undefined}
                                        inputProps={timeInputProps}
                                    />
                                    <TextField
                                        label="До"
                                        type={inputType}
                                        value={valueTo}
                                        onChange={(e) => setValueTo(e.target.value)}
                                        size="small"
                                        fullWidth
                                        InputLabelProps={needsShrink ? { shrink: true } : undefined}
                                        inputProps={timeInputProps}
                                    />
                                </Box>
                            ) : operator === 'categoryEquals' ? (
                                <FormControl fullWidth size="small">
                                    <InputLabel>Категория</InputLabel>
                                    <Select
                                        value={value}
                                        label="Категория"
                                        open={categorySelectOpen}
                                        onOpen={() => setCategorySelectOpen(true)}
                                        onClose={() => setCategorySelectOpen(false)}
                                        onChange={(e) => setValue(e.target.value)}
                                        MenuProps={{
                                            PaperProps: {
                                                sx: {
                                                    maxHeight: 420,
                                                },
                                            },
                                        }}
                                    >
                                        {shouldGroupCategoryValues
                                            ? groupedUniqueValues.flatMap((group) => {
                                                const expanded = expandedCategoryGroups[group.key] ?? false
                                                return [
                                                    <ListSubheader
                                                        key={`group-${group.key}`}
                                                        disableSticky
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={(e) => {
                                                            e.preventDefault()
                                                            e.stopPropagation()
                                                            setExpandedCategoryGroups((prev) => ({
                                                                ...prev,
                                                                [group.key]: !expanded,
                                                            }))
                                                        }}
                                                        sx={{ cursor: 'pointer', userSelect: 'none', fontWeight: 600, pointerEvents: 'auto' }}
                                                    >
                                                        {expanded ? '▾' : '▸'} {group.label}
                                                    </ListSubheader>,
                                                    ...(expanded
                                                        ? group.values.map((v) => (
                                                            <MenuItem key={v} value={v}>
                                                                {v}
                                                            </MenuItem>
                                                        ))
                                                        : []),
                                                ]
                                            })
                                            : uniqueValues.map((v) => (
                                                <MenuItem key={v} value={v}>
                                                    {v}
                                                </MenuItem>
                                            ))}
                                        {shouldGroupCategoryValues && (
                                            <Box sx={{ px: 1, py: 0.75, display: 'flex', gap: 0.75, position: 'sticky', bottom: 0, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider', zIndex: 1 }}>
                                                <Button
                                                    size="small"
                                                    color="inherit"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={(e) => {
                                                        e.preventDefault()
                                                        e.stopPropagation()
                                                        setValue('')
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
                                                        setCategorySelectOpen(false)
                                                    }}
                                                >
                                                    Добавить
                                                </Button>
                                            </Box>
                                        )}
                                    </Select>
                                </FormControl>
                            ) : (
                                <TextField
                                    label={
                                        operator === 'ilike'
                                            ? "Шаблон (например: %word%)"
                                            : 'Значение'
                                    }
                                    type={inputType}
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                    size="small"
                                    fullWidth
                                    InputLabelProps={needsShrink ? { shrink: true } : undefined}
                                    inputProps={timeInputProps}
                                    helperText={
                                        operator === 'ilike'
                                            ? '% — любые символы, _ — один символ'
                                            : undefined
                                    }
                                />
                            )}
                        </>
                    )}

                    {validationError && (
                        <Alert severity="error" sx={{ mt: 0 }}>
                            {validationError}
                        </Alert>
                    )}

                    {selectedField && operator && (
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={handleAddFilter}
                            disableElevation
                            fullWidth
                        >
                            Применить фильтр
                        </Button>
                    )}
                </Stack>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} variant="contained" disableElevation>
                    Готово
                </Button>
            </DialogActions>
        </Dialog>
    )
}
