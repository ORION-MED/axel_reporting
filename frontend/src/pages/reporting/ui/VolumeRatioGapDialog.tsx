import { useMemo, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    LinearProgress,
    Typography,
} from '@mui/material'
import type { ReportingOrganizationIndicatorValue } from '@shared/lib/reporting-api'
import { IndicatorDetailTable, type IndicatorDetailColumn } from './IndicatorDetailTable'
import { formatNumber } from '../lib/reporting-helpers'
import {
    buildVolumeRatioGapSummary,
    type VolumeRatioGapRow,
} from '../lib/volume-ratio-gap'

type GapFilter = 'all' | 'gap' | 'no_volume' | 'not_participating'

interface VolumeRatioGapDialogProps {
    open: boolean
    indicatorTitle: string
    organizations: readonly ReportingOrganizationIndicatorValue[]
    onClose: () => void
}

/**
 * Разбор недостачи по показателю-доле: сколько случаев оказания помощи прошло
 * без СЭМД и у каких МО.
 *
 * У показателей 6.1.3.2.7 и 27 «чего не хватает» разворачивается перечнем видов.
 * У долей знаменатель — случаи помощи из терпрограммы, перечня нет; вместо него
 * здесь недостача в документах. Она отвечает на тот же вопрос и вдобавок
 * ранжирует адресатов, чего процент не делает: на данных 08.2026 у детской
 * поликлиники 64,91 % — середина списка, а в документах 127 968 случаев,
 * второй по величине провал области.
 */
export function VolumeRatioGapDialog({
    open,
    indicatorTitle,
    organizations,
    onClose,
}: VolumeRatioGapDialogProps) {
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<GapFilter>('gap')

    const summary = useMemo(
        () => buildVolumeRatioGapSummary(organizations),
        [organizations],
    )

    const counts = useMemo(() => ({
        gap: summary.rows.filter((row) => (row.gap ?? 0) > 0).length,
        noVolume: summary.noApprovedVolumeCount,
        notParticipating: summary.notParticipatingCount,
    }), [summary])

    const filtered = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('ru-RU')
        return summary.rows.filter((row) => {
            if (filter === 'gap' && (row.gap ?? 0) <= 0) return false
            if (filter === 'no_volume' && row.status !== 'no_approved_volume') return false
            if (filter === 'not_participating' && row.status !== 'not_participating') return false
            if (!query) return true
            return row.organizationName.toLocaleLowerCase('ru-RU').includes(query)
        })
    }, [summary.rows, search, filter])

    const columns: Array<IndicatorDetailColumn<VolumeRatioGapRow>> = [
        {
            key: 'organization',
            header: 'Медицинская организация',
            render: (row) => (
                <>
                    <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                        {row.organizationName}
                    </Typography>
                    {row.status !== 'calculated' && (
                        <Chip
                            size="small"
                            variant="outlined"
                            sx={{ mt: 0.25 }}
                            label={row.status === 'no_approved_volume'
                                ? 'Нет утверждённого объёма'
                                : 'Не участвует в показателе'}
                        />
                    )}
                    {/* Р о годовом плане: недостача у такой МО завышена, и молчать
                        об этом нельзя — она может оказаться в первых строках. */}
                    {row.usedAnnualFallback && (
                        <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                            План частично взят за год — недостача завышена
                        </Typography>
                    )}
                </>
            ),
        },
        {
            key: 'gap',
            header: 'Не хватает СЭМД',
            align: 'right',
            width: 190,
            render: (row) => (
                row.gap === null
                    ? <Typography variant="body2" color="text.secondary">—</Typography>
                    : (
                        <>
                            <Typography variant="body2" fontWeight={800}>
                                {formatNumber(row.gap)}
                            </Typography>
                            {row.shareOfGap !== null && row.gap > 0 && (
                                <Typography variant="caption" color="text.secondary">
                                    {formatNumber(row.shareOfGap)} % разрыва
                                </Typography>
                            )}
                        </>
                    )
            ),
        },
        {
            key: 'fact',
            header: 'Факт / план',
            align: 'right',
            width: 170,
            render: (row) => (
                <>
                    <Typography variant="body2" fontWeight={700}>
                        {formatNumber(row.fact)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {row.plan === null ? 'плана нет' : `из ${formatNumber(row.plan)}`}
                    </Typography>
                </>
            ),
        },
        {
            key: 'percent',
            header: 'Доля',
            align: 'right',
            width: 110,
            render: (row) => (
                row.percent === null
                    ? <Typography variant="body2" color="text.secondary">—</Typography>
                    : <Typography variant="body2" fontWeight={700}>{formatNumber(row.percent)} %</Typography>
            ),
        },
    ]

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ pb: 0.5 }}>
                <Typography variant="subtitle1" fontWeight={700} component="div">
                    Разбор недостачи — {indicatorTitle}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Курганская область · {summary.calculatedCount} МО с утверждённым объёмом
                </Typography>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}>
                <Box sx={{ mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                        Не хватает <strong>{formatNumber(summary.totalGap)}</strong> СЭМД:
                        зарегистрировано {formatNumber(summary.totalFact)} при накопительном
                        плане {formatNumber(summary.totalPlan)}. «Не хватает» — это случаи
                        оказания помощи, по которым документ в РЭМД не зарегистрирован.
                    </Typography>
                    {summary.totalPlan > 0 && (
                        <LinearProgress
                            variant="determinate"
                            sx={{ mt: 0.75, height: 8, borderRadius: 1 }}
                            value={Math.min(100, (summary.totalFact / summary.totalPlan) * 100)}
                        />
                    )}
                </Box>
                {/* Числитель показателя больше суммы фактов в этом списке: регион
                    считает факт по всем МО, а недостачу — только там, где есть план.
                    Промолчать значило бы показать методологу два разных числителя
                    без объяснения. */}
                {summary.factWithoutPlan > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        Ещё {formatNumber(summary.factWithoutPlan)} СЭМД зарегистрировали
                        {' '}{summary.noApprovedVolumeCount} МО без утверждённого объёма — в разбор
                        они не входят: недостачу считать не от чего. В числителе показателя
                        эти документы учтены.
                    </Typography>
                )}
                {/* Ради этой строки разбор и открывают: она называет адресатов. */}
                {summary.organizationsToCloseEightyPercent > 0 && (
                    <Alert severity="info" sx={{ mb: 1 }}>
                        Первые {summary.organizationsToCloseEightyPercent} МО списка дают 80 %
                        всей недостачи. Процент этого не показывает: МО с приличной долей,
                        но большими объёмами теряет больше документов, чем маленькая
                        МО с плохим процентом.
                    </Alert>
                )}
                <IndicatorDetailTable
                    rows={filtered}
                    getRowId={(row) => row.organizationOid}
                    columns={columns}
                    filters={[
                        { value: 'gap', label: `С недостачей ${counts.gap}` },
                        { value: 'all', label: `Все ${summary.rows.length}` },
                        { value: 'no_volume', label: `Нет объёма ${counts.noVolume}` },
                        { value: 'not_participating', label: `Не участвует ${counts.notParticipating}` },
                    ]}
                    activeFilter={filter}
                    onFilterChange={setFilter}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Поиск по наименованию МО"
                    emptyMessage="Медицинские организации не найдены"
                    rowCountLabel={(count) => `${count} МО`}
                    tableMinWidth={620}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Закрыть</Button>
            </DialogActions>
        </Dialog>
    )
}
