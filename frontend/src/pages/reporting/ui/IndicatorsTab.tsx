import {
    Box,
    Chip,
    CircularProgress,
    Divider,
    IconButton,
    Paper,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tooltip,
    Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import type {
    ReportingIndicator,
    ReportingIndicatorValue,
    ReportingPeriod,
    ReportingSummary,
} from '@shared/lib/reporting-api'
import {
    businessStatusView,
    detailNumber,
    formatNumber,
    pilotCoverageLabel,
    formatPercent,
    getDenominatorSource,
    getVisibleIndicatorNotes,
    indicatorNumberView,
    statusView,
} from '../lib/reporting-helpers'

interface IndicatorRow {
    indicator: ReportingIndicator
    value: ReportingIndicatorValue | null
}

interface IndicatorsTabProps {
    loading: boolean
    summary: ReportingSummary
    selectedPeriod: ReportingPeriod | null
    rows: IndicatorRow[]
    onOpenDashboard: (indicatorId: string) => void
    onEdit: (indicator: ReportingIndicator) => void
}

export function IndicatorsTab({
    loading,
    summary,
    selectedPeriod,
    rows,
    onOpenDashboard,
    onEdit,
}: IndicatorsTabProps) {
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
            {loading ? (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={28} />
                </Box>
            ) : summary.periods.length === 0 ? (
                <Box sx={{ p: 3 }}>
                    <Typography variant="body2" color="text.secondary">
                        Нет отчетных периодов.
                    </Typography>
                </Box>
            ) : (
                <>
                <Box
                    sx={{
                        px: 1,
                        py: 0.65,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        flexWrap: 'wrap',
                        bgcolor: 'action.hover',
                        flexShrink: 0,
                    }}
                >
                    <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label="Региональный итог"
                    />
                    <Typography variant="caption" color="text.secondary">
                        Курганская область
                        {summary.organizationCount > 0 && ` · ${summary.organizationCount} МО`}
                        {selectedPeriod && ` · ${selectedPeriod.name}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: 'auto' } }}>
                        Нажмите на показатель, чтобы открыть его дашборд
                    </Typography>
                </Box>
                <Divider />
                <TableContainer sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    <Table size="small" sx={{ minWidth: 900 }}>
                        <TableHead>
                            <TableRow>
                                {/* Рекомендации 22.08.2026: нумерация показателей —
                                    по «Приложению 2». Прежний код 6.1.3.2.x остался
                                    подписью под номером, см. indicatorNumberView. */}
                                <TableCell sx={{ width: 110 }}>№ Прил. 2</TableCell>
                                <TableCell>Показатель</TableCell>
                                <TableCell sx={{ width: 220 }}>Статус</TableCell>
                                {/* Рекомендации 27.07, п.3.2: привычный порядок — сначала План, затем Факт. */}
                                <TableCell align="right" sx={{ width: 130 }}>План</TableCell>
                                <TableCell align="right" sx={{ width: 130 }}>Факт</TableCell>
                                <TableCell align="right" sx={{ width: 80 }} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map(({ indicator, value }) => {
                                const view = statusView(indicator, value)
                                const businessView = businessStatusView(value?.businessStatus ?? 'not_assessed')
                                const numeratorReady = value?.numerator !== null
                                    && typeof value?.numerator !== 'undefined'
                                const denominatorReady = value?.denominator !== null
                                    && typeof value?.denominator !== 'undefined'
                                const denominatorSource = getDenominatorSource(indicator)
                                const numberView = indicatorNumberView(indicator)
                                const indicatorNotes = getVisibleIndicatorNotes(indicator)
                                const pilotRawActiveTypeCount = detailNumber(
                                    value?.calculationDetails,
                                    'rawActiveTypeCount',
                                )
                                const pilotUnknownTypeCount = detailNumber(
                                    value?.calculationDetails,
                                    'epguUnknownTypeCount',
                                )
                                const pilotReferenceReady =
                                    indicator.isPilot
                                    && pilotUnknownTypeCount === 0
                                    && denominatorReady
                                // Рекомендации 27.07, п.3.1: в подсказках к меткам выводим
                                // количество видов, доступных на ЕПГУ (метки сами по себе
                                // выглядели незавершёнными).
                                const epguAvailableText = denominatorReady
                                    ? `${formatNumber(value?.denominator)} видов`
                                    : 'ожидается справочник'
                                const epguRegisteredText =
                                    value?.factValue === null
                                    || typeof value?.factValue === 'undefined'
                                        ? '—'
                                        : formatNumber(value.factValue)
                                // Рекомендация методолога от 03.08.2026: в метке показывать
                                // 35 видов, доступных на ЕПГУ, а не общее число видов в РЭМД.
                                // Общее число (74) относится к другому показателю и здесь
                                // «конфликтует по смыслу».
                                const remdChipTitle = pilotRawActiveTypeCount === null
                                    ? 'Выгрузка РЭМД за период ещё не загружена'
                                    : `Доступных на ЕПГУ: ${epguAvailableText};`
                                        + ` из них зарегистрировано в РЭМД: ${epguRegisteredText}.`
                                const referenceChipTitle = pilotReferenceReady
                                    ? `Справочник ЭМД/НСИ загружен. Доступных на ЕПГУ: ${epguAvailableText}.`
                                    : `${indicator.denominatorLabel}`
                                        + (pilotUnknownTypeCount !== null && pilotUnknownTypeCount > 0
                                            ? ` Не определена доступность на ЕПГУ у ${formatNumber(pilotUnknownTypeCount)} видов.`
                                            : '')
                                return (
                                    <TableRow
                                        key={indicator.id}
                                        hover
                                        tabIndex={0}
                                        aria-label={`Открыть дашборд показателя ${indicator.code}`}
                                        onClick={() => onOpenDashboard(indicator.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                onOpenDashboard(indicator.id)
                                            }
                                        }}
                                        sx={{ cursor: 'pointer' }}
                                    >
                                        <TableCell>
                                            <Typography variant="body2" fontWeight={700}>
                                                {numberView.number}
                                            </Typography>
                                            {numberView.codeNote && (
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ display: 'block', lineHeight: 1.3 }}
                                                >
                                                    {numberView.codeNote}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" fontWeight={600}>
                                                {indicator.title}
                                            </Typography>
                                            {indicator.formulaText && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {indicator.formulaText}
                                                </Typography>
                                            )}
                                            <Stack
                                                direction="row"
                                                spacing={0.5}
                                                flexWrap="wrap"
                                                useFlexGap
                                                sx={{ mt: 0.5 }}
                                            >
                                                {indicator.isPilot ? (
                                                    <>
                                                        <Tooltip title={remdChipTitle}>
                                                            <Chip
                                                                size="small"
                                                                color={pilotRawActiveTypeCount !== null ? 'success' : 'warning'}
                                                                variant="outlined"
                                                                label={`РЭМД · ${pilotRawActiveTypeCount === null ? 'ожидается' : epguAvailableText}`}
                                                                sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.68rem' } }}
                                                            />
                                                        </Tooltip>
                                                        <Tooltip title={referenceChipTitle}>
                                                            <Chip
                                                                size="small"
                                                                color={pilotReferenceReady ? 'success' : 'warning'}
                                                                variant="outlined"
                                                                label={`ЭМД/НСИ · ${pilotReferenceReady ? 'готов' : 'ожидается'}`}
                                                                sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.68rem' } }}
                                                            />
                                                        </Tooltip>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Tooltip
                                                            title={`${indicator.numeratorLabel}${value?.sourceName ? ` · ${value.sourceName}` : ''}`}
                                                        >
                                                            <Chip
                                                                size="small"
                                                                color={numeratorReady ? 'success' : 'warning'}
                                                                variant="outlined"
                                                                label={`Числитель · РЭМД ${numeratorReady ? 'загружен' : 'ожидается'}`}
                                                                sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.68rem' } }}
                                                            />
                                                        </Tooltip>
                                                        <Tooltip title={indicator.denominatorLabel}>
                                                            <Chip
                                                                size="small"
                                                                color={denominatorReady ? 'success' : 'warning'}
                                                                variant="outlined"
                                                                label={`Знаменатель · ${denominatorSource} ${denominatorReady ? 'загружен' : 'ожидается'}`}
                                                                sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.68rem' } }}
                                                            />
                                                        </Tooltip>
                                                    </>
                                                )}
                                            </Stack>
                                            {/* Н8: пометки о том, чем расчёт отличается
                                                от методики. Без них 40 % против плана 100 %
                                                читаются как провал, хотя это семь месяцев
                                                фактов против годового плана. */}
                                            {indicatorNotes.length > 0 && (
                                                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                                                    {indicatorNotes.map((note) => (
                                                        <Typography
                                                            key={note.key}
                                                            variant="caption"
                                                            color={note.draft ? 'warning.main' : 'text.secondary'}
                                                            sx={{ display: 'block', lineHeight: 1.35 }}
                                                        >
                                                            {note.text}
                                                        </Typography>
                                                    ))}
                                                </Stack>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Stack spacing={0.5} alignItems="flex-start">
                                                <Chip
                                                    size="small"
                                                    color={view.color}
                                                    variant={view.color === 'success' ? 'filled' : 'outlined'}
                                                    label={view.label}
                                                />
                                                {value?.businessStatus !== 'not_assessed' && (
                                                    <Chip
                                                        size="small"
                                                        color={businessView.color}
                                                        variant={businessView.color === 'success' ? 'filled' : 'outlined'}
                                                        label={businessView.label}
                                                    />
                                                )}
                                            </Stack>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Typography variant="body2">
                                                {indicator.isPilot
                                                    ? value?.targetValue === null || typeof value?.targetValue === 'undefined'
                                                        ? '—'
                                                        : `${formatNumber(value.targetValue)} видов`
                                                    : formatPercent(value?.targetValue)}
                                            </Typography>
                                            {!indicator.isPilot && value?.deviationValue !== null && typeof value?.deviationValue !== 'undefined' && (
                                                <Typography
                                                    variant="caption"
                                                    color={value.deviationValue >= 0 ? 'success.main' : 'error.main'}
                                                >
                                                    {value.deviationValue > 0 ? '+' : ''}{formatNumber(value.deviationValue)} п.п.
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell align="right">
                                            <Typography variant="body2" fontWeight={600}>
                                                {indicator.isPilot
                                                    ? value?.factValue === null || typeof value?.factValue === 'undefined'
                                                        ? '—'
                                                        : `${formatNumber(value.factValue)} видов`
                                                    : formatPercent(value?.factValue)}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {indicator.isPilot
                                                    ? value?.secondaryValue === null || typeof value?.secondaryValue === 'undefined'
                                                        ? pilotRawActiveTypeCount === null
                                                            ? 'ожидаются данные'
                                                            : `предварительно: ${formatNumber(pilotRawActiveTypeCount)}`
                                                        : pilotCoverageLabel(value.numerator, value.denominator)
                                                    : `${formatNumber(value?.numerator)} / ${formatNumber(value?.denominator)}`}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                                                <Tooltip title="Открыть дашборд">
                                                    <IconButton
                                                        size="small"
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            onOpenDashboard(indicator.id)
                                                        }}
                                                        aria-label={`Открыть дашборд ${indicator.code}`}
                                                    >
                                                        <DashboardOutlinedIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                {!indicator.isPilot && (
                                                    <Tooltip title="Редактировать">
                                                        <IconButton
                                                            size="small"
                                                            onClick={(event) => {
                                                                event.stopPropagation()
                                                                onEdit(indicator)
                                                            }}
                                                            aria-label={`Редактировать ${indicator.code}`}
                                                        >
                                                            <EditOutlinedIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                )}
                                            </Stack>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
                </>
            )}
        </Paper>
    )
}
