import { type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
    Box,
    Button,
    CircularProgress,
    Divider,
    InputAdornment,
    MenuItem,
    Paper,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined'
import SearchIcon from '@mui/icons-material/Search'
import type {
    ReportingDashboard,
    ReportingDiagnosticFinding,
    ReportingOrganizationIndicatorValue,
} from '@shared/lib/reporting-api'
import { ReportingHexMap } from './ReportingHexMap'
import {
    formatPercent,
    indicatorMenuLabel,
    minzdravPercentColor,
    organizationCoveragePercent,
    organizationStatusView,
    semdTypeCountLabel,
    type OrganizationSortOrder,
} from '../lib/reporting-helpers'

/**
 * Р3, решение от 29.07.2026: кнопка справочника реализации СЭМД в региональной ГИС скрыта
 * с дашборда до появления данных от МИАЦ.
 *
 * Почему. Справочник заполняется только владельцем региональной ГИС, и в ТЗ по итогам ВКС
 * (раздел 6, пункт 7) он честно записан как недостающие данные. Для Курганской области он к
 * тому же малополезен: все 35 видов имеют регистрации в РЭМД, то есть ГИС технически умеет
 * всё, и пометка «не реализовано» противоречила бы факту. Пустая кнопка на демонстрации
 * только вызывает вопросы.
 *
 * ВЕРНУТЬ: поставить `true`. Сам справочник, его API и диалог никуда не делись — скрыт
 * только вход с дашборда, правок бэкенда возврат не требует.
 */
const SHOW_GIS_DIRECTORY_BUTTON = false

interface DashboardTabProps {
    dashboardSplitRef: RefObject<HTMLDivElement>
    organizationRowRefs: MutableRefObject<Map<string, HTMLElement>>
    organizationsPanelOpen: boolean
    organizationsPanelWidth: number
    organizationsPanelResizing: boolean
    dashboardLoading: boolean
    dashboard: ReportingDashboard
    selectedDiagnostics: ReportingDiagnosticFinding[]
    selectedOrganizationOid: string | null
    selectedPeriodId: string
    selectedDashboardIndicatorId: string
    organizationSearch: string
    organizationSortOrder: OrganizationSortOrder
    filteredOrganizations: ReportingOrganizationIndicatorValue[]
    onMapOrganizationChange: (organizationOid: string | null) => void
    onOpenInstitutionDetails: (organizationOid: string) => void
    onIndicatorChange: (indicatorId: string) => void
    onTogglePanel: () => void
    onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void
    onSearchChange: (value: string) => void
    onSortOrderChange: (order: OrganizationSortOrder) => void
    onToggleOrganization: (organizationOid: string) => void
    onOpenRegionSemdTypes: () => void
    onOpenSemdTypeRegistryTypes: () => void
    onOpenVolumeRatioGap: () => void
    onOpenMonthlyDynamics: () => void
    onOpenGisAvailability: () => void
    onOpenRegionDiagnostics: () => void
}

export function DashboardTab({
    dashboardSplitRef,
    organizationRowRefs,
    organizationsPanelOpen,
    organizationsPanelWidth,
    organizationsPanelResizing,
    dashboardLoading,
    dashboard,
    selectedDiagnostics,
    selectedOrganizationOid,
    selectedPeriodId,
    selectedDashboardIndicatorId,
    organizationSearch,
    organizationSortOrder,
    filteredOrganizations,
    onMapOrganizationChange,
    onOpenInstitutionDetails,
    onIndicatorChange,
    onTogglePanel,
    onResizeStart,
    onSearchChange,
    onSortOrderChange,
    onToggleOrganization,
    onOpenRegionSemdTypes,
    onOpenSemdTypeRegistryTypes,
    onOpenVolumeRatioGap,
    onOpenMonthlyDynamics,
    onOpenGisAvailability,
    onOpenRegionDiagnostics,
}: DashboardTabProps) {
    const regionSemdTypeCount = semdTypeCountLabel(dashboard.pilotRegionSemdTypes?.length)
    /**
     * Перечень видов по региону и признак ГИС относятся только к 6.1.3.2.7: у долей
     * к объёмам ТПГГ перечня видов нет. Признак берём из типа расчёта выбранного
     * показателя, а не из его идентификатора: показателей с этим расчётом станет
     * больше, и список id пришлось бы дописывать.
     */
    const isSemdTypeCoverageIndicator = dashboard.indicators.some(
        (indicator) => (
            indicator.id === selectedDashboardIndicatorId
            && indicator.calculationType === 'semd_type_coverage'
        ),
    )

    /**
     * Разбор недостачи есть у показателей-долей: перечня видов у них нет, зато
     * считается то, чего нет у перечней, — сколько случаев помощи прошло без СЭМД.
     */
    const isVolumeRatioIndicator = dashboard.indicators.some(
        (indicator) => (
            indicator.id === selectedDashboardIndicatorId
            && indicator.calculationType === 'semd_volume_ratio'
        ),
    )

    /**
     * Н20 (ВКС 15.08.2026): свод причин нужен и у долей — методолог просила показывать
     * перевыполнение накопительного плана «тем же выпадающим меню, как Илья делал
     * на самый первый показатель». Находки долей пишет их собственный расчёт.
     */
    const hasRegionDiagnostics = isSemdTypeCoverageIndicator || isVolumeRatioIndicator

    /** Свой перечень видов есть и у показателя «Виды СЭМД в РЭМД» — Н18.1. */
    const isSemdTypeRegistryIndicator = dashboard.indicators.some(
        (indicator) => (
            indicator.id === selectedDashboardIndicatorId
            && indicator.calculationType === 'semd_type_registry'
        ),
    )

    /**
     * Н17 (ВКС 15.08.2026): «небольшая расшифровка наименования нам сверху нужна —
     * я ориентируюсь, а вы уже не ориентируетесь, и вам непонятно, что это за
     * показатель». Над картой стоит только код вида «6.1.3.2.11».
     *
     * Тексты берутся из самого показателя (`numeratorLabel` / `denominatorLabel`),
     * а не пишутся в коде: их формулировал методолог, и правит их он же — через
     * справочник показателей, без правки фронта.
     */
    const selectedIndicator = dashboard.indicators.find(
        (indicator) => indicator.id === selectedDashboardIndicatorId,
    )

    return (
        <Box
            ref={dashboardSplitRef}
            sx={{
                display: 'grid',
                gridTemplateColumns: organizationsPanelOpen
                    ? { xs: '1fr', lg: `minmax(0, 1fr) 8px ${organizationsPanelWidth}px` }
                    : '1fr',
                gridTemplateRows: organizationsPanelOpen
                    ? { xs: 'minmax(0, 1fr) minmax(200px, 34%)', lg: 'minmax(0, 1fr)' }
                    : 'minmax(0, 1fr)',
                columnGap: { xs: 1, lg: 0 },
                rowGap: 1,
                alignItems: 'stretch',
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
            }}
        >
            <Paper
                variant="outlined"
                sx={{
                    borderRadius: 1,
                    overflow: 'hidden',
                    minWidth: 0,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Н17: расшифровка стоит отдельной строкой над картой, а не плашкой
                    поверх неё. Наложением она делила ряд с селектором и кнопками,
                    упиралась в 520 px и обрезалась многоточием всегда — тексты
                    методолога длиной в предложение туда не помещаются ни у одного
                    показателя. Просили же ровно обратного: чтобы было видно сразу,
                    без наведения. Здесь текст переносится на вторую строку.

                    С 22.08.2026 первой строкой стоит полное наименование показателя
                    из «Приложения 2»: «Вывести наименование показателя полностью,
                    подробности расчета оставьте». Раньше здесь начинался сразу
                    числитель («Наибольшее количество СЭМД по одному из видов…»),
                    и с названием показателя его было не сопоставить. Наименование
                    выводится текстом, а не подсказкой: всплывающий абзац перекрывал
                    карту при каждом случайном наведении. */}
                {selectedIndicator && (
                    <Box
                        sx={{
                            px: 1.25,
                            py: 0.6,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                            flexShrink: 0,
                        }}
                    >
                        <Typography
                            variant="caption"
                            sx={{ display: 'block', fontWeight: 700, lineHeight: 1.3 }}
                        >
                            {selectedIndicator.title}
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{
                                display: 'block',
                                color: 'text.secondary',
                                lineHeight: 1.3,
                                mt: 0.25,
                            }}
                        >
                            {selectedIndicator.numeratorLabel}
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{
                                display: 'block',
                                color: 'text.secondary',
                                lineHeight: 1.3,
                            }}
                        >
                            делится на: {selectedIndicator.denominatorLabel}
                        </Typography>
                    </Box>
                )}
                <Box
                    sx={{
                        position: 'relative',
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                    }}
                >
                    {dashboardLoading ? (
                        <Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }}>
                            <CircularProgress size={28} />
                        </Box>
                    ) : dashboard.organizations.length === 0 ? (
                        <Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', p: 3 }}>
                            <Typography variant="body2" color="text.secondary" textAlign="center">
                                Загрузите Excel-выгрузку РЭМД для выбранного периода.
                            </Typography>
                        </Box>
                    ) : (
                        <ReportingHexMap
                            organizations={dashboard.organizations}
                            diagnostics={selectedDiagnostics}
                            selectedOrganizationOid={selectedOrganizationOid}
                            onSelectedOrganizationChange={onMapOrganizationChange}
                            onOpenInstitutionDetails={
                                onOpenInstitutionDetails
                            }
                        />
                    )}
                    <Stack
                        direction="row"
                        spacing={0.5}
                        alignItems="center"
                        sx={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            zIndex: 4,
                        }}
                    >
                        <TextField
                            select
                            size="small"
                            value={selectedDashboardIndicatorId}
                            onChange={(event) => {
                                onIndicatorChange(event.target.value)
                            }}
                            disabled={!selectedPeriodId || dashboardLoading}
                            inputProps={{ 'aria-label': 'Показатель' }}
                            /* В закрытом виде поле высотой 36 px, две строки пункта
                               в него не помещаются — показываем одну подпись. */
                            SelectProps={{
                                renderValue: (value) => {
                                    const indicator = dashboard.indicators.find(
                                        (item) => item.id === value,
                                    )
                                    return indicator
                                        ? indicatorMenuLabel(indicator)
                                        : String(value ?? '')
                                },
                            }}
                            sx={{
                                width: 268,
                                bgcolor: 'rgba(255,255,255,0.96)',
                                borderRadius: 1,
                                '& .MuiInputBase-root': { height: 36 },
                            }}
                        >
                            {/* Н16 (ВКС 15.08.2026): в списке стояли одни коды, и между
                                чем переключаешься — непонятно. Слева номер «Приложения 2»,
                                на который методолог просила перейти, справа короткое имя.
                                Прежний код остаётся под именем: по нему идёт сверка
                                с Соглашением, и убирать его совсем нельзя. */}
                            {dashboard.indicators.map((indicator) => (
                                <MenuItem key={indicator.id} value={indicator.id}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography
                                            variant="body2"
                                            sx={{ fontWeight: 700, lineHeight: 1.2 }}
                                        >
                                            {indicatorMenuLabel(indicator)}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            sx={{ color: 'text.secondary', lineHeight: 1.2 }}
                                        >
                                            {indicator.code}
                                        </Typography>
                                    </Box>
                                </MenuItem>
                            ))}
                        </TextField>
                        {/* В13 (ВКС 31.07): в системе два списка видов — этот,
                            региональный, и перечень по конкретной МО в её карточке.
                            На демонстрации их спутали, поэтому в названии обеих кнопок
                            теперь явно сказано, чей это перечень. Число видов берётся
                            из самого перечня: с 07.08.2026 их 36, а не 35. */}
                        {isSemdTypeCoverageIndicator && (
                            <Tooltip title={`Перечень ${regionSemdTypeCount} целевых видов СЭМД по всему региону: какие из них зарегистрировала хотя бы одна МО. Перечень по конкретной МО открывается из её карточки.`}>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={onOpenRegionSemdTypes}
                                    disabled={!dashboard.pilotRegionSemdTypes}
                                    sx={{
                                        height: 36,
                                        px: 1.1,
                                        textTransform: 'none',
                                        fontWeight: 700,
                                        bgcolor: 'rgba(255,255,255,0.96)',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {regionSemdTypeCount} видов по региону
                                </Button>
                            </Tooltip>
                        )}
                        {/* Разбор недостачи у долей: перечня видов здесь нет, поэтому
                            вместо «каких видов не хватает» — сколько случаев помощи
                            прошло без СЭМД и у каких МО. */}
                        {isVolumeRatioIndicator && (
                            <Tooltip title="Сколько случаев оказания помощи прошло без СЭМД: разбор недостачи по медицинским организациям.">
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={onOpenVolumeRatioGap}
                                    disabled={dashboard.organizations.length === 0}
                                    sx={{
                                        height: 36,
                                        px: 1.1,
                                        textTransform: 'none',
                                        fontWeight: 700,
                                        bgcolor: 'rgba(255,255,255,0.96)',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    Разбор недостачи
                                </Button>
                            </Tooltip>
                        )}
                        {/* Д-9 (ВКС 24.08.2026). Кнопка стоит у долей и у показателя
                            «Виды СЭМД в РЭМД» — именно по ним методолог просила кривые.
                            У 6.1.3.2.7 её нет: там числитель — виды на ЕПГУ, помесячной
                            динамики у справочника не бывает. */}
                        {(isVolumeRatioIndicator || isSemdTypeRegistryIndicator) && (
                            <Tooltip title="Помесячные кривые: план терпрограммы против зарегистрированных СЭМД. Ровные кривые означают, что оформление встроено в работу; всплеск в конце года — что документы делают авралом.">
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={onOpenMonthlyDynamics}
                                    sx={{
                                        height: 36,
                                        px: 1.1,
                                        textTransform: 'none',
                                        fontWeight: 700,
                                        bgcolor: 'rgba(255,255,255,0.96)',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    Динамика по месяцам
                                </Button>
                            </Tooltip>
                        )}
                        {/* Н18.1 (ВКС 15.08.2026): методолог насчитала 74 вида против
                            наших 70 и просила показать, «что не попадает в расчёт».
                            Разбор отвечает на это списком, а не перепиской. */}
                        {isSemdTypeRegistryIndicator && (
                            <Tooltip title="Разбор Перечня № 5пр по региону: какие виды СЭМД регистрируются, каких не хватает и какие регистрируются мимо Перечня.">
                                <span>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        onClick={onOpenSemdTypeRegistryTypes}
                                        disabled={!dashboard.semdTypeRegistryTypes}
                                        sx={{
                                            height: 36,
                                            px: 1.1,
                                            textTransform: 'none',
                                            fontWeight: 700,
                                            bgcolor: 'rgba(255,255,255,0.96)',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        Разбор по видам
                                    </Button>
                                </span>
                            </Tooltip>
                        )}
                        {SHOW_GIS_DIRECTORY_BUTTON
                            && isSemdTypeCoverageIndicator && (
                            <Tooltip title="Справочник реализации видов СЭМД в региональной ГИС (Р3)">
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={onOpenGisAvailability}
                                    sx={{
                                        height: 36,
                                        px: 1.1,
                                        textTransform: 'none',
                                        fontWeight: 700,
                                        bgcolor: 'rgba(255,255,255,0.96)',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    ГИС
                                </Button>
                            </Tooltip>
                        )}
                        {hasRegionDiagnostics && (
                            <Tooltip title="Свод причин по всему региону: одна причина — один раз, со списком затронутых МО и видов СЭМД (FR-11)">
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={onOpenRegionDiagnostics}
                                    disabled={!selectedPeriodId}
                                    sx={{
                                        height: 36,
                                        px: 1.1,
                                        textTransform: 'none',
                                        fontWeight: 700,
                                        bgcolor: 'rgba(255,255,255,0.96)',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    Причины по региону
                                </Button>
                            </Tooltip>
                        )}
                        <Tooltip title={organizationsPanelOpen ? 'Скрыть список МО справа' : 'Показать список МО справа'}>
                            <Button
                                size="small"
                                variant={organizationsPanelOpen ? 'outlined' : 'contained'}
                                startIcon={organizationsPanelOpen
                                    ? <ChevronRightIcon fontSize="small" />
                                    : <ViewSidebarOutlinedIcon fontSize="small" />}
                                onClick={onTogglePanel}
                                aria-label={organizationsPanelOpen ? 'Скрыть список МО' : 'Показать список МО'}
                                sx={{
                                    minWidth: organizationsPanelOpen ? 118 : 152,
                                    height: 36,
                                    px: 1.1,
                                    textTransform: 'none',
                                    fontWeight: 700,
                                    bgcolor: organizationsPanelOpen ? 'rgba(255,255,255,0.96)' : 'primary.main',
                                    boxShadow: organizationsPanelOpen ? 'none' : 2,
                                    '&:hover': {
                                        bgcolor: organizationsPanelOpen ? '#fff' : 'primary.dark',
                                    },
                                }}
                            >
                                {organizationsPanelOpen ? 'Скрыть список' : 'Показать список МО'}
                            </Button>
                        </Tooltip>
                    </Stack>
                </Box>
            </Paper>

            {organizationsPanelOpen && (
                <Box
                    role="separator"
                    aria-label="Изменить ширину списка МО"
                    aria-orientation="vertical"
                    onPointerDown={onResizeStart}
                    sx={{
                        display: { xs: 'none', lg: 'flex' },
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'col-resize',
                        bgcolor: organizationsPanelResizing ? 'primary.50' : 'transparent',
                        transition: organizationsPanelResizing ? 'none' : 'background-color 0.15s',
                        '&::after': {
                            content: '""',
                            width: 2,
                            height: 48,
                            borderRadius: 2,
                            bgcolor: organizationsPanelResizing ? 'primary.main' : 'divider',
                            transition: organizationsPanelResizing ? 'none' : 'background-color 0.15s',
                        },
                        '&:hover': {
                            bgcolor: 'action.hover',
                            '&::after': { bgcolor: 'primary.main' },
                        },
                    }}
                />
            )}

            {organizationsPanelOpen && (
                <Paper
                    variant="outlined"
                    sx={{
                        borderRadius: 1,
                        overflow: 'hidden',
                        minWidth: 0,
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                >
                    <Box
                        sx={{
                            px: 1,
                            py: 0.75,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 1,
                            flexShrink: 0,
                        }}
                    >
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle2" fontWeight={700}>
                                Медицинские организации
                            </Typography>
                        </Box>
                        <Tooltip title="Скрыть список МО">
                            <Button
                                size="small"
                                variant="text"
                                startIcon={<ChevronRightIcon fontSize="small" />}
                                onClick={onTogglePanel}
                                aria-label="Скрыть список МО"
                                sx={{
                                    minWidth: 0,
                                    px: 0.75,
                                    textTransform: 'none',
                                    fontWeight: 700,
                                }}
                            >
                                Скрыть
                            </Button>
                        </Tooltip>
                    </Box>
                    <Box sx={{ px: 1, pb: 0.75, flexShrink: 0 }}>
                        <TextField
                            fullWidth
                            size="small"
                            value={organizationSearch}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="Найти МО"
                            inputProps={{ 'aria-label': 'Поиск медицинской организации' }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                ),
                            }}
                            sx={{ '& .MuiInputBase-root': { height: 34 } }}
                        />
                        {/* Рекомендация методолога от 03.08.2026: фильтры «Все / Выполняется /
                            Не выполняется» убраны — «не вижу ситуаций их применения (пока)».
                            Состояние фильтра в ReportingPage оставлено: список МО строится
                            через него, а значение теперь всегда «все». */}
                        {/* В3 (ВКС 31.07): по умолчанию список идёт от большего процента
                            к меньшему; переключатель оставлен, потому что порядок по
                            названию нужен, когда МО ищут глазами, а не по величине. */}
                        <TextField
                            select
                            size="small"
                            fullWidth
                            value={organizationSortOrder}
                            onChange={(event) => {
                                onSortOrderChange(event.target.value as OrganizationSortOrder)
                            }}
                            label="Сортировка"
                            inputProps={{ 'aria-label': 'Сортировка списка МО' }}
                            sx={{ mt: 0.75, '& .MuiInputBase-root': { height: 34 } }}
                        >
                            <MenuItem value="percent_desc">Процент: по убыванию</MenuItem>
                            <MenuItem value="percent_asc">Процент: по возрастанию</MenuItem>
                            <MenuItem value="name">По названию</MenuItem>
                        </TextField>
                    </Box>
                    <Divider />
                    {dashboardLoading ? (
                        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : (
                        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1, pb: 1 }}>
                            {filteredOrganizations.length === 0 ? (
                                <Box sx={{ py: 3 }}>
                                    <Typography variant="body2" color="text.secondary" textAlign="center">
                                        МО не найдены
                                    </Typography>
                                </Box>
                            ) : (
                                <Stack spacing={0.55} sx={{ py: 0.75 }}>
                                    {filteredOrganizations.map((organization) => {
                                        const status = organizationStatusView(organization)
                                        const isSelected = selectedOrganizationOid === organization.organizationOid
                                        const percentValue = organizationCoveragePercent(organization)
                                        const progressValue = percentValue === null || typeof percentValue === 'undefined'
                                            ? null
                                            : Math.max(0, Math.min(100, Number(percentValue)))
                                        const progressLabel = progressValue === null
                                            ? '—'
                                            : formatPercent(progressValue)
                                        // Рекомендации 27.07, п.5: полоса выполнения красится той же
                                        // шкалой Минздрава, что и плитки МО на карте.
                                        const progressColor = progressValue === null
                                            ? '#9ca3af'
                                            : minzdravPercentColor(progressValue)
                                        const statusHint = organization.calculationDetails?.isPreliminary === true
                                            ? 'предварительно'
                                            : status.label
                                        return (
                                            <Box
                                                key={`${organization.indicatorId}-${organization.organizationOid}`}
                                                component="button"
                                                type="button"
                                                ref={(element: HTMLButtonElement | null) => {
                                                    if (element) {
                                                        organizationRowRefs.current.set(organization.organizationOid, element)
                                                    } else {
                                                        organizationRowRefs.current.delete(organization.organizationOid)
                                                    }
                                                }}
                                                aria-label={`Выбрать медицинскую организацию ${organization.organizationName || organization.organizationFullName}`}
                                                title={`${organization.organizationFullName || organization.organizationName}: ${progressLabel} · ${statusHint}`}
                                                onClick={() => onToggleOrganization(organization.organizationOid)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault()
                                                        onToggleOrganization(organization.organizationOid)
                                                    }
                                                }}
                                                sx={{
                                                    display: 'block',
                                                    width: '100%',
                                                    px: 0.85,
                                                    py: 0.75,
                                                    border: '1px solid',
                                                    borderColor: isSelected ? 'primary.main' : 'transparent',
                                                    borderRadius: 1.25,
                                                    bgcolor: isSelected ? 'primary.50' : 'transparent',
                                                    color: 'text.primary',
                                                    textAlign: 'left',
                                                    cursor: 'pointer',
                                                    font: 'inherit',
                                                    '&:hover': {
                                                        bgcolor: isSelected ? 'primary.100' : 'action.hover',
                                                    },
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                        gap: 0.75,
                                                        minWidth: 0,
                                                    }}
                                                >
                                                    <Typography
                                                        variant="body2"
                                                        fontWeight={700}
                                                        sx={{
                                                            flex: 1,
                                                            minWidth: 0,
                                                            fontSize: '0.76rem',
                                                            lineHeight: 1.16,
                                                            overflow: 'hidden',
                                                            display: '-webkit-box',
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient: 'vertical',
                                                        }}
                                                    >
                                                        {/* Рекомендация методолога от 24.08.2026: «по длинному
                                                            названию сразу не понятно, что это за МО». В колонке
                                                            шириной 250 px полное наименование обрезалось
                                                            на «ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ УЧРЕЖДЕНИЕ "МЕЖРАЙОННАЯ…»
                                                            — то есть на общей для всех части, а различающая
                                                            до экрана не доходила. Здесь краткое наименование
                                                            по ФРМО; полное осталось в подсказке и в поиске. */}
                                                        {organization.organizationName || organization.organizationFullName}
                                                    </Typography>
                                                    <Typography
                                                        variant="body2"
                                                        fontWeight={800}
                                                        textAlign="right"
                                                        sx={{
                                                            width: 54,
                                                            flexShrink: 0,
                                                            whiteSpace: 'nowrap',
                                                            fontSize: '0.76rem',
                                                            lineHeight: 1.15,
                                                            fontVariantNumeric: 'tabular-nums',
                                                        }}
                                                    >
                                                        {progressLabel}
                                                    </Typography>
                                                </Box>
                                                <Box
                                                    sx={{
                                                        mt: 0.55,
                                                        height: 9,
                                                        borderRadius: 999,
                                                        bgcolor: '#d1d5db',
                                                        overflow: 'hidden',
                                                        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.04)',
                                                    }}
                                                >
                                                    <Box
                                                        sx={{
                                                            width: `${progressValue ?? 0}%`,
                                                            height: '100%',
                                                            borderRadius: 999,
                                                            bgcolor: progressColor,
                                                            transition: 'width 0.2s ease',
                                                        }}
                                                    />
                                                </Box>
                                            </Box>
                                        )
                                    })}
                                </Stack>
                            )}
                        </Box>
                    )}
                </Paper>
            )}
        </Box>
    )
}
