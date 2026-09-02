import { useMemo, useState } from 'react'
import {
    Alert,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Button,
    Typography,
} from '@mui/material'
import type { SemdTypeRegistryType } from '@shared/lib/reporting-api'
import { IndicatorDetailTable, type IndicatorDetailColumn } from './IndicatorDetailTable'
import { formatNumber } from '../lib/reporting-helpers'

type SemdTypeRegistryFilter = 'all' | 'registered' | 'not_registered' | 'outside_registry'

interface SemdTypeRegistryDialogProps {
    open: boolean
    types: SemdTypeRegistryType[] | null
    onClose: () => void
}

/**
 * Н18.1 (ВКС 15.08.2026) — разбор показателя «Виды СЭМД, регистрируемые в РЭМД»:
 * какие виды Перечня № 5пр регион регистрирует, каких не хватает и какие
 * регистрируются мимо Перечня.
 *
 * Повод конкретный: методолог насчитала 74 зарегистрированных вида против наших 70
 * и просила показать, «что не попадает в расчёт». Виды вне Перечня — отдельное
 * состояние, а не пропущенные строки: именно они и объясняют расхождение.
 */
export function SemdTypeRegistryDialog({ open, types, onClose }: SemdTypeRegistryDialogProps) {
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<SemdTypeRegistryFilter>('all')

    const allTypes = useMemo(() => types ?? [], [types])
    const counts = useMemo(() => ({
        registered: allTypes.filter((type) => type.status === 'registered').length,
        notRegistered: allTypes.filter((type) => type.status === 'not_registered').length,
        outside: allTypes.filter((type) => type.status === 'outside_registry').length,
    }), [allTypes])
    const registryTypeCount = counts.registered + counts.notRegistered

    const filtered = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('ru-RU')
        return allTypes.filter((type) => {
            if (filter !== 'all' && type.status !== filter) return false
            if (!query) return true
            return [
                type.name,
                type.officialName5pr ?? '',
                type.nsiOid ?? '',
                type.officialOid ?? '',
            ]
                .join(' ')
                .toLocaleLowerCase('ru-RU')
                .includes(query)
        })
    }, [allTypes, search, filter])

    /**
     * Год, за который загружена прошлогодняя выгрузка. Все строки несут его
     * одинаковым, поэтому берём из первой; `null` — выгрузки нет, и колонки
     * прошлого года на экране быть не должно.
     */
    const priorYear = allTypes.find((type) => type.priorYear !== null)?.priorYear ?? null

    const columns: Array<IndicatorDetailColumn<SemdTypeRegistryType>> = [
        {
            key: 'name',
            header: 'Вид СЭМД',
            render: (type) => (
                <>
                    <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>
                        {type.officialName5pr ?? type.name}
                    </Typography>
                    <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', overflowWrap: 'anywhere' }}
                    >
                        {[
                            type.nsiOid ? `Вид МД ${type.nsiOid}` : '',
                            type.officialOid ? `OID ${type.officialOid}` : '',
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </Typography>
                </>
            ),
        },
        /* Д-28, просьба методолога от 28.08.2026: показать прошлый год рядом
           с текущим. Смысл — увидеть виды, которые в прошлом году
           регистрировались, а в этом ещё нет: «это зона ответственности МО».
           Колонка появляется только когда выгрузка прошлого года загружена. */
        ...(priorYear === null ? [] : [{
            key: 'priorYear',
            header: `${priorYear} г.`,
            width: 130,
            render: (type: SemdTypeRegistryType) => (
                (type.priorYearDocumentCount ?? 0) > 0
                    ? (
                        <>
                            <Typography variant="body2" fontWeight={700} color="text.secondary">
                                {formatNumber(type.priorYearDocumentCount ?? 0)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {formatNumber(type.priorYearOrganizationCount ?? 0)} МО
                            </Typography>
                        </>
                    )
                    : <Typography variant="body2" color="text.secondary">—</Typography>
            ),
        } as IndicatorDetailColumn<SemdTypeRegistryType>]),
        {
            key: 'registrations',
            header: priorYear === null ? 'Регистрации' : `${priorYear + 1} г.`,
            width: 150,
            render: (type) => (
                type.documentCount > 0
                    ? (
                        <>
                            <Typography variant="body2" fontWeight={700}>
                                {formatNumber(type.documentCount)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                {formatNumber(type.organizationCount)} МО
                            </Typography>
                        </>
                    )
                    : <Typography variant="body2" color="text.secondary">—</Typography>
            ),
        },
        {
            key: 'status',
            header: 'Статус',
            width: 180,
            render: (type) => (
                <Chip
                    size="small"
                    color={statusColor(type.status)}
                    variant={type.status === 'registered' ? 'filled' : 'outlined'}
                    label={statusLabel(type.status)}
                />
            ),
        },
    ]

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ pb: 0.5 }}>
                <Typography variant="subtitle1" fontWeight={700} component="div">
                    Виды электронных медицинских документов, которые регистрируются
                    в РЭМД ЕГИСЗ
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    {registryTypeCount} видов Перечня № 5пр по региону — Курганская область
                </Typography>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Зарегистрировано {counts.registered} из {registryTypeCount} видов Перечня —
                    вид засчитывается, если хотя бы одна МО региона зарегистрировала его в РЭМД.
                </Typography>
                {/* Расхождение с ручным подсчётом объясняется здесь, а не в переписке:
                    методолог насчитала 74 вида против наших 70 именно на этих строках. */}
                {counts.outside > 0 && (
                    <Alert severity="info" sx={{ mb: 1 }}>
                        Ещё {counts.outside} видов регистрируются в РЭМД, но в Перечень № 5пр
                        не входят и в расчёт показателя не берутся: доля от {registryTypeCount} видов,
                        посчитанная с ними, могла бы превысить 100 %. Они помечены статусом
                        «Вне Перечня № 5пр».
                    </Alert>
                )}
                <IndicatorDetailTable
                    rows={filtered}
                    getRowId={(type) => type.semdTypeId}
                    columns={columns}
                    filters={[
                        { value: 'all', label: `Все ${allTypes.length}` },
                        { value: 'registered', label: `Зарегистрировано ${counts.registered}` },
                        { value: 'not_registered', label: `Не зарегистрировано ${counts.notRegistered}` },
                        { value: 'outside_registry', label: `Вне Перечня ${counts.outside}` },
                    ]}
                    activeFilter={filter}
                    onFilterChange={setFilter}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Поиск по названию, номеру или OID"
                    emptyMessage="Виды СЭМД не найдены"
                    rowCountLabel={(count) => `${count} видов`}
                    tableMinWidth={520}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Закрыть</Button>
            </DialogActions>
        </Dialog>
    )
}

function statusLabel(status: SemdTypeRegistryType['status']): string {
    if (status === 'registered') return 'Зарегистрирован'
    if (status === 'outside_registry') return 'Вне Перечня № 5пр'
    return 'Не зарегистрирован'
}

/**
 * «Вне Перечня» — не ошибка и не достижение: вид регистрируется, просто не входит
 * в знаменатель. Отсюда нейтральный тон вместо зелёного или красного.
 */
function statusColor(
    status: SemdTypeRegistryType['status'],
): 'success' | 'warning' | 'default' {
    if (status === 'registered') return 'success'
    if (status === 'outside_registry') return 'warning'
    return 'default'
}
