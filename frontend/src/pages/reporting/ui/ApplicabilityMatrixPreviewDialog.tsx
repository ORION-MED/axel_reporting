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
import type { ApplicabilityMatrixPreviewResult } from '@shared/lib/reporting-api'
import { formatNumber } from '../lib/reporting-helpers'

interface ApplicabilityMatrixPreviewDialogProps {
    previewResult: ApplicabilityMatrixPreviewResult | null
    importing: boolean
    onCancel: () => void
    onConfirm: () => void
}

function SummaryCard({
    label,
    value,
    detail,
}: {
    label: string
    value: string
    detail?: string
}) {
    return (
        <Paper variant="outlined" sx={{ p: 1.25, flex: 1, minWidth: 150 }}>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Typography variant="h6" lineHeight={1.25}>
                {value}
            </Typography>
            {detail && (
                <Typography variant="caption" color="text.secondary">
                    {detail}
                </Typography>
            )}
        </Paper>
    )
}

export function ApplicabilityMatrixPreviewDialog({
    previewResult,
    importing,
    onCancel,
    onConfirm,
}: ApplicabilityMatrixPreviewDialogProps) {
    const preview = previewResult?.preview
    const blockingErrors = preview?.blockingErrors ?? []

    return (
        <Dialog
            open={Boolean(previewResult)}
            onClose={() => {
                if (!importing) onCancel()
            }}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle>Проверка матрицы применимости СЭМД</DialogTitle>
            <DialogContent dividers>
                {previewResult && preview && (
                    <Stack spacing={1.5}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={700}>
                                {previewResult.sourceName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Файл проверен без изменения расчета. После подтверждения правила
                                будут применены к выбранному отчетному периоду.
                            </Typography>
                        </Box>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <SummaryCard
                                label="Виды СЭМД"
                                value={`${formatNumber(preview.totals.matchedSemdTypeCount)} / ${formatNumber(preview.totals.epguTypeCount)}`}
                                detail="сопоставлено с перечнем ЕПГУ"
                            />
                            <SummaryCard
                                label="Правила"
                                value={formatNumber(preview.totals.normalizedRuleCount)}
                                detail={`из ${formatNumber(preview.totals.sourceRuleCount)} строк файла`}
                            />
                            <SummaryCard
                                label="МО с полным расчетом"
                                value={`${formatNumber(preview.totals.finalOrganizationCount)} / ${formatNumber(preview.totals.directoryOrganizationCount)}`}
                                detail="без неопределенных видов"
                            />
                            <SummaryCard
                                label="Пары МО × СЭМД"
                                value={formatNumber(preview.totals.requirementCount)}
                                detail={`не определено: ${formatNumber(preview.totals.unknownCount)}`}
                            />
                        </Stack>

                        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                            <Table size="small" stickyHeader>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Код и вид СЭМД</TableCell>
                                        <TableCell align="right">Правил</TableCell>
                                        <TableCell align="right">Обязательно</TableCell>
                                        <TableCell align="right">Не требуется</TableCell>
                                        <TableCell align="right">Не определено</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {preview.typeSummaries.map((item) => (
                                        <TableRow key={item.semdTypeCode} hover>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight={600}>
                                                    {item.semdTypeCode} · {item.documentName}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">{formatNumber(item.ruleCount)}</TableCell>
                                            <TableCell align="right">
                                                {formatNumber(item.requiredOrganizationCount)}
                                            </TableCell>
                                            <TableCell align="right">
                                                {formatNumber(item.notRequiredOrganizationCount)}
                                            </TableCell>
                                            <TableCell align="right">
                                                {formatNumber(item.unknownOrganizationCount)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>

                        {(preview.ignoredRedundantRows.length > 0 || preview.overriddenRows.length > 0) && (
                            <Alert severity="info">
                                Нормализация файла: исключено повторяющихся правил —
                                {' '}{formatNumber(preview.totals.ignoredRedundantRuleCount)}, изменено решений по
                                согласованным условиям — {formatNumber(preview.totals.overriddenRuleCount)}.
                            </Alert>
                        )}

                        {preview.directoryOverrides.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1, maxHeight: 260, overflow: 'auto' }}>
                                <Typography variant="caption" color="text.secondary">
                                    Справочник признаков МО
                                </Typography>
                                <Typography variant="body2" sx={{ mb: 0.75 }}>
                                    Перечни МО по этим правилам взяты из справочника, а не из колонки
                                    «Комментарий методолога». Комментарий сохраняется для аудита.
                                </Typography>
                                <Stack spacing={0.75}>
                                    {preview.directoryOverrides.map((item) => (
                                        <Box key={`${item.semdTypeCode}-${item.sourceRowNumber}`}>
                                            <Typography variant="body2" fontWeight={600}>
                                                {item.semdTypeCode} · {item.documentName}
                                            </Typography>
                                            {item.addedOrganizations.length > 0 && (
                                                <Typography variant="body2" color="success.main">
                                                    + добавил справочник ({item.addedOrganizations.length}):
                                                    {' '}{item.addedOrganizations.join(', ')}
                                                </Typography>
                                            )}
                                            {item.removedOrganizations.length > 0 && (
                                                <Typography variant="body2" color="warning.main">
                                                    − снял справочник ({item.removedOrganizations.length}):
                                                    {' '}{item.removedOrganizations.join(', ')}
                                                </Typography>
                                            )}
                                        </Box>
                                    ))}
                                </Stack>
                            </Paper>
                        )}

                        {preview.warnings.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1, maxHeight: 160, overflow: 'auto' }}>
                                <Stack spacing={0.5}>
                                    {preview.warnings.map((warning, index) => (
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

                        {!preview.canConfirm && (
                            <Alert severity="error">
                                <Typography variant="body2" fontWeight={600}>
                                    Матрицу нельзя применить
                                </Typography>
                                {blockingErrors.length > 0 ? (
                                    <Stack component="ul" spacing={0.25} sx={{ my: 0.5, pl: 2.5 }}>
                                        {blockingErrors.map((error) => (
                                            <Typography component="li" variant="body2" key={error}>
                                                {error}
                                            </Typography>
                                        ))}
                                    </Stack>
                                ) : (
                                    <Typography variant="body2">
                                        Проверьте сообщения предпросмотра и повторите загрузку.
                                    </Typography>
                                )}
                            </Alert>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel} disabled={importing}>
                    Отмена
                </Button>
                <Button
                    variant="contained"
                    onClick={onConfirm}
                    disabled={importing || !preview?.canConfirm}
                    startIcon={importing ? <CircularProgress size={16} /> : <SaveOutlinedIcon />}
                >
                    Применить матрицу
                </Button>
            </DialogActions>
        </Dialog>
    )
}
