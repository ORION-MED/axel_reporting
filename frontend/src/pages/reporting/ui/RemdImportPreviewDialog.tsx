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
import type { RemdWorkbookPreviewResult } from '@shared/lib/reporting-api'
import { formatNumber } from '../lib/reporting-helpers'

interface RemdImportPreviewDialogProps {
    importPreview: RemdWorkbookPreviewResult | null
    importing: boolean
    onCancel: () => void
    onConfirm: () => void
}

export function RemdImportPreviewDialog({
    importPreview,
    importing,
    onCancel,
    onConfirm,
}: RemdImportPreviewDialogProps) {
    return (
        <Dialog
            open={Boolean(importPreview)}
            onClose={() => {
                if (!importing) onCancel()
            }}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle>Проверка файла РЭМД</DialogTitle>
            <DialogContent dividers>
                {importPreview && (
                    <Stack spacing={1.5}>
                        <Box>
                            <Typography variant="subtitle2" fontWeight={700}>
                                {importPreview.sourceName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Режим: {importPreview.importMode === 'merge'
                                    ? 'дополнение / обновление'
                                    : 'полная замена'}
                                {' · '}
                                файл проверен без записи фактов
                            </Typography>
                        </Box>

                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">МО</Typography>
                                <Typography variant="h6">
                                    {formatNumber(importPreview.preview.totals.institutionCount)}
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">Строк подразделений</Typography>
                                <Typography variant="h6">
                                    {formatNumber(importPreview.preview.totals.subdivisionRowCount)}
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">Видов СЭМД</Typography>
                                <Typography variant="h6">
                                    {formatNumber(importPreview.preview.totals.availableSemdTypeCount)}
                                </Typography>
                            </Paper>
                            <Paper variant="outlined" sx={{ p: 1, flex: 1 }}>
                                <Typography variant="caption" color="text.secondary">Документов</Typography>
                                <Typography variant="h6">
                                    {formatNumber(importPreview.preview.totals.regionDocumentCount)}
                                </Typography>
                            </Paper>
                        </Stack>

                        {importPreview.preview.totals.unassignedSubdivisionRowCount > 0 && (
                            <Alert severity="warning">
                                {formatNumber(importPreview.preview.totals.unassignedSubdivisionRowCount)} строк
                                {' · '}
                                {formatNumber(importPreview.preview.totals.unassignedSubdivisionDocumentCount)} документов
                                будут сохранены как «Без привязки к подразделению».
                            </Alert>
                        )}

                        {!importPreview.preview.canConfirm && (
                            <Alert severity="error">
                                Найдены блокирующие ошибки. Подтверждение импорта недоступно.
                            </Alert>
                        )}

                        <Box>
                            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                                Сверка итогов
                            </Typography>
                            <TableContainer component={Paper} variant="outlined">
                                <Table size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Проверка</TableCell>
                                            <TableCell align="right">Ожидалось</TableCell>
                                            <TableCell align="right">Получено</TableCell>
                                            <TableCell sx={{ width: 110 }}>Статус</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {importPreview.preview.checks.map((check) => (
                                            <TableRow key={check.code}>
                                                <TableCell>{check.label}</TableCell>
                                                <TableCell align="right">{formatNumber(check.expected)}</TableCell>
                                                <TableCell align="right">{formatNumber(check.actual)}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        color={check.status === 'passed' ? 'success' : 'error'}
                                                        variant={check.status === 'passed' ? 'filled' : 'outlined'}
                                                        label={check.status === 'passed' ? 'Совпало' : 'Расхождение'}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>

                        {importPreview.preview.issues.length > 0 && (
                            <Box>
                                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                                    Замечания ({importPreview.preview.issues.length})
                                </Typography>
                                <Paper variant="outlined" sx={{ p: 1, maxHeight: 180, overflow: 'auto' }}>
                                    <Stack spacing={0.5}>
                                        {importPreview.preview.issues.map((issue, index) => (
                                            <Typography
                                                key={`${issue.code}-${issue.rowNumber ?? 'all'}-${index}`}
                                                variant="body2"
                                                color={issue.severity === 'error' ? 'error.main' : 'warning.main'}
                                            >
                                                {issue.rowNumber ? `Строка ${issue.rowNumber}: ` : ''}
                                                {issue.message}
                                            </Typography>
                                        ))}
                                    </Stack>
                                </Paper>
                            </Box>
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
                    disabled={importing || !importPreview?.preview.canConfirm}
                    startIcon={importing ? <CircularProgress size={16} /> : <SaveOutlinedIcon />}
                >
                    Сохранить данные
                </Button>
            </DialogActions>
        </Dialog>
    )
}
