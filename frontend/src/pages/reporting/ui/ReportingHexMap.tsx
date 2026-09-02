import {
    type PointerEvent as ReactPointerEvent,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {
    Box,
    Button,
    Chip,
    Divider,
    IconButton,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import type {
    ReportingDiagnosticFinding,
    ReportingOrganizationIndicatorValue,
} from '@shared/lib/reporting-api'
import {
    MINZDRAV_PERCENT_SCALE,
    minzdravPercentBandIndex,
    minzdravPercentColor,
    semdTypeCountLabel,
    semdTypeCountText,
    semdTypeRegistryDetails,
    semdVolumeRatioDetails,
    semdVolumeRatioStatusLabel,
    targetValueLabel,
    executionFactLabel,
    volumePlanLabel,
} from '../lib/reporting-helpers'
import { getInstitutionCellLabel } from '../model/institution-cell-labels'
import { groupFindings } from '../lib/diagnostic-findings'
import { DiagnosticFindingsDialog } from './DiagnosticFindingsDialog'

interface ReportingHexMapProps {
    organizations: ReportingOrganizationIndicatorValue[]
    diagnostics: ReportingDiagnosticFinding[]
    selectedOrganizationOid: string | null
    onSelectedOrganizationChange: (organizationOid: string | null) => void
    onOpenInstitutionDetails: (organizationOid: string) => void
}

interface CandidateCell {
    x: number
    y: number
}

interface HexCell extends CandidateCell {
    organization: ReportingOrganizationIndicatorValue
}

interface MapPan {
    x: number
    y: number
}

const VIEW_WIDTH = 980
const VIEW_HEIGHT = 620
const HEX_RADIUS = 34
const MIN_ZOOM = 1
const INITIAL_ZOOM = 1.25
const MAX_ZOOM = 2.5
const ZOOM_STEP = 0.25
const PILOT_INDICATOR_ID = 'semd_types_epgu_coverage'

const GEO_BOUNDS = {
    top: 57,
    bottom: 54,
    left: 61.7,
    right: 68.9,
}

function formatNumber(value: number | null | undefined): string {
    if (value === null || typeof value === 'undefined') return '-'
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

const HEX_NO_DATA_LABEL = 'Нет данных'
const HEX_PRELIMINARY_LABEL = 'Предв.'
/** ТЗ delta 2026-07-17, п.4 — «предварительно, скоро досчитается» (есть РЭМД, нет правил). */
const HEX_PRELIMINARY_COLOR = '#8a6d3b'
// На эталонной карте Минздрава объекты без данных — приглушённый сине-серый тон,
// который не читается ни как «плохо», ни как «хорошо» (там так показаны ЛНР/ДНР/ХРС/ЗПРЖ).
const HEX_NO_DATA_COLOR = '#5c6580'

// Р4: шкала Минздрава живёт в lib/reporting-helpers — той же шкалой красится полоса
// выполнения в списке МО (рекомендации 27.07, п.5).

// Р5 + рекомендации 27.07, п.6: МО, не участвующие в расчёте показателя (readiness =
// 'not_applicable', нет ни одного обязательного вида), красим в цвет основного поля карты —
// это не нулевое выполнение и не «истинный ноль».
/** Единая непрозрачность заливки соты — одинакова для всех МО, см. комментарий у polygon. */
const HEX_FILL_OPACITY = 0.95
const HEX_NOT_PARTICIPATING_COLOR = 'rgba(255,255,255,0.05)'
// Р5: АО «Курганфармация» держим в наборе только для справки — сота без заливки
// («цвета фона»), видна лишь рамка; на региональный процент не влияет.
const HEX_REFERENCE_FILL = 'rgba(255,255,255,0.05)'
const REFERENCE_ONLY_OIDS: ReadonlySet<string> = new Set([
    '1.2.643.5.1.13.13.12.3.45.167', // АО «Курганфармация»
])

/** Есть ли у МО вычисленный процент 6.1.3.2.7 (иначе — сота без числа). */
function pilotHasComputablePercent(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return organization.secondaryValue !== null
        && typeof organization.secondaryValue !== 'undefined'
}

/**
 * ТЗ delta 2026-07-17, п.4 — различаем два «беспроцентных» состояния соты:
 * «предварительно, скоро досчитается» (в РЭМД уже есть факты, но применимость видов к МО
 * ещё не определена → знаменатель не собран) vs «действительно нет данных» (в РЭМД по МО
 * вообще ничего нет). Разделитель — есть ли хоть один факт РЭМД (rawActiveTypeCount).
 */
function pilotHasRemdFacts(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return (detailNumber(organization.calculationDetails, 'rawActiveTypeCount') ?? 0) > 0
}

/** Р5: МО показывается только для справки (например, АО «Курганфармация»). */
function isReferenceOnlyOrganization(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return REFERENCE_ONLY_OIDS.has(organization.organizationOid)
}

/** Р5: МО не участвует в показателе — нет ни одного обязательного вида (знаменатель 0). */
function isPilotNotParticipating(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return organization.indicatorId === PILOT_INDICATOR_ID
        && String(organization.calculationDetails?.readiness ?? '') === 'not_applicable'
}

function formatHexValue(organization: ReportingOrganizationIndicatorValue): string {
    if (organization.indicatorId === PILOT_INDICATOR_ID) {
        // Р5: справочные МО и «не участвует» — без процента, короткий прочерк.
        if (
            isReferenceOnlyOrganization(organization)
            || isPilotNotParticipating(organization)
        ) {
            return '—'
        }
        if (pilotHasComputablePercent(organization)) {
            return `${formatNumber(organization.secondaryValue)}%`
        }
        // Беспроцентные соты: «предварительно» (есть РЭМД, нет правил) vs «нет данных».
        return pilotHasRemdFacts(organization)
            ? HEX_PRELIMINARY_LABEL
            : HEX_NO_DATA_LABEL
    }
    // Показатель 27: на соте — исполнение плана по матрице, а не доля от 145 видов
    // Перечня. Доля от Перечня по одной МО ничего не значит: районная больница
    // не обязана регистрировать патолого-анатомические виды, и 31 % у неё — норма,
    // а не провал. Доля от Перечня остаётся показателем региона и видна в карточке.
    const typeRegistryPlan = semdTypeRegistryDetails(organization)?.plan ?? null
    if (typeRegistryPlan !== null) {
        return typeRegistryPlan.percent === null
            ? '—'
            : `${formatNumber(typeRegistryPlan.percent)}%`
    }
    if (organization.factValue !== null) {
        return `${formatNumber(organization.factValue)}%`
    }
    // Доля к объёмам ТПГГ без знаменателя: ни процента, ни числа документов. Показать
    // здесь числитель значило бы выдать «53к» за выполнение показателя (7.1.2 ТЗ).
    if (semdVolumeRatioDetails(organization)) return '—'

    const numerator = organization.numerator ?? 0
    if (numerator >= 1_000_000) return `${(numerator / 1_000_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}м`
    if (numerator >= 1_000) return `${Math.round(numerator / 1_000).toLocaleString('ru-RU')}к`
    return formatNumber(numerator)
}

function isPreliminary(
    organization: ReportingOrganizationIndicatorValue,
): boolean {
    return organization.calculationDetails?.isPreliminary === true
}

function detailNumber(
    details: Record<string, unknown> | undefined,
    key: string,
): number | null {
    const parsed = Number(details?.[key])
    return Number.isFinite(parsed) ? parsed : null
}

/**
 * Сколько всего видов СЭМД разбирается по этой МО: правила определены + правила
 * не найдены + применимость неизвестна. Это то же число, что и целевое по показателю,
 * но взятое из расчёта, а не из подписи, — с 07.08.2026 их 36, а не 35.
 */
function organizationSemdTypeCount(
    organization: ReportingOrganizationIndicatorValue,
): number | null {
    const known = detailNumber(
        organization.calculationDetails,
        'knownApplicabilityCount',
    )
    if (known === null) return null
    const missing = detailNumber(
        organization.calculationDetails,
        'missingApplicabilityRuleCount',
    ) ?? 0
    const unknown = detailNumber(
        organization.calculationDetails,
        'unknownApplicabilityCount',
    ) ?? 0
    return known + missing + unknown
}

function formatApplicabilityProgress(
    organization: ReportingOrganizationIndicatorValue,
): string {
    const known = detailNumber(
        organization.calculationDetails,
        'knownApplicabilityCount',
    )
    const total = organizationSemdTypeCount(organization)
    if (known === null || total === null) return '-'
    return `${formatNumber(known)} / ${formatNumber(total)}`
}

function getOrganizationLabel(organization: ReportingOrganizationIndicatorValue): string {
    return getInstitutionCellLabel(
        organization.organizationOid,
        organization.organizationName,
    )
}

/**
 * Цвет соты для показателя 6.1.3.2.7 — по проценту исполнения, не по статусу
 * «предварительно/окончательно» (тот статус остаётся текстовой подписью, см.
 * statusLabel). Пороги и тона — из шкалы Минздрава MINZDRAV_PERCENT_SCALE (Р4).
 */
function pilotPercentColor(percent: number): string {
    return minzdravPercentColor(percent)
}

function statusColor(
    organization: ReportingOrganizationIndicatorValue,
    businessAssessmentMode: boolean,
): string {
    if (organization.indicatorId === PILOT_INDICATOR_ID) {
        if (isReferenceOnlyOrganization(organization)) return HEX_REFERENCE_FILL
        if (isPilotNotParticipating(organization)) return HEX_NOT_PARTICIPATING_COLOR
        if (pilotHasComputablePercent(organization)) {
            return pilotPercentColor(organization.secondaryValue as number)
        }
        return pilotHasRemdFacts(organization)
            ? HEX_PRELIMINARY_COLOR
            : HEX_NO_DATA_COLOR
    }
    // Показатель 27 с планом: цвет по шкале Минздрава от исполнения обязательных
    // видов — тот же язык, что у 6.1.3.2.7, и то же число на соте.
    const typeRegistryPlan = semdTypeRegistryDetails(organization)?.plan ?? null
    if (typeRegistryPlan !== null) {
        return typeRegistryPlan.percent === null
            ? HEX_NO_DATA_COLOR
            : minzdravPercentColor(typeRegistryPlan.percent)
    }
    if (organization.factValue !== null) {
        if (organization.businessStatus === 'target_met') return '#16843a'
        if (organization.businessStatus === 'critical') return '#c62828'
        if (organization.businessStatus === 'below_target') {
            return (organization.deviationValue ?? 0) >= -5 ? '#e6a700' : '#f06d1f'
        }
        return '#64748b'
    }
    const volumeRatio = semdVolumeRatioDetails(organization)
    if (volumeRatio) {
        // «Нет утверждённого объёма» и «не участвует» — те же два тона, что у 6.1.3.2.7
        // для справочных и не участвующих МО: не зелёный и не красный.
        return volumeRatio.status === 'no_approved_volume'
            ? HEX_PRELIMINARY_COLOR
            : HEX_NOT_PARTICIPATING_COLOR
    }
    if (businessAssessmentMode) return '#6b7280'

    const relative = organization.relativePercent ?? 0
    if ((organization.numerator ?? 0) <= 0) return '#6b7280'
    if (relative >= 75) return '#16843a'
    if (relative >= 50) return '#e6a700'
    if (relative >= 20) return '#f06d1f'
    return '#c62828'
}

function statusLabel(
    organization: ReportingOrganizationIndicatorValue,
    businessAssessmentMode: boolean,
): string {
    if (organization.indicatorId === PILOT_INDICATOR_ID) {
        if (isReferenceOnlyOrganization(organization)) return 'Справочно, вне процента'
        const readiness = String(
            organization.calculationDetails?.readiness ?? '',
        )
        if (readiness.startsWith('epgu_reference')) {
            return 'Нужен справочник ЭМД/НСИ'
        }
        if (readiness === 'applicability_incomplete') {
            return isPreliminary(organization)
                ? 'Предварительный расчет'
                : 'Применимость неполная'
        }
        if (readiness === 'not_applicable') return 'Не участвует в показателе'
    }
    // У показателя 27 целевого значения нет ни в одном перечне, зато есть план
    // по матрице применимости. «План не задан» на его карточке читалось бы как
    // отсутствие плана вообще — при том что план тут же показан числом видов.
    if (semdTypeRegistryDetails(organization)?.plan != null) {
        return 'План по матрице применимости'
    }
    if (organization.factValue !== null) {
        if (organization.targetValue === null) return 'План не задан'
        if (organization.businessStatus === 'target_met') return 'План выполнен'
        if (organization.businessStatus === 'critical') return 'Критическое отклонение'
        if (organization.businessStatus === 'below_target') return 'Ниже плана'
        // План может быть загружен раньше, чем пересчитан служебный
        // businessStatus. В этом случае наличие targetValue уже достаточно,
        // чтобы не показывать ошибочную плашку «План не задан».
        return organization.factValue >= organization.targetValue
            ? 'План выполнен'
            : 'Ниже плана'
    }
    const volumeRatio = semdVolumeRatioDetails(organization)
    if (volumeRatio) return semdVolumeRatioStatusLabel(volumeRatio.status)
    if (businessAssessmentMode) return 'Не оценено'
    if ((organization.numerator ?? 0) <= 0) return 'Нет передачи'
    return 'Оценка по объему'
}

function projectOrganization(organization: ReportingOrganizationIndicatorValue): CandidateCell {
    const latitude = organization.latitude ?? 55.44
    const longitude = organization.longitude ?? 65.34
    const xRatio = (longitude - GEO_BOUNDS.left) / (GEO_BOUNDS.right - GEO_BOUNDS.left)
    const yRatio = (GEO_BOUNDS.top - latitude) / (GEO_BOUNDS.top - GEO_BOUNDS.bottom)

    return {
        x: 120 + Math.min(1, Math.max(0, xRatio)) * 760,
        y: 80 + Math.min(1, Math.max(0, yRatio)) * 430,
    }
}

function buildCandidateCells(): CandidateCell[] {
    const rowColumns = [
        [3, 4, 5, 6, 7, 8],
        [2, 3, 4, 5, 6, 7, 8, 9, 10],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        [3, 4, 5, 6, 7, 8, 9, 10],
    ]

    return rowColumns.flatMap((columns, row) => (
        columns.map((column) => ({
            x: 105 + column * 62 + (row % 2) * 31,
            y: 88 + row * 58,
        }))
    ))
}

function buildHexLayout(organizations: ReportingOrganizationIndicatorValue[]): HexCell[] {
    const available = buildCandidateCells()
    const sorted = [...organizations].sort((left, right) => {
        const leftScore = left.numerator ?? 0
        const rightScore = right.numerator ?? 0
        return rightScore - leftScore
    })

    return sorted.map((organization, index) => {
        const target = projectOrganization(organization)
        let bestIndex = 0
        let bestDistance = Number.POSITIVE_INFINITY

        available.forEach((candidate, candidateIndex) => {
            const dx = candidate.x - target.x
            const dy = candidate.y - target.y
            const distance = dx * dx + dy * dy + index * 0.5
            if (distance < bestDistance) {
                bestDistance = distance
                bestIndex = candidateIndex
            }
        })

        const [cell] = available.splice(bestIndex, 1)
        return {
            organization,
            x: cell?.x ?? target.x,
            y: cell?.y ?? target.y,
        }
    })
}

function hexPoints(x: number, y: number, radius: number): string {
    return Array.from({ length: 6 }, (_, index) => {
        const angle = (Math.PI / 180) * (60 * index - 30)
        return `${x + radius * Math.cos(angle)},${y + radius * Math.sin(angle)}`
    }).join(' ')
}

function clampPan(pan: MapPan, zoom: number): MapPan {
    const width = VIEW_WIDTH / zoom
    const height = VIEW_HEIGHT / zoom
    const maxX = Math.max(0, (VIEW_WIDTH - width) / 2)
    const maxY = Math.max(0, (VIEW_HEIGHT - height) / 2)

    return {
        x: Math.min(maxX, Math.max(-maxX, pan.x)),
        y: Math.min(maxY, Math.max(-maxY, pan.y)),
    }
}

function getOrganizationOidFromPointerTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null
    return target
        .closest('[data-organization-oid]')
        ?.getAttribute('data-organization-oid') ?? null
}

export function ReportingHexMap({
    organizations,
    diagnostics,
    selectedOrganizationOid,
    onSelectedOrganizationChange,
    onOpenInstitutionDetails,
}: ReportingHexMapProps) {
    const cells = useMemo(() => buildHexLayout(organizations), [organizations])
    const hasBusinessAssessment = organizations.some(
        (organization) => organization.businessStatus !== 'not_assessed',
    )
    const isPilot = organizations[0]?.indicatorId === PILOT_INDICATOR_ID
    /**
     * Н18.2: у показателя 27 появился план по матрице применимости, и соты красятся
     * по его исполнению — по той же шкале Минздрава, что у 6.1.3.2.7.
     *
     * Оценка «выполнено / критично», как у долей, здесь не годится: план считается
     * выполненным только при всех обязательных видах, поэтому любая МО ниже 90 %
     * попадала бы в «критично» — на данных 08.2026 это все 37 сот одного цвета,
     * то есть карта без информации.
     */
    const hasTypeRegistryPlan = organizations.some(
        (organization) => semdTypeRegistryDetails(organization)?.plan != null,
    )
    const hasUnassessedFacts = organizations.some(
        (organization) => organization.factValue !== null
            && organization.businessStatus === 'not_assessed',
    )
    // Подпись про предварительный расчёт вешается на то же условие, что и метка
    // «предварительно» на соте, — и с теми же исключениями, что в formatHexValue.
    // Без них справочная МО (АО «Курганфармация»: регистрации есть, обязательных
    // видов нет) держала подпись «не для всех МО определена полная применимость»
    // даже когда применимость определена у всех 37 МО.
    const hasPreliminaryFacts = isPilot && organizations.some(
        (organization) =>
            !isReferenceOnlyOrganization(organization)
            && !isPilotNotParticipating(organization)
            && (
                isPreliminary(organization)
                || (!pilotHasComputablePercent(organization)
                    && pilotHasRemdFacts(organization))
            ),
    )
    const [zoom, setZoom] = useState(INITIAL_ZOOM)
    const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 })
    const [isDraggingMap, setIsDraggingMap] = useState(false)
    const [diagnosticFindingsOpen, setDiagnosticFindingsOpen] = useState(false)
    const mapDragRef = useRef<{
        pointerId: number
        startClientX: number
        startClientY: number
        clientX: number
        clientY: number
        moved: boolean
        organizationOid: string | null
    } | null>(null)

    const selected = useMemo(() => {
        return organizations.find(
            (organization) => organization.organizationOid === selectedOrganizationOid,
        ) ?? null
    }, [organizations, selectedOrganizationOid])
    /** Детали доли к объёмам ТПГГ — `null` у показателей с другим расчётом. */
    const selectedVolumeRatio = useMemo(
        () => (selected ? semdVolumeRatioDetails(selected) : null),
        [selected],
    )
    /** Детали показателя 27 «Виды СЭМД, регистрируемые в РЭМД». */
    const selectedTypeRegistry = useMemo(
        () => (selected ? semdTypeRegistryDetails(selected) : null),
        [selected],
    )
    const selectedDiagnostics = useMemo(() => (
        diagnostics.filter(
            (finding) => finding.organizationOid === selectedOrganizationOid,
        )
    ), [diagnostics, selectedOrganizationOid])
    const selectedSemdTypeCount = semdTypeCountLabel(
        selected ? organizationSemdTypeCount(selected) : null,
    )
    /**
     * FR-11: панель в карточке МО показывает те же сгруппированные причины, что и диалог.
     * Пока она считала сырые находки, счётчик «Показать ещё 6» обещал 6 строк, а в диалоге
     * открывалась одна сгруппированная карточка.
     */
    const selectedDiagnosticGroups = useMemo(
        () => groupFindings(selectedDiagnostics),
        [selectedDiagnostics],
    )
    useEffect(() => {
        setPan((value) => clampPan(value, zoom))
    }, [zoom])

    const viewBox = useMemo(() => {
        const width = VIEW_WIDTH / zoom
        const height = VIEW_HEIGHT / zoom
        const clampedPan = clampPan(pan, zoom)
        const x = (VIEW_WIDTH - width) / 2 + clampedPan.x
        const y = (VIEW_HEIGHT - height) / 2 + clampedPan.y
        return `${x} ${y} ${width} ${height}`
    }, [pan, zoom])
    const hasMapTransform =
        zoom !== MIN_ZOOM
        || Math.abs(pan.x) > 0.5
        || Math.abs(pan.y) > 0.5
    const handleZoomChange = (direction: 1 | -1) => {
        setZoom((value) => Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, value + direction * ZOOM_STEP),
        ))
    }
    const handleMapPointerDown = (
        event: ReactPointerEvent<SVGSVGElement>,
    ) => {
        if (event.button !== 0) return
        mapDragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            clientX: event.clientX,
            clientY: event.clientY,
            moved: false,
            organizationOid: getOrganizationOidFromPointerTarget(event.target),
        }
        setIsDraggingMap(true)
        event.currentTarget.setPointerCapture(event.pointerId)
    }
    const handleMapPointerMove = (
        event: ReactPointerEvent<SVGSVGElement>,
    ) => {
        const drag = mapDragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return

        const deltaClientX = event.clientX - drag.clientX
        const deltaClientY = event.clientY - drag.clientY
        const totalDeltaX = event.clientX - drag.startClientX
        const totalDeltaY = event.clientY - drag.startClientY

        if (Math.hypot(totalDeltaX, totalDeltaY) > 4) {
            drag.moved = true
        }

        drag.clientX = event.clientX
        drag.clientY = event.clientY

        if (deltaClientX === 0 && deltaClientY === 0) return

        const rect = event.currentTarget.getBoundingClientRect()
        const viewWidth = VIEW_WIDTH / zoom
        const viewHeight = VIEW_HEIGHT / zoom
        const deltaSvgX = (deltaClientX / rect.width) * viewWidth
        const deltaSvgY = (deltaClientY / rect.height) * viewHeight

        setPan((value) => clampPan({
            x: value.x - deltaSvgX,
            y: value.y - deltaSvgY,
        }, zoom))
    }
    const handleMapPointerEnd = (
        event: ReactPointerEvent<SVGSVGElement>,
    ) => {
        const drag = mapDragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        mapDragRef.current = null
        setIsDraggingMap(false)

        if (!drag.moved && drag.organizationOid) {
            onSelectedOrganizationChange(
                selectedOrganizationOid === drag.organizationOid
                    ? null
                    : drag.organizationOid,
            )
        }
    }
    const handleMapReset = () => {
        setZoom(MIN_ZOOM)
        setPan({ x: 0, y: 0 })
    }
    /**
     * Р4: на эталонной легенде Минздрава рядом с каждым тоном стоит количество объектов
     * («60-86.89% - 16 субъектов РФ»). Считаем то же по МО: в диапазоны попадают только
     * МО с вычислимым процентом, справочные и неучаствующие идут отдельными строками.
     */
    const legendCounts = useMemo(() => {
        const bands = MINZDRAV_PERCENT_SCALE.map(() => 0)
        let notParticipating = 0
        let reference = 0
        let withoutPlan = 0
        for (const organization of organizations) {
            const plan = semdTypeRegistryDetails(organization)?.plan ?? null
            if (plan !== null) {
                if (plan.percent === null) withoutPlan += 1
                else bands[minzdravPercentBandIndex(plan.percent)] += 1
                continue
            }
            if (isReferenceOnlyOrganization(organization)) {
                reference += 1
                continue
            }
            if (isPilotNotParticipating(organization)) {
                notParticipating += 1
                continue
            }
            if (!pilotHasComputablePercent(organization)) continue
            bands[minzdravPercentBandIndex(Number(organization.secondaryValue))] += 1
        }
        return { bands, notParticipating, reference, withoutPlan }
    }, [organizations])

    const legendItems: Array<{
        label: string
        color: string
        /** Сколько МО попало в диапазон; не задаётся для служебных состояний. */
        count?: number
        // Р4: для 6.1.3.2.7 заливка соты всегда идёт по шкале Минздрава (см. statusColor),
        // поэтому легенда обязана объяснять именно её. Раньше при наличии бизнес-оценки
        // легенда переключалась на «выполнено/критично» и описывала не те цвета, что на карте.
    }> = isPilot
        ? [
            ...MINZDRAV_PERCENT_SCALE.map((band, index) => ({
                label: band.label,
                color: band.color,
                count: legendCounts.bands[index],
            })),
            {
                label: 'не участвует',
                color: HEX_NOT_PARTICIPATING_COLOR,
                count: legendCounts.notParticipating,
            },
            { label: 'предварительно', color: HEX_PRELIMINARY_COLOR },
            { label: 'нет данных', color: HEX_NO_DATA_COLOR },
        ]
        // Н18.2: у показателя 27 та же шкала, что у 6.1.3.2.7, но считается она
        // от исполнения плана, а «не участвует» и «предварительно» здесь не бывает.
        : hasTypeRegistryPlan
        ? [
            ...MINZDRAV_PERCENT_SCALE.map((band, index) => ({
                label: band.label,
                color: band.color,
                count: legendCounts.bands[index],
            })),
            {
                label: 'нет обязательных видов',
                color: HEX_NO_DATA_COLOR,
                count: legendCounts.withoutPlan,
            },
        ]
        : hasBusinessAssessment
        ? [
            { label: 'выполнено', color: '#16843a' },
            { label: 'до 5 п.п.', color: '#e6a700' },
            { label: 'ниже', color: '#f06d1f' },
            { label: 'критично', color: '#c62828' },
            { label: 'нет оценки', color: '#6b7280' },
        ]
        : [
            { label: 'высокий', color: '#16843a' },
            { label: 'средний', color: '#e6a700' },
            { label: 'низкий', color: '#f06d1f' },
            { label: 'критичный', color: '#c62828' },
        ]

    return (
        <Box
            onWheel={(event) => {
                // Диалоги MUI рендерятся через portal, но React-событие всё равно
                // всплывает по дереву компонентов до карты. Масштабируем карту только
                // для колеса, которое физически произошло внутри её DOM-контейнера.
                if (
                    !(event.target instanceof Node)
                    || !event.currentTarget.contains(event.target)
                ) return
                event.preventDefault()
                const direction = event.deltaY < 0 ? 1 : -1
                handleZoomChange(direction)
            }}
            sx={{
                position: 'relative',
                flex: 1,
                minHeight: 0,
                bgcolor: '#10162b',
                overflow: 'hidden',
            }}
        >
            <Box
                component="svg"
                viewBox={viewBox}
                role="img"
                aria-label="Сотовая карта медицинских организаций Курганской области"
                onPointerDown={handleMapPointerDown}
                onPointerMove={handleMapPointerMove}
                onPointerUp={handleMapPointerEnd}
                onPointerCancel={handleMapPointerEnd}
                sx={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    cursor: isDraggingMap
                        ? 'grabbing'
                        : zoom > MIN_ZOOM
                            ? 'grab'
                            : 'default',
                    touchAction: 'none',
                    userSelect: 'none',
                }}
            >
                {/* ВКС 24.08.2026: «что это за разнотона? здесь светлее, здесь темнее…
                    какая-то полоска вертикальная под МРБ, уходящая вниз, и как будто
                    так окно». Под фон было положено четыре слоя: диагональный градиент,
                    контур области, декоративная клякса и пунктирная дуга. Осталась
                    только область — фон рисует контейнер (bgcolor выше) одним ровным
                    цветом, поэтому и <rect> с градиентом здесь больше нет.

                    «Окно» давал сам файл контура: это карта Викисклада, и первым
                    элементом в ней лежит фоновый прямоугольник 1000×760 цвета #f5f5f5.
                    Под `invert(1)` он становился тёмно-серым прямоугольником поверх
                    градиента — с краями, которые и читались как окно. Поэтому теперь
                    подключён `kurgan-oblast-silhouette.svg`: те же районы области,
                    но без фона, рек и соседних регионов, сплошной белой заливкой.
                    Инвертировать больше нечего, фильтр снят.

                    Геометрия <image> не тронута: viewBox исходника и preserveAspectRatio
                    те же, силуэт стоит ровно там же, где стоял контур, и соты
                    относительно него не сместились. */}
                <image
                    href="/maps/kurgan-oblast-silhouette.svg"
                    x="70"
                    y="55"
                    width="740"
                    height="460"
                    preserveAspectRatio="xMidYMid meet"
                    opacity="0.07"
                    pointerEvents="none"
                />
                {cells.map((cell) => {
                    const isActive = selected?.organizationOid === cell.organization.organizationOid
                    const color = statusColor(cell.organization, hasBusinessAssessment)
                    // Р5: справочная сота (Курганфармация) — только рамка, пунктиром.
                    const referenceOnly = isReferenceOnlyOrganization(cell.organization)
                    return (
                        <g
                            key={cell.organization.organizationOid}
                            data-organization-oid={cell.organization.organizationOid}
                            style={{ cursor: isDraggingMap ? 'grabbing' : 'pointer' }}
                        >
                            <polygon
                                points={hexPoints(cell.x, cell.y, HEX_RADIUS)}
                                fill={color}
                                stroke={isActive ? '#ffffff' : 'rgba(255,255,255,0.72)'}
                                strokeWidth={isActive ? 4 : 1.5}
                                strokeDasharray={referenceOnly ? '5 3' : undefined}
                                // Р4: непрозрачность одинакова для всех сот. Раньше она зависела
                                // от точности координат (approximate → 0.74), из-за чего 9 из 37 МО
                                // выглядели приглушённее при том же проценте. Метку точности убрали
                                // из карточки ещё 24.07, объяснения оттенку не осталось, а цвет соты
                                // по требованию означает только выполнение по шкале Минздрава.
                                opacity={HEX_FILL_OPACITY}
                                // ВКС 24.08.2026: «чтобы они не были в квадратике».
                                // У соты стояла feDropShadow с областью фильтра
                                // -40 %…180 % — прямоугольником вокруг шестиугольника.
                                // Тень с stdDeviation 5 заполняла его мягким тёмным
                                // пятном, и на светлых участках фона угол этого
                                // прямоугольника было видно. Тень снята: на ровном
                                // фоне соту достаточно отделяет собственная рамка.
                            />
                            <text
                                x={cell.x}
                                y={cell.y - 6}
                                textAnchor="middle"
                                fill="#ffffff"
                                fontSize="11"
                                fontWeight="800"
                                pointerEvents="none"
                            >
                                {getOrganizationLabel(cell.organization)}
                            </text>
                            {formatHexValue(cell.organization) === HEX_NO_DATA_LABEL ? (
                                <text
                                    x={cell.x}
                                    y={cell.y + 10}
                                    textAnchor="middle"
                                    fill="#ffffff"
                                    fontSize="9.5"
                                    fontWeight="700"
                                    pointerEvents="none"
                                >
                                    <tspan x={cell.x} dy="0">Нет</tspan>
                                    <tspan x={cell.x} dy="11">данных</tspan>
                                </text>
                            ) : (
                                <text
                                    x={cell.x}
                                    y={cell.y + 14}
                                    textAnchor="middle"
                                    fill="#ffffff"
                                    fontSize="11"
                                    fontWeight="700"
                                    pointerEvents="none"
                                >
                                    {formatHexValue(cell.organization)}
                                </text>
                            )}
                        </g>
                    )
                })}
            </Box>

            <Box
                sx={{
                    position: 'absolute',
                    left: 8,
                    bottom: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.4,
                    maxWidth: 'calc(100% - 126px)',
                    px: 0.75,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: 'rgba(8, 14, 29, 0.82)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    backdropFilter: 'blur(6px)',
                }}
            >
                {hasPreliminaryFacts && (
                    <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.67rem', lineHeight: 1.2 }}>
                        Предварительный расчет — не для всех МО определена полная применимость видов СЭМД
                    </Typography>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
                {legendItems.map((item) => (
                    <Stack key={item.label} direction="row" spacing={0.4} alignItems="center">
                        <Box
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                bgcolor: item.color,
                                flexShrink: 0,
                            }}
                        />
                        <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.67rem', lineHeight: 1 }}>
                            {typeof item.count === 'number'
                                ? `${item.label} — ${item.count} МО`
                                : item.label}
                        </Typography>
                    </Stack>
                ))}
                {/* У показателя 27 бизнес-оценки нет по решению, а не из-за нехватки
                    данных: знаменатель — Перечень № 5пр — загружен, целевого значения
                    у показателя не существует. Подпись «нужен знаменатель» здесь
                    отправила бы методолога искать несуществующую проблему. */}
                {hasUnassessedFacts && !hasBusinessAssessment && !hasTypeRegistryPlan && (
                    <Stack direction="row" spacing={0.4} alignItems="center">
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#64748b' }} />
                        <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.67rem', lineHeight: 1 }}>
                            нужен знаменатель
                        </Typography>
                    </Stack>
                )}
                </Box>
            </Box>

            <Stack
                spacing={0.25}
                sx={{
                    position: 'absolute',
                    right: 8,
                    bottom: 8,
                    p: 0.25,
                    borderRadius: 1,
                    bgcolor: 'rgba(255,255,255,0.94)',
                    boxShadow: 2,
                }}
            >
                <Tooltip title="Приблизить" placement="left">
                    <span>
                        <IconButton
                            size="small"
                            disabled={zoom >= MAX_ZOOM}
                            onClick={() => handleZoomChange(1)}
                            aria-label="Приблизить карту"
                        >
                            <ZoomInIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Отдалить" placement="left">
                    <span>
                        <IconButton
                            size="small"
                            disabled={zoom <= MIN_ZOOM}
                            onClick={() => handleZoomChange(-1)}
                            aria-label="Отдалить карту"
                        >
                            <ZoomOutIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title="Показать всю карту" placement="left">
                    <span>
                        <IconButton
                            size="small"
                            disabled={!hasMapTransform}
                            onClick={handleMapReset}
                            aria-label="Сбросить масштаб карты"
                        >
                            <CenterFocusStrongIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            </Stack>

            {selected && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 10,
                        right: 48,
                        left: { xs: 10, md: 'auto' },
                        width: { xs: 'auto', md: 340 },
                        maxHeight: 'calc(100% - 20px)',
                        overflowY: 'auto',
                        p: 1,
                        border: '1px solid rgba(255,255,255,0.18)',
                        borderRadius: 1,
                        bgcolor: 'rgba(14, 21, 39, 0.9)',
                        color: '#fff',
                        backdropFilter: 'blur(8px)',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                        <Typography variant="body2" fontWeight={800} sx={{ flex: 1, lineHeight: 1.25 }}>
                            {selected.organizationName}
                        </Typography>
                        <IconButton
                            size="small"
                            onClick={() => onSelectedOrganizationChange(null)}
                            aria-label="Закрыть карточку медицинской организации"
                            sx={{ color: '#fff', p: 0.25, mt: -0.25, mr: -0.25 }}
                        >
                            <CloseIcon sx={{ fontSize: 17 }} />
                        </IconButton>
                    </Box>
                    <Divider sx={{ my: 0.75, borderColor: 'rgba(255,255,255,0.16)' }} />
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {/* Рекомендации 27.07, п.8: оценка отклонения («Критическое отклонение» и т.п.)
                            из карточки убрана — на её месте показываем само исполнение. Информационные
                            статусы («не участвует», «справочно», «предварительный расчёт») остаются. */}
                        <Chip
                            size="small"
                            label={
                                isPilot && pilotHasComputablePercent(selected)
                                    ? `Исполнение ${formatNumber(selected.secondaryValue)} %`
                                    : statusLabel(selected, hasBusinessAssessment)
                            }
                            sx={{ bgcolor: statusColor(selected, hasBusinessAssessment), color: '#fff' }}
                        />
                    </Stack>
                    {isPilot ? (
                        <>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 0.75 }}>
                                {/* Рекомендации 27.07, п.7: привычный порядок — сначала План, затем Факт. */}
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        {isPreliminary(selected)
                                            ? 'Известно обязательных'
                                            : 'План'}
                                    </Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {selected.targetValue === null
                                            ? '-'
                                            : `${formatNumber(selected.targetValue)} видов`}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        {isPreliminary(selected)
                                            ? 'Возможные к оформлению'
                                            : 'Факт'}
                                    </Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {selected.factValue === null
                                            ? '-'
                                            : `${formatNumber(selected.factValue)} видов`}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        Правила определены
                                    </Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {formatApplicabilityProgress(selected)} видов
                                    </Typography>
                                </Box>
                            </Box>
                            {/* Рекомендации 27.07, п.8: строка «РЭМД до фильтра ЕПГУ и применимости»
                                убрана — общий анализ регистрации в РЭМД показывается отдельным показателем. */}
                            {isPreliminary(selected) && (
                                <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mt: 0.5 }}>
                                    Неизвестные виды не входят в знаменатель и не считаются нарушением МО.
                                </Typography>
                            )}
                            <Button
                                size="small"
                                variant="outlined"
                                onClick={() => onOpenInstitutionDetails(
                                    selected.organizationOid,
                                )}
                                sx={{
                                    mt: 0.75,
                                    width: '100%',
                                    color: '#fff',
                                    borderColor: 'rgba(255,255,255,0.38)',
                                    textTransform: 'none',
                                    '&:hover': {
                                        borderColor: '#fff',
                                        bgcolor: 'rgba(255,255,255,0.08)',
                                    },
                                }}
                            >
                                {/* В13 (ВКС 31.07): на демонстрации этот список спутали
                                    с региональным. Название должно называть организацию. */}
                                {selectedSemdTypeCount} видов по этой МО
                            </Button>
                        </>
                    ) : selectedTypeRegistry ? (
                        /* Показатель 27: числитель и знаменатель здесь — виды, а не
                           документы, поэтому общие подписи «Числитель / Факт» не годятся. */
                        <>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 0.75 }}>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        Регистрирует видов
                                    </Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {formatNumber(selectedTypeRegistry.registeredTypeCount)}
                                        {selected.denominator === null
                                            ? ''
                                            : ` из ${formatNumber(selected.denominator)}`}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>Доля</Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {selected.factValue === null
                                            ? '—'
                                            : `${formatNumber(selected.factValue)} %`}
                                    </Typography>
                                </Box>
                            </Box>
                            {/* Н18.2: план — число видов, обязательных этой МО по матрице
                                применимости. Показан рядом с исполнением, иначе процент
                                на соте не с чем сопоставить. */}
                            {selectedTypeRegistry.plan !== null && (
                                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 0.75 }}>
                                    <Box>
                                        <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                            План (обязательны)
                                        </Typography>
                                        <Typography variant="body2" fontWeight={800}>
                                            {semdTypeCountText(
                                                selectedTypeRegistry.plan.requiredTypeCount,
                                            )}
                                        </Typography>
                                    </Box>
                                    <Box>
                                        <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                            Исполнение плана
                                        </Typography>
                                        <Typography variant="body2" fontWeight={800}>
                                            {selectedTypeRegistry.plan.percent === null
                                                ? '—'
                                                : `${formatNumber(selectedTypeRegistry.plan.percent)} %`}
                                            {selectedTypeRegistry.plan.requiredTypeCount === 0
                                                ? ''
                                                : ` (${formatNumber(
                                                    selectedTypeRegistry.plan.registeredRequiredTypeCount,
                                                )} из ${formatNumber(
                                                    selectedTypeRegistry.plan.requiredTypeCount,
                                                )})`}
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                            {selectedTypeRegistry.typesOutsideRegistryCount > 0 && (
                                <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mt: 0.5 }}>
                                    Ещё {selectedTypeRegistry.typesOutsideRegistryCount} видов
                                    {' '}вне Перечня № 5пр — в расчёт не входят.
                                </Typography>
                            )}
                            {/* Требование Н18.2: без этой пометки заниженный план читается
                                как полный, а причина занижения — нерешённый вопрос
                                по семантике «условно» — остаётся невидимой. */}
                            {(selectedTypeRegistry.plan?.undefinedTypeCount ?? 0) > 0 && (
                                <Typography variant="caption" sx={{ display: 'block', color: '#fbbf24', mt: 0.5 }}>
                                    План занижен: по {selectedTypeRegistry.plan!.undefinedTypeCount}
                                    {' '}видам применимость не определена — в план они не вошли.
                                </Typography>
                            )}
                        </>
                    ) : selectedVolumeRatio ? (
                        /* Разметка методолога от 07.08.2026: «больница, план (госзадание),
                           факт (СЭМДы) и %». «План» здесь — утверждённый объём медпомощи
                           из терпрограммы, а не целевой процент показателя: целевой
                           вынесен отдельной строкой ниже, чтобы два «плана» не спутались.

                           С 15.08.2026 план накопительный, по месяц отчётной даты, и рядом
                           в скобках стоит годовой — формулировка Николая Ермакова на ВКС:
                           «накопительная цифра на текущий месяц, в скобках итоговая за год,
                           сравниваться будем с накопительной». */
                        <>
                            {/* Д-10 (ВКС 24.08.2026): «вот здесь третья колонка появляется —
                                законченные случаи по данным ГИС. И там вообще песня
                                становится». В макете методолога от 25.08 источник другой —
                                факт ТПГГ по реестрам ОМС, — но место и смысл те же:
                                план, сколько случаев прошло на самом деле, сколько СЭМД.

                                Первый ряд из трёх колонок, второй остаётся из двух:
                                порядок «план слева, факт справа» согласован 22.08,
                                и ломать его ради выравнивания сетки нельзя. */}
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0.5, mt: 0.75 }}>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        {volumePlanLabel(selectedVolumeRatio.throughMonth)}
                                    </Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {selected.denominator === null
                                            ? '—'
                                            : formatNumber(selected.denominator)}
                                        {selectedVolumeRatio.annualDenominator === null
                                            ? ''
                                            : ` (за год: ${formatNumber(
                                                selectedVolumeRatio.annualDenominator,
                                            )})`}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        {executionFactLabel(
                                            selectedVolumeRatio.execution?.fromMonth ?? null,
                                            selectedVolumeRatio.execution?.toMonth ?? null,
                                        )}
                                    </Typography>
                                    {/* Прочерк, а не ноль: Николай прямо описал сценарий
                                        показа — «в третьей колонке вместо прочерков
                                        появились цифры». Ноль означал бы, что случаев
                                        не было, а их просто не загрузили. */}
                                    <Typography variant="body2" fontWeight={800}>
                                        {selectedVolumeRatio.execution === null
                                            ? '—'
                                            : formatNumber(selectedVolumeRatio.execution.factValue)}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        Факт (СЭМД)
                                    </Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {formatNumber(selected.numerator)}
                                    </Typography>
                                </Box>
                            </Box>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 0.5 }}>
                                {/* Целевое — месячное из «Приложения 2», годовое в скобках.
                                    15.08.2026 методолог увидела «70 %» и приняла его
                                    за ошибку, помня годовые 95 %: без подписи месяца
                                    правильное число читается как чужое.

                                    Рекомендации 22.08.2026: целевое стоит слева, доля —
                                    справа. В строке выше порядок такой же — план слева,
                                    факт справа, — а при обратном порядке во второй строке
                                    взгляд сравнивал плановое с фактическим по диагонали. */}
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                        {targetValueLabel(selectedVolumeRatio.throughMonth)}
                                    </Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {selected.targetValue === null
                                            ? '—'
                                            : `${formatNumber(selected.targetValue)} %`}
                                        {selected.targetYearEndValue === null
                                            ? ''
                                            : ` (на конец года: ${formatNumber(
                                                selected.targetYearEndValue,
                                            )} %)`}
                                    </Typography>
                                </Box>
                                <Box>
                                    <Typography variant="caption" sx={{ color: '#cbd5e1' }}>Доля</Typography>
                                    <Typography variant="body2" fontWeight={800}>
                                        {selected.factValue === null
                                            ? '—'
                                            : `${formatNumber(selected.factValue)} %`}
                                    </Typography>
                                </Box>
                            </Box>
                            {/* Требование ТЗ методолога к 6.1.3.2.10: «выводим значения СЭМД
                                по обоим видам СЭМД». У показателей с одним видом строка одна. */}
                            {selectedVolumeRatio.numeratorByType.length > 1 && (
                                <Stack spacing={0.15} sx={{ mt: 0.75 }}>
                                    {selectedVolumeRatio.numeratorByType.map((type) => (
                                        <Box
                                            key={type.semdTypeCode}
                                            sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline' }}
                                        >
                                            <Typography
                                                variant="caption"
                                                sx={{ color: '#cbd5e1', flex: 1, minWidth: 0 }}
                                            >
                                                {type.semdTypeName || `Вид МД ${type.semdTypeCode}`}
                                            </Typography>
                                            <Typography variant="caption" fontWeight={800}>
                                                {formatNumber(type.documentCount)}
                                            </Typography>
                                        </Box>
                                    ))}
                                </Stack>
                            )}
                            {selectedVolumeRatio.status === 'no_approved_volume' && (
                                <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8', mt: 0.5 }}>
                                    СЭМД регистрируются, но объём по этим видам помощи
                                    терпрограммой не утверждён — делить не на что.
                                </Typography>
                            )}
                        </>
                    ) : (
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 0.75 }}>
                            <Box>
                                <Typography variant="caption" sx={{ color: '#cbd5e1' }}>Числитель</Typography>
                                <Typography variant="body2" fontWeight={800}>{formatNumber(selected.numerator)}</Typography>
                            </Box>
                            <Box>
                                <Typography variant="caption" sx={{ color: '#cbd5e1' }}>Факт</Typography>
                                <Typography variant="body2" fontWeight={800}>
                                    {selected.factValue === null ? '-' : `${formatNumber(selected.factValue)} %`}
                                </Typography>
                            </Box>
                            <Box>
                                <Typography variant="caption" sx={{ color: '#cbd5e1' }}>План</Typography>
                                <Typography variant="body2" fontWeight={800}>
                                    {selected.targetValue === null ? '-' : `${formatNumber(selected.targetValue)} %`}
                                </Typography>
                            </Box>
                            <Box>
                                <Typography variant="caption" sx={{ color: '#cbd5e1' }}>Отклонение</Typography>
                                <Typography variant="body2" fontWeight={800}>
                                    {selected.deviationValue === null
                                        ? '-'
                                        : `${selected.deviationValue > 0 ? '+' : ''}${formatNumber(selected.deviationValue)} п.п.`}
                                </Typography>
                            </Box>
                        </Box>
                    )}
                    {/* Н20: причины показываются у любого показателя, который их
                        порождает, — у 6.1.3.2.7 и у долей. Блок стоит после развилки,
                        а не внутри ветки: разметка карточки у них разная, а причины
                        и вход в полный разбор — общие. */}
                    {selectedDiagnostics.length > 0 && (
                        <>
                            <Divider sx={{ my: 0.75, borderColor: 'rgba(255,255,255,0.16)' }} />
                            <Typography variant="caption" fontWeight={800} sx={{ color: '#fff' }}>
                                Причины и действия
                            </Typography>
                            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                                {selectedDiagnosticGroups.slice(0, 3).map((group) => (
                                    <Box key={group.key}>
                                        <Typography variant="caption" sx={{ display: 'block', color: group.severity === 'error' ? '#f87171' : '#fbbf24', fontWeight: 700 }}>
                                            {group.cause}
                                        </Typography>
                                        {group.semdTypeNames.length > 0 && (
                                            <Typography variant="caption" sx={{ display: 'block', color: '#cbd5e1' }}>
                                                Затронуто видов СЭМД: {group.semdTypeNames.length}
                                            </Typography>
                                        )}
                                        {group.recommendation && (
                                            <Typography variant="caption" sx={{ display: 'block', color: '#e2e8f0' }}>
                                                <Box component="span" sx={{ color: '#7dd3fc', fontWeight: 800 }}>
                                                    Что сделать:{' '}
                                                </Box>
                                                {group.recommendation}
                                            </Typography>
                                        )}
                                    </Box>
                                ))}
                                {/* Кнопка есть всегда: даже когда причина одна, из панели
                                    нужен вход в полный разбор со списком видов. */}
                                <Button
                                    size="small"
                                    variant="text"
                                    onClick={() => setDiagnosticFindingsOpen(true)}
                                    sx={{
                                        alignSelf: 'flex-start',
                                        minWidth: 0,
                                        p: 0,
                                        color: '#7dd3fc',
                                        fontSize: 12,
                                        fontWeight: 800,
                                        lineHeight: 1.4,
                                        textTransform: 'none',
                                        '&:hover': {
                                            color: '#bae6fd',
                                            bgcolor: 'transparent',
                                            textDecoration: 'underline',
                                        },
                                    }}
                                >
                                    {selectedDiagnosticGroups.length > 3
                                        ? `Показать ещё ${selectedDiagnosticGroups.length - 3}`
                                        : 'Открыть все причины'}
                                </Button>
                            </Stack>
                        </>
                    )}
                </Box>
            )}

            <DiagnosticFindingsDialog
                open={diagnosticFindingsOpen}
                organizationName={selected?.organizationName ?? ''}
                findings={selectedDiagnostics}
                semdTypeCount={selectedSemdTypeCount}
                onClose={() => setDiagnosticFindingsOpen(false)}
                onOpenInstitutionDetails={() => {
                    if (!selected) return
                    setDiagnosticFindingsOpen(false)
                    onOpenInstitutionDetails(selected.organizationOid)
                }}
            />
        </Box>
    )
}
