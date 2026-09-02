import { useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    Divider,
    Drawer,
    FormControl,
    IconButton,
    InputLabel,
    ListItemText,
    MenuItem,
    Select,
    Slider,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import CloseIcon from '@mui/icons-material/Close'
import TimelineIcon from '@mui/icons-material/Timeline'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTableStore } from '@entities/table'
import type { TimeSeriesMethod, TimeSeriesConfig } from '@shared/lib'

// ─── Описание методов ───────────────────────────────────────────────────────

interface MethodOption {
    value: TimeSeriesMethod
    label: string
    description: string
    category: 'fill' | 'smooth'
    hasWindow?: boolean
    hasAlpha?: boolean
}

const METHOD_OPTIONS: MethodOption[] = [
    {
        value: 'ffill',
        label: 'Перенос предыдущего (ffill)',
        description: 'Заполняет каждый пропуск последним известным значением выше',
        category: 'fill',
    },
    {
        value: 'bfill',
        label: 'Перенос следующего (bfill)',
        description: 'Заполняет пропуски первым известным значением ниже',
        category: 'fill',
    },
    {
        value: 'linear',
        label: 'Линейная интерполяция',
        description: 'Заполняет пропуски линейно между двумя соседними известными значениями',
        category: 'fill',
    },
    {
        value: 'rolling_mean_fill',
        label: 'Скол. среднее — заполнение',
        description: 'Заполняет пропуски средним арифметическим в скользящем окне',
        category: 'fill',
        hasWindow: true,
    },
    {
        value: 'polynomial_fill',
        label: 'Квадратичная интерполяция',
        description: 'Заполняет пропуски квадратичным полиномом через ближайшие точки',
        category: 'fill',
    },
    {
        value: 'rolling_mean',
        label: 'Скол. среднее — сглаживание',
        description: 'Заменяет все значения скользящим средним, убирая шум',
        category: 'smooth',
        hasWindow: true,
    },
    {
        value: 'rolling_median',
        label: 'Скол. медиана — сглаживание',
        description: 'Заменяет все значения скользящей медианой (устойчиво к выбросам)',
        category: 'smooth',
        hasWindow: true,
    },
    {
        value: 'ewm',
        label: 'Экспоненц. сглаживание (EWM)',
        description: 'S(t) = α·x(t) + (1−α)·S(t−1). Чем меньше α — тем сильнее сглаживание',
        category: 'smooth',
        hasAlpha: true,
    },
]

const FILL_METHODS = METHOD_OPTIONS.filter((m) => m.category === 'fill')
const SMOOTH_METHODS = METHOD_OPTIONS.filter((m) => m.category === 'smooth')

// ─── Компонент ─────────────────────────────────────────────────────────────

export const TimeSeriesDrawer = () => {
    const [open, setOpen] = useState(false)
    const [method, setMethod] = useState<TimeSeriesMethod>('ffill')
    const [selectedFields, setSelectedFields] = useState<string[]>([])
    const [windowSize, setWindowSize] = useState<number>(3)
    const [alpha, setAlpha] = useState<number>(0.3)
    const [applied, setApplied] = useState(false)

    const activeState = useTableStore((s) => s.getActiveState())
    const timeseriesTable = useTableStore((s) => s.timeseriesTable)
    const isLoading = useTableStore((s) => s.isLoading)

    // Только числовые видимые колонки
    const numericCols = useMemo(
        () => (activeState?.columns ?? []).filter((c) => c.visible && c.type === 'number'),
        [activeState],
    )

    const selectedMethodOpt = METHOD_OPTIONS.find((m) => m.value === method)!

    const handleOpen = () => {
        setApplied(false)
        setOpen(true)
    }

    const handleApply = async () => {
        if (!selectedFields.length || isLoading) return
        const config: TimeSeriesConfig = {
            method,
            fields: selectedFields,
            ...(selectedMethodOpt.hasWindow ? { window: windowSize } : {}),
            ...(selectedMethodOpt.hasAlpha ? { alpha } : {}),
        }
        await timeseriesTable(config)
        setApplied(true)
    }

    const hasData = !!activeState && numericCols.length > 0

    return (
        <>
            {/* Кнопка-гамбургер */}
            <Tooltip title="Временные ряды">
                <IconButton onClick={handleOpen} size="small" color="inherit">
                    <MenuIcon />
                </IconButton>
            </Tooltip>

            {/* Боковой Drawer */}
            <Drawer
                anchor="right"
                open={open}
                onClose={() => setOpen(false)}
                PaperProps={{ sx: { width: 380, display: 'flex', flexDirection: 'column' } }}
            >
                {/* Заголовок */}
                <Box
                    sx={{
                        px: 2,
                        py: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <TimelineIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={700} sx={{ flexGrow: 1 }}>
                        Временные ряды
                    </Typography>
                    <IconButton size="small" onClick={() => setOpen(false)}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>

                {/* Тело Drawer */}
                <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                    {!hasData ? (
                        <Alert severity="info" sx={{ mt: 1 }}>
                            Загрузите датасет с числовыми колонками, чтобы применять методы
                            временных рядов.
                        </Alert>
                    ) : (
                        <Stack spacing={2.5}>
                            {applied && (
                                <Alert severity="success" onClose={() => setApplied(false)}>
                                    Метод успешно применён. Шаг добавлен в историю обработки.
                                </Alert>
                            )}

                            {/* ── Выбор колонок ── */}
                            <Box>
                                <Typography variant="body2" fontWeight={600} gutterBottom>
                                    Числовые колонки
                                </Typography>
                                <FormControl fullWidth size="small">
                                    <InputLabel>Выберите колонки</InputLabel>
                                    <Select
                                        multiple
                                        value={selectedFields}
                                        onChange={(e) =>
                                            setSelectedFields(
                                                typeof e.target.value === 'string'
                                                    ? e.target.value.split(',')
                                                    : e.target.value,
                                            )
                                        }
                                        input={<Box component="div" />}
                                        renderValue={(selected) => (
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                {(selected as string[]).map((v) => (
                                                    <Chip key={v} label={v} size="small" />
                                                ))}
                                            </Box>
                                        )}
                                        label="Выберите колонки"
                                    >
                                        {numericCols.map((col) => (
                                            <MenuItem key={col.field} value={col.field}>
                                                <Checkbox
                                                    checked={selectedFields.includes(col.field)}
                                                    size="small"
                                                />
                                                <ListItemText
                                                    primary={col.headerName}
                                                    secondary={col.field !== col.headerName ? col.field : undefined}
                                                />
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>

                            {/* ── Заполнение пропусков ── */}
                            <Box>
                                <Typography
                                    variant="body2"
                                    fontWeight={600}
                                    color="text.secondary"
                                    gutterBottom
                                    sx={{ textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: 0.8 }}
                                >
                                    Заполнение пропусков
                                </Typography>
                                <Stack spacing={1}>
                                    {FILL_METHODS.map((opt) => (
                                        <Box
                                            key={opt.value}
                                            onClick={() => setMethod(opt.value)}
                                            sx={{
                                                p: 1.5,
                                                borderRadius: 1.5,
                                                border: '1px solid',
                                                borderColor:
                                                    method === opt.value ? 'primary.main' : 'divider',
                                                bgcolor:
                                                    method === opt.value
                                                        ? 'primary.50'
                                                        : 'background.paper',
                                                cursor: 'pointer',
                                                transition: 'all .15s',
                                                '&:hover': { borderColor: 'primary.light' },
                                            }}
                                        >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Typography variant="body2" fontWeight={600}>
                                                    {opt.label}
                                                </Typography>
                                                <Tooltip title={opt.description} placement="right">
                                                    <InfoOutlinedIcon
                                                        sx={{ fontSize: 14, color: 'text.secondary' }}
                                                    />
                                                </Tooltip>
                                            </Box>
                                            {method === opt.value && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ display: 'block', mt: 0.25 }}
                                                >
                                                    {opt.description}
                                                </Typography>
                                            )}
                                        </Box>
                                    ))}
                                </Stack>
                            </Box>

                            <Divider />

                            {/* ── Сглаживание ── */}
                            <Box>
                                <Typography
                                    variant="body2"
                                    fontWeight={600}
                                    color="text.secondary"
                                    gutterBottom
                                    sx={{ textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: 0.8 }}
                                >
                                    Сглаживание
                                </Typography>
                                <Stack spacing={1}>
                                    {SMOOTH_METHODS.map((opt) => (
                                        <Box
                                            key={opt.value}
                                            onClick={() => setMethod(opt.value)}
                                            sx={{
                                                p: 1.5,
                                                borderRadius: 1.5,
                                                border: '1px solid',
                                                borderColor:
                                                    method === opt.value ? 'primary.main' : 'divider',
                                                bgcolor:
                                                    method === opt.value
                                                        ? 'primary.50'
                                                        : 'background.paper',
                                                cursor: 'pointer',
                                                transition: 'all .15s',
                                                '&:hover': { borderColor: 'primary.light' },
                                            }}
                                        >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Typography variant="body2" fontWeight={600}>
                                                    {opt.label}
                                                </Typography>
                                                <Tooltip title={opt.description} placement="right">
                                                    <InfoOutlinedIcon
                                                        sx={{ fontSize: 14, color: 'text.secondary' }}
                                                    />
                                                </Tooltip>
                                            </Box>
                                            {method === opt.value && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ display: 'block', mt: 0.25 }}
                                                >
                                                    {opt.description}
                                                </Typography>
                                            )}
                                        </Box>
                                    ))}
                                </Stack>
                            </Box>

                            {/* ── Параметры ── */}
                            {(selectedMethodOpt.hasWindow || selectedMethodOpt.hasAlpha) && (
                                <>
                                    <Divider />
                                    <Box>
                                        <Typography variant="body2" fontWeight={600} gutterBottom>
                                            Параметры метода
                                        </Typography>

                                        {selectedMethodOpt.hasWindow && (
                                            <Box>
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        mb: 0.5,
                                                    }}
                                                >
                                                    <Typography variant="caption" color="text.secondary">
                                                        Размер окна (window)
                                                    </Typography>
                                                    <Typography variant="caption" fontWeight={600}>
                                                        {windowSize}
                                                    </Typography>
                                                </Box>
                                                <Slider
                                                    value={windowSize}
                                                    min={2}
                                                    max={50}
                                                    step={1}
                                                    onChange={(_, v) => setWindowSize(v as number)}
                                                    size="small"
                                                    marks={[
                                                        { value: 2, label: '2' },
                                                        { value: 10, label: '10' },
                                                        { value: 30, label: '30' },
                                                        { value: 50, label: '50' },
                                                    ]}
                                                />
                                            </Box>
                                        )}

                                        {selectedMethodOpt.hasAlpha && (
                                            <Box>
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        mb: 0.5,
                                                    }}
                                                >
                                                    <Typography variant="caption" color="text.secondary">
                                                        Коэффициент α (alpha)
                                                    </Typography>
                                                    <Typography variant="caption" fontWeight={600}>
                                                        {alpha.toFixed(2)}
                                                    </Typography>
                                                </Box>
                                                <Slider
                                                    value={alpha}
                                                    min={0.01}
                                                    max={1}
                                                    step={0.01}
                                                    onChange={(_, v) => setAlpha(v as number)}
                                                    size="small"
                                                    marks={[
                                                        { value: 0.01, label: '0.01' },
                                                        { value: 0.3, label: '0.3' },
                                                        { value: 0.7, label: '0.7' },
                                                        { value: 1, label: '1' },
                                                    ]}
                                                />
                                                <Typography variant="caption" color="text.secondary">
                                                    Малый α → сильное сглаживание; α=1 → без сглаживания
                                                </Typography>
                                            </Box>
                                        )}
                                    </Box>
                                </>
                            )}
                        </Stack>
                    )}
                </Box>

                {/* Кнопка Apply */}
                {hasData && (
                    <Box
                        sx={{
                            p: 2,
                            borderTop: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        <Button
                            variant="contained"
                            fullWidth
                            onClick={handleApply}
                            disabled={isLoading || selectedFields.length === 0}
                        >
                            Применить
                        </Button>
                        {selectedFields.length === 0 && (
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}
                            >
                                Выберите хотя бы одну колонку
                            </Typography>
                        )}
                    </Box>
                )}
            </Drawer>
        </>
    )
}
