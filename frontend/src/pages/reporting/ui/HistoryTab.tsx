import {
    Box,
    Chip,
    CircularProgress,
    Divider,
    IconButton,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import RefreshIcon from '@mui/icons-material/Refresh'
import type { ReportingImportRun } from '@shared/lib/reporting-api'
import { formatDateTime, formatFileSize, importStatusView } from '../lib/reporting-helpers'

interface HistoryTabProps {
    historyLoading: boolean
    imports: ReportingImportRun[]
    selectedPeriodId: string
    importing: boolean
    downloadingImportId: string | null
    onRefresh: () => void
    onOpenPreview: (importRun: ReportingImportRun) => void
    onDownload: (importRun: ReportingImportRun) => void
}

export function HistoryTab({
    historyLoading,
    imports,
    selectedPeriodId,
    importing,
    downloadingImportId,
    onRefresh,
    onOpenPreview,
    onDownload,
}: HistoryTabProps) {
    return (
        <Paper
            variant="outlined"
            sx={{
                borderRadius: 1,
                overflow: 'hidden',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <Box
                sx={{
                    p: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                }}
            >
                <Box>
                    <Typography variant="subtitle1" fontWeight={700}>
                        Журнал импортов
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Каждый импорт хранит исходный файл и контрольную сумму.
                    </Typography>
                </Box>
                <Tooltip title="Обновить историю">
                    <span>
                        <IconButton
                            size="small"
                            onClick={onRefresh}
                            disabled={!selectedPeriodId || historyLoading}
                        >
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>
            <Divider />
            {historyLoading ? (
                <Box sx={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={28} />
                </Box>
            ) : imports.length === 0 ? (
                <Box sx={{ p: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                        Для выбранного периода импортов пока нет.
                    </Typography>
                </Box>
            ) : (
                <TableContainer sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    <Table size="small" sx={{ minWidth: 980 }}>
                        <TableHead>
                            <TableRow>
                                <TableCell>Дата и файл</TableCell>
                                <TableCell sx={{ width: 130 }}>Статус</TableCell>
                                <TableCell align="right" sx={{ width: 130 }}>Показатели</TableCell>
                                <TableCell align="right" sx={{ width: 130 }}>Строки МО</TableCell>
                                <TableCell sx={{ width: 180 }}>Контрольная сумма</TableCell>
                                <TableCell align="right" sx={{ width: 80 }} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {imports.map((importRun) => {
                                const status = importStatusView(importRun.status)
                                return (
                                    <TableRow key={importRun.id} hover>
                                        <TableCell>
                                            <Typography variant="body2" fontWeight={600}>
                                                {importRun.originalFilename}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                {formatDateTime(importRun.createdAt)} · {formatFileSize(importRun.fileSize)}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                {importRun.sourceType === 'emd_nsi_csv'
                                                    ? 'Справочник ЭМД/НСИ'
                                                    : importRun.sourceType === 'tpgg_workbook'
                                                        ? 'ТПГГ / применимость СЭМД к МО'
                                                        : importRun.sourceType === 'applicability_matrix'
                                                            ? 'Матрица применимости СЭМД'
                                                        : importRun.sourceType === 'organization_directory'
                                                            ? 'Справочник признаков МО'
                                                        : importRun.importMode === 'merge'
                                                            ? 'Дополнение / обновление'
                                                            : 'Полная замена'}
                                            </Typography>
                                            {importRun.errorMessage && (
                                                <Typography variant="caption" color="error" display="block">
                                                    {importRun.errorMessage}
                                                </Typography>
                                            )}
                                            {importRun.warnings.length > 0 && (
                                                <Typography variant="caption" color="warning.main" display="block">
                                                    Предупреждений: {importRun.warnings.length}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                size="small"
                                                color={status.color}
                                                variant={status.color === 'success' ? 'filled' : 'outlined'}
                                                label={status.label}
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            {importRun.indicatorValuesCount}
                                        </TableCell>
                                        <TableCell align="right">
                                            {importRun.organizationValuesCount}
                                        </TableCell>
                                        <TableCell>
                                            <Typography
                                                variant="caption"
                                                fontFamily="monospace"
                                                title={importRun.fileSha256}
                                            >
                                                {importRun.fileSha256.slice(0, 16)}…
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                            {importRun.status === 'previewed' ? (
                                                <Tooltip title="Открыть предпросмотр">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => onOpenPreview(importRun)}
                                                            disabled={importing}
                                                        >
                                                            <ChevronRightIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            ) : (
                                                <Tooltip title="Скачать исходный файл">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => onDownload(importRun)}
                                                            disabled={
                                                                importRun.status !== 'completed'
                                                                || downloadingImportId === importRun.id
                                                            }
                                                        >
                                                            {downloadingImportId === importRun.id
                                                                ? <CircularProgress size={18} />
                                                                : <DownloadOutlinedIcon fontSize="small" />}
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Paper>
    )
}
