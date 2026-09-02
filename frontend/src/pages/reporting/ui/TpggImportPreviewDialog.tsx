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
import type { TpggWorkbookPreviewResult } from '@shared/lib/reporting-api'
import { formatNumber } from '../lib/reporting-helpers'

interface TpggImportPreviewDialogProps {
    tpggImportPreview: TpggWorkbookPreviewResult | null
    importing: boolean
    onCancel: () => void
    onConfirm: () => void
}

export function TpggImportPreviewDialog({
    tpggImportPreview,
    importing,
    onCancel,
    onConfirm,
}: TpggImportPreviewDialogProps) {
    return (
        <Dialog
            open={Boolean(tpggImportPreview)}
            onClose={() => {
                if (!importing) onCancel()
            }}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle>Проверка файла ТПГГ</DialogTitle>
            <DialogContent dividers>
                {tpggImportPreview && (
                    <Stack spacing={1.5}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={700}>
                                {tpggImportPreview.sourceName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                ТПГГ за {tpggImportPreview.preview.reportingYear} год
                                {' · '}
                                файл проверен без изменения правил применимости
                            </Typography>
                        </Box>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Листы
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(tpggImportPreview.preview.totals.parsedSheetCount)}
                                    <Typography component="span" variant="caption" color="text.secondary">
                                        {' '}/ {formatNumber(tpggImportPreview.preview.totals.sheetCount)}
                                    </Typography>
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    МО сопоставлено
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(tpggImportPreview.preview.totals.matchedOrganizationCount)}
                                    <Typography component="span" variant="caption" color="text.secondary">
                                        {' '}/ {formatNumber(tpggImportPreview.preview.totals.directoryOrganizationCount)}
                                    </Typography>
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Виды ЕПГУ / правила
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(tpggImportPreview.preview.totals.epguTypeCount)}
                                    <Typography component="span" variant="caption" color="text.secondary">
                                        {' '}/ {formatNumber(tpggImportPreview.preview.totals.supportedRuleTypeCount)}
                                    </Typography>
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Исходные строки
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(tpggImportPreview.preview.totals.planValueCount)}
                                </Typography>
                            </Paper>
                        </Stack>

                        <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Результат правила</TableCell>
                                        <TableCell align="right">Пар МО × СЭМД</TableCell>
                                        <TableCell>Как используется</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    <TableRow>
                                        <TableCell>Обязательно</TableCell>
                                        <TableCell align="right">
                                            {formatNumber(tpggImportPreview.preview.totals.requiredCount)}
                                        </TableCell>
                                        <TableCell>Участвует в плане МО</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>Не требуется</TableCell>
                                        <TableCell align="right">
                                            {formatNumber(tpggImportPreview.preview.totals.notRequiredCount)}
                                        </TableCell>
                                        <TableCell>Исключается только по однозначному разделу</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell>Не определено</TableCell>
                                        <TableCell align="right">
                                            {formatNumber(tpggImportPreview.preview.totals.unknownCount)}
                                        </TableCell>
                                        <TableCell>Не считается нарушением МО</TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableContainer>

                        {tpggImportPreview.preview.unmatchedOrganizations.length > 0 && (
                            <Alert severity="info">
                                {formatNumber(tpggImportPreview.preview.unmatchedOrganizations.length)} организаций
                                из ТПГГ не входят в рабочий справочник МО. Их строки сохранятся
                                без привязки и не попадут в оценку МО.
                            </Alert>
                        )}

                        {tpggImportPreview.preview.warnings.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1, maxHeight: 180, overflow: 'auto' }}>
                                <Stack spacing={0.5}>
                                    {tpggImportPreview.preview.warnings.map((warning, index) => (
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

                        {!tpggImportPreview.preview.canConfirm && (
                            <Alert severity="error">
                                Импорт нельзя применить. Проверьте наличие справочника ЭМД/НСИ
                                и сопоставление МО.
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
                        || !tpggImportPreview?.preview.canConfirm
                    }
                    startIcon={
                        importing
                            ? <CircularProgress size={16} />
                            : <SaveOutlinedIcon />
                    }
                >
                    Применить правила
                </Button>
            </DialogActions>
        </Dialog>
    )
}
