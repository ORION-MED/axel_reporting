import { useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    MenuItem,
    Paper,
    Select,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTableStore } from '@entities/table'
import {
    WINDOW_DATE_UNITS,
    WINDOW_TIME_UNITS,
} from '@shared/lib'
import type { WindowSplitConfig, WindowSplitUnit } from '@shared/lib'

interface Props {
    onClose: () => void
}

export const WindowSplitDialog = ({ onClose }: Props) => {
    const activeState = useTableStore((s) => s.getActiveState())
    const windowSplitTable = useTableStore((s) => s.windowSplitTable)
    const isLoading = useTableStore((s) => s.isLoading)
    const [applyError, setApplyError] = useState<string | null>(null)

    // Колонки типа date / datetime / time
    const temporalCols = useMemo(
        () =>
            (activeState?.columns ?? []).filter(
                (c) => c.visible && (c.type === 'date' || c.type === 'datetime' || c.type === 'time'),
            ),
        [activeState],
    )

    const [selectedField, setSelectedField] = useState<string>(temporalCols[0]?.field ?? '')
    const [unit, setUnit] = useState<WindowSplitUnit>('yearmonth')

    const selectedCol = (activeState?.columns ?? []).find((c) => c.field === selectedField)
    const isDateType = selectedCol?.type === 'date' || selectedCol?.type === 'datetime'
    const isTimeType = selectedCol?.type === 'time' || selectedCol?.type === 'datetime'

    // Когда меняем колонку — сбрасываем единицу на разумное умолчание
    const handleFieldChange = (field: string) => {
        setSelectedField(field)
        const col = (activeState?.columns ?? []).find((c) => c.field === field)
        if (col?.type === 'time') {
            setUnit('hour')
        } else {
            setUnit('yearmonth')
        }
    }

    const newColName = selectedField ? `${selectedField}_${unit}` : ''
    const alreadyExists = (activeState?.columns ?? []).some((c) => c.field === newColName)

    const handleApply = async () => {
        if (!selectedField || !selectedCol || isLoading) return
        setApplyError(null)
        const config: WindowSplitConfig = {
            field: selectedField,
            fieldType: selectedCol.type as 'date' | 'datetime' | 'time',
            unit,
        }
        try {
            await windowSplitTable(config)
            onClose()
        } catch (e) {
            setApplyError(e instanceof Error ? e.message : String(e))
        }
    }

    return (
        <Box
            sx={{
                position: 'fixed',
                inset: 0,
                bgcolor: 'rgba(0,0,0,0.40)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1300,
            }}
            onClick={onClose}
        >
            <Paper
                sx={{
                    p: 0,
                    borderRadius: 2,
                    width: 520,
                    maxWidth: '95vw',
                    maxHeight: '85vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── Заголовок ── */}
                <Box
                    sx={{
                        px: 2.5,
                        py: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <CalendarMonthIcon color="primary" sx={{ fontSize: 20 }} />
                    <Typography variant="subtitle1" fontWeight={700}>
                        Разбиение на окна
                    </Typography>
                </Box>

                {/* ── Тело ── */}
                <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2 }}>
                    {temporalCols.length === 0 ? (
                        <Alert severity="info">
                            В таблице нет видимых колонок типа <b>date</b>, <b>datetime</b> или <b>time</b>.
                            Убедитесь, что тип колонки определён правильно при загрузке файла.
                        </Alert>
                    ) : (
                        <Stack spacing={2.5}>
                            {/* Выбор колонки */}
                            <Box>
                                <Typography variant="body2" fontWeight={600} gutterBottom>
                                    Колонка с датой / временем
                                </Typography>
                                <Select
                                    fullWidth
                                    size="small"
                                    value={selectedField}
                                    onChange={(e) => handleFieldChange(e.target.value)}
                                >
                                    {temporalCols.map((col) => (
                                        <MenuItem key={col.field} value={col.field}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                {(col.type === 'time') ? (
                                                    <AccessTimeIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                                                ) : (
                                                    <CalendarMonthIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                                                )}
                                                <span>{col.headerName}</span>
                                                <Chip
                                                    label={col.type}
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                                                />
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </Box>

                            {/* Единицы разбиения по дате */}
                            {isDateType && (
                                <Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                                        <CalendarMonthIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                                        <Typography
                                            variant="caption"
                                            fontWeight={700}
                                            color="text.secondary"
                                            sx={{ textTransform: 'uppercase', letterSpacing: 0.8 }}
                                        >
                                            Окна по дате
                                        </Typography>
                                    </Box>
                                    <Stack spacing={0.75}>
                                        {WINDOW_DATE_UNITS.map((opt) => (
                                            <Box
                                                key={opt.value}
                                                onClick={() => setUnit(opt.value)}
                                                sx={{
                                                    p: 1.25,
                                                    borderRadius: 1.5,
                                                    border: '1px solid',
                                                    borderColor: unit === opt.value ? 'primary.main' : 'divider',
                                                    bgcolor: unit === opt.value ? 'primary.50' : 'background.paper',
                                                    cursor: 'pointer',
                                                    transition: 'all .15s',
                                                    '&:hover': { borderColor: 'primary.light' },
                                                }}
                                            >
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <Typography variant="body2" fontWeight={600}>
                                                        {opt.label}
                                                    </Typography>
                                                    <Tooltip title={opt.hint} placement="right">
                                                        <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                                    </Tooltip>
                                                    {unit === opt.value && (
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ ml: 1 }}
                                                        >
                                                            {opt.hint}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Box>
                            )}

                            {/* Разделитель если datetime — показываем обе секции */}
                            {selectedCol?.type === 'datetime' && <Divider />}

                            {/* Единицы разбиения по времени */}
                            {isTimeType && (
                                <Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                                        <AccessTimeIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
                                        <Typography
                                            variant="caption"
                                            fontWeight={700}
                                            color="text.secondary"
                                            sx={{ textTransform: 'uppercase', letterSpacing: 0.8 }}
                                        >
                                            Окна по времени
                                        </Typography>
                                    </Box>
                                    <Stack spacing={0.75}>
                                        {WINDOW_TIME_UNITS.map((opt) => (
                                            <Box
                                                key={opt.value}
                                                onClick={() => setUnit(opt.value)}
                                                sx={{
                                                    p: 1.25,
                                                    borderRadius: 1.5,
                                                    border: '1px solid',
                                                    borderColor: unit === opt.value ? 'primary.main' : 'divider',
                                                    bgcolor: unit === opt.value ? 'primary.50' : 'background.paper',
                                                    cursor: 'pointer',
                                                    transition: 'all .15s',
                                                    '&:hover': { borderColor: 'primary.light' },
                                                }}
                                            >
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <Typography variant="body2" fontWeight={600}>
                                                        {opt.label}
                                                    </Typography>
                                                    <Tooltip title={opt.hint} placement="right">
                                                        <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                                    </Tooltip>
                                                    {unit === opt.value && (
                                                        <Typography
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ ml: 1 }}
                                                        >
                                                            {opt.hint}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Box>
                            )}

                            {/* Превью новой колонки */}
                            {newColName && (
                                <Box
                                    sx={{
                                        p: 1.5,
                                        borderRadius: 1.5,
                                        bgcolor: 'grey.50',
                                        border: '1px solid',
                                        borderColor: 'divider',
                                    }}
                                >
                                    <Typography variant="caption" color="text.secondary">
                                        Будет добавлена новая колонка:
                                    </Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                        <Chip
                                            label={newColName}
                                            size="small"
                                            color={alreadyExists ? 'warning' : 'success'}
                                            variant="outlined"
                                        />
                                        {alreadyExists && (
                                            <Typography variant="caption" color="warning.main">
                                                колонка уже существует — значения будут перезаписаны
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            )}
                        </Stack>
                    )}
                </Box>

                {/* ── Кнопки ── */}
                {applyError && (
                    <Alert severity="error" sx={{ mx: 2.5, mb: 1 }}>{applyError}</Alert>
                )}
                <Box
                    sx={{
                        px: 2.5,
                        py: 1.5,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 1,
                    }}
                >
                    <Button size="small" onClick={onClose}>Отмена</Button>
                    <Button
                        size="small"
                        variant="contained"
                        onClick={handleApply}
                        disabled={isLoading || !selectedField || temporalCols.length === 0}
                    >
                        Применить
                    </Button>
                </Box>
            </Paper>
        </Box>
    )
}
