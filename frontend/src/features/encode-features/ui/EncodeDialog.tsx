import { useEffect, useMemo, useRef, useState } from 'react'
import {
    Box,
    Button,
    Chip,
    Divider,
    ListSubheader,
    MenuItem,
    Paper,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
    Alert,
} from '@mui/material'
import LabelIcon from '@mui/icons-material/Label'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTableStore } from '@entities/table'
import type { EncodeConfig, EncodeMethod } from '@shared/lib'
import { projectRows, useNotify } from '@shared/lib'

interface Props {
    onClose: () => void
}

interface MethodOption {
    value: EncodeMethod | 'none'
    label: string
    hint: string
    group: string
    needsTarget?: boolean
}

const METHODS: MethodOption[] = [
    { group: '', value: 'none', label: 'Не кодировать', hint: 'Пропустить эту колонку' },
    // ----- базовые -----
    { group: 'Базовые', value: 'onehot', label: 'One-Hot encoding', hint: 'Бинарная колонка для каждого значения. Взрыв размерности при высокой кардинальности.' },
    { group: 'Базовые', value: 'label', label: 'Label Encoding (авто)', hint: 'Автоматически сортирует уникальные значения и присваивает 0, 1, 2… Без ручной настройки. Для деревьев и GBM; не рекомендуется для линейных моделей (ложный порядок).' },
    { group: 'Базовые', value: 'ordinal', label: 'Ordinal encoding (ручной порядок)', hint: 'Значения заменяются на 0, 1, 2… в заданном порядке. Использовать только если порядок реальный (low<medium<high).' },
    // ----- высокая кардинальность -----
    { group: 'Высокая кардинальность', value: 'frequency', label: 'Frequency encoding', hint: 'Заменяет категорию на относительную частоту (0.0–1.0). Не увеличивает размерность. Хорошо для деревьев.' },
    { group: 'Высокая кардинальность', value: 'count', label: 'Count encoding', hint: 'Заменяет категорию на абсолютное кол-во вхождений. Аналогично frequency, но в штуках.' },
    // ----- target-based -----
    { group: 'Target-based', value: 'target', label: 'Target (Mean) encoding', hint: 'Заменяет категорию на среднее целевой переменной. Осторожно: делать только на train, иначе утечка.', needsTarget: true },
    { group: 'Target-based', value: 'loo', label: 'LOO Target encoding', hint: 'Leave-One-Out: для каждой строки исключается её вклад в среднее. Уменьшает утечку по сравнению с mean encoding.', needsTarget: true },
    { group: 'Target-based', value: 'woe', label: 'WOE encoding', hint: 'Weight of Evidence: log(P(event|cat)/P(non-event|cat)). Только для бинарной цели (0/1). Часто при кредитном скоринге.', needsTarget: true },
]

const groups = [
    { label: '', methods: METHODS.filter((m) => m.group === '') },
    { label: 'Базовые', methods: METHODS.filter((m) => m.group === 'Базовые') },
    { label: 'Высокая кардинальность', methods: METHODS.filter((m) => m.group === 'Высокая кардинальность') },
    { label: 'Target-based', methods: METHODS.filter((m) => m.group === 'Target-based') },
]

type EncodeEntry = { method: EncodeMethod | 'none'; ordinalOrder: string; targetField: string }

export const EncodeDialog = ({ onClose }: Props) => {
    const rows = useTableStore((s) => s.rows)
    const encodeTable = useTableStore((s) => s.encodeTable)
    const isLoading = useTableStore((s) => s.isLoading)
    const { showError } = useNotify()
    const activeState = useTableStore((s) => s.getActiveState())
    const editingEntryId = useTableStore((s) => s.editingEntryId)
    const [applyError, setApplyError] = useState<string | null>(null)

    const categoricalCols = useMemo(
        () => (activeState?.columns ?? []).filter((c) => c.type === 'string'),
        [activeState],
    )

    // Числовые колонки — кандидаты для target
    const numericCols = useMemo(
        () => (activeState?.columns ?? []).filter((c) => c.type === 'number'),
        [activeState],
    )

    const sourceEncodeConfig = useMemo(() => {
        const history = activeState?.processingHistory ?? []
        if (!history.length) return null

        if (editingEntryId) {
            const editingEntry = history.find((entry) => entry.id === editingEntryId)
            if (editingEntry?.type === 'encode') {
                return editingEntry.config as EncodeConfig
            }
        }

        const lastEncodeEntry = [...history].reverse().find((entry) => entry.type === 'encode')
        return lastEncodeEntry ? (lastEncodeEntry.config as EncodeConfig) : null
    }, [activeState?.processingHistory, editingEntryId])

    const createInitialConfig = useMemo(
        () => () => {
            const defaults: Record<string, EncodeEntry> = Object.fromEntries(
                categoricalCols.map((c) => [c.field, { method: 'none' as const, ordinalOrder: '', targetField: '' }]),
            )

            if (!sourceEncodeConfig) return defaults

            for (const col of categoricalCols) {
                const saved = sourceEncodeConfig[col.field]
                if (!saved) continue
                defaults[col.field] = {
                    method: saved.method,
                    ordinalOrder: Array.isArray(saved.ordinalOrder) ? saved.ordinalOrder.join(', ') : '',
                    targetField: typeof saved.targetField === 'string' ? saved.targetField : '',
                }
            }

            return defaults
        },
        [categoricalCols, sourceEncodeConfig],
    )

    const [config, setConfig] = useState<Record<string, EncodeEntry>>(
        createInitialConfig,
    )

    useEffect(() => {
        setConfig(createInitialConfig())
    }, [createInitialConfig])

    const setMethod = (field: string, method: EncodeMethod | 'none') =>
        setConfig((p) => ({ ...p, [field]: { ...p[field], method } }))
    const setOrdinal = (field: string, val: string) =>
        setConfig((p) => ({ ...p, [field]: { ...p[field], ordinalOrder: val } }))
    const setTarget = (field: string, val: string) =>
        setConfig((p) => ({ ...p, [field]: { ...p[field], targetField: val } }))

    const [uniqueCounts, setUniqueCounts] = useState<Record<string, number>>({})
    const [sortedUniqueValues, setSortedUniqueValues] = useState<Record<string, string[]>>({})

    const workerRef = useRef<Worker | null>(null)
    useEffect(() => {
        if (!categoricalCols.length) return
        const controller = new AbortController()
        const worker = new Worker(
            new URL('../../../shared/lib/dataStatsWorker.ts', import.meta.url),
            { type: 'module' },
        )
        workerRef.current = worker
        worker.onmessage = (e: MessageEvent) => {
            worker.terminate()
            workerRef.current = null
            if (e.data?.ok) {
                setUniqueCounts(e.data.result.counts)
                setSortedUniqueValues(e.data.result.sorted)
            }
        }
        worker.onerror = () => {
            worker.terminate()
            workerRef.current = null
            showError('Не удалось загрузить уникальные значения')
        }
        const fields = categoricalCols.map((c) => c.field)
        projectRows(rows, fields, controller.signal)
            .then((slimRows) => worker.postMessage({ type: 'uniqueValues', rows: slimRows, fields }))
            .catch((err) => {
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    worker.terminate()
                    workerRef.current = null
                    showError('Не удалось загрузить уникальные значения')
                }
            })
        return () => {
            controller.abort()
            worker.terminate()
            workerRef.current = null
        }
    }, [categoricalCols, rows, showError])

    const handleApply = () => {
        setApplyError(null)
        const finalConfig: EncodeConfig = {}
        for (const [field, entry] of Object.entries(config)) {
            if (entry.method === 'none') continue
            const ordinalOrder = entry.method === 'ordinal'
                ? entry.ordinalOrder.split(',').map((s) => s.trim()).filter(Boolean)
                : undefined

            // Build mapping for display purposes (value → code)
            let _labelMapping: Record<string, number> | undefined
            if (entry.method === 'label') {
                const sorted = sortedUniqueValues[field] ?? []
                if (sorted.length > 0) {
                    _labelMapping = {}
                    sorted.forEach((v, i) => { _labelMapping![v] = i })
                }
            } else if (entry.method === 'ordinal' && ordinalOrder && ordinalOrder.length > 0) {
                _labelMapping = {}
                ordinalOrder.forEach((v, i) => { _labelMapping![v] = i })
            }

            finalConfig[field] = {
                method: entry.method,
                ...(ordinalOrder ? { ordinalOrder } : {}),
                ...(['target', 'loo', 'woe'].includes(entry.method) && entry.targetField
                    ? { targetField: entry.targetField }
                    : {}),
                ...(_labelMapping ? { _labelMapping } : {}),
            }
        }
        if (!Object.keys(finalConfig).length) { onClose(); return }
        onClose()
        encodeTable(finalConfig).catch((e) => {
            showError(e instanceof Error ? e.message : String(e))
        })
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
                    width: 580, maxWidth: '95vw', maxHeight: '85vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Заголовок */}
                <Box sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <LabelIcon color="secondary" />
                    <Box>
                        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                            Кодирование категориальных признаков
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Преобразование строк в числа для моделей машинного обучения
                        </Typography>
                    </Box>
                </Box>

                {/* Колонки */}
                <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2 }}>
                    {categoricalCols.length === 0 ? (
                        <Box sx={{ textAlign: 'center', py: 5 }}>
                            <Typography variant="body2" color="text.secondary">
                                Текстовых (категориальных) колонок не найдено
                            </Typography>
                        </Box>
                    ) : (
                        <Stack spacing={2}>
                            {categoricalCols.map((col) => {
                                const cur = config[col.field] ?? { method: 'none', ordinalOrder: '', targetField: '' }
                                const uniq = uniqueCounts[col.field] ?? 0
                                const warnOneHot = uniq > 20
                                return (
                                    <Box key={col.field}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Typography variant="body2" fontWeight={600}
                                                    sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {col.headerName}
                                                </Typography>
                                                <Chip label="string" size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Typography variant="caption" color="text.disabled">
                                                    {uniq} уникальных
                                                </Typography>
                                                {warnOneHot && cur.method === 'onehot' && (
                                                    <Tooltip title="Много уникальных значений — One-Hot создаст большое количество новых колонок">
                                                        <Chip label="⚠ много" size="small" color="warning"
                                                            sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }} />
                                                    </Tooltip>
                                                )}
                                            </Box>
                                        </Box>

                                        <Select
                                            size="small" fullWidth
                                            value={cur.method}
                                            onChange={(e) => setMethod(col.field, e.target.value as EncodeMethod | 'none')}
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

                                        {/* Ordinal: ввод порядка */}
                                        {cur.method === 'ordinal' && (
                                            <Box sx={{ mt: 1 }}>
                                                <TextField
                                                    size="small" fullWidth
                                                    label="Порядок значений (через запятую)"
                                                    placeholder="например: low, medium, high"
                                                    value={cur.ordinalOrder}
                                                    onChange={(e) => setOrdinal(col.field, e.target.value)}
                                                    helperText={cur.ordinalOrder ? `Сейчас: ${cur.ordinalOrder.split(',').filter(Boolean).length} значений. Пустое поле — автосортировка.` : 'Пусто — значения будут отсортированы автоматически'}
                                                />
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    sx={{ mt: 0.5, fontSize: '0.75rem' }}
                                                    onClick={() => setOrdinal(col.field, (sortedUniqueValues[col.field] ?? []).join(', '))}
                                                >
                                                    Подставить из данных
                                                </Button>
                                            </Box>
                                        )}

                                        {/* Label encoding preview */}
                                        {cur.method === 'label' && (
                                            <Box sx={{ mt: 1 }}>
                                                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                                    Авто-маппинг (алфавитно-числовая сортировка):
                                                </Typography>
                                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                    {(sortedUniqueValues[col.field] ?? []).slice(0, 12).map((v, i) => (
                                                        <Chip
                                                            key={v}
                                                            size="small"
                                                            label={`${v} → ${i}`}
                                                            variant="outlined"
                                                            sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                                                        />
                                                    ))}
                                                    {(sortedUniqueValues[col.field]?.length ?? 0) > 12 && (
                                                        <Chip size="small" label={`ещё ${(sortedUniqueValues[col.field]?.length ?? 0) - 12}…`} variant="outlined" />
                                                    )}
                                                </Box>
                                            </Box>
                                        )}

                                        {/* Target-based: выбор целевой колонки */}
                                        {['target', 'loo', 'woe'].includes(cur.method) && (
                                            <Box sx={{ mt: 1 }}>
                                                {numericCols.length === 0 ? (
                                                    <Alert severity="warning" sx={{ py: 0.5 }}>
                                                        Нет числовых колонок для целевой переменной
                                                    </Alert>
                                                ) : (
                                                    <Select
                                                        size="small" fullWidth displayEmpty
                                                        value={cur.targetField}
                                                        onChange={(e) => setTarget(col.field, e.target.value)}
                                                        sx={{ fontSize: '0.85rem' }}
                                                    >
                                                        <MenuItem value=""><em>Целевая колонка…</em></MenuItem>
                                                        {numericCols.map((nc) => (
                                                            <MenuItem key={nc.field} value={nc.field}>{nc.headerName}</MenuItem>
                                                        ))}
                                                    </Select>
                                                )}
                                                {cur.method === 'woe' && (
                                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                                        WOE требует бинарную цель (0/1)
                                                    </Typography>
                                                )}
                                            </Box>
                                        )}

                                        {cur.method === 'onehot' && (
                                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                                Будет создано {uniq} новых колонок: {col.field}__value1, {col.field}__value2, …
                                            </Typography>
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
                        disabled={isLoading || categoricalCols.length === 0 || Object.values(config).every((v) => v.method === 'none')}
                    >
                        Применить
                    </Button>
                </Box>
            </Paper>
        </Box>
    )
}
