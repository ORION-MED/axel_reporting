import { useMemo, useState } from 'react'
import {
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Button,
    Typography,
} from '@mui/material'
import type { PilotRegionSemdType } from '@shared/lib/reporting-api'
import { IndicatorDetailTable, type IndicatorDetailColumn } from './IndicatorDetailTable'
import { semdTypeCountLabel } from '../lib/reporting-helpers'

type RegionSemdTypesFilter = 'all' | 'covered' | 'missing'

interface RegionSemdTypesDialogProps {
    open: boolean
    types: PilotRegionSemdType[] | null
    onClose: () => void
}

/**
 * Roadmap Пакет A, задача 8 — региональный список целевых видов СЭМД: какие исполнены
 * хотя бы одной МО региона, какие нет. Данные уже считались на backend для агрегированного
 * числа (actualRegionTypeCount) — здесь просто показывается тот же список подетально.
 *
 * Поле контракта называется `covered` и переименования не требует: с 24.08.2026
 * поменялась подпись на экране, а не признак.
 */
export function RegionSemdTypesDialog({ open, types, onClose }: RegionSemdTypesDialogProps) {
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState<RegionSemdTypesFilter>('all')

    const allTypes = useMemo(() => types ?? [], [types])
    const filtered = useMemo(() => {
        const query = search.trim().toLocaleLowerCase('ru-RU')
        return allTypes.filter((type) => {
            if (filter === 'covered' && !type.covered) return false
            if (filter === 'missing' && type.covered) return false
            if (!query) return true
            return [
                type.name,
                type.officialName5pr ?? '',
                type.code,
                type.nsiOid ?? '',
                type.officialOid ?? '',
            ]
                .join(' ')
                .toLocaleLowerCase('ru-RU')
                .includes(query)
        })
    }, [allTypes, search, filter])

    const coveredCount = allTypes.filter((type) => type.covered).length

    const columns: Array<IndicatorDetailColumn<PilotRegionSemdType>> = [
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
                        {/* Р2: служебный код вида (nsi_type_NN) в названии не показываем —
                            он дублирует «Вид МД NN»; в поиске выше код остаётся доступен. */}
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
        {
            key: 'covered',
            header: 'Статус',
            width: 160,
            render: (type) => (
                /* ВКС 24.08.2026: «слово "покрыт" меняем». Сначала предложили
                   «реализован», но реализует вид не регион, а разработчик МИС —
                   регион его исполняет. На «исполнен» и сошлись. */
                <Chip
                    size="small"
                    color={type.covered ? 'success' : 'default'}
                    variant={type.covered ? 'filled' : 'outlined'}
                    label={type.covered ? 'Исполнен регионом' : 'Не исполнен'}
                />
            ),
        },
    ]

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            {/* В13: заголовок должен сам отвечать на вопрос «чей это список» —
                на демонстрации региональный перечень спутали с перечнем по МО. */}
            {/* Рекомендация методолога от 03.08.2026: в заголовке — наименование показателя
                дословно по Приложению 2, «и для остальных показателей тот же принцип».
                Уточнение «N видов по региону» из В13 сохранено подзаголовком: оно отличает
                региональный список от списка по конкретной МО, и на демонстрации 31.07
                их уже путали. */}
            <DialogTitle sx={{ pb: 0.5 }}>
                <Typography variant="subtitle1" fontWeight={700} component="div">
                    Количество видов электронных медицинских документов, которые регистрируются
                    в РЭМД ЕГИСЗ посредством ГИСЗ субъекта Российской Федерации, доступ к которым
                    обеспечен для использования гражданами в личном кабинете гражданина на ЕПГУ
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    6.1.3.2.7 · {semdTypeCountLabel(allTypes.length)} видов СЭМД
                    {' '}по региону — Курганская область
                </Typography>
            </DialogTitle>
            <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Исполнено {coveredCount} из {allTypes.length} целевых видов —
                    вид считается исполненным, если хотя бы одна МО региона зарегистрировала его в РЭМД.
                </Typography>
                <IndicatorDetailTable
                    rows={filtered}
                    getRowId={(type) => type.id}
                    columns={columns}
                    filters={[
                        { value: 'all', label: `Все ${allTypes.length}` },
                        { value: 'covered', label: `Исполнено ${coveredCount}` },
                        { value: 'missing', label: `Не исполнено ${allTypes.length - coveredCount}` },
                    ]}
                    activeFilter={filter}
                    onFilterChange={setFilter}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="Поиск по названию, номеру или OID"
                    emptyMessage="Виды СЭМД не найдены"
                    rowCountLabel={(count) => `${count} видов`}
                    tableMinWidth={480}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Закрыть</Button>
            </DialogActions>
        </Dialog>
    )
}
