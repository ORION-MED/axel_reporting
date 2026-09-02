import { useEffect, useMemo, useState } from 'react'
import {
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
    Typography,
    Alert,
} from '@mui/material'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useTableStore } from '@entities/table'
import type { OutlierConfig, OutlierMethod, OutlierPreview } from '@shared/lib'
import { projectRows, useNotify } from '@shared/lib'

interface Props {
    onClose: () => void
}

type MethodOpt = {
    value: OutlierMethod | 'none'
    label: string
    hint: string
    group: string
}

const METHODS: MethodOpt[] = [
    { group: '', value: 'none', label: 'Не обрабатывать', hint: 'Пропустить эту колонку' },
    // ----- Статистические -----
    { group: 'Статистические', value: 'iqr', label: 'IQR (межквартильный)', hint: 'Выброс: ниже Q1 − k·IQR или выше Q3 + k·IQR. Хорошо для одногорбых распределений.' },
    { group: 'Статистические', value: 'zscore', label: 'Z-score (3σ)', hint: '|z| = |(x − μ) / σ| > порог. Работает лучше при нормальном распределении.' },
    { group: 'Статистические', value: 'robust_zscore', label: 'Robust Z-score (MAD)', hint: 'Использует median и MAD вместо mean/std. Устойчив к самим выбросам при оценке параметров.' },
    // ----- Перцентили -----
    { group: 'Перцентили', value: 'percentile', label: 'По перцентилям', hint: 'Удаляет строки за границами [pLow%, pHigh%]. Практично для тяжёлых хвостов.' },
]

const GROUPS = [
    { label: '', methods: METHODS.filter((m) => m.group === '') },
    { label: 'Статистические', methods: METHODS.filter((m) => m.group === 'Статистические') },
    { label: 'Перцентили', methods: METHODS.filter((m) => m.group === 'Перцентили') },
]

interface ColEntry {
    method: OutlierMethod | 'none'
    iqrK: number
    zThreshold: number
    pLow: number
    pHigh: number
}

const fmt = (n: number) => {
    if (!isFinite(n)) return '—'
    if (Math.abs(n) >= 1e5 || (Math.abs(n) < 0.001 && n !== 0)) return n.toExponential(2)
    return +n.toFixed(3) + ''
}

export const OutlierDialog = ({ onClose }: Props) => {
    const rows = useTableStore((s) => s.rows)
    const removeOutliers = useTableStore((s) => s.removeOutliers)
    const isLoading = useTableStore((s) => s.isLoading)
    const { showError } = useNotify()
    const activeState = useTableStore((s) => s.getActiveState())
    const editingEntryId = useTableStore((s) => s.editingEntryId)
    const [applyError, setApplyError] = useState<string | null>(null)

    const numericCols = useMemo(
        () => (activeState?.columns ?? []).filter((c) => c.type === 'number'),
        [activeState],
    )

    const sourceOutlierConfig = useMemo(() => {
        const history = activeState?.processingHistory ?? []
        if (!history.length) return null

        if (editingEntryId) {
            const editingEntry = history.find((entry) => entry.id === editingEntryId)
            if (editingEntry?.type === 'outliers') {
                return editingEntry.config as OutlierConfig
            }
        }

        const lastOutlierEntry = [...history].reverse().find((entry) => entry.type === 'outliers')
        return lastOutlierEntry ? (lastOutlierEntry.config as OutlierConfig) : null
    }, [activeState?.processingHistory, editingEntryId])

    const createInitialConfig = useMemo(
        () => () => {
            const defaults: Record<string, ColEntry> = Object.fromEntries(
                numericCols.map((c) => [c.field, { method: 'none' as const, iqrK: 1.5, zThreshold: 3, pLow: 1, pHigh: 99 }]),
            )

            if (!sourceOutlierConfig) return defaults

            for (const col of numericCols) {
                const saved = sourceOutlierConfig[col.field]
                if (!saved) continue
                defaults[col.field] = {
                    method: saved.method,
                    iqrK: saved.iqrK ?? 1.5,
                    zThreshold: saved.zThreshold ?? 3,
                    pLow: saved.pLow ?? 1,
                    pHigh: saved.pHigh ?? 99,
                }
            }

            return defaults
        },
        [numericCols, sourceOutlierConfig],
    )

    const [config, setConfig] = useState<Record<string, ColEntry>>(
        createInitialConfig,
    )

    useEffect(() => {
        setConfig(createInitialConfig())
    }, [createInitialConfig])

    const setField = <K extends keyof ColEntry>(field: string, key: K, val: ColEntry[K]) =>
        setConfig((p) => ({ ...p, [field]: { ...p[field], [key]: val } }))

    const [preview, setPreview] = useState<OutlierPreview[]>([])

    useEffect(() => {
        const cfg: OutlierConfig = {}
        for (const [field, entry] of Object.entries(config)) {
            if (entry.method === 'none') continue
            cfg[field] = {
                method: entry.method,
                iqrK: entry.iqrK,
                zThreshold: entry.zThreshold,
                pLow: entry.pLow,
                pHigh: entry.pHigh,
            }
        }
        if (!Object.keys(cfg).length) { setPreview([]); return }
        const controller = new AbortController()
        let worker: Worker | null = new Worker(
            new URL('../../../shared/lib/dataStatsWorker.ts', import.meta.url),
            { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent) => {
            if (!worker) return
            worker.terminate()
            worker = null
            if (e.data?.ok) setPreview(e.data.result)
        }
        worker.onerror = () => { worker?.terminate(); worker = null; showError('Не удалось вычислить предпросмотр выбросов') }
        projectRows(rows, Object.keys(cfg), controller.signal)
            .then((slimRows) => worker?.postMessage({ type: 'previewOutliers', rows: slimRows, config: cfg }))
            .catch((err) => {
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    worker?.terminate()
                    worker = null
                    showError('Не удалось вычислить предпросмотр выбросов')
                }
            })
        return () => { controller.abort(); worker?.terminate(); worker = null }
    }, [config, rows, showError])

    const totalOutliers = useMemo(
        () => preview.reduce((s, p) => s + p.outlierCount, 0),
        [preview],
    )

    const activeFields = Object.keys(config).filter((f) => config[f].method !== 'none')

    const handleApply = async () => {
        const finalConfig: OutlierConfig = {}
        for (const field of activeFields) {
            const e = config[field]
            finalConfig[field] = {
                method: e.method as OutlierMethod,
                iqrK: e.iqrK,
                zThreshold: e.zThreshold,
                pLow: e.pLow,
                pHigh: e.pHigh,
            }
        }
        if (!Object.keys(finalConfig).length) { onClose(); return }
        try {
            await removeOutliers(finalConfig)
            onClose()
        } catch (e) {
            setApplyError(e instanceof Error ? e.message : String(e))
        }
    }

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
                    width: 620, maxWidth: '95vw', maxHeight: '85vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Заголовок */}
                <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <QueryStatsIcon color="error" />
                    <Box>
                        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                            Удаление выбросов
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Выберите метод для каждой числовой колонки
                        </Typography>
                    </Box>
                    <Box flex={1} />
                    {activeFields.length > 0 && (
                        <Chip
                            label={`~${totalOutliers.toLocaleString()} выбросов в ${activeFields.length} кол.`}
                            color="error"
                            size="small"
                            icon={<WarningAmberIcon />}
                        />
                    )}
                </Box>

                {/* Список колонок */}
                <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2 }}>
                    {numericCols.length === 0 && (
                        <Alert severity="info">Числовых колонок не найдено</Alert>
                    )}
                    <Stack spacing={2}>
                        {numericCols.map((col) => {
                            const entry = config[col.field]
                            const p = preview.find((x) => x.field === col.field)
                            const hint = METHODS.find((m) => m.value === entry.method)?.hint ?? ''
                            const isActive = entry.method !== 'none'

                            return (
                                <Box
                                    key={col.field}
                                    sx={{
                                        border: '1px solid',
                                        borderColor: isActive ? 'error.light' : 'divider',
                                        borderRadius: 1.5,
                                        p: 1.5,
                                        bgcolor: isActive ? 'error.50' : 'transparent',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                        <Typography variant="body2" fontWeight={600} flex={1}>
                                            {col.headerName}
                                        </Typography>
                                        {p && (
                                            <Chip
                                                label={`${p.outlierCount} выброс${p.outlierCount === 1 ? '' : p.outlierCount < 5 ? 'а' : 'ов'} / ${p.totalCount}`}
                                                size="small"
                                                color={p.outlierCount > 0 ? 'error' : 'default'}
                                                variant="outlined"
                                            />
                                        )}
                                        {p && (
                                            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                                                [{fmt(p.bounds.lower)}, {fmt(p.bounds.upper)}]
                                            </Typography>
                                        )}
                                    </Box>

                                    {/* Выбор метода */}
                                    <Select
                                        size="small"
                                        fullWidth
                                        value={entry.method}
                                        onChange={(e) => setField(col.field, 'method', e.target.value as OutlierMethod | 'none')}
                                        sx={{ mb: 1 }}
                                    >
                                        {GROUPS.flatMap((g) => [
                                            ...(g.label ? [<ListSubheader key={g.label}>{g.label}</ListSubheader>] : []),
                                            ...g.methods.map((m) => (
                                                <MenuItem key={m.value} value={m.value}>
                                                    {m.label}
                                                </MenuItem>
                                            )),
                                        ])}
                                    </Select>

                                    {/* Подсказка */}
                                    {entry.method !== 'none' && hint && (
                                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start', mb: 1 }}>
                                            <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled', mt: '2px', flexShrink: 0 }} />
                                            <Typography variant="caption" color="text.secondary">{hint}</Typography>
                                        </Box>
                                    )}

                                    {/* Параметры IQR */}
                                    {entry.method === 'iqr' && (
                                        <TextField
                                            size="small"
                                            label="Множитель k"
                                            type="number"
                                            value={entry.iqrK}
                                            onChange={(e) => setField(col.field, 'iqrK', Math.max(0.1, parseFloat(e.target.value) || 1.5))}
                                            slotProps={{ input: { inputProps: { step: 0.1, min: 0.1 }, startAdornment: <InputAdornment position="start">k =</InputAdornment> } }}
                                            sx={{ width: 150 }}
                                            helperText="Обычно 1.5, строже — 3.0"
                                        />
                                    )}

                                    {/* Параметры Z-score / Robust Z */}
                                    {(entry.method === 'zscore' || entry.method === 'robust_zscore') && (
                                        <TextField
                                            size="small"
                                            label="Порог"
                                            type="number"
                                            value={entry.zThreshold}
                                            onChange={(e) => setField(col.field, 'zThreshold', Math.max(0.5, parseFloat(e.target.value) || 3))}
                                            slotProps={{ input: { inputProps: { step: 0.1, min: 0.5 }, startAdornment: <InputAdornment position="start">|z| &gt;</InputAdornment> } }}
                                            sx={{ width: 170 }}
                                            helperText={entry.method === 'robust_zscore' ? 'Обычно 3.5' : 'Обычно 2.5–3.0'}
                                        />
                                    )}

                                    {/* Параметры Percentile */}
                                    {entry.method === 'percentile' && (
                                        <Box sx={{ display: 'flex', gap: 1.5 }}>
                                            <TextField
                                                size="small"
                                                label="Нижний %"
                                                type="number"
                                                value={entry.pLow}
                                                onChange={(e) => setField(col.field, 'pLow', Math.min(entry.pHigh - 1, Math.max(0, parseFloat(e.target.value) || 1)))}
                                                slotProps={{ input: { inputProps: { step: 0.5, min: 0, max: 49 }, endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
                                                sx={{ width: 130 }}
                                            />
                                            <TextField
                                                size="small"
                                                label="Верхний %"
                                                type="number"
                                                value={entry.pHigh}
                                                onChange={(e) => setField(col.field, 'pHigh', Math.max(entry.pLow + 1, Math.min(100, parseFloat(e.target.value) || 99)))}
                                                slotProps={{ input: { inputProps: { step: 0.5, min: 51, max: 100 }, endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
                                                sx={{ width: 130 }}
                                            />
                                        </Box>
                                    )}
                                </Box>
                            )
                        })}
                    </Stack>
                </Box>

                <Divider />

                {/* Подвал */}
                <Box sx={{ px: 3, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box flex={1}>
                        {activeFields.length > 0 ? (
                            <Typography variant="caption" color="text.secondary">
                                Строки, где хотя бы одна из выбранных колонок содержит выброс, будут <b>удалены</b>.
                            </Typography>
                        ) : (
                            <Typography variant="caption" color="text.disabled">
                                Выберите метод для одной или нескольких колонок
                            </Typography>
                        )}
                    </Box>
                    {applyError && (
                        <Alert severity="error" sx={{ flex: 1 }}>{applyError}</Alert>
                    )}
                    <Button variant="outlined" onClick={onClose} disabled={isLoading}>
                        Отмена
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        disabled={isLoading || activeFields.length === 0}
                        onClick={handleApply}
                    >
                        Удалить выбросы
                    </Button>
                </Box>
            </Paper>
        </Box>
    )
}
