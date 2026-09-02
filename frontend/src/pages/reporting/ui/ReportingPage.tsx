import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Alert,
    Box,
    Button,
    CircularProgress,
    Container,
    Divider,
    IconButton,
    ListItemText,
    ListSubheader,
    Menu,
    MenuItem,
    Paper,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import {
    cancelApplicabilityMatrixPreview,
    cancelRemdWorkbookPreview,
    cancelTpggWorkbookPreview,
    cancelTargetPlanPreview,
    confirmApplicabilityMatrix,
    confirmRemdWorkbook,
    confirmTpggWorkbook,
    confirmTargetPlan,
    createReportingPeriod,
    downloadIndicatorFactsExport,
    downloadReportingImportSource,
    getApplicabilityMatrixPreview,
    getReportingDashboard,
    recalculatePilotIndicator,
    getReportingDiagnostics,
    getReportingImports,
    getReportingSummary,
    getPilotInstitutionDetails,
    getPilotInstitutionRequirementHistory,
    getRemdWorkbookPreview,
    getTpggWorkbookPreview,
    getTargetPlanPreview,
    importEmdNsiCsv,
    importEpguDocVisibility,
    importFrmr,
    importPerechen5pr,
    importRemdNumerator,
    importRemdInterval,
    importTpggExecution,
    importInclusionRegister,
    previewRemdWorkbook,
    previewApplicabilityMatrix,
    getReportingPeriodDeletionPreview,
    deleteReportingPeriod,
    previewOrganizationDirectory,
    confirmOrganizationDirectory,
    cancelOrganizationDirectoryPreview,
    previewTpggWorkbook,
    previewTargetPlan,
    setPilotInstitutionRequirement,
    upsertReportingValue,
    type ApplicabilityMatrixConfirmResult,
    type ApplicabilityMatrixPreviewResult,
    type ReportingPeriodDeletionPreview,
    type ReportingPeriodDeletionResult,
    type OrganizationDirectoryConfirmResult,
    type OrganizationDirectoryPreviewResult,
    type ReportingDashboard,
    type ReportingDiagnosticFinding,
    type ReportingIndicator,
    type ReportingImportMode,
    type ReportingImportRun,
    type ReportingSummary,
    type RemdWorkbookConfirmResult,
    type RemdWorkbookPreviewResult,
    type EmdNsiImportResult,
    type EpguDocVisibilityImportResult,
    type Perechen5prImportResult,
    type RemdNumeratorImportResult,
    type RemdIntervalImportResult,
    type TpggExecutionImportResult,
    type InclusionRegisterImportResult,
    type FrmrImportResult,
    type PilotInstitutionDetails,
    type PilotRequirementOverrideHistoryEntry,
    type TpggWorkbookConfirmResult,
    type TpggWorkbookPreviewResult,
    type TargetPlanConfirmResult,
    type TargetPlanPreviewResult,
} from '@shared/lib/reporting-api'
import { IndicatorsTab } from './IndicatorsTab'
import { DashboardTab } from './DashboardTab'
import { HistoryTab } from './HistoryTab'
import { OrganizationsTab } from './OrganizationsTab'
import { SourcesReferenceTab } from './SourcesReferenceTab'
import { RegionSemdTypesDialog } from './RegionSemdTypesDialog'
import { SemdTypeRegistryDialog } from './SemdTypeRegistryDialog'
import { MonthlyDynamicsDialog } from './MonthlyDynamicsDialog'
import { VolumeRatioGapDialog } from './VolumeRatioGapDialog'
import { GisAvailabilityDialog } from './GisAvailabilityDialog'
import { DiagnosticFindingsDialog } from './DiagnosticFindingsDialog'
import { InstitutionDetailsDialog } from './InstitutionDetailsDialog'
import { RequirementHistoryDialog } from './RequirementHistoryDialog'
import { RequirementOverrideDialog } from './RequirementOverrideDialog'
import { RemdImportPreviewDialog } from './RemdImportPreviewDialog'
import { TpggImportPreviewDialog } from './TpggImportPreviewDialog'
import { ApplicabilityMatrixPreviewDialog } from './ApplicabilityMatrixPreviewDialog'
import { OrganizationDirectoryPreviewDialog } from './OrganizationDirectoryPreviewDialog'
import { DeletePeriodDialog } from './DeletePeriodDialog'
import { TargetPlanPreviewDialog } from './TargetPlanPreviewDialog'
import { PeriodDialog } from './PeriodDialog'
import { EditIndicatorValueDialog } from './EditIndicatorValueDialog'
import {
    buildDefaultPeriodForm,
    compareInstitutionTypes,
    emptyDashboard,
    emptySummary,
    emptyValueForm,
    getErrorMessage,
    indicatorMenuLabel,
    formatNumber,
    isInstitutionTypeProblem,
    monthName,
    sortOrganizations,
    valueToForm,
    DEFAULT_ORGANIZATION_SORT,
    type InstitutionDetailsFilter,
    type OrganizationSortOrder,
    type PeriodForm,
    type ValueForm,
} from '../lib/reporting-helpers'

const importStepSx = {
    width: 24,
    height: 24,
    // Пункт прижат к верху, поэтому кружок надо оптически посадить
    // на первую строку заголовка, а не на середину всего пункта.
    mt: '-2px',
    mr: 1.25,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
    fontSize: 12,
    fontWeight: 700,
}

/**
 * MenuItem в MUI по умолчанию `white-space: nowrap`: длинная подпись
 * не переносится, а уезжает под край меню и обрезается. Подписи здесь
 * объясняют, что именно грузится и на что влияет, — обрезать их нельзя.
 */
const importMenuItemSx = {
    alignItems: 'flex-start',
    whiteSpace: 'normal',
    py: 0.75,
}

/**
 * Пустышки вместо точки статуса и номера шага.
 *
 * Без них заголовки трёх групп начинаются с разного отступа: у нумерованных
 * шагов слева точка и кружок с номером, у резервных загрузок нет ни того,
 * ни другого. Штатный `inset` у ListItemText даёт свой отступ, не совпадающий
 * ни с одним из них, — отсюда лесенка на скриншоте.
 */
const importDotSpacerSx = { width: 9, mr: 1, flex: '0 0 auto' }
const importStepSpacerSx = { width: 24, mr: 1.25, flex: '0 0 auto' }

/**
 * Жёсткая `lineHeight: 32px` у заголовка группы держит одну строку, а вторая
 * при переносе налезает на первую. Обычная высота строки с отступами
 * переносится корректно.
 */
const importGroupHeaderSx = {
    lineHeight: 1.5,
    py: 0.75,
    fontWeight: 700,
    whiteSpace: 'normal',
}

export const ReportingPage = () => {
    const [summary, setSummary] = useState<ReportingSummary>(emptySummary)
    const [dashboard, setDashboard] = useState<ReportingDashboard>(emptyDashboard)
    const [imports, setImports] = useState<ReportingImportRun[]>([])
    const [tab, setTab] = useState<'indicators' | 'dashboard' | 'history' | 'organizations' | 'sources'>('indicators')
    const [selectedPeriodId, setSelectedPeriodId] = useState<string>('')
    const [selectedDashboardIndicatorId, setSelectedDashboardIndicatorId] = useState<string>('')
    const [loading, setLoading] = useState(true)
    const [dashboardLoading, setDashboardLoading] = useState(false)
    const [selectedDiagnostics, setSelectedDiagnostics] = useState<ReportingDiagnosticFinding[]>([])
    const [institutionDetails, setInstitutionDetails] = useState<PilotInstitutionDetails | null>(null)
    const [institutionDetailsLoading, setInstitutionDetailsLoading] = useState(false)
    const [institutionDetailsFilter, setInstitutionDetailsFilter] = useState<InstitutionDetailsFilter>('all')
    const [institutionDetailsSearch, setInstitutionDetailsSearch] = useState('')
    const [editingInstitutionType, setEditingInstitutionType] = useState<
        PilotInstitutionDetails['types'][number] | null
    >(null)
    const [requirementOverrideStatus, setRequirementOverrideStatus] = useState<
        'required' | 'not_required'
    >('required')
    const [requirementOverrideReason, setRequirementOverrideReason] = useState('')
    const [requirementOverrideSaving, setRequirementOverrideSaving] = useState(false)
    const [requirementOverrideError, setRequirementOverrideError] = useState<string | null>(null)
    const [requirementHistoryOpen, setRequirementHistoryOpen] = useState(false)
    const [requirementHistory, setRequirementHistory] = useState<PilotRequirementOverrideHistoryEntry[]>([])
    const [requirementHistoryLoading, setRequirementHistoryLoading] = useState(false)
    const [requirementHistoryError, setRequirementHistoryError] = useState<string | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [downloadingImportId, setDownloadingImportId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [importing, setImporting] = useState(false)
    const [importMode, setImportMode] = useState<ReportingImportMode>('merge')
    const [importMenuAnchorEl, setImportMenuAnchorEl] = useState<HTMLElement | null>(null)
    const [organizationsPanelOpen, setOrganizationsPanelOpen] = useState(true)
    const [organizationsPanelWidth, setOrganizationsPanelWidth] = useState(360)
    const [organizationsPanelResizing, setOrganizationsPanelResizing] = useState(false)
    const [selectedOrganizationOid, setSelectedOrganizationOid] = useState<string | null>(null)
    const [organizationSearch, setOrganizationSearch] = useState('')
    const [organizationSortOrder, setOrganizationSortOrder] = useState<OrganizationSortOrder>(
        DEFAULT_ORGANIZATION_SORT,
    )
    const [regionSemdTypesOpen, setRegionSemdTypesOpen] = useState(false)
    const [semdTypeRegistryOpen, setSemdTypeRegistryOpen] = useState(false)
    const [volumeRatioGapOpen, setVolumeRatioGapOpen] = useState(false)
    const [monthlyDynamicsOpen, setMonthlyDynamicsOpen] = useState(false)
    const [gisAvailabilityOpen, setGisAvailabilityOpen] = useState(false)
    // FR-11: региональный свод причин — одна причина показывается один раз со списком
    // затронутых МО, вместо десятков одинаковых карточек в разных МО.
    const [regionDiagnostics, setRegionDiagnostics] = useState<ReportingDiagnosticFinding[]>([])
    const [regionDiagnosticsOpen, setRegionDiagnosticsOpen] = useState(false)
    const [exportingPilotTargetPlan, setExportingPilotTargetPlan] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [importPreview, setImportPreview] = useState<RemdWorkbookPreviewResult | null>(null)
    const [importResult, setImportResult] = useState<RemdWorkbookConfirmResult | null>(null)
    const [emdNsiImportResult, setEmdNsiImportResult] = useState<EmdNsiImportResult | null>(null)
    const [epguDocVisibilityImportResult, setEpguDocVisibilityImportResult] =
        useState<EpguDocVisibilityImportResult | null>(null)
    const [perechen5prImportResult, setPerechen5prImportResult] =
        useState<Perechen5prImportResult | null>(null)
    const [remdNumeratorImportResult, setRemdNumeratorImportResult] =
        useState<RemdNumeratorImportResult | null>(null)
    /**
     * Результаты по каждой выгрузке РЭМД за интервал. Массив, а не одна запись:
     * методолог прислала тринадцать файлов, и грузить их по одному, каждый раз
     * дожидаясь исчезновения плашки, — работа на полчаса.
     */
    const [remdIntervalImportResults, setRemdIntervalImportResults] =
        useState<RemdIntervalImportResult[] | null>(null)
    /** Результаты по каждому перечню входимости: их семь. */
    const [inclusionRegisterResults, setInclusionRegisterResults] =
        useState<InclusionRegisterImportResult[] | null>(null)
    /** Результаты по каждому файлу исполнения ТПГГ: их шестнадцать. */
    const [tpggExecutionResults, setTpggExecutionResults] =
        useState<TpggExecutionImportResult[] | null>(null)
    const [frmrImportResult, setFrmrImportResult] = useState<FrmrImportResult | null>(null)
    const [tpggImportPreview, setTpggImportPreview] = useState<TpggWorkbookPreviewResult | null>(null)
    const [tpggImportResult, setTpggImportResult] = useState<TpggWorkbookConfirmResult | null>(null)
    const [organizationDirectoryPreview, setOrganizationDirectoryPreview] =
        useState<OrganizationDirectoryPreviewResult | null>(null)
    const [organizationDirectoryResult, setOrganizationDirectoryResult] =
        useState<OrganizationDirectoryConfirmResult | null>(null)
    const [applicabilityMatrixPreview, setApplicabilityMatrixPreview] =
        useState<ApplicabilityMatrixPreviewResult | null>(null)
    const [applicabilityMatrixResult, setApplicabilityMatrixResult] =
        useState<ApplicabilityMatrixConfirmResult | null>(null)
    const [targetPlanPreview, setTargetPlanPreview] = useState<TargetPlanPreviewResult | null>(null)
    const [targetPlanResult, setTargetPlanResult] = useState<TargetPlanConfirmResult | null>(null)
    const [editingIndicator, setEditingIndicator] = useState<ReportingIndicator | null>(null)
    const [valueForm, setValueForm] = useState<ValueForm>(emptyValueForm)
    const [periodDialogOpen, setPeriodDialogOpen] = useState(false)
    const [deletePeriodPreview, setDeletePeriodPreview] =
        useState<ReportingPeriodDeletionPreview | null>(null)
    const [deletingPeriod, setDeletingPeriod] = useState(false)
    const [deletedPeriodResult, setDeletedPeriodResult] =
        useState<ReportingPeriodDeletionResult | null>(null)
    const [periodForm, setPeriodForm] = useState<PeriodForm>(() => buildDefaultPeriodForm())
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const emdNsiFileInputRef = useRef<HTMLInputElement | null>(null)
    const epguDocVisibilityFileInputRef = useRef<HTMLInputElement | null>(null)
    const perechen5prFileInputRef = useRef<HTMLInputElement | null>(null)
    const remdNumeratorFileInputRef = useRef<HTMLInputElement | null>(null)
    const remdIntervalFileInputRef = useRef<HTMLInputElement | null>(null)
    const tpggExecutionFileInputRef = useRef<HTMLInputElement | null>(null)
    const inclusionRegisterFileInputRef = useRef<HTMLInputElement | null>(null)
    const frmrFileInputRef = useRef<HTMLInputElement | null>(null)
    const tpggFileInputRef = useRef<HTMLInputElement | null>(null)
    const organizationDirectoryFileInputRef = useRef<HTMLInputElement | null>(null)
    const applicabilityMatrixFileInputRef = useRef<HTMLInputElement | null>(null)
    const targetPlanFileInputRef = useRef<HTMLInputElement | null>(null)
    const legacyImportModeRef = useRef<ReportingImportMode>('merge')
    const dashboardSplitRef = useRef<HTMLDivElement | null>(null)
    const organizationsResizeStartRef = useRef<{ clientX: number; width: number } | null>(null)
    const organizationRowRefs = useRef(new Map<string, HTMLElement>())

    const valueByIndicatorId = useMemo(() => {
        return new Map(summary.values.map((value) => [value.indicatorId, value]))
    }, [summary.values])

    /**
     * До 13.08.2026 список резался до одного 6.1.3.2.7: остальные показатели стояли
     * пустыми, и на демонстрации их нечем было объяснить. Теперь считаются шесть —
     * 6.1.3.2.7, доли к объёмам ТПГГ 6.1.3.2.8–6.1.3.2.11 и показатель 27, — и прятать
     * их нельзя. Порядок задаёт бэкенд полем sort_order.
     */
    const rows = useMemo(() => {
        return summary.indicators.map((indicator) => ({
            indicator,
            value: valueByIndicatorId.get(indicator.id) ?? null,
        }))
    }, [summary.indicators, valueByIndicatorId])

    const selectedPeriod = useMemo(
        () => summary.periods.find((period) => period.id === selectedPeriodId) ?? null,
        [selectedPeriodId, summary.periods],
    )

    const filteredOrganizations = useMemo(() => {
        const query = organizationSearch.trim().toLocaleLowerCase('ru-RU')
        const matched = dashboard.organizations.filter((organization) => {
            if (!query) return true
            return [
                organization.organizationName,
                organization.organizationFullName,
                organization.organizationOid,
            ]
                .join(' ')
                .toLocaleLowerCase('ru-RU')
                .includes(query)
        })
        // В3 (ВКС 31.07): по умолчанию — от большего процента к меньшему.
        // С бэкенда список приходит по названию, поэтому сортируем здесь.
        return sortOrganizations(matched, organizationSortOrder)
    }, [
        dashboard.organizations,
        organizationSearch,
        organizationSortOrder,
    ])

    // Р7: светофор источников — какие из 8 файлов уже успешно загружены в период.
    // ТПГГ добавлен шагом 6 (до матрицы применимости): её импортёр читает объёмы ТПГГ
    // в момент подтверждения, поэтому без загруженной терпрограммы применимость
    // видов с основанием «утверждено госзаданием» считается по одному ФРМО.
    const loadedSourceTypes = useMemo(
        () => new Set(
            imports
                .filter((run) => run.status === 'completed')
                .map((run) => run.sourceType),
        ),
        [imports],
    )
    /**
     * Точка состояния источника. Красная у незагруженного означает «расчёт неполный»:
     * с 07.08.2026 все девять шагов обязательны (Н13), каждый пропущенный ломает
     * какой-нибудь знаменатель.
     *
     * Серая вернулась 25.08.2026 вместе с первым по-настоящему необязательным
     * источником — помесячными выгрузками РЭМД. Без них показатели считаются
     * полностью, не строится только кривая динамики, и красная точка звала бы
     * чинить то, что не сломано.
     */
    const renderSourceStatusDot = (sourceType: string, optional = false) => {
        const loaded = loadedSourceTypes.has(sourceType)
        const missingColor = optional ? 'action.disabled' : 'error.main'
        return (
            <Box
                component="span"
                title={
                    loaded
                        ? 'Файл загружен'
                        : optional
                            ? 'Файл не загружен; на расчёт показателей не влияет'
                            : 'Файл не загружен'
                }
                sx={{
                    width: 9,
                    height: 9,
                    // Пункт меню прижат к верху ради переноса подписей,
                    // поэтому точка опускается на середину первой строки.
                    mt: '6px',
                    mr: 1,
                    borderRadius: '50%',
                    flexShrink: 0,
                    bgcolor: loaded ? 'success.main' : missingColor,
                }}
            />
        )
    }

    const filteredInstitutionTypes = useMemo(() => {
        let types = institutionDetails?.types ?? []
        const query = institutionDetailsSearch.trim().toLocaleLowerCase('ru-RU')

        if (query) {
            types = types.filter((type) => (
                [
                    type.nsiTypeCode,
                    type.name,
                    type.officialName5pr ?? '',
                    type.documentFormat,
                    type.requirementReason,
                    type.requirementSource,
                    type.manualOverride?.reason ?? '',
                    // Р9: поиск «по основанию» должен находить и текст основания обязательности.
                    ...(type.requirementGrounds ?? []).map((ground) => ground.text),
                ]
                    .join(' ')
                    .toLocaleLowerCase('ru-RU')
                    .includes(query)
            ))
        }

        if (institutionDetailsFilter === 'required') {
            return types.filter(
                (type) => type.requirementStatus === 'required',
            ).sort(compareInstitutionTypes)
        }
        if (institutionDetailsFilter === 'manual') {
            return types.filter(
                (type) => type.manualOverride !== null,
            ).sort(compareInstitutionTypes)
        }
        if (institutionDetailsFilter === 'unknown') {
            return types.filter(
                (type) =>
                    type.requirementStatus === 'unknown'
                    || type.requirementStatus === 'missing',
            ).sort(compareInstitutionTypes)
        }
        if (institutionDetailsFilter === 'problem') {
            return types.filter(isInstitutionTypeProblem)
                .sort(compareInstitutionTypes)
        }
        return [...types].sort(compareInstitutionTypes)
    }, [
        institutionDetails,
        institutionDetailsFilter,
        institutionDetailsSearch,
    ])

    const loadSummary = useCallback(async (periodId?: string | null) => {
        setLoading(true)
        setError(null)
        try {
            const data = await getReportingSummary(periodId)
            setSummary(data)
            setSelectedPeriodId(data.selectedPeriodId ?? '')
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setLoading(false)
        }
    }, [])

    const loadDashboard = useCallback(async (periodId?: string | null, indicatorId?: string | null) => {
        setDashboardLoading(true)
        setError(null)
        try {
            const data = await getReportingDashboard(periodId, indicatorId)
            setDashboard(data)
            setSelectedDashboardIndicatorId(data.selectedIndicatorId ?? '')
            setSelectedOrganizationOid((current) => (
                current && data.organizations.some(
                    (organization) => organization.organizationOid === current,
                )
                    ? current
                    : null
            ))
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setDashboardLoading(false)
        }
    }, [])

    const loadImports = useCallback(async (periodId?: string | null) => {
        setHistoryLoading(true)
        setError(null)
        try {
            setImports(await getReportingImports(periodId))
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setHistoryLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadSummary()
    }, [loadSummary])

    useEffect(() => {
        if (!importResult) return
        const timer = window.setTimeout(() => setImportResult(null), 5000)
        return () => window.clearTimeout(timer)
    }, [importResult])

    useEffect(() => {
        if (!emdNsiImportResult) return
        const timer = window.setTimeout(() => setEmdNsiImportResult(null), 5000)
        return () => window.clearTimeout(timer)
    }, [emdNsiImportResult])

    useEffect(() => {
        if (!epguDocVisibilityImportResult) return
        const timer = window.setTimeout(
            () => setEpguDocVisibilityImportResult(null),
            5000,
        )
        return () => window.clearTimeout(timer)
    }, [epguDocVisibilityImportResult])

    useEffect(() => {
        if (!perechen5prImportResult) return
        const timer = window.setTimeout(
            () => setPerechen5prImportResult(null),
            5000,
        )
        return () => window.clearTimeout(timer)
    }, [perechen5prImportResult])

    useEffect(() => {
        if (!remdNumeratorImportResult) return
        const timer = window.setTimeout(
            () => setRemdNumeratorImportResult(null),
            5000,
        )
        return () => window.clearTimeout(timer)
    }, [remdNumeratorImportResult])

    useEffect(() => {
        if (!inclusionRegisterResults) return
        const timer = window.setTimeout(() => setInclusionRegisterResults(null), 15000)
        return () => window.clearTimeout(timer)
    }, [inclusionRegisterResults])

    useEffect(() => {
        if (!tpggExecutionResults) return
        const timer = window.setTimeout(() => setTpggExecutionResults(null), 15000)
        return () => window.clearTimeout(timer)
    }, [tpggExecutionResults])

    useEffect(() => {
        if (!remdIntervalImportResults) return
        // Дольше прочих: после загрузки семи файлов сводку читают, а не проглядывают.
        const timer = window.setTimeout(
            () => setRemdIntervalImportResults(null),
            15000,
        )
        return () => window.clearTimeout(timer)
    }, [remdIntervalImportResults])

    useEffect(() => {
        if (!frmrImportResult) return
        const timer = window.setTimeout(() => setFrmrImportResult(null), 5000)
        return () => window.clearTimeout(timer)
    }, [frmrImportResult])

    useEffect(() => {
        if (!tpggImportResult) return
        const timer = window.setTimeout(() => setTpggImportResult(null), 5000)
        return () => window.clearTimeout(timer)
    }, [tpggImportResult])

    useEffect(() => {
        if (!applicabilityMatrixResult) return
        const timer = window.setTimeout(() => setApplicabilityMatrixResult(null), 7000)
        return () => window.clearTimeout(timer)
    }, [applicabilityMatrixResult])

    useEffect(() => {
        if (!targetPlanResult) return
        const timer = window.setTimeout(() => setTargetPlanResult(null), 5000)
        return () => window.clearTimeout(timer)
    }, [targetPlanResult])

    useEffect(() => {
        if (tab !== 'dashboard' || !selectedPeriodId) return
        if (
            dashboard.selectedPeriodId === selectedPeriodId
            && dashboard.selectedIndicatorId === selectedDashboardIndicatorId
        ) return
        void loadDashboard(selectedPeriodId, selectedDashboardIndicatorId || undefined)
    }, [
        dashboard.selectedIndicatorId,
        dashboard.selectedPeriodId,
        loadDashboard,
        selectedDashboardIndicatorId,
        selectedPeriodId,
        tab,
    ])

    // Р7: журнал импортов нужен не только вкладке «История». На нём же построен светофор
    // источников — и в меню «Загрузка данных» (видно на любой вкладке), и на вкладке
    // «Источники». Пока загрузка была привязана к вкладке «История», светофор до её
    // открытия показывал все источники красными, даже если файлы загружены.
    useEffect(() => {
        if (!selectedPeriodId) return
        void loadImports(selectedPeriodId)
    }, [loadImports, selectedPeriodId])

    useEffect(() => {
        if (!organizationsPanelResizing) return

        const handlePointerMove = (event: PointerEvent) => {
            const start = organizationsResizeStartRef.current
            const splitWidth = dashboardSplitRef.current?.getBoundingClientRect().width ?? 0
            if (!start || splitWidth <= 0) return

            const maxWidth = Math.max(280, Math.min(600, splitWidth - 420))
            const nextWidth = start.width + start.clientX - event.clientX
            setOrganizationsPanelWidth(Math.min(maxWidth, Math.max(280, nextWidth)))
        }
        const handlePointerUp = () => {
            setOrganizationsPanelResizing(false)
            organizationsResizeStartRef.current = null
        }
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)

        return () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            document.body.style.cursor = previousCursor
            document.body.style.userSelect = previousUserSelect
        }
    }, [organizationsPanelResizing])

    useEffect(() => {
        if (!selectedOrganizationOid || !organizationsPanelOpen) return
        const frame = window.requestAnimationFrame(() => {
            organizationRowRefs.current.get(selectedOrganizationOid)?.scrollIntoView({
                block: 'nearest',
            })
        })
        return () => window.cancelAnimationFrame(frame)
    }, [filteredOrganizations, organizationsPanelOpen, selectedOrganizationOid])

    /**
     * Причины и находки есть только у показателя 6.1.3.2.7: у долей к объёмам ТПГГ
     * диагностики нет. Признак берём из типа расчёта показателя, а не из его id.
     */
    const selectedDashboardIndicator = useMemo(
        () => dashboard.indicators.find(
            (indicator) => indicator.id === selectedDashboardIndicatorId,
        ) ?? null,
        [dashboard.indicators, selectedDashboardIndicatorId],
    )

    useEffect(() => {
        // Н20: находки есть у 6.1.3.2.7 и у долей. У показателя «Виды СЭМД в РЭМД»
        // их нет — там «чего не хватает» разворачивается перечнем видов (Н18.1).
        const indicatorHasDiagnostics = (
            selectedDashboardIndicator?.calculationType === 'semd_type_coverage'
            || selectedDashboardIndicator?.calculationType === 'semd_volume_ratio'
        )
        if (
            tab !== 'dashboard'
            || !selectedPeriodId
            || !selectedOrganizationOid
            || !indicatorHasDiagnostics
        ) {
            setSelectedDiagnostics([])
            return
        }
        let cancelled = false
        void getReportingDiagnostics(
            selectedPeriodId,
            selectedOrganizationOid,
            selectedDashboardIndicator.id,
        )
            .then((findings) => {
                if (!cancelled) setSelectedDiagnostics(findings)
            })
            .catch((err) => {
                if (!cancelled) setError(getErrorMessage(err))
            })
        return () => {
            cancelled = true
        }
    }, [
        selectedDashboardIndicator,
        selectedOrganizationOid,
        selectedPeriodId,
        tab,
    ])

    /** FR-11: имена МО для регионального свода причин (в findings приходит только OID). */
    const organizationNameByOid = useMemo(() => {
        const names: Record<string, string> = {}
        for (const organization of dashboard.organizations) {
            names[organization.organizationOid] = organization.organizationName
        }
        return names
    }, [dashboard.organizations])

    /** FR-11: причины по всему региону — грузим один раз при открытии свода. */
    const handleOpenRegionDiagnostics = () => {
        if (!selectedPeriodId) return
        setRegionDiagnosticsOpen(true)
        // Н20: свод открывается и у долей, поэтому показатель передаётся явно.
        void getReportingDiagnostics(
            selectedPeriodId,
            undefined,
            selectedDashboardIndicator?.id,
        )
            .then(setRegionDiagnostics)
            .catch((err) => setError(getErrorMessage(err)))
    }

    const handleOrganizationsResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
        organizationsResizeStartRef.current = {
            clientX: event.clientX,
            width: organizationsPanelWidth,
        }
        setOrganizationsPanelResizing(true)
        event.preventDefault()
    }

    const handleOpenIndicatorDashboard = (indicatorId: string) => {
        setSelectedDashboardIndicatorId(indicatorId)
        setSelectedOrganizationOid(null)
        setOrganizationSearch('')
        setTab('dashboard')
    }

    const handleMapOrganizationChange = (organizationOid: string | null) => {
        setSelectedOrganizationOid(organizationOid)
        if (organizationOid) {
            setOrganizationSearch('')
        }
    }

    const handleDashboardIndicatorChange = (indicatorId: string) => {
        setSelectedDashboardIndicatorId(indicatorId)
        void loadDashboard(selectedPeriodId, indicatorId)
    }

    const handleToggleOrganizationsPanel = () => {
        setOrganizationsPanelOpen((value) => !value)
    }

    const handleToggleSelectedOrganization = (organizationOid: string) => {
        setSelectedOrganizationOid((current) => (
            current === organizationOid ? null : organizationOid
        ))
    }

    const handleOpenInstitutionDetails = async (
        organizationOid: string,
    ) => {
        if (!selectedPeriodId || institutionDetailsLoading) return
        setInstitutionDetailsLoading(true)
        setInstitutionDetailsFilter('all')
        setInstitutionDetailsSearch('')
        setRequirementHistoryOpen(false)
        setRequirementHistory([])
        setRequirementHistoryError(null)
        setError(null)
        try {
            setInstitutionDetails(
                await getPilotInstitutionDetails(
                    selectedPeriodId,
                    organizationOid,
                ),
            )
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setInstitutionDetailsLoading(false)
        }
    }

    const handleOpenRequirementHistory = async () => {
        if (!institutionDetails || requirementHistoryLoading) return
        setRequirementHistoryOpen(true)
        setRequirementHistoryLoading(true)
        setRequirementHistoryError(null)
        try {
            setRequirementHistory(
                await getPilotInstitutionRequirementHistory(
                    institutionDetails.periodId,
                    institutionDetails.organization.oid,
                ),
            )
        } catch (err) {
            setRequirementHistoryError(getErrorMessage(err))
        } finally {
            setRequirementHistoryLoading(false)
        }
    }

    const handleOpenRequirementOverride = (
        type: PilotInstitutionDetails['types'][number],
    ) => {
        setEditingInstitutionType(type)
        setRequirementOverrideStatus(
            type.manualOverride?.status
            ?? (type.requirementStatus === 'not_required'
                ? 'not_required'
                : 'required'),
        )
        setRequirementOverrideReason('')
        setRequirementOverrideError(null)
    }

    const handleCloseRequirementOverride = () => {
        setEditingInstitutionType(null)
        setRequirementOverrideError(null)
    }

    const handleRequirementOverrideReasonChange = (reason: string) => {
        setRequirementOverrideReason(reason)
        setRequirementOverrideError(null)
    }

    const handleCloseInstitutionDetails = () => {
        setInstitutionDetails(null)
        setInstitutionDetailsSearch('')
        setRequirementHistoryOpen(false)
        setRequirementHistory([])
        setRequirementHistoryError(null)
    }

    const handleSaveRequirementOverride = async (
        requirementStatus: 'required' | 'not_required' | null,
    ) => {
        if (
            !institutionDetails
            || !editingInstitutionType
            || requirementOverrideSaving
        ) return
        const reason = requirementOverrideReason.trim()
        if (!reason) {
            setRequirementOverrideError(
                requirementStatus === null
                    ? 'Укажите причину снятия ручного уточнения.'
                    : 'Укажите основание ручного уточнения.',
            )
            return
        }

        setRequirementOverrideSaving(true)
        setRequirementOverrideError(null)
        setError(null)
        try {
            const updated = await setPilotInstitutionRequirement({
                periodId: institutionDetails.periodId,
                organizationOid: institutionDetails.organization.oid,
                semdTypeId: editingInstitutionType.semdTypeId,
                requirementStatus,
                reason,
            })
            setInstitutionDetails(updated)
            setEditingInstitutionType(null)
            setRequirementOverrideReason('')
            if (requirementHistoryOpen) {
                setRequirementHistory(
                    await getPilotInstitutionRequirementHistory(
                        updated.periodId,
                        updated.organization.oid,
                    ),
                )
            }
            await loadDashboard(
                updated.periodId,
                'semd_types_epgu_coverage',
            )
            setSelectedDiagnostics(
                await getReportingDiagnostics(
                    updated.periodId,
                    updated.organization.oid,
                ),
            )
        } catch (err) {
            setRequirementOverrideError(getErrorMessage(err))
        } finally {
            setRequirementOverrideSaving(false)
        }
    }

    const handlePeriodChange = (periodId: string) => {
        setSelectedPeriodId(periodId)
        setInstitutionDetails(null)
        setEditingInstitutionType(null)
        setInstitutionDetailsSearch('')
        setRequirementHistoryOpen(false)
        setRequirementHistory([])
        setRequirementHistoryError(null)
        void loadSummary(periodId)
        if (tab === 'dashboard') {
            void loadDashboard(periodId, selectedDashboardIndicatorId || undefined)
        } else if (tab === 'history') {
            void loadImports(periodId)
        } else {
            setDashboard(emptyDashboard)
        }
    }

    const handleOpenDeletePeriod = async () => {
        if (!selectedPeriodId) return
        setError(null)
        try {
            setDeletePeriodPreview(await getReportingPeriodDeletionPreview(selectedPeriodId))
        } catch (err) {
            setError(getErrorMessage(err))
        }
    }

    const handleConfirmDeletePeriod = async () => {
        if (!deletePeriodPreview) return
        setDeletingPeriod(true)
        setError(null)
        try {
            const result = await deleteReportingPeriod(
                deletePeriodPreview.period.id,
                deletePeriodPreview.period.code,
            )
            setDeletePeriodPreview(null)
            setDeletedPeriodResult(result)
            // Выбранного периода больше нет: сбрасываем всё, что от него зависело,
            // и просим сервер выдать новый выбор по умолчанию.
            setSelectedPeriodId('')
            setInstitutionDetails(null)
            setDashboard(emptyDashboard)
            setImports([])
            await loadSummary(null)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setDeletingPeriod(false)
        }
    }

    const handleEdit = (indicator: ReportingIndicator) => {
        setEditingIndicator(indicator)
        setValueForm(valueToForm(valueByIndicatorId.get(indicator.id)))
        setError(null)
    }

    const handleCloseEdit = () => {
        if (saving) return
        setEditingIndicator(null)
        setValueForm(emptyValueForm)
    }

    const handleSaveValue = async () => {
        if (!editingIndicator || !selectedPeriodId) return
        setSaving(true)
        setError(null)
        try {
            const saved = await upsertReportingValue(editingIndicator.id, {
                periodId: selectedPeriodId,
                numerator: valueForm.numerator,
                denominator: valueForm.denominator,
                targetValue: valueForm.targetValue,
                sourceName: valueForm.sourceName,
                note: valueForm.note,
            })
            setSummary((prev) => ({
                ...prev,
                values: [
                    ...prev.values.filter((value) => value.indicatorId !== saved.indicatorId),
                    saved,
                ],
            }))
            setEditingIndicator(null)
            setValueForm(emptyValueForm)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setSaving(false)
        }
    }

    const handleCreatePeriod = async () => {
        setSaving(true)
        setError(null)
        try {
            const period = await createReportingPeriod({
                name: periodForm.name,
                code: periodForm.code,
                dateFrom: periodForm.dateFrom || null,
                dateTo: periodForm.dateTo || null,
                status: 'draft',
            })
            setPeriodDialogOpen(false)
            setPeriodForm(buildDefaultPeriodForm())
            await loadSummary(period.id)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setSaving(false)
        }
    }

    const handleImportFile = async (
        file: File | undefined,
        mode: ReportingImportMode = importMode,
    ) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setImportResult(null)
        try {
            const preview = await previewRemdWorkbook(
                selectedPeriodId,
                file,
                mode,
            )
            setImportPreview(preview)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }

    const handleEmdNsiImportFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setEmdNsiImportResult(null)
        try {
            const result = await importEmdNsiCsv(selectedPeriodId, file)
            setEmdNsiImportResult(result)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (emdNsiFileInputRef.current) {
                emdNsiFileInputRef.current.value = ''
            }
        }
    }

    const handleEpguDocVisibilityImportFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setEpguDocVisibilityImportResult(null)
        try {
            const result = await importEpguDocVisibility(selectedPeriodId, file)
            setEpguDocVisibilityImportResult(result)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (epguDocVisibilityFileInputRef.current) {
                epguDocVisibilityFileInputRef.current.value = ''
            }
        }
    }

    const handlePerechen5prImportFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setPerechen5prImportResult(null)
        try {
            const result = await importPerechen5pr(selectedPeriodId, file)
            setPerechen5prImportResult(result)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (perechen5prFileInputRef.current) {
                perechen5prFileInputRef.current.value = ''
            }
        }
    }

    const handleRemdNumeratorImportFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setRemdNumeratorImportResult(null)
        try {
            const result = await importRemdNumerator(selectedPeriodId, file)
            setRemdNumeratorImportResult(result)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (remdNumeratorFileInputRef.current) {
                remdNumeratorFileInputRef.current.value = ''
            }
        }
    }

    /**
     * Помесячные и нарастающие выгрузки РЭМД — по одной, но выбирать можно все
     * сразу. Загружаются строго последовательно: каждая пишет свой месяц, и
     * параллельная отправка семи файлов дала бы гонку на одном и том же периоде.
     *
     * Первая же ошибка останавливает загрузку и называет файл: продолжать,
     * оставив в кривой дыру на непонятном месяце, хуже, чем остановиться.
     */
    const handleRemdIntervalImportFiles = async (files: FileList | null) => {
        if (!files || files.length === 0 || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setRemdIntervalImportResults(null)
        const results: RemdIntervalImportResult[] = []
        try {
            for (const file of Array.from(files)) {
                try {
                    results.push(await importRemdInterval(selectedPeriodId, file))
                } catch (err) {
                    throw new Error(`«${file.name}»: ${getErrorMessage(err)}`, { cause: err })
                }
            }
            setRemdIntervalImportResults(results)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
        } catch (err) {
            // Загруженное до ошибки остаётся в базе — показываем, что успело пройти.
            if (results.length > 0) setRemdIntervalImportResults(results)
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (remdIntervalFileInputRef.current) {
                remdIntervalFileInputRef.current.value = ''
            }
        }
    }

    /**
     * Перечни входимости ТВСП от Минздрава: семь файлов, по одному на вид СЭМД.
     * Вид определяется по заголовку самого файла — выбирать его не нужно.
     */
    const handleInclusionRegisterFiles = async (files: FileList | null) => {
        if (!files || files.length === 0 || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setInclusionRegisterResults(null)
        const results: InclusionRegisterImportResult[] = []
        try {
            for (const file of Array.from(files)) {
                try {
                    results.push(await importInclusionRegister(selectedPeriodId, file))
                } catch (err) {
                    throw new Error(`«${file.name}»: ${getErrorMessage(err)}`, { cause: err })
                }
            }
            setInclusionRegisterResults(results)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            if (results.length > 0) setInclusionRegisterResults(results)
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (inclusionRegisterFileInputRef.current) {
                inclusionRegisterFileInputRef.current.value = ''
            }
        }
    }

    /**
     * Файлы исполнения терпрограммы: шестнадцать штук, по одному на лист.
     * Как и помесячные выгрузки — последовательно и с остановкой на первой ошибке.
     *
     * Переименовывать файлы фонда перед загрузкой нельзя: лист терпрограммы
     * определяется по номеру в начале имени.
     */
    const handleTpggExecutionImportFiles = async (files: FileList | null) => {
        if (!files || files.length === 0 || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setTpggExecutionResults(null)
        const results: TpggExecutionImportResult[] = []
        try {
            for (const file of Array.from(files)) {
                try {
                    results.push(await importTpggExecution(selectedPeriodId, file))
                } catch (err) {
                    throw new Error(`«${file.name}»: ${getErrorMessage(err)}`, { cause: err })
                }
            }
            setTpggExecutionResults(results)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            if (results.length > 0) setTpggExecutionResults(results)
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (tpggExecutionFileInputRef.current) {
                tpggExecutionFileInputRef.current.value = ''
            }
        }
    }

    const handleFrmrImportFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setFrmrImportResult(null)
        try {
            const result = await importFrmr(selectedPeriodId, file)
            setFrmrImportResult(result)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (frmrFileInputRef.current) {
                frmrFileInputRef.current.value = ''
            }
        }
    }

    const handleTpggImportFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setTpggImportResult(null)
        try {
            const preview = await previewTpggWorkbook(
                selectedPeriodId,
                file,
            )
            setTpggImportPreview(preview)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (tpggFileInputRef.current) {
                tpggFileInputRef.current.value = ''
            }
        }
    }

    const handleOrganizationDirectoryFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setOrganizationDirectoryResult(null)
        try {
            const preview = await previewOrganizationDirectory(selectedPeriodId, file)
            setOrganizationDirectoryPreview(preview)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (organizationDirectoryFileInputRef.current) {
                organizationDirectoryFileInputRef.current.value = ''
            }
        }
    }

    const handleConfirmOrganizationDirectory = async () => {
        if (!organizationDirectoryPreview) return
        setImporting(true)
        setError(null)
        try {
            const result = await confirmOrganizationDirectory(
                organizationDirectoryPreview.importId,
            )
            setOrganizationDirectoryResult(result)
            setOrganizationDirectoryPreview(null)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
            setOrganizationDirectoryPreview(null)
            await loadImports(selectedPeriodId)
        } finally {
            setImporting(false)
        }
    }

    const handleCancelOrganizationDirectoryPreview = async () => {
        if (!organizationDirectoryPreview || importing) return
        setImporting(true)
        setError(null)
        try {
            await cancelOrganizationDirectoryPreview(organizationDirectoryPreview.importId)
            setOrganizationDirectoryPreview(null)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
        }
    }

    const handleApplicabilityMatrixFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setApplicabilityMatrixResult(null)
        try {
            const preview = await previewApplicabilityMatrix(selectedPeriodId, file)
            setApplicabilityMatrixPreview(preview)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (applicabilityMatrixFileInputRef.current) {
                applicabilityMatrixFileInputRef.current.value = ''
            }
        }
    }

    const handleTargetPlanImportFile = async (file: File | undefined) => {
        if (!file || !selectedPeriodId) return
        setImporting(true)
        setError(null)
        setTargetPlanResult(null)
        try {
            const preview = await previewTargetPlan(
                selectedPeriodId,
                file,
            )
            setTargetPlanPreview(preview)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
            if (targetPlanFileInputRef.current) {
                targetPlanFileInputRef.current.value = ''
            }
        }
    }

    const handleExportPilotTargetPlan = async () => {
        if (!selectedPeriodId) return
        setExportingPilotTargetPlan(true)
        setError(null)
        try {
            await downloadIndicatorFactsExport(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setExportingPilotTargetPlan(false)
        }
    }

    const handleConfirmImport = async () => {
        if (!importPreview) return
        if (
            importPreview.importMode === 'replace'
            && !window.confirm(
                'Полностью заменить факты РЭМД за выбранный период? '
                + 'Факты, отсутствующие в новом файле, будут удалены. '
                + 'История предыдущих импортов сохранится.',
            )
        ) {
            return
        }

        setImporting(true)
        setError(null)
        try {
            const result = await confirmRemdWorkbook(
                importPreview.importId,
                importPreview.importMode,
            )
            setImportResult(result)
            setImportPreview(null)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                void loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            } else {
                setDashboard(emptyDashboard)
            }
        } catch (err) {
            setError(getErrorMessage(err))
            setImportPreview(null)
            await loadImports(selectedPeriodId)
        } finally {
            setImporting(false)
        }
    }

    const handleCancelImportPreview = async () => {
        if (!importPreview || importing) return
        setImporting(true)
        setError(null)
        try {
            await cancelRemdWorkbookPreview(importPreview.importId)
            setImportPreview(null)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
        }
    }

    const handleConfirmTpggImport = async () => {
        if (!tpggImportPreview) return
        setImporting(true)
        setError(null)
        try {
            const result = await confirmTpggWorkbook(
                tpggImportPreview.importId,
            )
            setTpggImportResult(result)
            setTpggImportPreview(null)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
            setTpggImportPreview(null)
            await loadImports(selectedPeriodId)
        } finally {
            setImporting(false)
        }
    }

    const handleCancelTpggImportPreview = async () => {
        if (!tpggImportPreview || importing) return
        setImporting(true)
        setError(null)
        try {
            await cancelTpggWorkbookPreview(tpggImportPreview.importId)
            setTpggImportPreview(null)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
        }
    }

    const handleConfirmApplicabilityMatrix = async () => {
        if (!applicabilityMatrixPreview) return
        setImporting(true)
        setError(null)
        try {
            const result = await confirmApplicabilityMatrix(
                applicabilityMatrixPreview.importId,
            )
            setApplicabilityMatrixResult(result)
            setApplicabilityMatrixPreview(null)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
            setApplicabilityMatrixPreview(null)
            await loadImports(selectedPeriodId)
        } finally {
            setImporting(false)
        }
    }

    const handleCancelApplicabilityMatrixPreview = async () => {
        if (!applicabilityMatrixPreview || importing) return
        setImporting(true)
        setError(null)
        try {
            await cancelApplicabilityMatrixPreview(applicabilityMatrixPreview.importId)
            setApplicabilityMatrixPreview(null)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
        }
    }

    const handleConfirmTargetPlanImport = async () => {
        if (!targetPlanPreview) return
        setImporting(true)
        setError(null)
        try {
            const result = await confirmTargetPlan(
                targetPlanPreview.importId,
            )
            setTargetPlanResult(result)
            setTargetPlanPreview(null)
            await Promise.all([
                loadSummary(selectedPeriodId),
                loadImports(selectedPeriodId),
            ])
            if (tab === 'dashboard') {
                await loadDashboard(
                    selectedPeriodId,
                    selectedDashboardIndicatorId || undefined,
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
            setTargetPlanPreview(null)
            await loadImports(selectedPeriodId)
        } finally {
            setImporting(false)
        }
    }

    const handleCancelTargetPlanImportPreview = async () => {
        if (!targetPlanPreview || importing) return
        setImporting(true)
        setError(null)
        try {
            await cancelTargetPlanPreview(targetPlanPreview.importId)
            setTargetPlanPreview(null)
            await loadImports(selectedPeriodId)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
        }
    }

    const handleOpenImportPreview = async (importRun: ReportingImportRun) => {
        setImporting(true)
        setError(null)
        try {
            if (importRun.sourceType === 'tpgg_workbook') {
                setTpggImportPreview(
                    await getTpggWorkbookPreview(importRun.id),
                )
            } else if (importRun.sourceType === 'applicability_matrix') {
                setApplicabilityMatrixPreview(
                    await getApplicabilityMatrixPreview(importRun.id),
                )
            } else if (importRun.sourceType === 'target_plan') {
                setTargetPlanPreview(
                    await getTargetPlanPreview(importRun.id),
                )
            } else {
                setImportPreview(
                    await getRemdWorkbookPreview(importRun.id),
                )
            }
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setImporting(false)
        }
    }

    const handleDownloadImport = async (importRun: ReportingImportRun) => {
        setDownloadingImportId(importRun.id)
        setError(null)
        try {
            await downloadReportingImportSource(importRun)
        } catch (err) {
            setError(getErrorMessage(err))
        } finally {
            setDownloadingImportId(null)
        }
    }

    const handleTabChange = (
        _event: unknown,
        value: 'indicators' | 'dashboard' | 'history' | 'organizations' | 'sources',
    ) => {
        setTab(value)
        if (value === 'dashboard' && selectedPeriodId) {
            void loadDashboard(selectedPeriodId, selectedDashboardIndicatorId || undefined)
        } else if ((value === 'history' || value === 'sources') && selectedPeriodId) {
            void loadImports(selectedPeriodId)
        }
    }

    const openImportFilePicker = (
        inputRef: { current: HTMLInputElement | null },
        mode?: ReportingImportMode,
    ) => {
        if (mode) {
            legacyImportModeRef.current = mode
            setImportMode(mode)
        }
        setImportMenuAnchorEl(null)
        inputRef.current?.click()
    }

    return (
        <Box
            sx={{
                p: { xs: 0.75, md: 1 },
                bgcolor: 'background.default',
                height: '100%',
                minHeight: 0,
                overflow: 'hidden',
            }}
        >
            <Container
                maxWidth={false}
                disableGutters
                sx={{
                    height: '100%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <Paper
                    variant="outlined"
                    sx={{
                        px: 0.75,
                        py: 0.5,
                        mb: 0.75,
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        flexWrap: { xs: 'wrap', xl: 'nowrap' },
                        flexShrink: 0,
                    }}
                >
                    <Typography variant="subtitle1" fontWeight={700} noWrap sx={{ px: 0.5, mr: 0.25 }}>
                        Отчетность
                    </Typography>
                    <Tabs
                        value={tab}
                        onChange={handleTabChange}
                        sx={{
                            minHeight: 34,
                            '& .MuiTabs-indicator': { height: 2 },
                        }}
                    >
                        <Tab value="indicators" label="Показатели" sx={{ minHeight: 34, minWidth: 92, px: 1, py: 0, textTransform: 'none' }} />
                        <Tab value="dashboard" label="Дашборд" sx={{ minHeight: 34, minWidth: 82, px: 1, py: 0, textTransform: 'none' }} />
                        <Tab value="history" label="История" sx={{ minHeight: 34, minWidth: 76, px: 1, py: 0, textTransform: 'none' }} />
                        <Tab value="organizations" label="Организации" sx={{ minHeight: 34, minWidth: 104, px: 1, py: 0, textTransform: 'none' }} />
                        <Tab value="sources" label="Источники" sx={{ minHeight: 34, minWidth: 92, px: 1, py: 0, textTransform: 'none' }} />
                    </Tabs>
                    <Box sx={{ flex: 1, minWidth: 4 }} />
                    <TextField
                        select
                        size="small"
                        value={selectedPeriodId}
                        onChange={(event) => handlePeriodChange(event.target.value)}
                        disabled={summary.periods.length === 0 || loading}
                        inputProps={{ 'aria-label': 'Период' }}
                        sx={{
                            width: { xs: 170, md: 190 },
                            '& .MuiInputBase-root': { height: 36 },
                        }}
                    >
                        {summary.periods.map((period) => (
                            <MenuItem key={period.id} value={period.id}>
                                {period.name}
                            </MenuItem>
                        ))}
                    </TextField>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => setPeriodDialogOpen(true)}
                            sx={{ textTransform: 'none', minHeight: 34, px: 1 }}
                        >
                            Период
                        </Button>
                        {/* Удаление необратимо, поэтому кнопка без подписи и в стороне
                            от «Период»: промахнуться мимо создания сложнее. Состав
                            удаляемого показывается в диалоге до подтверждения. */}
                        <Tooltip title="Удалить выбранный отчётный период">
                            <span>
                                <IconButton
                                    size="small"
                                    color="error"
                                    aria-label="Удалить период"
                                    disabled={!selectedPeriodId || loading || deletingPeriod}
                                    onClick={() => void handleOpenDeletePeriod()}
                                >
                                    <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                        {/* Пока идёт загрузка, кнопка выключена — и раньше выглядела
                            просто сломанной: серая, без объяснений. Крутилка вместо
                            значка говорит, что дело в незавершённом запросе, а не
                            в потерянном периоде. Тот же приём, что у «Экспорта». */}
                        <Tooltip
                            title={importing ? 'Идёт загрузка файла, дождитесь ответа' : ''}
                        >
                            <span>
                                <Button
                                    id="reporting-import-menu-button"
                                    size="small"
                                    variant="outlined"
                                    startIcon={importing
                                        ? <CircularProgress size={14} />
                                        : <UploadFileIcon />}
                                    endIcon={<KeyboardArrowDownIcon />}
                                    onClick={(event) => setImportMenuAnchorEl(event.currentTarget)}
                                    disabled={!selectedPeriodId || importing}
                                    sx={{ textTransform: 'none', minHeight: 34, px: 1 }}
                                >
                                    Загрузка данных
                                </Button>
                            </span>
                        </Tooltip>
                        <Menu
                            anchorEl={importMenuAnchorEl}
                            open={Boolean(importMenuAnchorEl)}
                            onClose={() => setImportMenuAnchorEl(null)}
                            MenuListProps={{
                                dense: true,
                                'aria-labelledby': 'reporting-import-menu-button',
                            }}
                            // По умолчанию MUI раскрывает меню от верхнего угла
                            // кнопки — оно ложится на саму кнопку и на соседние.
                            // Пока пунктов было немного, это не бросалось в глаза;
                            // с четырнадцатью меню накрыло всю панель.
                            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                            slotProps={{
                                paper: {
                                    sx: {
                                        width: 460,
                                        maxWidth: 'calc(100vw - 24px)',
                                        // Высота ограничена намеренно: не влезающее
                                        // меню MUI поднимает вверх, чтобы оно
                                        // поместилось, и оно снова накрывает панель.
                                        // Лучше прокрутка внутри, чем сдвиг.
                                        maxHeight: 'calc(100vh - 180px)',
                                    },
                                },
                            }}
                        >
                            <ListSubheader sx={importGroupHeaderSx}>
                                Порядок для полного расчёта
                            </ListSubheader>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(emdNsiFileInputRef)}>
                                {renderSourceStatusDot('emd_nsi_csv')}
                                <Box sx={importStepSx}>1</Box>
                                <ListItemText
                                    primary="ЭМД/НСИ 1520"
                                    secondary="Базовый справочник видов медицинских документов"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(epguDocVisibilityFileInputRef)}>
                                {renderSourceStatusDot('epgu_doc_visibility_xlsx')}
                                <Box sx={importStepSx}>2</Box>
                                <ListItemText
                                    primary="ЭМД 1253 — видимость на ЕПГУ"
                                    secondary="Определяет, какие виды отображаются гражданам"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(perechen5prFileInputRef)}>
                                {renderSourceStatusDot('perechen_5pr_xlsx')}
                                <Box sx={importStepSx}>3</Box>
                                <ListItemText
                                    primary="Перечень СЭМД №5пр"
                                    secondary="Официальные наименования целевых видов СЭМД"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(remdNumeratorFileInputRef)}>
                                {renderSourceStatusDot('remd_numerator_tidy_xlsx')}
                                <Box sx={importStepSx}>4</Box>
                                <ListItemText
                                    primary="Числитель РЭМД"
                                    secondary="Создаёт справочник целевых МО и загружает фактические регистрации"
                                />
                            </MenuItem>
                            {/*
                              * Справочник признаков МО стоит перед ФРМР с 31.08.2026: он
                              * задаёт состав целевых МО и заводит те организации, которых
                              * нет в выгрузке РЭМД. ФРМР добавляет подразделения только
                              * существующим МО — загруженный раньше справочника, он
                              * пропустил бы новые молча.
                              */}
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(organizationDirectoryFileInputRef)}>
                                {renderSourceStatusDot('organization_directory')}
                                <Box sx={importStepSx}>5</Box>
                                <ListItemText
                                    primary="Справочник признаков МО"
                                    secondary="Задаёт состав целевых МО; обязательно до ФРМР и до матрицы"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(frmrFileInputRef)}>
                                {renderSourceStatusDot('frmr_activity_type_xlsx')}
                                <Box sx={importStepSx}>6</Box>
                                <ListItemText
                                    primary="ФРМР — МО и подразделения"
                                    secondary="Добавляет типы и виды подразделений для созданных МО"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(tpggFileInputRef)}>
                                {renderSourceStatusDot('tpgg_workbook')}
                                <Box sx={importStepSx}>7</Box>
                                <ListItemText
                                    primary="ТПГГ — территориальная программа"
                                    secondary="Обязательно до матрицы: объёмы читаются в момент её импорта"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(applicabilityMatrixFileInputRef)}>
                                {renderSourceStatusDot('applicability_matrix')}
                                <Box sx={importStepSx}>8</Box>
                                <ListItemText
                                    primary="Матрица применимости СЭМД"
                                    secondary="Формирует обязательный набор и знаменатель для каждого МО"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(targetPlanFileInputRef)}>
                                {renderSourceStatusDot('target_plan')}
                                <Box sx={importStepSx}>9</Box>
                                <ListItemText
                                    primary="Плановые значения"
                                    secondary="Применяет план показателя к выбранному отчетному периоду"
                                />
                            </MenuItem>
                            <Divider />
                            {/* Номера шага у этих трёх нет намеренно: девять шагов —
                                обязательный порядок загрузки, и второй десятки быть
                                не должно. Каждый принимает несколько файлов сразу,
                                поэтому сказано об этом один раз в заголовке группы. */}
                            <ListSubheader sx={importGroupHeaderSx}>
                                Дополнительные источники · несколько файлов сразу
                            </ListSubheader>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(remdIntervalFileInputRef)}>
                                {renderSourceStatusDot('remd_interval_xlsx', true)}
                                <Box sx={importStepSpacerSx} />
                                <ListItemText
                                    primary="Выгрузки РЭМД по месяцам"
                                    secondary="Кривая динамики по месяцам и числитель показателя «Виды СЭМД в РЭМД»"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(inclusionRegisterFileInputRef)}>
                                {renderSourceStatusDot('inclusion_register', true)}
                                <Box sx={importStepSpacerSx} />
                                <ListItemText
                                    primary="Перечни входимости ТВСП (Минздрав)"
                                    secondary="Состав ТВСП, обязанных передавать вид, с планом и фактом по зданиям"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(tpggExecutionFileInputRef)}>
                                {renderSourceStatusDot('tpgg_execution', true)}
                                <Box sx={importStepSpacerSx} />
                                <ListItemText
                                    primary="Исполнение ТПГГ по реестрам ОМС"
                                    secondary="Третья колонка карточки МО: сколько случаев прошло на самом деле"
                                />
                            </MenuItem>
                            <Divider />
                            <ListSubheader sx={importGroupHeaderSx}>
                                Резервные загрузки
                            </ListSubheader>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(fileInputRef, 'merge')}>
                                <Box sx={importDotSpacerSx} />
                                <Box sx={importStepSpacerSx} />
                                <ListItemText
                                    primary="Общий Excel — дополнить / обновить"
                                    secondary="Совместимый импорт старого сводного формата"
                                />
                            </MenuItem>
                            <MenuItem sx={importMenuItemSx} onClick={() => openImportFilePicker(fileInputRef, 'replace')}>
                                <Box sx={importDotSpacerSx} />
                                <Box sx={importStepSpacerSx} />
                                <ListItemText
                                    primary="Общий Excel — полностью заменить"
                                    secondary="Удаляет отсутствующие в новом файле факты выбранного периода"
                                    secondaryTypographyProps={{ color: 'warning.main' }}
                                />
                            </MenuItem>
                        </Menu>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleImportFile(
                                    event.target.files?.[0],
                                    legacyImportModeRef.current,
                                )
                            }}
                        />
                        <input
                            ref={emdNsiFileInputRef}
                            type="file"
                            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleEmdNsiImportFile(
                                    event.target.files?.[0],
                                )
                            }}
                        />
                        <input
                            ref={epguDocVisibilityFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleEpguDocVisibilityImportFile(
                                    event.target.files?.[0],
                                )
                            }}
                        />
                        <input
                            ref={perechen5prFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handlePerechen5prImportFile(
                                    event.target.files?.[0],
                                )
                            }}
                        />
                        <input
                            ref={remdNumeratorFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleRemdNumeratorImportFile(
                                    event.target.files?.[0],
                                )
                            }}
                        />
                        <input
                            ref={remdIntervalFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            multiple
                            hidden
                            onChange={(event) => {
                                void handleRemdIntervalImportFiles(event.target.files)
                            }}
                        />
                        <input
                            ref={inclusionRegisterFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            multiple
                            hidden
                            onChange={(event) => {
                                void handleInclusionRegisterFiles(event.target.files)
                            }}
                        />
                        <input
                            ref={tpggExecutionFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            multiple
                            hidden
                            onChange={(event) => {
                                void handleTpggExecutionImportFiles(event.target.files)
                            }}
                        />
                        <input
                            ref={frmrFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleFrmrImportFile(event.target.files?.[0])
                            }}
                        />
                        <input
                            ref={tpggFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleTpggImportFile(
                                    event.target.files?.[0],
                                )
                            }}
                        />
                        <input
                            ref={organizationDirectoryFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleOrganizationDirectoryFile(event.target.files?.[0])
                            }}
                        />
                        <input
                            ref={applicabilityMatrixFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleApplicabilityMatrixFile(event.target.files?.[0])
                            }}
                        />
                        <input
                            ref={targetPlanFileInputRef}
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            hidden
                            onChange={(event) => {
                                void handleTargetPlanImportFile(
                                    event.target.files?.[0],
                                )
                            }}
                        />
                        <Tooltip title="Скачать факт 6.1.3.2.7 в структуре шаблона «Приложение 2»">
                            <span>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={exportingPilotTargetPlan
                                        ? <CircularProgress size={14} />
                                        : <DownloadOutlinedIcon />}
                                    onClick={() => void handleExportPilotTargetPlan()}
                                    disabled={!selectedPeriodId || exportingPilotTargetPlan}
                                    sx={{ textTransform: 'none', minHeight: 34, px: 1 }}
                                >
                                    Экспорт в Excel
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Обновить">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={() => void loadSummary(selectedPeriodId || undefined)}
                                    disabled={loading}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Paper>

                {error && (
                    <Alert severity="error" sx={{ mb: 1, py: 0, flexShrink: 0 }} onClose={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {importResult && (
                    <Alert
                        severity={importResult.qualityIssueCount > 0 ? 'warning' : 'success'}
                        sx={{ mb: 1, py: 0, maxHeight: 64, overflow: 'auto', flexShrink: 0 }}
                    >
                        Режим: {importResult.importMode === 'merge' ? 'дополнение / обновление' : 'полная замена'}.{' '}
                        Сохранено МО: {importResult.institutionCount}, подразделений: {importResult.subdivisionCount},
                        видов СЭМД: {importResult.semdTypeCount}, фактов: {formatNumber(importResult.factCount)}.
                        {importResult.unassignedSubdivisionCount > 0 && (
                            <> Без привязки к подразделению: {formatNumber(importResult.unassignedDocumentCount)} документов.</>
                        )}
                        {importResult.qualityIssueCount > 0 && ` Предупреждений: ${importResult.qualityIssueCount}.`}
                    </Alert>
                )}

                {emdNsiImportResult && (
                    <Alert
                        severity={
                            emdNsiImportResult.warnings.length > 0
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        Справочник ЭМД/НСИ
                        {emdNsiImportResult.sourceVersion
                            ? ` версии ${emdNsiImportResult.sourceVersion}`
                            : ''}{' '}
                        загружен: {formatNumber(emdNsiImportResult.rowCount)} записей,
                        {' '}{formatNumber(emdNsiImportResult.typeCount)} видов;
                        на {emdNsiImportResult.reportingDate} активны
                        {' '}{formatNumber(emdNsiImportResult.activeTypeCount)},
                        доступны на ЕПГУ
                        {' '}{formatNumber(emdNsiImportResult.epguAvailableTypeCount)}.
                        {emdNsiImportResult.remdTypesOutsideReferenceCount > 0
                            && ` Вне справочника осталось видов РЭМД: ${formatNumber(emdNsiImportResult.remdTypesOutsideReferenceCount)}.`}
                    </Alert>
                )}

                {epguDocVisibilityImportResult && (
                    <Alert
                        severity={
                            epguDocVisibilityImportResult.warnings.length > 0
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        Справочник видимости на ЕПГУ (1253)
                        {epguDocVisibilityImportResult.sourceVersion
                            ? ` версии ${epguDocVisibilityImportResult.sourceVersion}`
                            : ''}{' '}
                        загружен: {formatNumber(epguDocVisibilityImportResult.typeCount)} видов МД,
                        {' '}сопоставлено с каталогом {formatNumber(epguDocVisibilityImportResult.matchedTypeCount)},
                        {' '}видимых на ЕПГУ {formatNumber(epguDocVisibilityImportResult.visibleTypeCount)}.
                        {epguDocVisibilityImportResult.unmatchedTypeCodes.length > 0
                            && ` Не найдено в каталоге 1520: ${epguDocVisibilityImportResult.unmatchedTypeCodes.join(', ')}.`}
                    </Alert>
                )}

                {perechen5prImportResult && (
                    <Alert
                        severity={
                            perechen5prImportResult.warnings.length > 0
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        Перечень видов СЭМД №5пр загружен:
                        {' '}{formatNumber(perechen5prImportResult.rowCount)} строк,
                        {' '}сопоставлено с каталогом {formatNumber(perechen5prImportResult.matchedTypeCount)}.
                        {perechen5prImportResult.unmatchedTypeCodes.length > 0
                            && ` Не найдено в каталоге 1520: ${perechen5prImportResult.unmatchedTypeCodes.join(', ')}.`}
                    </Alert>
                )}

                {inclusionRegisterResults && inclusionRegisterResults.length > 0 && (
                    <Alert
                        severity={
                            inclusionRegisterResults.some((r) => r.warnings.length > 1)
                                ? 'warning'
                                : 'success'
                        }
                        sx={{ mb: 1, py: 0, maxHeight: 64, overflow: 'auto', flexShrink: 0 }}
                    >
                        Перечней входимости загружено: {inclusionRegisterResults.length}.
                        {inclusionRegisterResults.map((r) => (
                            ` Вид ${r.semdTypeCode}: ${formatNumber(r.factTotal)}`
                            + ` из ${formatNumber(r.planTotal)} ТВСП.`
                        )).join('')}
                    </Alert>
                )}

                {tpggExecutionResults && tpggExecutionResults.length > 0 && (
                    <Alert
                        severity={
                            tpggExecutionResults.some((result) => result.warnings.length > 0)
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        Файлов исполнения ТПГГ загружено: {tpggExecutionResults.length}.
                        {' '}Листов терпрограммы:{' '}
                        {[...new Set(tpggExecutionResults.flatMap((r) => r.sheetCodes))].join(', ')}.
                        {' '}Случаев по факту:{' '}
                        {formatNumber(
                            tpggExecutionResults.reduce((sum, r) => sum + r.factTotal, 0),
                        )}
                        {' '}при плане{' '}
                        {formatNumber(
                            tpggExecutionResults.reduce((sum, r) => sum + r.planTotal, 0),
                        )}.
                        {tpggExecutionResults.some((r) => r.unmatchedOrganizationNames.length > 0)
                            && ' Часть организаций вне справочника МО — они сохранены справочно.'}
                    </Alert>
                )}

                {remdIntervalImportResults && remdIntervalImportResults.length > 0 && (
                    <Alert
                        severity={
                            remdIntervalImportResults.some(
                                (result) => result.warnings.length > 0,
                            )
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        {(() => {
                            const monthly = remdIntervalImportResults
                                .filter((result) => result.coverage === 'month')
                            const cumulative = remdIntervalImportResults
                                .filter((result) => result.coverage === 'cumulative')
                            // Последняя нарастающая и есть числитель показателя 27 —
                            // ради неё загрузка и делается, поэтому число видов вынесено.
                            const latest = cumulative
                                .reduce<RemdIntervalImportResult | null>(
                                    (best, result) => (
                                        !best || result.month > best.month ? result : best
                                    ),
                                    null,
                                )
                            return (
                                <>
                                    Выгрузок РЭМД загружено: {remdIntervalImportResults.length}.
                                    {monthly.length > 0 && (
                                        <>
                                            {' '}Помесячных {monthly.length}
                                            {' '}({monthly
                                                .map((result) => monthName(result.month))
                                                .join(', ')}).
                                        </>
                                    )}
                                    {latest && (
                                        <>
                                            {' '}Нарастающих {cumulative.length}, последняя
                                            {' '}по {monthName(latest.month)}:
                                            {' '}уникальных видов {formatNumber(latest.uniqueTypeCount)},
                                            {' '}МО {formatNumber(latest.matchedOrganizationCount)},
                                            {' '}документов {formatNumber(latest.documentCount)}.
                                            {' '}Числитель показателя «Виды СЭМД в РЭМД»
                                            {' '}считается по ней.
                                        </>
                                    )}
                                </>
                            )
                        })()}
                    </Alert>
                )}

                {remdNumeratorImportResult && (
                    <Alert
                        severity={
                            remdNumeratorImportResult.warnings.length > 0
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        Числитель РЭМД («{remdNumeratorImportResult.sheetName}») загружен:
                        {' '}{formatNumber(remdNumeratorImportResult.rowCount)} строк,
                        {' '}целевых МО в справочнике {formatNumber(remdNumeratorImportResult.directoryOrganizationCount)},
                        {' '}МО сопоставлено {formatNumber(remdNumeratorImportResult.matchedOrganizationCount)},
                        {' '}видов сопоставлено {formatNumber(remdNumeratorImportResult.matchedTypeCount)},
                        {' '}фактов сохранено {formatNumber(remdNumeratorImportResult.factCount)}.
                        {remdNumeratorImportResult.excludedOrganizationOids.length > 0
                            && ` Вне контура 37 МО пропущено организаций: ${formatNumber(remdNumeratorImportResult.excludedOrganizationOids.length)}.`}
                        {' '}Разбивка по подразделениям: {formatNumber(remdNumeratorImportResult.subdivisionFactCount)} записей,
                        {' '}подразделений сопоставлено с ФРМР {formatNumber(remdNumeratorImportResult.matchedSubdivisionCount)}
                        {remdNumeratorImportResult.unknownSubdivisionFactCount > 0
                            && `, подразделение неизвестно у ${formatNumber(remdNumeratorImportResult.unknownSubdivisionFactCount)}`}.
                        {remdNumeratorImportResult.unmatchedOrganizationOids.length > 0
                            && ` Не найдено МО: ${formatNumber(remdNumeratorImportResult.unmatchedOrganizationOids.length)}.`}
                        {remdNumeratorImportResult.unmatchedDocumentTypeNames.length > 0
                            && ` Не сопоставлено видов: ${formatNumber(remdNumeratorImportResult.unmatchedDocumentTypeNames.length)}.`}
                    </Alert>
                )}

                {frmrImportResult && (
                    <Alert
                        severity={
                            frmrImportResult.warnings.length > 0 ? 'warning' : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        ФРМР загружен: {formatNumber(frmrImportResult.recordCount)} записей,
                        {' '}{formatNumber(frmrImportResult.organizationCount)} уникальных организаций,
                        {' '}сопоставлено с МО {formatNumber(frmrImportResult.matchedOrganizationCount)}.
                        {' '}Подразделений сохранено {formatNumber(frmrImportResult.savedSubdivisionCount)}
                        {' '}({formatNumber(frmrImportResult.subdivisionTypeCount)} типов,
                        {' '}{formatNumber(frmrImportResult.subdivisionKindCount)} видов).
                        {frmrImportResult.unmatchedOrganizationOids.length > 0
                            && ` Вне справочника МО: ${formatNumber(frmrImportResult.unmatchedOrganizationOids.length)}.`}
                    </Alert>
                )}

                {deletedPeriodResult && (
                    <Alert
                        severity="success"
                        onClose={() => setDeletedPeriodResult(null)}
                        sx={{ mb: 1, py: 0, maxHeight: 64, overflow: 'auto', flexShrink: 0 }}
                    >
                        Период «{deletedPeriodResult.period.name}» удалён.
                        {' '}Снято фактов РЭМД — {formatNumber(deletedPeriodResult.counts.remdFacts)},
                        {' '}значений по МО — {formatNumber(deletedPeriodResult.counts.organizationValues)},
                        {' '}находок — {formatNumber(deletedPeriodResult.counts.diagnosticFindings)},
                        {' '}записей журнала загрузок — {formatNumber(deletedPeriodResult.counts.importRuns)}.
                    </Alert>
                )}

                {organizationDirectoryResult && (
                    <Alert
                        severity={
                            organizationDirectoryResult.warnings.length > 0 ? 'warning' : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        Справочник признаков МО сохранён:
                        {' '}{formatNumber(organizationDirectoryResult.savedOrganizationCount)} МО,
                        {organizationDirectoryResult.createdOrganizationCount > 0 && (
                            <>
                                {' '}из них заведено заново —
                                {' '}{formatNumber(organizationDirectoryResult.createdOrganizationCount)},
                            </>
                        )}
                        {' '}прикреплённое население —
                        {' '}{formatNumber(organizationDirectoryResult.attachedPopulationCount)},
                        {' '}детское —
                        {' '}{formatNumber(organizationDirectoryResult.attachedChildPopulationCount)}.
                        {' '}Чтобы признаки попали в знаменатель, переимпортируйте матрицу применимости.
                    </Alert>
                )}

                {tpggImportResult && (
                    <Alert
                        severity={
                            tpggImportResult.warnings.length > 0
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        ТПГГ за {tpggImportResult.reportingYear} год применена:
                        {' '}{formatNumber(tpggImportResult.planValueCount)} исходных строк,
                        сопоставлено {formatNumber(tpggImportResult.matchedOrganizationCount)} МО.
                        Правила: обязательно — {formatNumber(tpggImportResult.requiredCount)},
                        не требуется — {formatNumber(tpggImportResult.notRequiredCount)},
                        не определено — {formatNumber(tpggImportResult.unknownCount)}.
                        {tpggImportResult.protectedRequirementCount > 0
                            && ` Защищено более приоритетных правил: ${formatNumber(tpggImportResult.protectedRequirementCount)}.`}
                    </Alert>
                )}

                {applicabilityMatrixResult && (
                    <Alert
                        severity={
                            applicabilityMatrixResult.unknownCount > 0
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        Матрица СЭМД применена: {formatNumber(applicabilityMatrixResult.normalizedRuleCount)} правил,
                        {' '}{formatNumber(applicabilityMatrixResult.semdTypeCount)} видов СЭМД,
                        {' '}{formatNumber(applicabilityMatrixResult.organizationCount)} МО.
                        Полный расчет получен для
                        {' '}{formatNumber(applicabilityMatrixResult.finalOrganizationCount)} МО;
                        не определено пар МО × СЭМД —
                        {' '}{formatNumber(applicabilityMatrixResult.unknownCount)}.
                    </Alert>
                )}

                {targetPlanResult && (
                    <Alert
                        severity={
                            targetPlanResult.warnings.length > 0
                                ? 'warning'
                                : 'success'
                        }
                        sx={{
                            mb: 1,
                            py: 0,
                            maxHeight: 64,
                            overflow: 'auto',
                            flexShrink: 0,
                        }}
                    >
                        План целевых значений применен: обновлено показателей
                        {' '}{formatNumber(targetPlanResult.updatedCount)}.
                    </Alert>
                )}

                {tab === 'indicators' ? (
                    <IndicatorsTab
                        loading={loading}
                        summary={summary}
                        selectedPeriod={selectedPeriod}
                        rows={rows}
                        onOpenDashboard={handleOpenIndicatorDashboard}
                        onEdit={handleEdit}
                    />
                ) : tab === 'dashboard' ? (
                    <DashboardTab
                        dashboardSplitRef={dashboardSplitRef}
                        organizationRowRefs={organizationRowRefs}
                        organizationsPanelOpen={organizationsPanelOpen}
                        organizationsPanelWidth={organizationsPanelWidth}
                        organizationsPanelResizing={organizationsPanelResizing}
                        dashboardLoading={dashboardLoading}
                        dashboard={dashboard}
                        selectedDiagnostics={selectedDiagnostics}
                        selectedOrganizationOid={selectedOrganizationOid}
                        selectedPeriodId={selectedPeriodId}
                        selectedDashboardIndicatorId={selectedDashboardIndicatorId}
                        organizationSearch={organizationSearch}
                        organizationSortOrder={organizationSortOrder}
                        filteredOrganizations={filteredOrganizations}
                        onMapOrganizationChange={handleMapOrganizationChange}
                        onOpenInstitutionDetails={handleOpenInstitutionDetails}
                        onIndicatorChange={handleDashboardIndicatorChange}
                        onTogglePanel={handleToggleOrganizationsPanel}
                        onResizeStart={handleOrganizationsResizeStart}
                        onSearchChange={setOrganizationSearch}
                        onSortOrderChange={setOrganizationSortOrder}
                        onToggleOrganization={handleToggleSelectedOrganization}
                        onOpenRegionSemdTypes={() => setRegionSemdTypesOpen(true)}
                        onOpenSemdTypeRegistryTypes={() => setSemdTypeRegistryOpen(true)}
                        onOpenVolumeRatioGap={() => setVolumeRatioGapOpen(true)}
                        onOpenMonthlyDynamics={() => setMonthlyDynamicsOpen(true)}
                        onOpenGisAvailability={() => setGisAvailabilityOpen(true)}
                        onOpenRegionDiagnostics={handleOpenRegionDiagnostics}
                    />
                ) : tab === 'history' ? (
                    <HistoryTab
                        historyLoading={historyLoading}
                        imports={imports}
                        selectedPeriodId={selectedPeriodId}
                        importing={importing}
                        downloadingImportId={downloadingImportId}
                        onRefresh={() => void loadImports(selectedPeriodId)}
                        onOpenPreview={(importRun) => void handleOpenImportPreview(importRun)}
                        onDownload={(importRun) => void handleDownloadImport(importRun)}
                    />
                ) : tab === 'organizations' ? (
                    <OrganizationsTab />
                ) : (
                    <SourcesReferenceTab loadedSourceTypes={loadedSourceTypes} />
                )}
            </Container>

            <InstitutionDetailsDialog
                institutionDetails={institutionDetails}
                institutionDetailsSearch={institutionDetailsSearch}
                institutionDetailsFilter={institutionDetailsFilter}
                filteredInstitutionTypes={filteredInstitutionTypes}
                requirementHistoryLoading={requirementHistoryLoading}
                onClose={handleCloseInstitutionDetails}
                onSearchChange={setInstitutionDetailsSearch}
                onFilterChange={setInstitutionDetailsFilter}
                onOpenRequirementHistory={() => void handleOpenRequirementHistory()}
                onOpenRequirementOverride={handleOpenRequirementOverride}
            />

            <RequirementHistoryDialog
                open={requirementHistoryOpen}
                institutionDetails={institutionDetails}
                requirementHistoryLoading={requirementHistoryLoading}
                requirementHistoryError={requirementHistoryError}
                requirementHistory={requirementHistory}
                onClose={() => setRequirementHistoryOpen(false)}
            />

            <RequirementOverrideDialog
                editingInstitutionType={editingInstitutionType}
                requirementOverrideStatus={requirementOverrideStatus}
                requirementOverrideReason={requirementOverrideReason}
                requirementOverrideSaving={requirementOverrideSaving}
                requirementOverrideError={requirementOverrideError}
                onClose={handleCloseRequirementOverride}
                onStatusChange={setRequirementOverrideStatus}
                onReasonChange={handleRequirementOverrideReasonChange}
                onSave={(status) => void handleSaveRequirementOverride(status)}
            />

            <RemdImportPreviewDialog
                importPreview={importPreview}
                importing={importing}
                onCancel={() => void handleCancelImportPreview()}
                onConfirm={() => void handleConfirmImport()}
            />

            <TpggImportPreviewDialog
                tpggImportPreview={tpggImportPreview}
                importing={importing}
                onCancel={() => void handleCancelTpggImportPreview()}
                onConfirm={() => void handleConfirmTpggImport()}
            />

            <DeletePeriodDialog
                preview={deletePeriodPreview}
                deleting={deletingPeriod}
                onCancel={() => setDeletePeriodPreview(null)}
                onConfirm={() => void handleConfirmDeletePeriod()}
            />

            <OrganizationDirectoryPreviewDialog
                directoryImportPreview={organizationDirectoryPreview}
                importing={importing}
                onCancel={() => void handleCancelOrganizationDirectoryPreview()}
                onConfirm={() => void handleConfirmOrganizationDirectory()}
            />

            <ApplicabilityMatrixPreviewDialog
                previewResult={applicabilityMatrixPreview}
                importing={importing}
                onCancel={() => void handleCancelApplicabilityMatrixPreview()}
                onConfirm={() => void handleConfirmApplicabilityMatrix()}
            />

            <TargetPlanPreviewDialog
                targetPlanPreview={targetPlanPreview}
                importing={importing}
                onCancel={() => void handleCancelTargetPlanImportPreview()}
                onConfirm={() => void handleConfirmTargetPlanImport()}
            />

            <RegionSemdTypesDialog
                open={regionSemdTypesOpen}
                types={dashboard.pilotRegionSemdTypes}
                onClose={() => setRegionSemdTypesOpen(false)}
            />

            <SemdTypeRegistryDialog
                open={semdTypeRegistryOpen}
                types={dashboard.semdTypeRegistryTypes}
                onClose={() => setSemdTypeRegistryOpen(false)}
            />

            <VolumeRatioGapDialog
                open={volumeRatioGapOpen}
                indicatorTitle={indicatorMenuLabel(
                    dashboard.indicators.find(
                        (indicator) => indicator.id === selectedDashboardIndicatorId,
                    ) ?? { code: '' },
                )}
                organizations={dashboard.organizations}
                onClose={() => setVolumeRatioGapOpen(false)}
            />

            <MonthlyDynamicsDialog
                open={monthlyDynamicsOpen}
                periodId={selectedPeriodId}
                indicatorId={selectedDashboardIndicatorId || null}
                indicatorTitle={indicatorMenuLabel(
                    dashboard.indicators.find(
                        (indicator) => indicator.id === selectedDashboardIndicatorId,
                    ) ?? { code: '' },
                )}
                organizations={dashboard.organizations}
                onClose={() => setMonthlyDynamicsOpen(false)}
            />

            <DiagnosticFindingsDialog
                open={regionDiagnosticsOpen}
                scope="region"
                organizationName="Все МО региона"
                findings={regionDiagnostics}
                organizationNameByOid={organizationNameByOid}
                onClose={() => setRegionDiagnosticsOpen(false)}
            />

            <GisAvailabilityDialog
                open={gisAvailabilityOpen}
                onClose={() => setGisAvailabilityOpen(false)}
                onChanged={() => {
                    // Р3: изменение справочника ГИС меняет зону причин — пересчитываем период
                    // и обновляем дашборд.
                    if (!selectedPeriodId) return
                    void (async () => {
                        try {
                            await recalculatePilotIndicator(selectedPeriodId)
                        } finally {
                            void loadDashboard(
                                selectedPeriodId,
                                selectedDashboardIndicatorId || undefined,
                            )
                        }
                    })()
                }}
            />

            <PeriodDialog
                open={periodDialogOpen}
                saving={saving}
                periodForm={periodForm}
                onFormChange={setPeriodForm}
                onClose={() => setPeriodDialogOpen(false)}
                onSave={() => void handleCreatePeriod()}
            />

            <EditIndicatorValueDialog
                editingIndicator={editingIndicator}
                valueForm={valueForm}
                saving={saving}
                selectedPeriodId={selectedPeriodId}
                onFormChange={setValueForm}
                onClose={handleCloseEdit}
                onSave={() => void handleSaveValue()}
            />
        </Box>
    )
}
