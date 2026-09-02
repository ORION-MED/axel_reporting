import { useEffect, useMemo, useState } from 'react'
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
    Tab,
    Tabs,
    Tooltip,
    Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import type { PilotInstitutionDetails } from '@shared/lib/reporting-api'
import {
    compactRequirementMeta,
    compactRequirementReason,
    countAttentionTypes,
    formatDateTime,
    formatNumber,
    formatPercent,
    groundLevelView,
    GROUND_LEVEL_ORDER,
    isAttentionType,
    NOT_REGISTERED_STATUSES,
    requirementMarker,
    requirementStatusView,
    REQUIRED_STATUSES,
    semdResultTone,
    semdResultView,
    semdTypeCountLabel,
    visibleGrounds,
    type InstitutionDetailsFilter,
    type InstitutionSemdType,
} from '../lib/reporting-helpers'
import {
    IndicatorDetailTable,
    type IndicatorDetailColumn,
} from './IndicatorDetailTable'

/** Roadmap задача 7 — структурное разделение видов СЭМД на то, что обязательно/возможно, и то, что фактически выполняется. */
/**
 * Рекомендации 27.07, п.9.6: карточка МО управляется одной строкой из четырёх вкладок
 * вместо прежнего набора дублирующих чипов и подменю.
 */
type InstitutionDetailsSection = 'all' | 'required' | 'not_registered' | 'attention'

interface InstitutionDetailsDialogProps {
    institutionDetails: PilotInstitutionDetails | null
    institutionDetailsSearch: string
    institutionDetailsFilter: InstitutionDetailsFilter
    filteredInstitutionTypes: InstitutionSemdType[]
    requirementHistoryLoading: boolean
    onClose: () => void
    onSearchChange: (value: string) => void
    onFilterChange: (filter: InstitutionDetailsFilter) => void
    onOpenRequirementHistory: () => void
    onOpenRequirementOverride: (type: InstitutionSemdType) => void
}

export function InstitutionDetailsDialog({
    institutionDetails,
    institutionDetailsSearch,
    institutionDetailsFilter,
    filteredInstitutionTypes,
    requirementHistoryLoading,
    onClose,
    onSearchChange,
    onFilterChange,
    onOpenRequirementHistory,
    onOpenRequirementOverride,
}: InstitutionDetailsDialogProps) {
    const [section, setSection] = useState<InstitutionDetailsSection>('all')
    const organizationOid = institutionDetails?.organization.oid

    useEffect(() => {
        if (organizationOid) setSection('all')
    }, [organizationOid])

    const sectionedTypes = useMemo(() => {
        if (section === 'required') {
            return filteredInstitutionTypes.filter(
                (type) => REQUIRED_STATUSES.has(type.resultStatus),
            )
        }
        if (section === 'not_registered') {
            return filteredInstitutionTypes.filter(
                (type) => NOT_REGISTERED_STATUSES.has(type.resultStatus),
            )
        }
        if (section === 'attention') {
            // В1 (ВКС 31.07): только «не обязателен, но формирует» — предикат и его
            // обоснование лежат в reporting-helpers, там же тесты.
            return filteredInstitutionTypes.filter(isAttentionType)
        }
        return filteredInstitutionTypes
    }, [filteredInstitutionTypes, section])

    return (
        <Dialog
            open={Boolean(institutionDetails)}
            onClose={onClose}
            maxWidth="xl"
            fullWidth
            PaperProps={{
                sx: { height: 'min(860px, calc(100vh - 32px))' },
            }}
        >
            <DialogTitle sx={{ pb: 1 }}>
                {institutionDetails && (
                    <Stack
                        direction={{ xs: 'column', md: 'row' }}
                        spacing={1}
                        alignItems={{ xs: 'flex-start', md: 'center' }}
                    >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="h6" fontWeight={800}>
                                {institutionDetails.organization.name}
                            </Typography>
                            {/* В13: подпись явно говорит, что это перечень по одной МО,
                                а не региональный — их спутали на демонстрации. */}
                            <Typography variant="caption" color="text.secondary">
                                6.1.3.2.7 · {semdTypeCountLabel(
                                    institutionDetails.summary.totalTypeCount,
                                )} видов СЭМД по этой МО
                                {institutionDetails.reportingDate
                                    && ` · на ${institutionDetails.reportingDate}`}
                            </Typography>
                        </Box>
                        <Chip
                            size="small"
                            color={
                                institutionDetails.summary.isPreliminary
                                    ? 'warning'
                                    : 'success'
                            }
                            label={
                                institutionDetails.summary.isPreliminary
                                    ? 'Предварительный расчет'
                                    : 'Применимость определена'
                            }
                        />
                        {institutionDetails.summary.manualOverrideCount > 0 && (
                            <Chip
                                size="small"
                                color="info"
                                variant="outlined"
                                label={`Ручных уточнений: ${institutionDetails.summary.manualOverrideCount}`}
                            />
                        )}
                    </Stack>
                )}
            </DialogTitle>
            <DialogContent
                dividers
                sx={{
                    p: 1.5,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                }}
            >
                {institutionDetails && (
                    <Stack spacing={1} sx={{ minHeight: 0, flex: 1 }}>
                        <Paper
                            variant="outlined"
                            sx={{
                                p: 1.25,
                                bgcolor: 'background.paper',
                            }}
                        >
                            {/* Шапка в две строки: сверху процент, снизу полоса вкладок.
                                Раньше вкладки стояли сбоку и выравнивались по центру блока с
                                процентом — их подчёркивание не совпадало ни с одной линией. */}
                            <Box sx={{ mb: 1 }}>
                                <Typography variant="caption" color="text.secondary">
                                    Исполнение
                                </Typography>
                                <Stack
                                    direction="row"
                                    spacing={1}
                                    alignItems="baseline"
                                    sx={{ flexWrap: 'wrap' }}
                                >
                                    <Typography variant="h4" fontWeight={900} lineHeight={1.05}>
                                        {formatPercent(institutionDetails.summary.coveragePercent)}
                                    </Typography>
                                    {/* Н10: «Нет подтверждённого знаменателя» перенесено сюда
                                        из свёрнутого блока «методика». Там оно пряталось за
                                        кликом, хотя объясняет прочерк вместо процента. */}
                                    <Typography variant="caption" color="text.secondary">
                                        {institutionDetails.summary.requiredTypeCount > 0
                                            ? `${formatNumber(institutionDetails.summary.registeredRequiredTypeCount)} из ${formatNumber(institutionDetails.summary.requiredTypeCount)} обязательных видов формируются`
                                            : 'Нет подтверждённого знаменателя: обязательные виды для этой МО не определены'}
                                    </Typography>
                                </Stack>
                            </Box>
                            {/* Рекомендации 27.07, п.9.6: одна строка из четырёх вкладок
                                вместо прежних дублирующих чипов и подменю. */}
                            <Tabs
                                value={section}
                                onChange={(_event, value: InstitutionDetailsSection) => setSection(value)}
                                variant="scrollable"
                                scrollButtons="auto"
                                sx={{
                                    minWidth: 0,
                                    minHeight: 34,
                                    borderBottom: 1,
                                    borderColor: 'divider',
                                    '& .MuiTabs-indicator': { height: 2 },
                                }}
                            >
                                <Tab
                                    value="all"
                                    label={`Перечень СЭМД (${formatNumber(institutionDetails.summary.totalTypeCount)})`}
                                    sx={{ minHeight: 34, py: 0, textTransform: 'none' }}
                                />
                                <Tab
                                    value="required"
                                    label={`Обязательные для МО (${formatNumber(institutionDetails.summary.requiredTypeCount)})`}
                                    sx={{ minHeight: 34, py: 0, textTransform: 'none' }}
                                />
                                <Tab
                                    value="not_registered"
                                    label={`Не зарегистрированные от МО (${formatNumber(institutionDetails.summary.missingRequiredTypeCount)})`}
                                    sx={{ minHeight: 34, py: 0, textTransform: 'none' }}
                                />
                                {/* В1: счётчик считается по тому же предикату, что и сам
                                    фильтр, — иначе на вкладке обещаются виды, которых в ней нет.
                                    Берём полный список types, а не отфильтрованный поиском. */}
                                <Tab
                                    value="attention"
                                    label={`Внимание (${formatNumber(
                                        countAttentionTypes(institutionDetails.types),
                                    )})`}
                                    sx={{ minHeight: 34, py: 0, textTransform: 'none' }}
                                />
                            </Tabs>
                        </Paper>

                        <Box
                            component="details"
                            sx={{
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1,
                                bgcolor: 'action.hover',
                                px: 1.25,
                                py: 0.9,
                                '&[open]': { pb: 1.1 },
                                '& summary': {
                                    cursor: 'pointer',
                                    listStyle: 'none',
                                },
                                '& summary::-webkit-details-marker': {
                                    display: 'none',
                                },
                            }}
                        >
                            <Box
                                component="summary"
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    minWidth: 0,
                                }}
                            >
                                {/* Н10 (визуальная разгрузка окна): здесь стояли те же
                                    процент и статус, что и на два блока выше, — одно и то же
                                    число читалось трижды на одном экране. Состав окна
                                    методолог менять не разрешила, поэтому убраны только
                                    повторы: остался заголовок раскрывающегося пояснения. */}
                                <Typography variant="body2" fontWeight={800} sx={{ flex: 1 }}>
                                    Как считается процент
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    методика
                                </Typography>
                            </Box>
                            {/* Формулировка методолога от 22.08.2026 — прислана
                                готовым текстом, «скопируйте текст». */}
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                                В числителе — обязательные виды СЭМД, зарегистрированные
                                в РЭМД от медицинской организации.
                                В знаменателе — подтвержденные обязательные виды.
                                {' '}{formatNumber(institutionDetails.summary.unknownApplicabilityCount)}
                                {' '}неопределенных видов не входят в процент и не считаются нарушением МО.
                                Ручные уточнения имеют приоритет над правилами из ТПГГ.
                            </Typography>
                            {/* В6 (ВКС 31.07): расшифровка приоритетов обязательности —
                                цифра в колонке «Основание» без легенды ничего не говорит.
                                Логика соединения уровней здесь намеренно не описана,
                                см. комментарий к GROUND_LEVELS. */}
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                display="block"
                                sx={{ mt: 0.75, fontWeight: 700 }}
                            >
                                Приоритеты обязательности в графе «Основание»
                            </Typography>
                            <Stack component="ul" sx={{ m: 0, mt: 0.35, pl: 2.2 }} spacing={0.15}>
                                {GROUND_LEVEL_ORDER.map((level) => (
                                    <Typography
                                        key={level}
                                        component="li"
                                        variant="caption"
                                        color="text.secondary"
                                    >
                                        <strong>{level}</strong>
                                        {' — '}
                                        {groundLevelView(level).description}
                                    </Typography>
                                ))}
                            </Stack>
                        </Box>

                        <IndicatorDetailTable<InstitutionSemdType, InstitutionDetailsFilter>
                            rows={sectionedTypes}
                            getRowId={(type) => type.semdTypeId}
                            searchValue={institutionDetailsSearch}
                            onSearchChange={onSearchChange}
                            searchPlaceholder="Поиск по TYPE, названию или основанию"
                            rowCountLabel={(count) => `${count} строк`}
                            toolbarExtra={(
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<HistoryOutlinedIcon />}
                                    onClick={onOpenRequirementHistory}
                                    disabled={requirementHistoryLoading}
                                    sx={{ whiteSpace: 'nowrap', textTransform: 'none' }}
                                >
                                    Журнал уточнений
                                </Button>
                            )}
                            // Выборкой управляют вкладки выше (п.9.6), поэтому строка
                            // чипов-фильтров в таблице не нужна.
                            filters={[]}
                            activeFilter={institutionDetailsFilter}
                            onFilterChange={onFilterChange}
                            emptyMessage="По выбранным условиям строки СЭМД не найдены."
                            tableMinWidth={1040}
                            columns={([
                                {
                                    key: 'type',
                                    header: 'Вид СЭМД',
                                    width: 360,
                                    render: (type) => {
                                        // В2: на вкладке «Перечень СЭМД» виды идут вперемешку,
                                        // и без пометки обязательности непонятно, почему один
                                        // незарегистрированный красный, а другой серый.
                                        // На остальных вкладках обязательность задана самой
                                        // вкладкой, пометка там была бы шумом.
                                        const marker = section === 'all'
                                            ? requirementMarker(type)
                                            : null
                                        return (
                                            <>
                                                <Typography variant="body2" fontWeight={700}>
                                                    {type.officialName5pr ?? type.name}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    Вид МД {type.nsiTypeCode}
                                                    {type.officialOid ? ` · OID ${type.officialOid}` : ''}
                                                </Typography>
                                                <Stack
                                                    direction="row"
                                                    spacing={0.5}
                                                    alignItems="center"
                                                    sx={{ flexWrap: 'wrap', rowGap: 0.25 }}
                                                >
                                                    {type.documentFormat && (
                                                        <Typography variant="caption" color="text.secondary">
                                                            {type.documentFormat}
                                                        </Typography>
                                                    )}
                                                    {marker && (
                                                        <Chip
                                                            size="small"
                                                            variant="outlined"
                                                            color={marker.color}
                                                            label={marker.label}
                                                            sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: 11 } }}
                                                        />
                                                    )}
                                                </Stack>
                                            </>
                                        )
                                    },
                                },
                                {
                                    key: 'remd',
                                    header: 'РЭМД',
                                    align: 'right',
                                    width: 110,
                                    render: (type) => (
                                        <Typography
                                            variant="body2"
                                            fontWeight={type.registered ? 700 : 400}
                                            color={type.registered ? 'success.main' : 'text.secondary'}
                                        >
                                            {type.registered
                                                ? formatNumber(type.documentCount)
                                                : 'нет'}
                                        </Typography>
                                    ),
                                },
                                {
                                    key: 'result',
                                    header: 'Результат',
                                    width: 210,
                                    render: (type) => {
                                        const result = semdResultView(type.resultStatus)
                                        const resultTone = semdResultTone(result.color)
                                        // В2: колонка «Применимость» убрана, её значки
                                        // (кнопка уточнения и пометка ручной правки) переехали
                                        // сюда; статус правила ушёл в подсказку.
                                        const ruleStatus = requirementStatusView(type.requirementStatus)
                                        return (
                                            <Stack
                                                direction="row"
                                                spacing={0.5}
                                                alignItems="center"
                                                sx={{ flexWrap: 'wrap', rowGap: 0.25 }}
                                            >
                                            <Box
                                                title={`${result.description}\nПравило: ${ruleStatus.label}`}
                                                sx={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 0.65,
                                                    maxWidth: 158,
                                                    px: 0.85,
                                                    py: 0.45,
                                                    border: '1px solid',
                                                    borderColor: resultTone.border,
                                                    borderRadius: 999,
                                                    bgcolor: resultTone.bg,
                                                    color: resultTone.text,
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        width: 7,
                                                        height: 7,
                                                        borderRadius: '50%',
                                                        bgcolor: resultTone.dot,
                                                        flexShrink: 0,
                                                    }}
                                                />
                                                <Typography
                                                    variant="caption"
                                                    fontWeight={800}
                                                    sx={{
                                                        color: 'inherit',
                                                        lineHeight: 1.15,
                                                        whiteSpace: 'normal',
                                                    }}
                                                >
                                                    {result.label}
                                                </Typography>
                                            </Box>
                                            <Tooltip title="Уточнить применимость">
                                                <IconButton
                                                    size="small"
                                                    aria-label={`Уточнить применимость TYPE=${type.nsiTypeCode}`}
                                                    onClick={() => onOpenRequirementOverride(type)}
                                                >
                                                    <EditOutlinedIcon fontSize="inherit" />
                                                </IconButton>
                                            </Tooltip>
                                            {type.manualOverride && (
                                                <Typography
                                                    variant="caption"
                                                    color="info.main"
                                                    sx={{ width: '100%' }}
                                                >
                                                    ручное уточнение
                                                </Typography>
                                            )}
                                            </Stack>
                                        )
                                    },
                                },
                                {
                                    key: 'reason',
                                    header: 'Основание',
                                    render: (type) => {
                                        const evidenceSummary = type.evidence.slice(0, 2).map(
                                            (evidence) => [
                                                evidence.sheetName,
                                                evidence.rowNumber !== null
                                                    ? `строка ${evidence.rowNumber}`
                                                    : '',
                                                evidence.annualValue !== null
                                                    ? `годовой объем ${formatNumber(evidence.annualValue)}`
                                                    : '',
                                            ].filter(Boolean).join(' · '),
                                        ).join('\n')
                                        const reasonText = type.requirementReason
                                            || 'Безопасное правило применимости пока отсутствует.'
                                        const compactReason = compactRequirementReason(type)
                                        const compactMeta = compactRequirementMeta(type)
                                        const gisText = type.gisAvailable === true
                                            ? 'ГИС: доступен'
                                            : type.gisAvailable === false
                                                ? 'ГИС: не доступен'
                                                : 'ГИС: неизвестно'
                                        // Р9 (рекомендации 27.07, п.9.3): в «Основании» показываем
                                        // реальные основания обязательности из формы_1 (1–2 на вид).
                                        // Если форма старой редакции — прежняя краткая формулировка.
                                        // В6 (ВКС 31.07): у каждого основания подписан приоритет.
                                        const grounds = visibleGrounds(type)
                                        // Рекомендации 22.08.2026: «пусть будет пустое Основание».
                                        // Имя файла-источника — подпись к основанию, и одно оно
                                        // в пустой клетке читается как оставшийся хвост. Если
                                        // говорить в «Основании» нечего, клетка пуста целиком.
                                        const showMeta = Boolean(
                                            compactMeta && (grounds.length > 0 || compactReason),
                                        )
                                        const reasonTitle = [
                                            grounds.length > 0
                                                ? `Основание:\n${grounds.map(
                                                    (ground) => `• ${groundLevelView(ground.level).label}: ${ground.text}`,
                                                ).join('\n')}`
                                                : '',
                                            reasonText,
                                            type.requirementSource
                                                ? `Источник: ${type.requirementSource}`
                                                : '',
                                            gisText,
                                            type.manualOverride
                                                ? `Ручное уточнение: ${type.manualOverride.createdBy} · ${formatDateTime(type.manualOverride.createdAt)}`
                                                : '',
                                            type.manualOverride
                                                ? `Исходное правило: ${requirementStatusView(type.baseRequirementStatus).label}${type.baseRequirementSource ? ` · ${type.baseRequirementSource}` : ''}`
                                                : '',
                                            evidenceSummary
                                                ? `Подтверждения:\n${evidenceSummary}`
                                                : '',
                                        ].filter(Boolean).join('\n')
                                        return (
                                            <>
                                                {grounds.length > 0 ? (
                                                    grounds.map((ground) => {
                                                        // В6: приоритет виден рядом с текстом,
                                                        // расшифровка уровня — в подсказке чипа.
                                                        const level = groundLevelView(ground.level)
                                                        return (
                                                            <Stack
                                                                key={`${ground.level}-${ground.text}`}
                                                                direction="row"
                                                                spacing={0.6}
                                                                alignItems="flex-start"
                                                                sx={{ mb: 0.4 }}
                                                            >
                                                                <Tooltip title={level.description}>
                                                                    <Chip
                                                                        size="small"
                                                                        variant="outlined"
                                                                        label={ground.level}
                                                                        aria-label={level.label}
                                                                        sx={{
                                                                            height: 18,
                                                                            minWidth: 18,
                                                                            mt: 0.15,
                                                                            flexShrink: 0,
                                                                            fontVariantNumeric: 'tabular-nums',
                                                                            '& .MuiChip-label': {
                                                                                px: 0.5,
                                                                                fontSize: 11,
                                                                                fontWeight: 800,
                                                                            },
                                                                        }}
                                                                    />
                                                                </Tooltip>
                                                                <Typography
                                                                    variant="body2"
                                                                    fontWeight={600}
                                                                    title={reasonTitle}
                                                                    sx={{
                                                                        display: '-webkit-box',
                                                                        WebkitLineClamp: 2,
                                                                        WebkitBoxOrient: 'vertical',
                                                                        overflow: 'hidden',
                                                                        lineHeight: 1.25,
                                                                    }}
                                                                >
                                                                    {ground.text}
                                                                </Typography>
                                                            </Stack>
                                                        )
                                                    })
                                                ) : compactReason ? (
                                                    <Typography
                                                        variant="body2"
                                                        fontWeight={600}
                                                        title={reasonTitle}
                                                        sx={{
                                                            display: '-webkit-box',
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient: 'vertical',
                                                            overflow: 'hidden',
                                                            lineHeight: 1.25,
                                                        }}
                                                    >
                                                        {compactReason}
                                                    </Typography>
                                                ) : null}
                                                {showMeta && (
                                                    <Typography
                                                        variant="caption"
                                                        color="text.secondary"
                                                        title={reasonTitle}
                                                        sx={{
                                                            display: 'block',
                                                            mt: 0.35,
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                        }}
                                                    >
                                                        {compactMeta}
                                                    </Typography>
                                                )}
                                            </>
                                        )
                                    },
                                },
                            ] satisfies Array<IndicatorDetailColumn<InstitutionSemdType>>)}
                        />
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>
                    Закрыть
                </Button>
            </DialogActions>
        </Dialog>
    )
}
