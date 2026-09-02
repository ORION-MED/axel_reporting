import { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    MenuItem,
    Paper,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material'
import FunctionsIcon from '@mui/icons-material/Functions'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { useTableStore } from '@entities/table'
import type { ImputeConfig, ImputeMethod, MissingInfo } from '@shared/lib'
import { projectRows, useNotify } from '@shared/lib'

interface Props {
    onClose: () => void
}

interface MethodOption {
    value: ImputeMethod
    label: string
    hint: string
    numericOnly?: boolean
}

const METHOD_OPTIONS: MethodOption[] = [
    { value: 'mean', label: 'Среднее', hint: 'Заполнить средним арифметическим (только числовые)', numericOnly: true },
    { value: 'median', label: 'Медиана', hint: 'Заполнить медианой (только числовые)', numericOnly: true },
    { value: 'mode', label: 'Мода', hint: 'Наиболее часто встречающееся значение' },
    { value: 'ffill', label: 'Предыдущее (ffill)', hint: 'Скопировать последнее известное значение выше' },
    { value: 'bfill', label: 'Следующее (bfill)', hint: 'Скопировать первое известное значение ниже' },
    { value: 'linear', label: 'Линейная интерп.', hint: 'Линейная интерполяция между соседними значениями (только числовые)', numericOnly: true },
    { value: 'constant', label: 'Константа', hint: 'Заполнить указанным значением' },
    { value: 'drop', label: 'Удалить строки', hint: 'Удалить все строки, где это поле пустое' },
]

export const ImputeDialog = ({ onClose }: Props) => {
    const rows = useTableStore((s) => s.rows)
    const imputeTable = useTableStore((s) => s.imputeTable)
    const isLoading = useTableStore((s) => s.isLoading)
    const { showError } = useNotify()
    const activeState = useTableStore((s) => s.getActiveState())
    const editingEntryId = useTableStore((s) => s.editingEntryId)
    const [applyError, setApplyError] = useState<string | null>(null)

    const sourceImputeConfig = useMemo(() => {
        const history = activeState?.processingHistory ?? []
        if (!history.length) return null

        if (editingEntryId) {
            const editingEntry = history.find((entry) => entry.id === editingEntryId)
            if (editingEntry?.type === 'impute') {
                return editingEntry.config as ImputeConfig
            }
        }

        const lastImputeEntry = [...history].reverse().find((entry) => entry.type === 'impute')
        return lastImputeEntry ? (lastImputeEntry.config as ImputeConfig) : null
    }, [activeState?.processingHistory, editingEntryId])

    // Сводка по пропускам. Для переоткрытия/редактирования также включаем поля из сохраненной конфигурации.
    const [report, setReport] = useState<MissingInfo[]>([])
    const [isLoadingReport, setIsLoadingReport] = useState(true)

    useEffect(() => {
        setIsLoadingReport(true)
        const controller = new AbortController()
        let worker: Worker | null = new Worker(
            new URL('../../../shared/lib/dataStatsWorker.ts', import.meta.url),
            { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent) => {
            if (!worker) return
            worker.terminate()
            worker = null
            if (!e.data?.ok) { setIsLoadingReport(false); return }
            const byField = new Map<string, MissingInfo>()
            const columnsByField = new Map((activeState?.columns ?? []).map((c) => [c.field, c]))
            for (const item of (e.data.result as MissingInfo[]).filter((m: MissingInfo) => m.count > 0)) {
                const col = columnsByField.get(item.field)
                byField.set(item.field, { ...item, isNumeric: col ? col.type === 'number' : item.isNumeric })
            }
            if (sourceImputeConfig) {
                for (const field of Object.keys(sourceImputeConfig)) {
                    if (byField.has(field)) continue
                    const col = columnsByField.get(field)
                    byField.set(field, {
                        field, count: 0, total: rows.length, pct: 0,
                        isNumeric: col ? col.type === 'number' : false,
                    })
                }
            }
            setReport(Array.from(byField.values()))
            setIsLoadingReport(false)
        }
        worker.onerror = () => { worker?.terminate(); worker = null; setIsLoadingReport(false); showError('Не удалось вычислить статистику пропусков') }
        projectRows(rows, (activeState?.columns ?? []).map((c) => c.field), controller.signal)
            .then((slimRows) => worker?.postMessage({ type: 'missingReport', rows: slimRows }))
            .catch((err) => {
                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    worker?.terminate()
                    worker = null
                    setIsLoadingReport(false)
                    showError('Не удалось вычислить статистику пропусков')
                }
            })
        return () => { controller.abort(); worker?.terminate(); worker = null }
    }, [rows, activeState?.columns, sourceImputeConfig, showError])

    const createInitialConfig = useMemo(
        () => () => {
            const defaults: Record<string, { method: ImputeMethod; value: string }> = Object.fromEntries(
                report.map((m) => [m.field, { method: m.isNumeric ? ('mean' as ImputeMethod) : ('mode' as ImputeMethod), value: '' }]),
            )

            if (!sourceImputeConfig) return defaults

            for (const field of Object.keys(defaults)) {
                const saved = sourceImputeConfig[field]
                if (!saved) continue
                defaults[field] = {
                    method: saved.method,
                    value: saved.method === 'constant' && saved.value !== undefined ? String(saved.value) : '',
                }
            }

            return defaults
        },
        [report, sourceImputeConfig],
    )

    // Локальная конфигурация выбора методов
    const [config, setConfig] = useState<Record<string, { method: ImputeMethod; value: string }>>(
        createInitialConfig,
    )

    useEffect(() => {
        setConfig(createInitialConfig())
    }, [createInitialConfig])

    const setMethod = (field: string, method: ImputeMethod) =>
        setConfig((prev) => ({ ...prev, [field]: { ...prev[field], method } }))

    const setValue = (field: string, val: string) =>
        setConfig((prev) => ({ ...prev, [field]: { ...prev[field], value: val } }))

    const handleApply = async () => {
        setApplyError(null)
        const finalConfig: ImputeConfig = {}
        for (const [field, { method, value }] of Object.entries(config)) {
            finalConfig[field] = { method, ...(method === 'constant' ? { value } : {}) }
        }
        try {
            await imputeTable(finalConfig)
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
                    width: 560,
                    maxWidth: '95vw',
                    maxHeight: '85vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Заголовок */}
                <Box
                    sx={{
                        px: 3,
                        py: 2,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    <FunctionsIcon color="primary" />
                    <Box>
                        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
                            Заполнение пустых значений
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Выберите стратегию для каждой колонки с пропусками
                        </Typography>
                    </Box>
                </Box>

                {/* Список колонок */}
                <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2 }}>
                    {isLoadingReport ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                            <CircularProgress size={32} />
                        </Box>
                    ) : report.length === 0 ? (
                        <Box sx={{ textAlign: 'center', py: 5 }}>
                            <Typography variant="body2" color="text.secondary">
                                Пустых значений не найдено 🎉
                            </Typography>
                        </Box>
                    ) : (
                        <Stack spacing={2}>
                            {report.map((info) => {
                                const cur = config[info.field] ?? { method: 'mode', value: '' }
                                return (
                                    <Box key={info.field}>
                                        <Box
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                mb: 0.75,
                                            }}
                                        >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Typography
                                                    variant="body2"
                                                    fontWeight={600}
                                                    sx={{
                                                        maxWidth: 220,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {info.field}
                                                </Typography>
                                                <Chip
                                                    label={info.isNumeric ? 'числовой' : 'текст'}
                                                    size="small"
                                                    color={info.isNumeric ? 'info' : 'default'}
                                                    sx={{ height: 18, fontSize: '0.6rem' }}
                                                />
                                            </Box>
                                            <Typography variant="caption" color="error.main">
                                                {info.count} пустых ({info.pct.toFixed(1)}%)
                                            </Typography>
                                        </Box>

                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                                            <Select
                                                size="small"
                                                value={cur.method}
                                                onChange={(e) =>
                                                    setMethod(info.field, e.target.value as ImputeMethod)
                                                }
                                                sx={{ flex: 1, fontSize: '0.85rem' }}
                                            >
                                                {METHOD_OPTIONS.filter(
                                                    (o) => !o.numericOnly || info.isNumeric,
                                                ).map((opt) => (
                                                    <MenuItem key={opt.value} value={opt.value}>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <span>{opt.label}</span>
                                                            <Tooltip title={opt.hint} placement="right">
                                                                <InfoOutlinedIcon
                                                                    sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }}
                                                                />
                                                            </Tooltip>
                                                        </Box>
                                                    </MenuItem>
                                                ))}
                                            </Select>

                                            {cur.method === 'constant' && (
                                                <TextField
                                                    size="small"
                                                    placeholder="Значение"
                                                    value={cur.value}
                                                    onChange={(e) => setValue(info.field, e.target.value)}
                                                    sx={{ width: 160 }}
                                                />
                                            )}
                                        </Box>
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
                <Box
                    sx={{
                        px: 3,
                        py: 2,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 1,
                    }}
                >
                    <Button size="small" onClick={onClose} disabled={isLoading}>
                        Отмена
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        onClick={handleApply}
                        disabled={isLoading || report.length === 0}
                    >
                        Применить
                    </Button>
                </Box>
            </Paper>
        </Box>
    )
}
