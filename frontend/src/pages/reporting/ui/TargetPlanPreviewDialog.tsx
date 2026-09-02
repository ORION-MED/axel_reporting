import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from '@mui/material'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import type { TargetPlanPreviewResult } from '@shared/lib/reporting-api'
import { formatNumber } from '../lib/reporting-helpers'

interface TargetPlanPreviewDialogProps {
    targetPlanPreview: TargetPlanPreviewResult | null
    importing: boolean
    onCancel: () => void
    onConfirm: () => void
}

export function TargetPlanPreviewDialog({
    targetPlanPreview,
    importing,
    onCancel,
    onConfirm,
}: TargetPlanPreviewDialogProps) {
    return (
        <Dialog
            open={Boolean(targetPlanPreview)}
            onClose={() => {
                if (!importing) onCancel()
            }}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle>Проверка плана целевых значений</DialogTitle>
            <DialogContent dividers>
                {targetPlanPreview && (
                    <Stack spacing={1.5}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={700}>
                                {targetPlanPreview.sourceName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                План на {targetPlanPreview.preview.planYear} год
                                {targetPlanPreview.preview.targetMonth
                                    ? ` · месяц периода: ${targetPlanPreview.preview.targetMonth}`
                                    : ''}
                                {' · '}
                                меняется только целевое значение показателя, числитель и знаменатель не затрагиваются
                            </Typography>
                        </Box>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Строк плана
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(targetPlanPreview.preview.totals.rowCount)}
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Сопоставлено
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(targetPlanPreview.preview.totals.matchedCount)}
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Применимо
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(targetPlanPreview.preview.totals.applicableCount)}
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Изменится
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(targetPlanPreview.preview.totals.changingCount)}
                                </Typography>
                            </Paper>
                        </Stack>

                        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Показатель</TableCell>
                                        <TableCell align="right">Текущее</TableCell>
                                        <TableCell align="right">Новое</TableCell>
                                        <TableCell>Комментарий</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {targetPlanPreview.preview.rows.map((row, index) => (
                                        <TableRow key={`${row.indicatorCode ?? row.itemNumber}-${index}`}>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight={row.applicable ? 600 : 400}>
                                                    {row.indicatorCode ?? row.itemNumber}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {row.name}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                {row.currentTargetValue === null ? '—' : formatNumber(row.currentTargetValue)}
                                            </TableCell>
                                            <TableCell align="right">
                                                {row.newTargetValue === null ? '—' : formatNumber(row.newTargetValue)}
                                            </TableCell>
                                            <TableCell>
                                                <Typography
                                                    variant="caption"
                                                    color={row.applicable ? 'text.secondary' : 'text.disabled'}
                                                >
                                                    {row.note || (row.willChange ? 'Значение будет обновлено' : 'Без изменений')}
                                                </Typography>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>

                        {targetPlanPreview.preview.warnings.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1, maxHeight: 180, overflow: 'auto' }}>
                                <Stack spacing={0.5}>
                                    {targetPlanPreview.preview.warnings.map((warning, index) => (
                                        <Typography
                                            key={`${warning}-${index}`}
                                            variant="body2"
                                            color="warning.main"
                                        >
                                            {warning}
                                        </Typography>
                                    ))}
                                </Stack>
                            </Paper>
                        )}

                        {!targetPlanPreview.preview.canConfirm && (
                            <Alert severity="error">
                                Импорт нельзя применить: ни один показатель плана не сопоставлен с применимым показателем отчетности.
                            </Alert>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={onCancel}
                    disabled={importing}
                >
                    Отмена
                </Button>
                <Button
                    variant="contained"
                    onClick={onConfirm}
                    disabled={
                        importing
                        || !targetPlanPreview?.preview.canConfirm
                    }
                    startIcon={
                        importing
                            ? <CircularProgress size={16} />
                            : <SaveOutlinedIcon />
                    }
                >
                    Применить целевые значения
                </Button>
            </DialogActions>
        </Dialog>
    )
}
