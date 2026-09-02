import { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    InputAdornment,
    ListSubheader,
    MenuItem,
    Paper,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material'
import ScaleIcon from '@mui/icons-material/Scale'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTableStore } from '@entities/table'
import type { ScaleConfig, ScaleMethod, ColumnStats } from '@shared/lib'
import { projectRows, useNotify } from '@shared/lib'

interface Props {
    onClose: () => void
}

interface MethodOption {
    value: ScaleMethod | 'none'
    label: string
    hint: string
    group: string
}

const METHODS: MethodOption[] = [
    { group: '', value: 'none', label: 'Не масштабировать', hint: 'Пропустить эту колонку' },
    // ----- z-score -----
    { group: 'z-score', value: 'standard', label: 'Standard (z-score)', hint: '(x − μ) / σ  →  среднее 0, std 1. Лучший выбор для SVM, линейных моделей, нейросетей.' },
    { group: 'z-score', value: 'center_only', label: 'Только центрирование', hint: 'x − μ. Сдвигает среднее в 0 без деления на std. Полезно перед PCA.' },
    { group: 'z-score', value: 'unit_variance', label: 'Только std=1', hint: 'x / σ. Нормирует дисперсию без смещения. Используется редко при важности нуля.' },
    // ----- range -----
    { group: 'Диапазон', value: 'minmax', label: 'Min-Max [0, 1]', hint: '(x − min)/(max − min). Для kNN, CNN. Чувствителен к выбросам.' },
    { group: 'Диапазон', value: 'minmax_sym', label: 'Min-Max [−1, 1]', hint: '2·(x − min)/(max − min) − 1. Симметричный диапазон, часто в tanh-сетях.' },
    { group: 'Диапазон', value: 'maxabs', label: 'MaxAbs [−1, 1]', hint: 'x / max(|x|). Сохраняет спарсность (нули остаются нулями). Для разреженных матриц.' },
    // ----- outlier-robust -----
    { group: 'Устойчивые', value: 'robust', label: 'Robust IQR', hint: '(x − median) / IQR. Хорошо работает при выбросах.' },
    { group: 'Устойчивые', value: 'percentile', label: 'Перцентильный [0,1]', hint: 'Приводит заданный диапазон перцентилей к [0, 1] с обрезкой хвостов.' },
]

type ScaleEntry = { method: ScaleMethod | 'none'; pLow: number; pHigh: number }

export const ScaleDialog = ({ onClose }: Props) => {
    const rows = useTableStore((s) => s.rows)
    const scaleTable = useTableStore((s) => s.scaleTable)
    const isLoading = useTableStore((s) => s.isLoading)
    const { showError } = useNotify()
    const [applyError, setApplyError] = useState<string | null>(null)
    const activeState = useTableStore((s) => s.getActiveState())
    const editingEntryId = useTableStore((s) => s.editingEntryId)

    const numericCols = useMemo(
        () => (activeState?.columns ?? []).filter((c) => c.type === 'number'),
        [activeState],
    )

    const sourceScaleConfig = useMemo(() => {
        const history = activeState?.processingHistory ?? []
        if (!history.length) return null

        if (editingEntryId) {
            const editingEntry = history.find((entry) => entry.id === editingEntryId)
            if (editingEntry?.type === 'scale') {
                return editingEntry.config as ScaleConfig
            }
        }

        const lastScaleEntry = [...history].reverse().find((entry) => entry.type === 'scale')
        return lastScaleEntry ? (lastScaleEntry.config as ScaleConfig) : null
    }, [activeState?.processingHistory, editingEntryId])

    const createInitialConfig = useMemo(
        () => () => {
            const defaults: Record<string, ScaleEntry> = Object.fromEntries(
                numericCols.map((c) => [c.field, { method: 'none' as const, pLow: 5, pHigh: 95 }]),
            )

            if (!sourceScaleConfig) return defaults

            for (const col of numericCols) {
                const saved = sourceScaleConfig[col.field]
                if (!saved) continue
                defaults[col.field] = {
                    method: saved.method,
                    pLow: saved.pLow ?? 5,
                    pHigh: saved.pHigh ?? 95,
                }
            }

            return defaults
        },
        [numericCols, sourceScaleConfig],
    )

    const [config, setConfig] = useState<Record<string, ScaleEntry>>(
        createInitialConfig,
    )

    useEffect(() => {
        setConfig(createInitialConfig())
    }, [createInitialConfig])

    const [allStats, setAllStats] = useState<Record<string, ColumnStats | null>>({})

    useEffect(() => {
        if (!numericCols.length) return
        const controller = new AbortController()
        let worker: Worker | null = new Worker(
            new URL('../../../shared/lib/dataStatsWorker.ts', import.meta.url),
            { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent) => {
            if (!worker) return
            worker.terminate()
            worker = null
            if (e.data?.ok) setAllStats(e.data.result)
        }
        worker.onerror = () => { worker?.terminate(); worker = null; showError('Не удалось вычислить статистику колонок') }
        const fields = numericCols.map((c) => c.field)
        projectRows(rows, fields, controller.signal)
            .then((slimRows) => worker?.postMessage({ type: 'columnStats', rows: slimRows, fields }))
            .catch((err) => {
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    worker?.terminate()
                    worker = null
                    showError('Не удалось вычислить статистику колонок')
                }
            })
        return () => { controller.abort(); worker?.terminate(); worker = null }
    }, [rows, numericCols, showError])

    const setMethod = (field: string, method: ScaleMethod | 'none') =>
        setConfig((p) => ({ ...p, [field]: { ...p[field], method } }))
    const setPct = (field: string, key: 'pLow' | 'pHigh', val: number) =>
        setConfig((p) => ({ ...p, [field]: { ...p[field], [key]: val } }))

    const handleApply = async () => {
        setApplyError(null)
        const finalConfig: ScaleConfig = {}
        for (const [field, entry] of Object.entries(config)) {
            if (entry.method !== 'none') {
                finalConfig[field] = {
                    method: entry.method,
                    ...(entry.method === 'percentile' ? { pLow: entry.pLow, pHigh: entry.pHigh } : {}),
                }
            }
        }
        if (!Object.keys(finalConfig).length) { onClose(); return }
        try {
            await scaleTable(finalConfig)
            onClose()
        } catch (e) {
            setApplyError(e instanceof Error ? e.message : String(e))
        }
    }

    // Группируем методы по group
    const groups = [
        { label: '', methods: METHODS.filter((m) => m.group === '') },
        { label: 'z-score', methods: METHODS.filter((m) => m.group === 'z-score') },
        { label: 'Диапазон', methods: METHODS.filter((m) => m.group === 'Диапазон') },
        { label: 'Устойчивые', methods: METHODS.filter((m) => m.group === 'Устойчивые') },
    ]

    return (
        <Box
            sx={{
                position: 'fixed', inset: 0,
                bgcolor: 'rgba(0,0,0,0.40)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1300,
            }}
            onClick={onClose}
        >
            <Paper
                sx={{
                    p: 0, borderRadius: 2,
                    width: 580, maxWidth: '95vw', maxHeight: '85vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Заголовок */}
                <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <ScaleIcon color="primary" />
                    <Box>
                        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                            Масштабирование числовых признаков
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Выберите метод для каждой числовой колонки
                        </Typography>
                    </Box>
                </Box>

                {/* Колонки */}
                <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2 }}>
                    {numericCols.length === 0 ? (
                        <Box sx={{ textAlign: 'center', py: 5 }}>
                            <Typography variant="body2" color="text.secondary">
                                Числовых колонок не найдено
                            </Typography>
                        </Box>
                    ) : (
                        <Stack spacing={2}>
                            {numericCols.map((col) => {
                                const stats = allStats[col.field]
                                const cur = config[col.field] ?? { method: 'none', pLow: 5, pHigh: 95 }
                                return (
                                    <Box key={col.field}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Typography variant="body2" fontWeight={600}
                                                    sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {col.headerName}
                                                </Typography>
                                                <Chip label="number" size="small" color="primary" sx={{ height: 18, fontSize: '0.6rem' }} />
                                            </Box>
                                            {stats && (
                                                <Typography variant="caption" color="text.disabled">
                                                    min {stats.min} · max {stats.max} · μ {stats.mean} · σ {stats.std}
                                                </Typography>
                                            )}
                                        </Box>

                                        <Select
                                            size="small"
                                            fullWidth
                                            value={cur.method}
                                            onChange={(e) => setMethod(col.field, e.target.value as ScaleMethod | 'none')}
                                            sx={{ fontSize: '0.85rem' }}
                                        >
                                            {groups.map(({ label, methods }) => [
                                                label && <ListSubheader key={`h-${label}`} sx={{ fontSize: '0.75rem', lineHeight: '2' }}>{label}</ListSubheader>,
                                                ...methods.map((opt) => (
                                                    <MenuItem key={opt.value} value={opt.value}>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <span>{opt.label}</span>
                                                            <Tooltip title={opt.hint} placement="right">
                                                                <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
                                                            </Tooltip>
                                                        </Box>
                                                    </MenuItem>
                                                )),
                                            ])}
                                        </Select>

                                        {cur.method === 'percentile' && (
                                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                <TextField
                                                    size="small" label="Нижний %" type="number"
                                                    value={cur.pLow}
                                                    onChange={(e) => setPct(col.field, 'pLow', Number(e.target.value))}
                                                    InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                                                    inputProps={{ min: 0, max: 49, step: 1 }}
                                                    sx={{ width: 120 }}
                                                />
                                                <TextField
                                                    size="small" label="Верхний %" type="number"
                                                    value={cur.pHigh}
                                                    onChange={(e) => setPct(col.field, 'pHigh', Number(e.target.value))}
                                                    InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
                                                    inputProps={{ min: 51, max: 100, step: 1 }}
                                                    sx={{ width: 120 }}
                                                />
                                            </Box>
                                        )}
                                        <Divider sx={{ mt: 1.5 }} />
                                    </Box>
                                )
                            })}
                        </Stack>
                    )}
                </Box>

                {/* Нижняя панель */}
                {applyError && (
                    <Alert severity="error" sx={{ mx: 3, mb: 1 }}>{applyError}</Alert>
                )}
                <Box sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                    <Button size="small" onClick={onClose} disabled={isLoading}>Отмена</Button>
                    <Button
                        size="small" variant="contained" onClick={handleApply}
                        disabled={isLoading || numericCols.length === 0 || Object.values(config).every((v) => v.method === 'none')}
                    >
                        Применить
                    </Button>
                </Box>
            </Paper>
        </Box>
    )
}
