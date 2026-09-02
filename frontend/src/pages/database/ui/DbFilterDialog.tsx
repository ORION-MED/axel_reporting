import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, FormControl, InputLabel, Select, MenuItem,
    TextField, Box, Typography, Chip, Divider,
    IconButton, List, ListItem, ListItemText, ListItemSecondaryAction,
    Paper, Stack, Checkbox, CircularProgress,
    type SelectChangeEvent,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import FilterListIcon from '@mui/icons-material/FilterList'
import AddIcon from '@mui/icons-material/Add'
import { formatFilterSummaryLabel, groupIcd9Values, isIcdCategoryColumn, useNotify } from '@shared/lib'

export type ColType = 'number' | 'date' | 'datetime' | 'time' | 'string'

export interface ColumnDef {
    column_name: string
    data_type: string
}

export interface FilterDef {
    column: string
    operator: string
    value?: string
    valueFrom?: string
    valueTo?: string
    colType: ColType
}

interface Props {
    open: boolean
    onClose: () => void
    columns: ColumnDef[]
    filters: FilterDef[]
    onAddFilters: (filters: FilterDef[]) => void
    onRemove: (index: number) => void
    onClear: () => void
    fetchDistinct: (column: string) => Promise<string[]>
}

const NUMBER_OPS = [
    { value: '>', label: 'Больше чем' },
    { value: '<', label: 'Меньше чем' },
    { value: '==', label: 'Равно' },
    { value: '<=', label: 'Не больше чем' },
    { value: '>=', label: 'Не меньше чем' },
    { value: 'between', label: 'В диапазоне' },
    { value: 'isNull', label: 'Не заполнено' },
    { value: 'isNotNull', label: 'Заполнено' },
]

const DATE_OPS = [
    { value: '>', label: 'Позже чем' },
    { value: '<', label: 'Раньше чем' },
    { value: '==', label: 'Равно' },
    { value: 'between', label: 'В диапазоне' },
    { value: 'isNull', label: 'Не заполнено' },
    { value: 'isNotNull', label: 'Заполнено' },
]

const STRING_OPS = [
    { value: 'ilike', label: 'Содержит (ILIKE)' },
    { value: '==', label: 'Равно' },
    { value: 'categoryEquals', label: 'Одно из значений (IN)' },
    { value: 'categoryNotEquals', label: 'Исключить значения (NOT IN)' },
    { value: 'isNull', label: 'Не заполнено' },
    { value: 'isNotNull', label: 'Заполнено' },
]

function pgTypeToColType(pgType: string): ColType {
    const t = pgType.toLowerCase()
    if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision', 'decimal', 'int4', 'int8', 'int2', 'float4', 'float8'].includes(t)) return 'number'
    if (t === 'date') return 'date'
    if (['timestamp without time zone', 'timestamp with time zone', 'timestamp', 'timestamptz'].includes(t)) return 'datetime'
    if (['time without time zone', 'time with time zone', 'time', 'timetz'].includes(t)) return 'time'
    return 'string'
}

function opsForType(t: ColType) {
    if (t === 'number') return NUMBER_OPS
    if (t === 'date' || t === 'datetime' || t === 'time') return DATE_OPS
    return STRING_OPS
}

function inputTypeFor(c: ColType): string {
    if (c === 'date') return 'date'
    if (c === 'datetime') return 'datetime-local'
    if (c === 'time') return 'time'
    if (c === 'number') return 'number'
    return 'text'
}

const needsNoValue = (op: string) => op === 'isNull' || op === 'isNotNull'
const needsBetween = (op: string) => op === 'between'
const isCategory = (op: string) => op === 'categoryEquals' || op === 'categoryNotEquals'

const GROUP_SENTINEL = '__dbfilter_group__'

export const DbFilterDialog = ({ open, onClose, columns, filters, onAddFilters, onRemove, onClear, fetchDistinct }: Props) => {
    const { showError } = useNotify()
    const fetchDistinctRef = useRef(fetchDistinct)
    const [draftCol, setDraftCol] = useState('')
    const [draftOp, setDraftOp] = useState('')
    const [draftVal, setDraftVal] = useState('')
    const [draftCategoryVals, setDraftCategoryVals] = useState<string[]>([])
    const [draftFrom, setDraftFrom] = useState('')
    const [draftTo, setDraftTo] = useState('')
    const [categoryValues, setCategoryValues] = useState<string[]>([])
    const [categoryLoading, setCategoryLoading] = useState(false)
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
    const [categorySelectOpen, setCategorySelectOpen] = useState(false)

    const draftColInfo = columns.find((c) => c.column_name === draftCol)
    const draftColType: ColType = draftColInfo ? pgTypeToColType(draftColInfo.data_type) : 'string'
    const draftOps = opsForType(draftColType)
    const iType = inputTypeFor(draftColType)
    const needsShrink = iType !== 'text' && iType !== 'number'

    const shouldGroupCategories = useMemo(() => isIcdCategoryColumn(draftCol), [draftCol])
    const groupedCategoryValues = useMemo(
        () => (shouldGroupCategories ? groupIcd9Values(categoryValues) : []),
        [categoryValues, shouldGroupCategories],
    )

    useEffect(() => {
        fetchDistinctRef.current = fetchDistinct
    }, [fetchDistinct])

    useEffect(() => {
        setDraftOp('')
        setDraftVal('')
        setDraftCategoryVals([])
        setDraftFrom('')
        setDraftTo('')
        setCategoryValues([])
        setExpandedGroups({})
    }, [draftCol])

    useEffect(() => {
        setDraftVal('')
        setDraftCategoryVals([])
        setDraftFrom('')
        setDraftTo('')
        setCategoryValues([])
        setExpandedGroups({})
        setCategorySelectOpen(false)
        if (isCategory(draftOp) && draftCol) {
            setCategoryLoading(true)
            fetchDistinctRef.current(draftCol)
                .then((data) => setCategoryValues(data))
                .catch((err) => {
                    setCategoryValues([])
                    showError(
                        err?.response?.data?.message
                        ?? err?.message
                        ?? 'Не удалось загрузить значения колонки',
                    )
                })
                .finally(() => setCategoryLoading(false))
        }
    }, [draftOp, draftCol, showError])

    const handleCategoryMultiChange = useCallback((values: string[]) => {
        const groupKey = values.find((v) => v.startsWith(GROUP_SENTINEL))
        if (groupKey) {
            const key = groupKey.slice(GROUP_SENTINEL.length)
            setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
            return
        }
        setDraftCategoryVals(values.filter((v) => !v.startsWith(GROUP_SENTINEL)))
    }, [])

    const toggleGroupSelection = useCallback((groupKey: string) => {
        const group = groupedCategoryValues.find((g) => g.key === groupKey)
        if (!group) return
        setDraftCategoryVals((prev) => {
            const allSelected = group.values.every((v) => prev.includes(v))
            return allSelected
                ? prev.filter((v) => !group.values.includes(v))
                : Array.from(new Set([...prev, ...group.values]))
        })
    }, [groupedCategoryValues])

    const canAdd = (): boolean => {
        if (!draftCol || !draftOp) return false
        if (needsNoValue(draftOp)) return true
        if (needsBetween(draftOp)) return Boolean(draftFrom && draftTo)
        if (isCategory(draftOp)) return draftCategoryVals.length > 0
        return Boolean(draftVal)
    }

    const handleAdd = () => {
        if (!canAdd()) return
        if (isCategory(draftOp)) {
            onAddFilters(draftCategoryVals.map((value) => ({
                column: draftCol,
                operator: draftOp,
                colType: draftColType,
                value,
            })))
        } else {
            onAddFilters([{
                column: draftCol,
                operator: draftOp,
                colType: draftColType,
                ...(needsBetween(draftOp)
                    ? { valueFrom: draftFrom, valueTo: draftTo }
                    : needsNoValue(draftOp) ? {}
                    : { value: draftVal }),
            }])
        }
        setDraftCol('')
        setDraftOp('')
        setDraftVal('')
        setDraftCategoryVals([])
        setDraftFrom('')
        setDraftTo('')
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FilterListIcon color="primary" />
                <Box sx={{ flex: 1 }}>
                    Фильтры
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
                        Активных фильтров: {filters.length}
                    </Typography>
                </Box>
                <IconButton size="small" onClick={onClose}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            <DialogContent dividers>
                <Stack spacing={2}>
                    {filters.length > 0 && (
                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>Активные фильтры</Typography>
                            <Paper variant="outlined" sx={{ borderRadius: 1 }}>
                                <List disablePadding dense>
                                    {filters.map((f, idx) => (
                                        <Box key={idx}>
                                            <ListItem sx={{ py: 0.75 }}>
                                                <ListItemText
                                                    primary={
                                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                                                            {formatFilterSummaryLabel({ field: f.column, operator: f.operator, value: f.value, valueFrom: f.valueFrom, valueTo: f.valueTo })}
                                                        </Typography>
                                                    }
                                                />
                                                <ListItemSecondaryAction>
                                                    <IconButton size="small" edge="end" onClick={() => onRemove(idx)} color="error">
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </ListItemSecondaryAction>
                                            </ListItem>
                                            {idx < filters.length - 1 && <Divider />}
                                        </Box>
                                    ))}
                                </List>
                            </Paper>
                            <Button size="small" color="error" onClick={onClear} sx={{ mt: 1 }}>
                                Очистить все фильтры
                            </Button>
                        </Box>
                    )}

                    <Divider />
                    <Typography variant="subtitle2">Добавить фильтр</Typography>

                    <FormControl fullWidth size="small">
                        <InputLabel>Столбец</InputLabel>
                        <Select
                            value={draftCol}
                            label="Столбец"
                            onChange={(e: SelectChangeEvent) => setDraftCol(e.target.value)}
                        >
                            {columns.map((c) => {
                                const ct = pgTypeToColType(c.data_type)
                                return (
                                    <MenuItem key={c.column_name} value={c.column_name}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            {c.column_name}
                                            <Chip
                                                label={ct}
                                                size="small"
                                                sx={{ height: 18, fontSize: '0.65rem' }}
                                                color={ct === 'number' ? 'primary' : ct === 'date' ? 'secondary' : ct === 'datetime' ? 'info' : ct === 'time' ? 'warning' : 'default'}
                                                variant="outlined"
                                            />
                                        </Box>
                                    </MenuItem>
                                )
                            })}
                        </Select>
                    </FormControl>

                    {draftCol && (
                        <FormControl fullWidth size="small">
                            <InputLabel>Оператор</InputLabel>
                            <Select
                                value={draftOp}
                                label="Оператор"
                                onChange={(e: SelectChangeEvent) => setDraftOp(e.target.value)}
                            >
                                {draftOps.map((op) => (
                                    <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}

                    {draftOp && !needsNoValue(draftOp) && (
                        isCategory(draftOp) ? (
                            <FormControl fullWidth size="small">
                                <InputLabel>Значения</InputLabel>
                                <Select
                                    multiple
                                    value={draftCategoryVals}
                                    label="Значения"
                                    open={categorySelectOpen}
                                    onOpen={() => setCategorySelectOpen(true)}
                                    onClose={() => setCategorySelectOpen(false)}
                                    renderValue={(selected) => {
                                        const count = (selected as string[]).length
                                        return count === 0 ? 'Выберите значения' : `${count} выбрано`
                                    }}
                                    onChange={(e: SelectChangeEvent<string[]>) =>
                                        handleCategoryMultiChange(e.target.value as string[])
                                    }
                                    disabled={categoryLoading}
                                >
                                    {categoryLoading ? (
                                        <MenuItem disabled>
                                            <CircularProgress size={16} sx={{ mr: 1 }} />
                                            Загрузка значений...
                                        </MenuItem>
                                    ) : shouldGroupCategories
                                        ? groupedCategoryValues.flatMap((group) => {
                                            const expanded = expandedGroups[group.key] ?? false
                                            const selectedInGroup = group.values.filter((v) => draftCategoryVals.includes(v)).length
                                            return [
                                                <MenuItem
                                                    key={`g-${group.key}`}
                                                    value={`${GROUP_SENTINEL}${group.key}`}
                                                    sx={{ cursor: 'pointer', userSelect: 'none' }}
                                                >
                                                    <Box sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
                                                        <Checkbox
                                                            size="small"
                                                            checked={selectedInGroup > 0 && selectedInGroup === group.values.length}
                                                            indeterminate={selectedInGroup > 0 && selectedInGroup < group.values.length}
                                                            sx={{ p: 0.25, mr: 0.75 }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={() => toggleGroupSelection(group.key)}
                                                        />
                                                        <Typography variant="body2">{group.label} ({group.values.length})</Typography>
                                                        <Box sx={{ ml: 'auto' }}>{expanded ? '▾' : '▸'}</Box>
                                                    </Box>
                                                </MenuItem>,
                                                ...(expanded
                                                    ? group.values.map((v) => (
                                                        <MenuItem key={v} value={v}>
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
                                        ))
                                    }
                                    {!categoryLoading && (
                                        <Box sx={{ px: 1, py: 0.5, display: 'flex', gap: 0.5, position: 'sticky', bottom: 0, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider', zIndex: 1 }}>
                                            <Button
                                                size="small"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDraftCategoryVals(categoryValues) }}
                                            >
                                                Все
                                            </Button>
                                            <Button
                                                size="small"
                                                color="inherit"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDraftCategoryVals([]) }}
                                            >
                                                Очистить
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="contained"
                                                onMouseDown={(e) => e.preventDefault()}
                                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCategorySelectOpen(false) }}
                                            >
                                                ОК
                                            </Button>
                                        </Box>
                                    )}
                                </Select>
                            </FormControl>
                        ) : needsBetween(draftOp) ? (
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <TextField
                                    label="От" type={iType} value={draftFrom}
                                    onChange={(e) => setDraftFrom(e.target.value)}
                                    size="small" fullWidth
                                    InputLabelProps={needsShrink ? { shrink: true } : undefined}
                                    inputProps={iType === 'time' ? { step: 1 } : undefined}
                                />
                                <TextField
                                    label="До" type={iType} value={draftTo}
                                    onChange={(e) => setDraftTo(e.target.value)}
                                    size="small" fullWidth
                                    InputLabelProps={needsShrink ? { shrink: true } : undefined}
                                    inputProps={iType === 'time' ? { step: 1 } : undefined}
                                />
                            </Box>
                        ) : (
                            <TextField
                                label={draftOp === 'ilike' ? 'Шаблон (например: %word%)' : 'Значение'}
                                type={iType} value={draftVal}
                                onChange={(e) => setDraftVal(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                                size="small" fullWidth
                                InputLabelProps={needsShrink ? { shrink: true } : undefined}
                                inputProps={iType === 'time' ? { step: 1 } : undefined}
                                helperText={draftOp === 'ilike' ? '% — любые символы, _ — один символ' : undefined}
                            />
                        )
                    )}

                    {draftCol && draftOp && (
                        <Button
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={handleAdd}
                            disabled={!canAdd()}
                            disableElevation
                            fullWidth
                        >
                            Добавить фильтр
                        </Button>
                    )}
                </Stack>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} variant="contained" disableElevation>Готово</Button>
            </DialogActions>
        </Dialog>
    )
}
