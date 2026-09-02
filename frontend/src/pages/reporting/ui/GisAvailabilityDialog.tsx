import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Paper,
    Stack,
    TextField,
    Typography,
} from '@mui/material'
import {
    getSemdGisAvailability,
    setSemdGisAvailability,
    type SemdGisAvailability,
} from '@shared/lib/reporting-api'

/**
 * Р3: редактор справочника реализации видов СЭМД в региональной ГИС (владелец — МИАЦ).
 * По каждому из целевых видов МИАЦ выставляет «реализовано / не реализовано / не уточнено».
 * От значения зависит зона причины в расчёте: не реализовано → зона МИАЦ/поставщика ГИС,
 * реализовано → проверка на уровне МО, не уточнено → сначала подтвердить доступность.
 */

type GisChoice = 'yes' | 'no' | 'unknown'

const CHOICES: ReadonlyArray<{ value: GisChoice; label: string }> = [
    { value: 'yes', label: 'Реализовано в ГИС' },
    { value: 'no', label: 'Не реализовано в ГИС' },
    { value: 'unknown', label: 'Не уточнено' },
]

function toChoice(isAvailable: boolean | null): GisChoice {
    if (isAvailable === true) return 'yes'
    if (isAvailable === false) return 'no'
    return 'unknown'
}

function toIsAvailable(choice: GisChoice): boolean | null {
    if (choice === 'yes') return true
    if (choice === 'no') return false
    return null
}

interface GisAvailabilityDialogProps {
    open: boolean
    onClose: () => void
    onChanged: () => void
}

export function GisAvailabilityDialog({
    open,
    onClose,
    onChanged,
}: GisAvailabilityDialogProps) {
    const [rows, setRows] = useState<SemdGisAvailability[]>([])
    const [loading, setLoading] = useState(false)
    const [savingId, setSavingId] = useState<string | null>(null)
    const [error, setError] = useState('')
    const [dirty, setDirty] = useState(false)

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true)
        setError('')
        setDirty(false)
        getSemdGisAvailability()
            .then((data) => {
                if (!cancelled) setRows(data)
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(
                        err?.response?.data?.message
                        ?? 'Не удалось загрузить справочник реализации в ГИС',
                    )
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [open])

    const counts = useMemo(() => ({
        yes: rows.filter((row) => row.isAvailable === true).length,
        no: rows.filter((row) => row.isAvailable === false).length,
        unknown: rows.filter((row) => row.isAvailable === null).length,
    }), [rows])

    const handleChange = useCallback(async (row: SemdGisAvailability, choice: GisChoice) => {
        const nextValue = toIsAvailable(choice)
        if (nextValue === row.isAvailable) return
        setSavingId(row.semdTypeId)
        setError('')
        try {
            const updated = await setSemdGisAvailability(row.semdTypeId, nextValue)
            setRows((prev) => prev.map(
                (item) => item.semdTypeId === updated.semdTypeId ? updated : item,
            ))
            setDirty(true)
        } catch (err) {
            const message = (err as { response?: { data?: { message?: string } } })
                ?.response?.data?.message
            setError(message ?? 'Не удалось сохранить значение')
        } finally {
            setSavingId(null)
        }
    }, [])

    const handleClose = () => {
        if (dirty) onChanged()
        onClose()
    }

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
            <DialogTitle>Реализация видов СЭМД в региональной ГИС</DialogTitle>
            <DialogContent
                dividers
                sx={{ display: 'flex', flexDirection: 'column', minHeight: 460 }}
            >
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Признак технической доступности вида в региональной ГИС (владелец — МИАЦ).
                    Реализовано {counts.yes}, не реализовано {counts.no}, не уточнено{' '}
                    {counts.unknown}. Порядок источников: явное значение по паре МО × вид →
                    этот справочник → факт РЭМД по региону. «Не реализовано» переводит
                    причины по виду из зоны ответственности МО в зону МИАЦ и поставщика ГИС.
                </Typography>

                {error && (
                    <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>
                        {error}
                    </Alert>
                )}

                {loading ? (
                    <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : (
                    <Stack spacing={0.75} sx={{ flex: 1, overflowY: 'auto' }}>
                        {rows.map((row) => (
                            <Paper
                                key={row.semdTypeId}
                                variant="outlined"
                                sx={{
                                    p: 1,
                                    display: 'flex',
                                    gap: 1,
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <Box sx={{ flex: 1, minWidth: 220 }}>
                                    <Typography variant="body2" fontWeight={700}>
                                        {row.officialName5pr ?? row.name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {row.nsiTypeCode ? `Вид МД ${row.nsiTypeCode}` : ''}
                                    </Typography>
                                </Box>
                                <TextField
                                    select
                                    size="small"
                                    value={toChoice(row.isAvailable)}
                                    onChange={(event) => void handleChange(
                                        row,
                                        event.target.value as GisChoice,
                                    )}
                                    disabled={savingId === row.semdTypeId}
                                    sx={{ minWidth: 210 }}
                                >
                                    {CHOICES.map((choice) => (
                                        <MenuItem key={choice.value} value={choice.value}>
                                            {choice.label}
                                        </MenuItem>
                                    ))}
                                </TextField>
                            </Paper>
                        ))}
                        {rows.length === 0 && (
                            <Typography variant="body2" color="text.secondary">
                                Нет видов СЭМД. Сначала загрузите справочник ЭМД/НСИ 1520.
                            </Typography>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose}>Закрыть</Button>
            </DialogActions>
        </Dialog>
    )
}
