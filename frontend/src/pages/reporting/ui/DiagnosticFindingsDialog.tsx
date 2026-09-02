import { useMemo, useState } from 'react'
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Paper,
    Stack,
    Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { ReportingDiagnosticFinding } from '@shared/lib/reporting-api'
import { groupFindings } from '../lib/diagnostic-findings'
import { semdTypeCountLabel } from '../lib/reporting-helpers'

interface DiagnosticFindingsDialogProps {
    open: boolean
    organizationName: string
    findings: ReportingDiagnosticFinding[]
    onClose: () => void
    onOpenInstitutionDetails?: () => void
    /**
     * Сколько видов СЭМД разбирается по этой МО — для подписи кнопки перехода
     * к расшифровке. Приходит из расчёта: с 07.08.2026 видов 36, а не 35.
     */
    semdTypeCount?: number
    /**
     * FR-11: 'region' — одна региональная причина показывается один раз со списком
     * затронутых МО (иначе она дублируется по каждому МО и каждому виду СЭМД).
     */
    scope?: 'organization' | 'region'
    organizationNameByOid?: Readonly<Record<string, string>>
}

function findingColor(
    severity: ReportingDiagnosticFinding['severity'],
): string {
    if (severity === 'error') return '#dc2626'
    if (severity === 'warning') return '#d97706'
    return '#2563eb'
}

export function DiagnosticFindingsDialog({
    open,
    organizationName,
    findings,
    onClose,
    onOpenInstitutionDetails,
    semdTypeCount,
    scope = 'organization',
    organizationNameByOid,
}: DiagnosticFindingsDialogProps) {
    const groups = useMemo(
        () => groupFindings(findings, organizationNameByOid),
        [findings, organizationNameByOid],
    )

    return (
        <Dialog
            open={open}
            onClose={onClose}
            onWheel={(event) => event.stopPropagation()}
            maxWidth="md"
            fullWidth
            scroll="paper"
            PaperProps={{
                sx: {
                    maxHeight: 'min(780px, calc(100vh - 32px))',
                    borderRadius: 2,
                },
            }}
        >
            <DialogTitle sx={{ py: 1.5, pr: 6 }}>
                <Typography variant="h6" fontWeight={800}>
                    {scope === 'region'
                        ? 'Причины и действия по региону'
                        : 'Все причины и действия'}
                </Typography>
                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                        mt: 0.25,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {organizationName} · {groups.length}{' '}
                    {groups.length === 1 ? 'причина' : 'причин'}
                    {groups.length !== findings.length
                        && ` · ${findings.length} записей сгруппировано`}
                </Typography>
                <IconButton
                    aria-label="Закрыть список причин"
                    onClick={onClose}
                    size="small"
                    sx={{ position: 'absolute', top: 12, right: 12 }}
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            <DialogContent
                dividers
                sx={{ p: 1.5, bgcolor: '#f8fafc' }}
            >
                <Stack spacing={1}>
                    {groups.map((group, index) => {
                        const accentColor = findingColor(group.severity)
                        return (
                            <Paper
                                key={group.key}
                                variant="outlined"
                                sx={{
                                    p: 1.25,
                                    borderLeft: '4px solid',
                                    borderLeftColor: accentColor,
                                    borderRadius: 1.5,
                                    boxShadow: 'none',
                                }}
                            >
                                <Stack
                                    direction="row"
                                    spacing={1}
                                    alignItems="flex-start"
                                >
                                    <Box
                                        aria-hidden
                                        sx={{
                                            display: 'grid',
                                            placeItems: 'center',
                                            width: 24,
                                            height: 24,
                                            flexShrink: 0,
                                            borderRadius: '50%',
                                            bgcolor: `${accentColor}12`,
                                            color: accentColor,
                                            fontSize: 12,
                                            fontWeight: 900,
                                        }}
                                    >
                                        {index + 1}
                                    </Box>
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                color: 'text.primary',
                                                lineHeight: 1.45,
                                                fontWeight: 700,
                                            }}
                                        >
                                            {group.cause}
                                        </Typography>
                                        {group.responsibilityArea && (
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    display: 'block',
                                                    mt: 0.3,
                                                    color: 'text.secondary',
                                                }}
                                            >
                                                Зона ответственности:{' '}
                                                {group.responsibilityArea}
                                            </Typography>
                                        )}
                                        {scope === 'region'
                                            && group.organizationNames.length > 0 && (
                                            <AffectedChips
                                                label="Затронуто МО"
                                                values={group.organizationNames}
                                            />
                                        )}
                                        {group.semdTypeNames.length > 0 && (
                                            <AffectedChips
                                                label="Затронуто видов СЭМД"
                                                values={group.semdTypeNames}
                                            />
                                        )}
                                        {group.evidenceChips.map((chips) => (
                                            <AffectedChips
                                                key={chips.label}
                                                label={chips.label}
                                                values={chips.values}
                                                total={chips.total}
                                            />
                                        ))}
                                        {group.recommendation && (
                                            <Box
                                                sx={{
                                                    mt: 0.8,
                                                    px: 1,
                                                    py: 0.75,
                                                    bgcolor: '#eff6ff',
                                                    borderRadius: 1,
                                                }}
                                            >
                                                <Typography
                                                    variant="caption"
                                                    fontWeight={800}
                                                    color="#0369a1"
                                                >
                                                    Что сделать
                                                </Typography>
                                                <Typography
                                                    variant="body2"
                                                    sx={{
                                                        mt: 0.15,
                                                        lineHeight: 1.4,
                                                    }}
                                                >
                                                    {group.recommendation}
                                                </Typography>
                                            </Box>
                                        )}
                                    </Box>
                                </Stack>
                            </Paper>
                        )
                    })}
                </Stack>
            </DialogContent>

            <DialogActions sx={{ px: 2, py: 1.25 }}>
                <Button onClick={onClose} color="inherit">
                    Закрыть
                </Button>
                {onOpenInstitutionDetails && (
                    <Button
                        variant="contained"
                        onClick={onOpenInstitutionDetails}
                        sx={{ textTransform: 'none' }}
                    >
                        Расшифровка по {semdTypeCountLabel(semdTypeCount)} видам СЭМД
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    )
}

/**
 * Сколько чипов показывать сразу. После выноса названия вида из текста причины
 * (пункт А-4) в группу попадает до 35 МО и до 25 видов — списком целиком карточка
 * становится нечитаемой, поэтому хвост прячем под «ещё N».
 */
const AFFECTED_CHIPS_VISIBLE = 10

/** Список затронутых объектов группы (МО или виды СЭМД) компактными чипами. */
function AffectedChips({
    label,
    values,
    total,
}: {
    label: string
    values: string[]
    /** Общее число значений, если в находку попала только выборка (например 20 из 115). */
    total?: number
}) {
    const [expanded, setExpanded] = useState(false)
    const hiddenCount = values.length - AFFECTED_CHIPS_VISIBLE
    const shown = expanded ? values : values.slice(0, AFFECTED_CHIPS_VISIBLE)
    const totalCount = total ?? values.length
    const isSample = totalCount > values.length

    return (
        <Box sx={{ mt: 0.7 }}>
            <Typography variant="caption" fontWeight={800} color="text.secondary">
                {label}: {totalCount}
                {isSample && ` (показаны первые ${values.length})`}
            </Typography>
            <Box
                sx={{
                    mt: 0.4,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.5,
                    alignItems: 'center',
                }}
            >
                {shown.map((value) => (
                    <Chip
                        key={value}
                        size="small"
                        variant="outlined"
                        label={value}
                        sx={{
                            maxWidth: '100%',
                            height: 22,
                            fontSize: '0.72rem',
                        }}
                    />
                ))}
                {hiddenCount > 0 && (
                    <Chip
                        size="small"
                        variant={expanded ? 'outlined' : 'filled'}
                        color="primary"
                        onClick={() => setExpanded((value) => !value)}
                        label={expanded ? 'свернуть' : `ещё ${hiddenCount}`}
                        sx={{ height: 22, fontSize: '0.72rem', cursor: 'pointer' }}
                    />
                )}
            </Box>
        </Box>
    )
}
