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
import type {
    PilotInstitutionDetails,
    PilotRequirementOverrideHistoryEntry,
} from '@shared/lib/reporting-api'
import { formatDateTime, requirementStatusView } from '../lib/reporting-helpers'

interface RequirementHistoryDialogProps {
    open: boolean
    institutionDetails: PilotInstitutionDetails | null
    requirementHistoryLoading: boolean
    requirementHistoryError: string | null
    requirementHistory: PilotRequirementOverrideHistoryEntry[]
    onClose: () => void
}

export function RequirementHistoryDialog({
    open,
    institutionDetails,
    requirementHistoryLoading,
    requirementHistoryError,
    requirementHistory,
    onClose,
}: RequirementHistoryDialogProps) {
    return (
        <Dialog
            open={open}
            onClose={() => {
                if (!requirementHistoryLoading) onClose()
            }}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle>Журнал ручных уточнений</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    {institutionDetails && (
                        <Box>
                            <Typography variant="subtitle2" fontWeight={800}>
                                {institutionDetails.organization.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                История изменений применимости СЭМД по показателю 6.1.3.2.7
                            </Typography>
                        </Box>
                    )}

                    {requirementHistoryLoading && (
                        <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            sx={{ py: 2 }}
                        >
                            <CircularProgress size={18} />
                            <Typography variant="body2" color="text.secondary">
                                Загружаем журнал...
                            </Typography>
                        </Stack>
                    )}

                    {!requirementHistoryLoading && requirementHistoryError && (
                        <Alert severity="error">{requirementHistoryError}</Alert>
                    )}

                    {!requirementHistoryLoading
                        && !requirementHistoryError
                        && requirementHistory.length === 0 && (
                            <Alert severity="info">
                                Для выбранного МО ручных уточнений пока нет.
                            </Alert>
                        )}

                    {!requirementHistoryLoading
                        && !requirementHistoryError
                        && requirementHistory.length > 0 && (
                            <TableContainer component={Paper} variant="outlined">
                                <Table size="small" sx={{ minWidth: 760 }}>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell sx={{ width: 175 }}>Дата</TableCell>
                                            <TableCell sx={{ width: 260 }}>Вид СЭМД</TableCell>
                                            <TableCell sx={{ width: 145 }}>Действие</TableCell>
                                            <TableCell>Основание</TableCell>
                                            <TableCell sx={{ width: 120 }}>Пользователь</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {requirementHistory.map((entry) => {
                                            const action = entry.requirementStatus
                                                ? requirementStatusView(entry.requirementStatus)
                                                : {
                                                    label: 'Снято уточнение',
                                                    color: 'warning' as const,
                                                }
                                            return (
                                                <TableRow key={entry.id} hover>
                                                    <TableCell sx={{ verticalAlign: 'top' }}>
                                                        <Typography variant="body2">
                                                            {formatDateTime(entry.createdAt)}
                                                        </Typography>
                                                        {entry.isCurrent && (
                                                            <Chip
                                                                size="small"
                                                                color="info"
                                                                variant="outlined"
                                                                label="текущая запись"
                                                                sx={{ mt: 0.5 }}
                                                            />
                                                        )}
                                                    </TableCell>
                                                    <TableCell sx={{ verticalAlign: 'top' }}>
                                                        <Typography variant="body2" fontWeight={700}>
                                                            TYPE={entry.nsiTypeCode}
                                                        </Typography>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {entry.semdTypeName}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell sx={{ verticalAlign: 'top' }}>
                                                        <Chip
                                                            size="small"
                                                            color={action.color}
                                                            variant="outlined"
                                                            label={action.label}
                                                        />
                                                    </TableCell>
                                                    <TableCell sx={{ verticalAlign: 'top' }}>
                                                        <Typography variant="body2">
                                                            {entry.reason}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell sx={{ verticalAlign: 'top' }}>
                                                        <Typography variant="body2">
                                                            {entry.createdBy}
                                                        </Typography>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button
                    disabled={requirementHistoryLoading}
                    onClick={onClose}
                >
                    Закрыть
                </Button>
            </DialogActions>
        </Dialog>
    )
}
