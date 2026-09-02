import {
    Alert,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Paper,
    Stack,
    Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import type { ReportingPeriodDeletionPreview } from '@shared/lib/reporting-api'
import { formatNumber } from '../lib/reporting-helpers'

/**
 * Подтверждение удаления отчётного периода.
 *
 * Операция необратима: в системе нет ни корзины, ни down-миграций, а все внешние
 * ключи на период стоят с ON DELETE CASCADE. Поэтому диалог не спрашивает «вы уверены?»,
 * а показывает поимённо, сколько строк исчезнет по каждой таблице — решение принимается
 * по цифрам, а не по общей формулировке.
 *
 * Отдельно вынесены ручные уточнения применимости: это единственное в списке, что
 * вводит человек и что больше нигде не хранится. Остальное восстанавливается
 * повторной загрузкой девяти файлов.
 */

interface DeletePeriodDialogProps {
    preview: ReportingPeriodDeletionPreview | null
    deleting: boolean
    onCancel: () => void
    onConfirm: () => void
}

const ROWS: Array<{
    key: keyof ReportingPeriodDeletionPreview['counts']
    label: string
}> = [
    { key: 'remdFacts', label: 'Факты регистрации в РЭМД (числитель)' },
    { key: 'remdSubdivisionFacts', label: 'Факты по подразделениям' },
    { key: 'tpggPlanValues', label: 'Плановые объёмы ТПГГ' },
    { key: 'indicatorValues', label: 'Значения показателей' },
    { key: 'organizationValues', label: 'Значения по медорганизациям' },
    { key: 'diagnosticFindings', label: 'Находки в своде причин' },
    { key: 'qualityIssues', label: 'Замечания к качеству данных' },
    { key: 'importRuns', label: 'Записи журнала загрузок (и файлы в хранилище)' },
]

export function DeletePeriodDialog({
    preview,
    deleting,
    onCancel,
    onConfirm,
}: DeletePeriodDialogProps) {
    const overrides = preview?.counts.requirementOverrides ?? 0

    return (
        <Dialog
            open={Boolean(preview)}
            onClose={() => {
                if (!deleting) onCancel()
            }}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle>Удалить отчётный период?</DialogTitle>
            <DialogContent dividers>
                {preview && (
                    <Stack spacing={1.5}>
                        <Typography variant="subtitle2" fontWeight={700}>
                            {preview.period.name}
                            <Typography component="span" variant="caption" color="text.secondary">
                                {' · '}{preview.period.code}
                            </Typography>
                        </Typography>

                        <Paper variant="outlined" sx={{ p: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                                Будет удалено безвозвратно
                            </Typography>
                            <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                                {ROWS.map((row) => (
                                    <Stack
                                        key={row.key}
                                        direction="row"
                                        justifyContent="space-between"
                                        spacing={1}
                                    >
                                        <Typography variant="body2" color="text.secondary">
                                            {row.label}
                                        </Typography>
                                        <Typography variant="body2" fontWeight={600}>
                                            {formatNumber(preview.counts[row.key])}
                                        </Typography>
                                    </Stack>
                                ))}
                            </Stack>
                        </Paper>

                        {overrides > 0 && (
                            <Alert severity="warning">
                                Среди удаляемого — <b>{formatNumber(overrides)}</b> ручных уточнений
                                применимости. Это единственные данные, введённые вручную:
                                повторной загрузкой файлов они не восстановятся.
                            </Alert>
                        )}

                        <Alert severity="info">
                            Обязательность пар «МО × вид СЭМД», справочники видов, организации
                            и признаки МО не пострадают — они не привязаны к периоду.
                            Остальное восстанавливается повторной загрузкой девяти файлов.
                        </Alert>

                        {preview.isLastPeriod && (
                            <Alert severity="warning">
                                Это последний период. После удаления в сервисе не останется
                                ни одного, и разделы отчётности будут пустыми, пока не создадите новый.
                            </Alert>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} disabled={deleting}>
                    Отмена
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={onConfirm}
                    disabled={deleting}
                    startIcon={deleting ? <CircularProgress size={16} /> : <DeleteOutlineIcon />}
                >
                    Удалить период
                </Button>
            </DialogActions>
        </Dialog>
    )
}
