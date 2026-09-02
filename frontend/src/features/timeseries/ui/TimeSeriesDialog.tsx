import { useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Chip,
    Divider,
    FormControl,
    InputLabel,
    ListItemText,
    MenuItem,
    Paper,
    Select,
    Slider,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material'
import TimelineIcon from '@mui/icons-material/Timeline'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTableStore } from '@entities/table'
import type { TimeSeriesMethod, TimeSeriesConfig } from '@shared/lib'

//  Типы секций

export type TsSection = 'preprocess' | 'fill'

//  Описание методов

interface MethodOption {
    value: TimeSeriesMethod
    label: string
    description: string
    hasWindow?: boolean
    hasAlpha?: boolean
    hasLambda?: boolean
    hasOrder?: boolean
    hasPeriod?: boolean
    hasLag?: boolean
}

interface MethodGroup {
    label: string
    methods: MethodOption[]
}

const PREPROCESS_GROUPS: MethodGroup[] = [
    {
        label: 'Сглаживание ряда',
        methods: [
            { value: 'rolling_mean', label: 'Скользящее среднее', description: 'Заменяет каждое значение средним в скользящем окне. Устраняет высокочастотный шум.', hasWindow: true },
            { value: 'rolling_median', label: 'Медианный фильтр', description: 'Заменяет каждое значение медианой в окне. Устойчив к единичным выбросам.', hasWindow: true },
            { value: 'ewm', label: 'EWM сглаживание', description: 'S(t) = αx(t) + (1−α)S(t−1). Больший вес — свежим наблюдениям.', hasAlpha: true },
        ],
    },
    {
        label: 'Нормализация и стандартизация',
        methods: [
            { value: 'normalize', label: 'Нормализация (min-max)', description: 'x̂ = (x − min) / (max − min). Масштабирует значения в диапазон [0, 1].' },
            { value: 'standardize', label: 'Стандартизация (z-score)', description: 'x̂ = (x − μ) / σ. Центрирует ряд с нулевым средним и единичной дисперсией.' },
        ],
    },
    {
        label: 'Логарифмирование и степенные преобразования',
        methods: [
            { value: 'log_transform', label: 'Логарифмирование ln(x)', description: 'Стабилизирует дисперсию, уменьшает влияние правого хвоста. Требует x > 0.' },
            { value: 'boxcox', label: 'Преобразование Бокса–Кокса', description: 'y = (xλ − 1)/λ; при λ=0 → ln(x). Универсальный способ нормализовать ряд.', hasLambda: true },
        ],
    },
    {
        label: 'Дифференцирование',
        methods: [
            { value: 'diff', label: 'Дифференцирование', description: 'y[t] − y[t−k]. Порядок 1 устраняет тренд; порядок k — сезонность периода k.', hasOrder: true },
            { value: 'seasonal_diff', label: 'Сезонное дифференцирование', description: 'y[t] − y[t − T]. Удаляет сезонную составляющую периода T.', hasPeriod: true },
        ],
    },
    {
        label: 'Лаговые признаки',
        methods: [
            { value: 'lag_feature', label: 'Создание лага (lag k)', description: 'Добавляет новую колонку {поле}_lagK со значением ряда, сдвинутым на k шагов назад.', hasLag: true },
        ],
    },
]

const FILL_METHODS: MethodOption[] = [
    { value: 'ffill', label: 'Предыдущее значение (ffill)', description: 'Переносит последнее известное значение вперёд.' },
    { value: 'bfill', label: 'Следующее значение (bfill)', description: 'Переносит ближайшее следующее известное значение назад.' },
    { value: 'linear', label: 'Линейная интерполяция', description: 'Заполняет пропуски линейно между двумя соседними известными значениями.' },
    { value: 'polynomial_fill', label: 'Полиномиальная интерполяция', description: 'Квадратичный полином через 3 ближайшие известные точки.' },
    { value: 'spline_fill', label: 'Сплайн-интерполяция', description: 'Кубический сплайн Catmull-Rom — гладкая кривая через известные точки.' },
    { value: 'mean_fill', label: 'Заполнение средним', description: 'Заполняет пропуски средним арифметическим всей колонки.' },
    { value: 'median_fill', label: 'Заполнение медианой', description: 'Заполняет пропуски медианой — устойчиво к выбросам.' },
    { value: 'rolling_mean_fill', label: 'Скользящее среднее (только пропуски)', description: 'Заполняет пропуски средним в скользящем окне соседних значений.', hasWindow: true },
]

const SECTION_TITLE: Record<TsSection, string> = {
    preprocess: 'Предобработка временного ряда',
    fill: 'Заполнение пропусков',
}
//  Карточка метода

function MethodCard({ opt, selected, onClick }: { opt: MethodOption; selected: boolean; onClick: () => void }) {
    return (
        <Box
            onClick={onClick}
            sx={{
                p: 1.25, borderRadius: 1.5, border: '1px solid',
                borderColor: selected ? 'primary.main' : 'divider',
                bgcolor: selected ? 'primary.50' : 'background.paper',
                cursor: 'pointer', transition: 'all .15s',
                '&:hover': { borderColor: 'primary.light' },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="body2" fontWeight={600}>{opt.label}</Typography>
                <Tooltip title={opt.description} placement="right">
                    <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
                </Tooltip>
            </Box>
            {selected && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    {opt.description}
                </Typography>
            )}
        </Box>
    )
}

//  Параметры выбранного метода

function MethodParams({ opt, windowSize, setWindowSize, alpha, setAlpha, lambda, setLambda, diffOrder, setDiffOrder }: {
    opt: MethodOption
    windowSize: number; setWindowSize: (v: number) => void
    alpha: number; setAlpha: (v: number) => void
    lambda: number; setLambda: (v: number) => void
    diffOrder: number; setDiffOrder: (v: number) => void
}) {
    if (!opt.hasWindow && !opt.hasAlpha && !opt.hasLambda && !opt.hasOrder && !opt.hasPeriod && !opt.hasLag) return null
    return (
        <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="body2" fontWeight={600} gutterBottom>Параметры метода</Typography>
            <Stack spacing={1.5}>
                {opt.hasWindow && (
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Размер окна</Typography>
                            <Typography variant="caption" fontWeight={700}>{windowSize}</Typography>
                        </Box>
                        <Slider value={windowSize} min={2} max={50} step={1}
                            onChange={(_, v) => setWindowSize(v as number)} size="small"
                            marks={[{ value: 2, label: '2' }, { value: 10, label: '10' }, { value: 30, label: '30' }, { value: 50, label: '50' }]}
                        />
                    </Box>
                )}
                {opt.hasAlpha && (
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Коэффициент α</Typography>
                            <Typography variant="caption" fontWeight={700}>{alpha.toFixed(2)}</Typography>
                        </Box>
                        <Slider value={alpha} min={0.01} max={1} step={0.01}
                            onChange={(_, v) => setAlpha(v as number)} size="small"
                            marks={[{ value: 0.01, label: '0.01' }, { value: 0.3, label: '0.3' }, { value: 0.7, label: '0.7' }, { value: 1, label: '1' }]}
                        />
                        <Typography variant="caption" color="text.secondary">
                            Малый α → сильнее сглаживание; α=1 → без сглаживания
                        </Typography>
                    </Box>
                )}
                {opt.hasLambda && (
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Параметр λ</Typography>
                            <Typography variant="caption" fontWeight={700}>{Math.abs(lambda) < 1e-6 ? '0 (ln)' : lambda.toFixed(2)}</Typography>
                        </Box>
                        <Slider value={lambda} min={-2} max={2} step={0.05}
                            onChange={(_, v) => setLambda(v as number)} size="small"
                            marks={[{ value: -2, label: '−2' }, { value: 0, label: '0 (ln)' }, { value: 0.5, label: '0.5' }, { value: 1, label: '1 (id)' }, { value: 2, label: '2' }]}
                        />
                        <Typography variant="caption" color="text.secondary">
                            λ=0 → ln(x); λ=0.5 → √x; λ=1 → тождественное
                        </Typography>
                    </Box>
                )}
                {opt.hasOrder && (
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Порядок дифференцирования (k)</Typography>
                            <Typography variant="caption" fontWeight={700}>{diffOrder}</Typography>
                        </Box>
                        <Slider value={diffOrder} min={1} max={52} step={1}
                            onChange={(_, v) => setDiffOrder(v as number)} size="small"
                            marks={[{ value: 1, label: '1' }, { value: 7, label: '7' }, { value: 12, label: '12' }, { value: 52, label: '52' }]}
                        />
                        <Typography variant="caption" color="text.secondary">
                            k=1 → устранение тренда; k=период → устранение сезонности
                        </Typography>
                    </Box>
                )}
                {opt.hasPeriod && (
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Период сезонности (T)</Typography>
                            <Typography variant="caption" fontWeight={700}>{diffOrder}</Typography>
                        </Box>
                        <Slider value={diffOrder} min={2} max={52} step={1}
                            onChange={(_, v) => setDiffOrder(v as number)} size="small"
                            marks={[{ value: 2, label: '2' }, { value: 7, label: '7д' }, { value: 12, label: '12м' }, { value: 52, label: '52н' }]}
                        />
                        <Typography variant="caption" color="text.secondary">
                            T=7 → недельная; T=12 → месячная; T=52 → годовая (поднедельная)
                        </Typography>
                    </Box>
                )}
                {opt.hasLag && (
                    <Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">Лаг (k шагов назад)</Typography>
                            <Typography variant="caption" fontWeight={700}>{diffOrder}</Typography>
                        </Box>
                        <Slider value={diffOrder} min={1} max={52} step={1}
                            onChange={(_, v) => setDiffOrder(v as number)} size="small"
                            marks={[{ value: 1, label: '1' }, { value: 7, label: '7' }, { value: 14, label: '14' }, { value: 52, label: '52' }]}
                        />
                        <Typography variant="caption" color="text.secondary">
                            Добавит колонку {'{поле}_lagK'} со значениями, сдвинутыми на k шагов
                        </Typography>
                    </Box>
                )}
            </Stack>
        </>
    )
}

//  Компонент

interface Props {
    onClose: () => void
    defaultSection?: TsSection
}

export const TimeSeriesDialog = ({ onClose, defaultSection = 'fill' }: Props) => {
    const allPreprocessMethods = PREPROCESS_GROUPS.flatMap((g) => g.methods)

    const [method, setMethod] = useState<TimeSeriesMethod>(
        defaultSection === 'preprocess' ? allPreprocessMethods[0].value : FILL_METHODS[0].value,
    )
    const [selectedFields, setSelectedFields] = useState<string[]>([])
    const [windowSize, setWindowSize] = useState<number>(3)
    const [alpha, setAlpha] = useState<number>(0.3)
    const [lambda, setLambda] = useState<number>(0.5)
    const [diffOrder, setDiffOrder] = useState<number>(1)

    const activeState = useTableStore((s) => s.getActiveState())
    const timeseriesTable = useTableStore((s) => s.timeseriesTable)
    const isLoading = useTableStore((s) => s.isLoading)
    const [applyError, setApplyError] = useState<string | null>(null)

    // Колонки типа date/datetime/time — для обоих разделов
    const tsCols = useMemo(
        () => (activeState?.columns ?? []).filter(
            (c) => c.visible && (c.type === 'date' || c.type === 'datetime' || c.type === 'time'),
        ),
        [activeState],
    )
    const activeCols = tsCols

    const sectionMethods = defaultSection === 'preprocess' ? allPreprocessMethods : FILL_METHODS
    const selectedMethodOpt = sectionMethods.find((m) => m.value === method) ?? sectionMethods[0]

    const handleApply = async () => {
        if (!selectedFields.length || isLoading) return
        setApplyError(null)
        const config: TimeSeriesConfig = {
            method,
            fields: selectedFields,
            ...(selectedMethodOpt.hasWindow ? { window: windowSize } : {}),
            ...(selectedMethodOpt.hasAlpha ? { alpha } : {}),
            ...(selectedMethodOpt.hasLambda ? { lambda } : {}),
            ...(selectedMethodOpt.hasOrder || selectedMethodOpt.hasPeriod || selectedMethodOpt.hasLag ? { window: diffOrder } : {}),
        }
        try {
            await timeseriesTable(config)
            onClose()
        } catch (e) {
            setApplyError(e instanceof Error ? e.message : String(e))
        }
    }

    return (
        <Box
            sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.40)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300 }}
            onClick={onClose}
        >
            <Paper
                sx={{ p: 0, borderRadius: 2, width: 580, maxWidth: '95vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/*  Заголовок  */}
                <Box sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <TimelineIcon color="primary" sx={{ fontSize: 20 }} />
                    <Typography variant="subtitle1" fontWeight={700}>{SECTION_TITLE[defaultSection]}</Typography>
                </Box>

                {/*  Тело  */}
                <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2 }}>
                    {activeCols.length === 0 ? (
                        <Alert severity="info">В таблице нет видимых временных колонок (date / datetime / time) для обработки.</Alert>
                    ) : (
                        <Stack spacing={2}>
                            {/* Выбор колонок */}
                            <Box>
                                <Typography variant="body2" fontWeight={600} gutterBottom>
                                    Временные колонки (date / datetime / time)
                                </Typography>
                                <FormControl fullWidth size="small">
                                    <InputLabel>Выберите колонки</InputLabel>
                                    <Select
                                        multiple value={selectedFields}
                                        onChange={(e) => setSelectedFields(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                                        renderValue={(selected) => (
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                {(selected as string[]).map((v) => <Chip key={v} label={v} size="small" />)}
                                            </Box>
                                        )}
                                        label="Выберите колонки"
                                    >
                                        {activeCols.map((col) => (
                                            <MenuItem key={col.field} value={col.field}>
                                                <Checkbox checked={selectedFields.includes(col.field)} size="small" />
                                                <ListItemText
                                                    primary={col.headerName}
                                                    secondary={`${col.type}${col.field !== col.headerName ? ` · ${col.field}` : ''}`}
                                                />
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>

                            {/* Методы — для предобработки: группы */}
                            {defaultSection === 'preprocess' ? (
                                <Stack spacing={1.5}>
                                    {PREPROCESS_GROUPS.map((group) => (
                                        <Box key={group.label}>
                                            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                {group.label}
                                            </Typography>
                                            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                                                {group.methods.map((opt) => (
                                                    <MethodCard key={opt.value} opt={opt} selected={method === opt.value} onClick={() => setMethod(opt.value)} />
                                                ))}
                                            </Stack>
                                        </Box>
                                    ))}
                                </Stack>
                            ) : (
                                <Stack spacing={0.75}>
                                    {FILL_METHODS.map((opt) => (
                                        <MethodCard key={opt.value} opt={opt} selected={method === opt.value} onClick={() => setMethod(opt.value)} />
                                    ))}
                                </Stack>
                            )}

                            <MethodParams opt={selectedMethodOpt} windowSize={windowSize} setWindowSize={setWindowSize} alpha={alpha} setAlpha={setAlpha} lambda={lambda} setLambda={setLambda} diffOrder={diffOrder} setDiffOrder={setDiffOrder} />
                        </Stack>
                    )}
                </Box>

                {/*  Кнопки  */}
                {applyError && (
                    <Alert severity="error" sx={{ mx: 2.5, mb: 1 }}>{applyError}</Alert>
                )}
                <Box sx={{ px: 2.5, py: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                    <Button size="small" onClick={onClose}>Отмена</Button>
                    <Button size="small" variant="contained" onClick={handleApply} disabled={isLoading || selectedFields.length === 0}>
                        Применить
                    </Button>
                </Box>
            </Paper>
        </Box>
    )
}
