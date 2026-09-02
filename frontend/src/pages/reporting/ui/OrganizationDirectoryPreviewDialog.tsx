import {
    Alert,
    Box,
    Button,
    Chip,
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
import type { OrganizationDirectoryPreviewResult } from '@shared/lib/reporting-api'
import { formatNumber } from '../lib/reporting-helpers'

/**
 * Предпросмотр справочника признаков МО региона.
 *
 * Главное, что должно быть видно до подтверждения: сколько МО сопоставилось по OID,
 * какие лицензии в файле и какие из них вообще участвуют в расчёте показателя.
 * Последнее важно: методолог прислала лицензию 1090.5, но среди 35 целевых видов СЭМД
 * нет ни одного, который от неё зависит, — она сохранится, но цифры не сдвинет.
 */

interface OrganizationDirectoryPreviewDialogProps {
    directoryImportPreview: OrganizationDirectoryPreviewResult | null
    importing: boolean
    onCancel: () => void
    onConfirm: () => void
}

export function OrganizationDirectoryPreviewDialog({
    directoryImportPreview,
    importing,
    onCancel,
    onConfirm,
}: OrganizationDirectoryPreviewDialogProps) {
    const preview = directoryImportPreview?.preview

    return (
        <Dialog
            open={Boolean(directoryImportPreview)}
            onClose={() => {
                if (!importing) onCancel()
            }}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle>Проверка справочника признаков МО</DialogTitle>
            <DialogContent dividers>
                {directoryImportPreview && preview && (
                    <Stack spacing={1.5}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={700}>
                                {directoryImportPreview.sourceName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                лист «{preview.sheetName}»
                                {' · '}
                                прикреплённое население и лицензии на отдельные виды медпомощи
                            </Typography>
                        </Box>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    МО сопоставлено
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(preview.totals.matchedOrganizationCount)}
                                    <Typography component="span" variant="caption" color="text.secondary">
                                        {' '}/ {formatNumber(preview.totals.directoryOrganizationCount)}
                                    </Typography>
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Прикреплённое население
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(preview.totals.attachedPopulationCount)}
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Прикреплённое детское
                                </Typography>
                                <Typography variant="h6">
                                    {formatNumber(preview.totals.attachedChildPopulationCount)}
                                </Typography>
                            </Paper>
                        </Stack>

                        <TableContainer component={Paper} variant="outlined">
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Лицензия</TableCell>
                                        <TableCell>Вид работ (услуг)</TableCell>
                                        <TableCell align="right">МО</TableCell>
                                        <TableCell align="right">В расчёте</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {preview.licenses.map((license) => (
                                        <TableRow key={license.code}>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight={700}>
                                                    {license.code}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="caption" color="text.secondary">
                                                    {license.title}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">
                                                {formatNumber(license.organizationCount)}
                                            </TableCell>
                                            <TableCell align="right">
                                                <Chip
                                                    size="small"
                                                    label={license.usedByIndicator ? 'да' : 'нет'}
                                                    color={license.usedByIndicator ? 'success' : 'default'}
                                                    variant={license.usedByIndicator ? 'filled' : 'outlined'}
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>

                        {preview.newOrganizations.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Новые МО — их нет в реестре, будут созданы справочником
                                </Typography>
                                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                                    {preview.newOrganizations.map((item) => (
                                        <Typography key={item.oid} variant="body2">
                                            строка {item.rowNumber}: {item.name || item.oid}
                                        </Typography>
                                    ))}
                                </Stack>
                            </Paper>
                        )}

                        {preview.missingFromFile.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    МО реестра, которых нет в файле — признаки останутся пустыми
                                </Typography>
                                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                                    {preview.missingFromFile.map((item) => (
                                        <Typography key={item.oid} variant="body2">
                                            {item.name}
                                        </Typography>
                                    ))}
                                </Stack>
                            </Paper>
                        )}

                        {preview.warnings.length > 0 && (
                            <Paper variant="outlined" sx={{ p: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Предупреждения
                                </Typography>
                                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
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

                        <Alert severity="info">
                            Справочник сам по себе знаменатель не меняет: перечни МО читает импортёр
                            матрицы применимости в момент подтверждения. Чтобы новые признаки попали
                            в расчёт, загрузите матрицу (форма_1) после справочника.
                        </Alert>

                        {!preview.canConfirm && (
                            <Alert severity="error">
                                Справочник нельзя применить: ни один OID из файла не найден в реестре МО.
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
                    Сохранить справочник
                </Button>
            </DialogActions>
        </Dialog>
    )
}
