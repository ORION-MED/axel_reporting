import {
    type FindingToSave,
    type OrganizationRow,
    type PilotCalculationReadiness,
    type PilotCalculationResult,
    type PilotInstitutionSemdStatus,
    type PilotRequirementStatus,
    type RequirementRow,
    type SemdTypeRow,
} from './pilot-calculation.types'

/**
 * Pure calculation & diagnostics layer for the 6.1.3.2.7 pilot indicator (roadmap step 1.3,
 * layers b+c: no database access anywhere in this file). Given already-fetched facts, rules
 * and manual overrides, these functions derive readiness/numerator/denominator/percent and
 * the diagnostic findings that explain the result. This is the part of the indicator that is
 * expected to become the reusable `IndicatorCalculator` contract in the roadmap's step 2 engine.
 */

/**
 * FR-11, пункт А-4 (решение от 29.07.2026) — единственный переключатель поведения.
 *
 * `false` (текущее): текст причины обезличен, название вида СЭМД в него не подставляется.
 * Причина «вид обязателен, возможность в ГИС есть, регистраций нет» становится одной
 * карточкой со списком затронутых видов в чипах вместо 27 одинаковых абзацев. Название вида
 * не теряется: находка несёт semdTypeId, и интерфейс показывает вид отдельным чипом
 * (группировка в DiagnosticFindingsDialog).
 *
 * `true` (прежнее): название подставляется внутрь формулировки, как в согласовательном
 * файле причин от 23.07.
 *
 * ОТКАТ: поставить `true`, пересобрать backend и выполнить пересчёт периода
 * (GET /api/reporting/pilot-calculation?periodId=…) либо любой импорт — тексты причин
 * перезапишутся. Ни миграций, ни правок фронтенда откат не требует.
 */
export const CAUSE_TEXT_INCLUDES_SEMD_NAME = false

/**
 * В12 (ВКС 31.07.2026): вид ведётся в другой информационной системе региона.
 *
 * Методолог, объясняя низкий процент Курганской поликлиники №2:
 *
 * > «В Курганской области льготные рецепты лекарственного обеспечения здесь выписываются
 * > в другой программе. Есть всего лишь несколько, по-моему, три медорганизации, которые
 * > участвуют в пилоте и регистрируют их в ГИСе… Поэтому льготный рецепт от большинства
 * > медорганизаций, работающих с льготным обеспечением, в РЭМД не регистрируется.»
 *
 * Перечень МО, участвующих в пилоте, отдельно не нужен: они те самые, у кого регистрации
 * по этому виду есть, а находка формируется только там, где регистраций нет. Поэтому
 * достаточно списка видов, а не пар «МО × вид».
 *
 * Ключ — код «Вид МД» (`SemdTypeRow.nsiOid`).
 *
 * **Согласовано 20.08.2026 с изменением текста** (причина № 17, вопрос В-09). Правило
 * задумывалось как третье состояние — «не вина МО и не пробел ГИС, документ просто
 * ведётся в другой программе». Методолог эту трактовку сняла:
 *
 * > «Для сервиса не важно, из какой ИС будет зарегистрирован СЭМД… Если оформляется
 * > в ГИС региона или в её компоненте, а СЭМД не регистрируется, значит: 1. МИАЦ
 * > не закупил функционал, 2. не выполняются все действия по оформлению, необходимые
 * > для регистрации в РЭМД.»
 *
 * Поэтому причина больше не оправдывает отсутствие регистраций, а называет факт, и
 * действие адресовано тому, кто его устраняет. Ведение в другой программе осталось
 * **основанием** правила (оно объясняет, почему вид выделен в отдельную находку),
 * но из текста для читателя ушло. Расчёт при этом остался прежним — прямое указание
 * методолога «оставляем расчёт, как есть сейчас».
 */
export const SEMD_TYPES_HANDLED_IN_EXTERNAL_SYSTEM: Readonly<Record<string, string>> = {
    '37': 'Льготные рецепты в Курганской области выписываются в другой программе;'
        + ' в РЭМД их регистрируют только МО — участники пилота.',
}

/**
 * Переключатель В12. `false` возвращает прежнее поведение: такие виды снова попадают
 * в причину «МО обязана формировать, возможность в ГИС есть, регистраций нет» с зоной МО.
 *
 * ОТКАТ: поставить `false`, пересобрать backend и пересчитать период — тексты причин
 * перезапишутся. Ни миграций, ни правок фронтенда откат не требует.
 */
export const SHOW_EXTERNAL_SYSTEM_CAUSE = true

export function externalSystemNote(nsiOid: string | null): string | null {
    if (!SHOW_EXTERNAL_SYSTEM_CAUSE) return null
    if (!nsiOid) return null
    return SEMD_TYPES_HANDLED_IN_EXTERNAL_SYSTEM[nsiOid.trim()] ?? null
}

/**
 * Собирает текст причины: с названием вида СЭМД или без него — по флагу выше.
 *
 * @param withName    формулировка с подстановкой названия (прежний вид текста)
 * @param withoutName формулировка без названия (позволяет группировать причины)
 */
export function buildCauseText(withName: string, withoutName: string): string {
    return CAUSE_TEXT_INCLUDES_SEMD_NAME ? withName : withoutName
}

export function requirementKey(organizationOid: string, semdTypeId: string): string {
    return `${organizationOid}\u0000${semdTypeId}`
}

export function readinessNote(readiness: PilotCalculationReadiness): string {
    if (readiness === 'ready') return 'Расчет выполнен'
    if (readiness === 'remd_data_missing') return 'Ожидается выгрузка РЭМД'
    if (readiness === 'epgu_reference_missing') {
        return 'Ожидается справочник ЭМД/НСИ с признаком доступности на ЕПГУ'
    }
    if (readiness === 'epgu_reference_incomplete') {
        return 'Сопоставление со справочником ЭМД/НСИ заполнено не полностью'
    }
    if (readiness === 'epgu_reference_empty') {
        return 'В справочнике не найдены виды, доступные на ЕПГУ'
    }
    if (readiness === 'applicability_incomplete') {
        return 'Не полностью настроена применимость видов СЭМД к МО'
    }
    return 'Для МО нет применимых видов СЭМД'
}

/**
 * Для 6.1.3.2.7 используется тот же приоритет справочников, что и при проверке матрицы:
 * doc_visible из 1253 — основной признак, SHOW_PATIENT из 1520 — резервный, пока для вида
 * документа в 1253 нет значения.
 */
export function resolvePrimaryEpguVisible(type: SemdTypeRow): boolean | null {
    return type.epguVisibleRegistry ?? type.epguAvailable
}

/**
 * Roadmap Пакет A, задача 10 — диагностика расхождения между SHOW_PATIENT (1520) и
 * doc_visible (1253) для одного и того же вида МД: обе выгрузки должны отражать доступность
 * документа на ЕПГУ, но ведутся раздельно и могут разойтись.
 */
export function addEpguVisibilitySourceMismatchFindings(
    findings: FindingToSave[],
    semdTypes: SemdTypeRow[],
): void {
    for (const type of semdTypes) {
        if (type.epguAvailable === null || type.epguVisibleRegistry === null) continue
        if (type.epguAvailable === type.epguVisibleRegistry) continue
        findings.push({
            organizationOid: null,
            semdTypeId: type.id,
            findingCode: 'epgu_visibility_source_mismatch',
            severity: 'warning',
            cause:
                `Для вида СЭМД «${type.name}» расходятся признаки видимости на ЕПГУ: `
                + `SHOW_PATIENT (справочник 1520) = ${type.epguAvailable ? 'Да' : 'Нет'}, `
                + `doc_visible (справочник 1253) = ${type.epguVisibleRegistry ? 'true' : 'false'}.`,
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Сверить обе выгрузки и актуализировать версию справочника, в котором значение устарело. До уточнения используется doc_visible (1253).',
            evidence: {
                showPatient: type.epguAvailable,
                docVisible: type.epguVisibleRegistry,
                officialOid: type.officialOid,
            },
        })
    }
}

export function resolvePilotReferenceReadiness(input: {
    catalogTypeCount: number
    unknownTypeCount: number
    epguAvailableTypeCount: number
    hasRemdData: boolean
}): PilotCalculationReadiness {
    if (!input.hasRemdData) return 'remd_data_missing'
    if (input.catalogTypeCount === 0) return 'epgu_reference_missing'
    if (input.unknownTypeCount === input.catalogTypeCount) {
        return 'epgu_reference_missing'
    }
    if (input.unknownTypeCount > 0) return 'epgu_reference_incomplete'
    if (input.epguAvailableTypeCount === 0) {
        return 'epgu_reference_empty'
    }
    return 'ready'
}

export function calculatePilotCoverage(
    actual: number | null,
    planned: number | null,
): number | null {
    if (actual === null || planned === null || planned <= 0) return null
    return Math.round((actual / planned) * 10_000) / 100
}

export function calculateInstitutionPilotProgress(input: {
    actualRequiredTypeCount: number
    requiredTypeCount: number
    missingApplicabilityRuleCount: number
    unknownApplicabilityCount: number
}): {
    applicabilityComplete: boolean
    isPreliminary: boolean
    actualTypeCount: number | null
    plannedTypeCount: number | null
    coveragePercent: number | null
} {
    const applicabilityComplete =
        input.missingApplicabilityRuleCount === 0
        && input.unknownApplicabilityCount === 0
    if (!applicabilityComplete && input.requiredTypeCount === 0) {
        return {
            applicabilityComplete,
            isPreliminary: false,
            actualTypeCount: null,
            plannedTypeCount: null,
            coveragePercent: null,
        }
    }
    return {
        applicabilityComplete,
        isPreliminary: !applicabilityComplete,
        actualTypeCount: input.actualRequiredTypeCount,
        plannedTypeCount: input.requiredTypeCount,
        coveragePercent: calculatePilotCoverage(
            input.actualRequiredTypeCount,
            input.requiredTypeCount,
        ),
    }
}

export function classifyPilotInstitutionSemd(input: {
    requirementStatus:
        | 'required'
        | 'not_required'
        | 'unknown'
        | 'missing'
    registered: boolean
    gisAvailable: boolean | null
}): PilotInstitutionSemdStatus {
    if (input.requirementStatus === 'required') {
        if (input.registered) return 'required_registered'
        if (input.gisAvailable === false) {
            return 'required_gis_unavailable'
        }
        if (input.gisAvailable === true) return 'required_missing'
        return 'required_gis_unknown'
    }
    if (input.requirementStatus === 'not_required') {
        return input.registered
            ? 'not_required_registered'
            : 'not_required'
    }
    return input.registered ? 'unknown_registered' : 'unknown'
}

export function resolvePilotRequirementStatus(
    baseStatus: PilotRequirementStatus,
    manualStatus: 'required' | 'not_required' | null,
): PilotRequirementStatus {
    return manualStatus ?? baseStatus
}

export function addReferenceFindings(
    findings: FindingToSave[],
    readiness: PilotCalculationReadiness,
    semdTypes: SemdTypeRow[],
    unknownTypes: SemdTypeRow[],
    unknownActiveTypes: SemdTypeRow[],
): void {
    if (readiness === 'remd_data_missing') {
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'remd_data_missing',
            severity: 'error',
            cause: 'Для выбранного периода отсутствуют факты РЭМД.',
            responsibilityArea: 'МИАЦ / оператор импорта',
            recommendation:
                'Загрузить и подтвердить полную выгрузку РЭМД за выбранный период.',
            evidence: {},
        })
        return
    }
    if (readiness === 'epgu_reference_missing') {
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'epgu_reference_missing',
            severity: 'error',
            cause:
                'Не загружен признак «Доступен на ЕПГУ» из официального справочника ЭМД/НСИ.',
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Загрузить актуальную выгрузку справочника ЭМД OID 1.2.643.5.1.13.13.11.1520. До этого использовать только предварительное число ненулевых видов РЭМД.',
            evidence: {
                catalogTypeCount: semdTypes.length,
                unknownTypeCount: unknownTypes.length,
                unknownActiveTypeCount: unknownActiveTypes.length,
            },
        })
        return
    }
    if (readiness === 'epgu_reference_incomplete') {
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'epgu_reference_incomplete',
            severity: 'error',
            cause:
                `Для ${unknownTypes.length} видов СЭМД не определена доступность на ЕПГУ.`,
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Дополнить сопоставление с актуальной версией справочника ЭМД/НСИ и повторить расчет.',
            evidence: {
                unknownTypeCount: unknownTypes.length,
                unknownActiveTypeCount: unknownActiveTypes.length,
                unknownActiveTypeNames: unknownActiveTypes
                    .slice(0, 20)
                    .map((type) => type.name),
            },
        })
        return
    }
    if (readiness === 'epgu_reference_empty') {
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'epgu_reference_empty',
            severity: 'error',
            cause:
                'Справочник загружен, но не найдено ни одного вида СЭМД с признаком доступности на ЕПГУ.',
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Проверить версию справочника и сопоставление значений поля «Доступен на ЕПГУ».',
            evidence: { catalogTypeCount: semdTypes.length },
        })
    }
}

/**
 * Итоги последнего успешного импорта числителя РЭМД, сохранённые в
 * `reporting_import_runs.details`. На них строятся правила качества данных P1–P3.
 */
export interface NumeratorImportSummary {
    unmatchedDocumentTypeNames: string[]
    unmatchedOrganizationOids: string[]
}

/**
 * Подразделение, которое формирует документы, но не найдено в справочнике ФРМР.
 *
 * Считается на момент расчёта, а не берётся из итогов импорта числителя. Причина
 * в порядке загрузки: числитель — шаг 4, ФРМР — шаг 6, то есть импортёр числителя
 * всегда сверяется с ФРМР **предыдущей** загрузки. После переимпорта ФРМР на 06.08
 * находка на рабочем периоде осталась стоять на 84 подразделениях, тогда как по
 * актуальному справочнику их 89, — и список OID в основании тоже был от старого
 * сопоставления. Методолог как раз просила показать конкретные подразделения
 * (причина № 14, «Требует обсуждения»), а показывать ей было нечего.
 */
export interface UnknownSubdivision {
    oid: string
    organizationName: string
    documentCount: number
}

/**
 * Сколько конкретных значений (OID подразделений, названий видов) класть в evidence находки.
 * Интерфейс показывает их отдельными чипами со свёрткой, поэтому в текст причины они
 * не подставляются: перечисление на 20 OID делает формулировку нечитаемой.
 */
const UNMAPPED_SAMPLE_SIZE = 20

/**
 * Правила качества данных P1–P5 из согласовательного файла
 * `AXEL_причины_и_действия_для_согласования_2026-07-23.xlsx` (лист «Предлагаемые причины»).
 * Формулировки причин и действий взяты из файла дословно и подставляют реальные значения.
 *
 * P6 (несовпадение периода выгрузки), P7 (истёкшая редакция) и P8 (нетипичное подразделение)
 * здесь не реализованы: в «тидy»-выгрузке РЭМД нет колонки периода, факт агрегируется без
 * номера редакции, а критерий «нетипичности» требует отдельного методического решения.
 */
export function addDataQualityFindings(
    findings: FindingToSave[],
    input: {
        numeratorImport: NumeratorImportSummary | null
        unknownSubdivisions: UnknownSubdivision[]
        applicabilityRuleCount: number
        organizationsWithoutSubdivisions: Array<{ oid: string; name: string }>
    },
): void {
    const unmappedNames = input.numeratorImport?.unmatchedDocumentTypeNames ?? []
    if (unmappedNames.length > 0) {
        // P3 — именно этот случай дал историю с «Рецепт 107-1/у» (34 вида из 35):
        // несопоставленный вид молча выпадает из числителя.
        const sample = unmappedNames.slice(0, UNMAPPED_SAMPLE_SIZE)
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'numerator_document_unmapped',
            severity: 'error',
            cause:
                `Для ${unmappedNames.length} видов документов из выгрузки РЭМД не найдено `
                + 'соответствие в справочнике ЭМД (1520). Факт по ним не учтён.',
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Проверить и нормализовать наименования; при необходимости обновить версию справочника 1520.',
            evidence: {
                unmappedTypeCount: unmappedNames.length,
                unmappedTypeNames: sample,
            },
        })
    }

    for (const oid of input.numeratorImport?.unmatchedOrganizationOids ?? []) {
        // P1 — организация не привязывается к карточке МО: её нет в справочнике,
        // поэтому находка остаётся региональной.
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'organization_not_in_directory',
            severity: 'warning',
            cause:
                `По организации с OID ${oid} есть факты РЭМД, но она отсутствует в справочнике `
                + 'организаций (или не подведомственна ДЗО) и в расчёт не включена.',
            responsibilityArea: 'МИАЦ / аналитик предметной области',
            recommendation:
                'Проверить принадлежность организации; при необходимости добавить её в справочник '
                + 'или подтвердить обоснованность исключения.',
            evidence: { organizationOid: oid },
        })
    }

    const unknownSubdivisions = input.unknownSubdivisions
    if (unknownSubdivisions.length > 0) {
        // P2 — по FR-11 не размножаем причину по каждому подразделению: одна находка
        // со списком. Список отсортирован по числу документов: методолог смотрит его
        // сверху, и первым должно идти подразделение, которое весит больше всех.
        const sample = [...unknownSubdivisions]
            .sort((left, right) => right.documentCount - left.documentCount)
            .slice(0, UNMAPPED_SAMPLE_SIZE)
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'subdivision_not_in_frmr',
            severity: 'warning',
            cause:
                `${unknownSubdivisions.length} подразделений формируют документы, но отсутствуют `
                + 'в ФРМР — их вид не определён, применимость по подразделению не рассчитана.',
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Актуализировать выгрузку ФРМР либо проверить корректность OID подразделения в источнике.',
            evidence: {
                unknownSubdivisionCount: unknownSubdivisions.length,
                unknownSubdivisionOids: sample.map((item) => item.oid),
                // Одного OID мало, чтобы найти подразделение: методолог просила назвать
                // МО и показать, сколько документов на нём висит.
                unknownSubdivisions: sample,
            },
        })
    }

    if (input.applicabilityRuleCount === 0) {
        // P4 — общая причина уровня периода; частная institution_applicability_incomplete
        // остаётся и показывает, какие именно МО не досчитаны.
        findings.push({
            organizationOid: null,
            semdTypeId: null,
            findingCode: 'applicability_matrix_not_loaded',
            severity: 'error',
            cause:
                'Не загружена матрица применимости видов СЭМД. Расчёт по всем МО выполняется '
                + 'только как предварительный.',
            responsibilityArea: 'МИАЦ / аналитик предметной области',
            recommendation:
                'Загрузить утверждённую матрицу применимости по типам и видам подразделений.',
            evidence: {},
        })
    }

    for (const organization of input.organizationsWithoutSubdivisions) {
        // P5 — привязываем к карточке МО: причина адресная.
        findings.push({
            organizationOid: organization.oid,
            semdTypeId: null,
            findingCode: 'organization_without_subdivisions',
            severity: 'warning',
            cause:
                `Для МО «${organization.name}» в ФРМР нет данных о подразделениях; `
                + 'применимость по подразделениям не определена.',
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Проверить выгрузку ФРМР по этой организации; при подтверждённом отсутствии данных '
                + 'определить резервное правило.',
            evidence: { organizationOid: organization.oid },
        })
    }
}

/**
 * Р10: обязательность снята, потому что МО отсутствует в файле ТПГГ целиком. Это допущение
 * («учреждение финансируется вне терпрограммы»), а не прямое показание источника, поэтому
 * оно выводится на экран для подтверждения методологом. По FR-11 текст причины не содержит
 * ни имени МО, ни названия вида — так все такие решения схлопываются в одну карточку со
 * списком затронутых МО и видов.
 */
export function addTpggOrganizationAbsentFindings(
    findings: FindingToSave[],
    pairs: Array<{ organizationOid: string; semdTypeId: string }>,
): void {
    for (const pair of pairs) {
        findings.push({
            organizationOid: pair.organizationOid,
            semdTypeId: pair.semdTypeId,
            findingCode: 'requirement_waived_organization_absent_from_tpgg',
            severity: 'info',
            // Формулировка методолога от 03.08.2026: «Государственное задание
            // и территориальная программа ОМС — используем формулировку "виды мед.помощи,
            // утверждённые государственным заданием". Так объёмнее, чем просто ТПГГ.»
            cause:
                'Обязательность вида снята: для МО нет видов медицинской помощи, '
                + 'утверждённых государственным заданием.',
            responsibilityArea: 'МИАЦ / аналитик предметной области',
            recommendation:
                'Подтвердить у методолога, что организация финансируется вне государственного '
                + 'задания. Дополнить применимость видов СЭМД по виду деятельности, видам '
                + 'мед.помощи, утверждённым государственным заданием.',
            evidence: { organizationOid: pair.organizationOid },
        })
    }
}

/**
 * Р3 (решение от 29.07): справочник МИАЦ и факт РЭМД — два независимых источника, и они
 * могут противоречить: вид помечен «не реализован в региональной ГИС», но при этом
 * зарегистрирован. Раньше выбор делался молча (побеждал факт), теперь расхождение
 * показывается явно — иначе устаревшая запись в справочнике тихо переносит
 * ответственность с МО на МИАЦ по всем МО сразу.
 */
export function addGisDirectoryConflictFindings(
    findings: FindingToSave[],
    conflicts: Array<{
        semdTypeId: string
        semdTypeName: string
        registeredOrganizationCount: number
    }>,
): void {
    for (const conflict of conflicts) {
        findings.push({
            organizationOid: null,
            semdTypeId: conflict.semdTypeId,
            findingCode: 'gis_directory_contradicts_remd_fact',
            severity: 'warning',
            cause:
                'Вид помечен в справочнике как не реализованный в региональной ГИС, '
                + `но зарегистрирован в РЭМД: организаций — ${conflict.registeredOrganizationCount}.`,
            responsibilityArea: 'МИАЦ / администратор справочников',
            recommendation:
                'Проверить справочник реализации СЭМД в региональной ГИС: либо запись '
                + 'устарела и вид уже реализован, либо регистрации выполнены в обход '
                + 'региональной ГИС и это отдельный вопрос к МО.',
            evidence: {
                semdTypeName: conflict.semdTypeName,
                registeredOrganizationCount: conflict.registeredOrganizationCount,
            },
        })
    }
}

export function calculateOrganization(input: {
    organization: OrganizationRow
    epguTypes: SemdTypeRow[]
    epguTypeIds: Set<string>
    referenceReady: boolean
    referenceReadiness: PilotCalculationReadiness
    factTypeIds: Set<string>
    requirementByKey: Map<string, RequirementRow>
    findings: FindingToSave[]
}): PilotCalculationResult['organizations'][number] & {
    details: Record<string, unknown>
    status:
        | 'awaiting_data'
        | 'calculated'
        | 'not_calculated'
    businessStatus:
        | 'not_assessed'
        | 'target_met'
        | 'below_target'
        | 'critical'
    deviationValue: number | null
} {
    const {
        organization,
        epguTypes,
        epguTypeIds,
        referenceReady,
        referenceReadiness,
        factTypeIds,
        requirementByKey,
        findings,
    } = input
    const rawActiveTypeCount = factTypeIds.size
    const epguActiveTypeIds = new Set(
        Array.from(factTypeIds).filter((id) => epguTypeIds.has(id)),
    )

    if (!referenceReady) {
        return {
            organizationOid: organization.oid,
            readiness: referenceReadiness,
            isPreliminary: false,
            actualTypeCount: null,
            plannedTypeCount: null,
            coveragePercent: null,
            rawActiveTypeCount,
            epguActiveTypeCount: 0,
            knownApplicabilityCount: 0,
            requiredTypeCount: 0,
            notRequiredTypeCount: 0,
            missingApplicabilityRuleCount: 0,
            unknownApplicabilityCount: 0,
            manualOverrideCount: 0,
            blockedByRegionalGisCount: 0,
            missingAtInstitutionCount: 0,
            unknownGisCapabilityCount: 0,
            handledInExternalSystemCount: 0,
            unexpectedRegisteredTypeCount: 0,
            status: 'awaiting_data',
            businessStatus: 'not_assessed',
            deviationValue: null,
            details: {
                readiness: referenceReadiness,
                rawActiveTypeCount,
                referenceReady: false,
            },
        }
    }

    const requiredTypes: SemdTypeRow[] = []
    const notRequiredTypeIds = new Set<string>()
    let missingApplicabilityRuleCount = 0
    let unknownApplicabilityCount = 0
    let manualOverrideCount = 0
    for (const type of epguTypes) {
        const requirement = requirementByKey.get(
            requirementKey(organization.oid, type.id),
        )
        if (!requirement) {
            missingApplicabilityRuleCount += 1
        } else if (requirement.requirementStatus === 'not_required') {
            if (requirement.isManualOverride) manualOverrideCount += 1
            notRequiredTypeIds.add(type.id)
        } else if (requirement.requirementStatus === 'required') {
            if (requirement.isManualOverride) manualOverrideCount += 1
            requiredTypes.push(type)
        } else {
            if (requirement.isManualOverride) manualOverrideCount += 1
            unknownApplicabilityCount += 1
        }
    }

    const applicabilityComplete =
        missingApplicabilityRuleCount === 0
        && unknownApplicabilityCount === 0

    let blockedByRegionalGisCount = 0
    let missingAtInstitutionCount = 0
    let unknownGisCapabilityCount = 0
    /** В12: обязательные виды, которые регион ведёт в другой информационной системе. */
    let handledInExternalSystemCount = 0
    const actualRequiredTypes = requiredTypes.filter(
        (type) => epguActiveTypeIds.has(type.id),
    )
    const progress = calculateInstitutionPilotProgress({
        actualRequiredTypeCount: actualRequiredTypes.length,
        requiredTypeCount: requiredTypes.length,
        missingApplicabilityRuleCount,
        unknownApplicabilityCount,
    })
    const knownApplicabilityCount =
        requiredTypes.length + notRequiredTypeIds.size
    if (!applicabilityComplete) {
        findings.push({
            organizationOid: organization.oid,
            semdTypeId: null,
            findingCode: 'institution_applicability_incomplete',
            severity: 'warning',
            cause: progress.isPreliminary
                ? `Предварительный расчет выполнен по ${requiredTypes.length} подтвержденным обязательным видам СЭМД; применимость остальных видов определена не полностью.`
                : 'Не полностью определено, какие виды СЭМД обязана формировать эта МО.',
            responsibilityArea: 'МИАЦ / аналитик предметной области',
            recommendation:
                'Дополнить применимость видов СЭМД по виду деятельности, государственному заданию и территориальной программе ОМС. До этого использовать результат только как демонстрационный и предварительный.',
            evidence: {
                epguAvailableTypeCount: epguTypes.length,
                knownApplicabilityCount,
                requiredTypeCount: requiredTypes.length,
                notRequiredTypeCount: notRequiredTypeIds.size,
                missingApplicabilityRuleCount,
                unknownApplicabilityCount,
                isPreliminary: progress.isPreliminary,
                preliminaryActualTypeCount:
                    progress.actualTypeCount,
                preliminaryPlannedTypeCount:
                    progress.plannedTypeCount,
                preliminaryCoveragePercent:
                    progress.coveragePercent,
            },
        })
    }
    for (const type of requiredTypes) {
        if (epguActiveTypeIds.has(type.id)) continue
        const requirement = requirementByKey.get(
            requirementKey(organization.oid, type.id),
        )!
        if (requirement.gisAvailable === false) {
            blockedByRegionalGisCount += 1
            findings.push({
                organizationOid: organization.oid,
                semdTypeId: type.id,
                findingCode: 'semd_not_implemented_in_regional_gis',
                severity: 'warning',
                cause: buildCauseText(
                    `Обязательный СЭМД «${type.name}» не зарегистрирован, потому что его формирование не реализовано в региональной ГИС.`,
                    'Обязательный вид СЭМД не зарегистрирован, потому что его формирование не реализовано в региональной ГИС.',
                ),
                responsibilityArea: 'МИАЦ / поставщик региональной ГИС',
                recommendation:
                    'Проверить план закупки и внедрения СЭМД, определить срок реализации и не относить причину к работе МО.',
                evidence: {
                    requirementReason: requirement.reason,
                    requirementSource: requirement.sourceName,
                },
            })
        } else if (requirement.gisAvailable === true) {
            // В12: вид, который регион ведёт в другой программе. Ветка идёт перед
            // «МО не зарегистрировала», потому что описывает ровно тот же случай, но
            // со своим действием. Оправданием она перестала быть 20.08.2026 —
            // см. согласование причины № 17 в заголовке файла.
            const externalNote = externalSystemNote(type.nsiOid)
            if (externalNote) {
                handledInExternalSystemCount += 1
                findings.push({
                    organizationOid: organization.oid,
                    semdTypeId: type.id,
                    findingCode: 'semd_handled_in_external_system',
                    // `error`, а не «Информация», с 25.08.2026 — наше решение,
                    // не правка методолога. Оно вытекает из её же трактовки: 20.08
                    // она сняла с причины роль оправдания, и та стала называть
                    // факт — «доступен в ГИС, регистраций нет». Это ровно то, что
                    // говорит причина № 8 (`required_semd_not_registered`), а та
                    // `error`. Тип «Информация» остался с прежней трактовки, когда
                    // находка объясняла, а не обвиняла, — похоже на недосмотр.
                    // Затрагивает 15 находок; откат — одна строка.
                    severity: 'error',
                    // Формулировка методолога от 20.08.2026 (причина № 17, решение
                    // «Изменить»): «в региональной ГИС доступен, регистраций нет».
                    cause: buildCauseText(
                        `Обязательный СЭМД «${type.name}» доступен в региональной ГИС, регистраций в РЭМД нет.`,
                        'Обязательный вид СЭМД доступен в региональной ГИС, регистраций в РЭМД нет.',
                    ),
                    // Зона сменилась с «МИАЦ / аналитик предметной области»: аналитика
                    // ждали ради объяснения, а объяснение получено. По ответу В-09
                    // виноват либо МИАЦ (не закуплен функционал), либо МО (оформление
                    // выполняется не до конца), поэтому названы оба.
                    responsibilityArea: 'МО / МИАЦ',
                    // Дословный текст методолога. Он говорит про льготные рецепты,
                    // потому что в перечне выше только вид 37; при добавлении
                    // нового вида действие придётся разносить по видам.
                    recommendation:
                        'При ведении льготных рецептов в ГИС региона или в одной из '
                        + 'компонент ГИС региона обеспечить выполнение действий, '
                        + 'необходимых для регистрации СЭМД в РЭМД ЕГИСЗ.',
                    evidence: {
                        externalSystemNote: externalNote,
                        requirementReason: requirement.reason,
                        requirementSource: requirement.sourceName,
                    },
                })
            } else {
                missingAtInstitutionCount += 1
                findings.push({
                    organizationOid: organization.oid,
                    semdTypeId: type.id,
                    findingCode: 'required_semd_not_registered',
                    severity: 'error',
                    cause: buildCauseText(
                        `МО обязана формировать СЭМД «${type.name}», возможность в ГИС есть, но регистраций в РЭМД нет.`,
                        'МО обязана формировать вид СЭМД, возможность в ГИС есть, но регистраций в РЭМД нет.',
                    ),
                    responsibilityArea: 'МО',
                    // Формулировка методолога от 03.08.2026, приведена дословно.
                    recommendation:
                        'Проверить настройки МИС на уровне медицинского персонала, который должен '
                        + 'формировать СЭМД, наличие действующих электронных подписей СЭМД, '
                        + 'ошибки регистрации этого вида СЭМД в РЭМД.',
                    evidence: {
                        requirementReason: requirement.reason,
                        requirementSource: requirement.sourceName,
                    },
                })
            }
        } else {
            unknownGisCapabilityCount += 1
            findings.push({
                organizationOid: organization.oid,
                semdTypeId: type.id,
                findingCode: 'regional_gis_capability_unknown',
                severity: 'warning',
                cause: buildCauseText(
                    `Для обязательного СЭМД «${type.name}» неизвестно, реализовано ли формирование в региональной ГИС.`,
                    'Для обязательного вида СЭМД неизвестно, реализовано ли формирование в региональной ГИС.',
                ),
                responsibilityArea: 'МИАЦ / поставщик региональной ГИС',
                recommendation:
                    'Уточнить техническую доступность СЭМД в региональной ГИС и зафиксировать ответ в справочнике применимости.',
                evidence: {
                    requirementReason: requirement.reason,
                    requirementSource: requirement.sourceName,
                },
            })
        }
    }

    const unexpectedRegisteredTypeIds = Array.from(epguActiveTypeIds).filter(
        (typeId) => notRequiredTypeIds.has(typeId),
    )
    for (const typeId of unexpectedRegisteredTypeIds) {
        const type = epguTypes.find((candidate) => candidate.id === typeId)!
        findings.push({
            organizationOid: organization.oid,
            semdTypeId: typeId,
            findingCode: 'semd_registered_when_not_required',
            severity: 'info',
            cause: buildCauseText(
                `СЭМД «${type.name}» зарегистрирован, хотя по текущему правилу он не обязателен для этой МО.`,
                'Вид СЭМД зарегистрирован, хотя по текущему правилу он не обязателен для этой МО.',
            ),
            responsibilityArea: 'МИАЦ / аналитик предметной области',
            recommendation:
                'Проверить правило применимости; регистрация может указывать на неполные или устаревшие исходные условия.',
            evidence: {},
        })
    }

    if (!applicabilityComplete) {
        return {
            organizationOid: organization.oid,
            readiness: 'applicability_incomplete',
            isPreliminary: progress.isPreliminary,
            actualTypeCount: progress.actualTypeCount,
            plannedTypeCount: progress.plannedTypeCount,
            coveragePercent: progress.coveragePercent,
            rawActiveTypeCount,
            epguActiveTypeCount: epguActiveTypeIds.size,
            knownApplicabilityCount,
            requiredTypeCount: requiredTypes.length,
            notRequiredTypeCount: notRequiredTypeIds.size,
            missingApplicabilityRuleCount,
            unknownApplicabilityCount,
            manualOverrideCount,
            blockedByRegionalGisCount,
            missingAtInstitutionCount,
            unknownGisCapabilityCount,
            handledInExternalSystemCount,
            unexpectedRegisteredTypeCount:
                unexpectedRegisteredTypeIds.length,
            status: progress.isPreliminary
                ? 'calculated'
                : 'awaiting_data',
            businessStatus: 'not_assessed',
            deviationValue: null,
            details: {
                readiness: 'applicability_incomplete',
                isPreliminary: progress.isPreliminary,
                rawActiveTypeCount,
                epguActiveTypeCount: epguActiveTypeIds.size,
                actualTypeCount: progress.actualTypeCount,
                plannedTypeCount: progress.plannedTypeCount,
                coveragePercent: progress.coveragePercent,
                knownApplicabilityCount,
                requiredTypeCount: requiredTypes.length,
                notRequiredTypeCount: notRequiredTypeIds.size,
                missingApplicabilityRuleCount,
                unknownApplicabilityCount,
                manualOverrideCount,
                blockedByRegionalGisCount,
                missingAtInstitutionCount,
                unknownGisCapabilityCount,
                unexpectedRegisteredTypeCount:
                    unexpectedRegisteredTypeIds.length,
            },
        }
    }

    const plannedTypeCount = progress.plannedTypeCount!
    const actualTypeCount = progress.actualTypeCount!
    const coveragePercent = progress.coveragePercent
    if (plannedTypeCount === 0) {
        return {
            organizationOid: organization.oid,
            readiness: 'not_applicable',
            isPreliminary: false,
            actualTypeCount: 0,
            plannedTypeCount: 0,
            coveragePercent: null,
            rawActiveTypeCount,
            epguActiveTypeCount: epguActiveTypeIds.size,
            knownApplicabilityCount,
            requiredTypeCount: 0,
            notRequiredTypeCount: notRequiredTypeIds.size,
            missingApplicabilityRuleCount: 0,
            unknownApplicabilityCount: 0,
            manualOverrideCount,
            blockedByRegionalGisCount: 0,
            missingAtInstitutionCount: 0,
            unknownGisCapabilityCount: 0,
            handledInExternalSystemCount: 0,
            unexpectedRegisteredTypeCount:
                unexpectedRegisteredTypeIds.length,
            status: 'not_calculated',
            businessStatus: 'not_assessed',
            deviationValue: null,
            details: {
                readiness: 'not_applicable',
                isPreliminary: false,
                rawActiveTypeCount,
                epguActiveTypeCount: epguActiveTypeIds.size,
                knownApplicabilityCount,
                requiredTypeCount: 0,
                notRequiredTypeCount: notRequiredTypeIds.size,
                manualOverrideCount,
            },
        }
    }

    const deviationValue = actualTypeCount - plannedTypeCount
    const criticalThreshold = Math.max(
        1,
        Math.ceil(plannedTypeCount * 0.25),
    )
    const businessStatus = deviationValue >= 0
        ? 'target_met'
        : deviationValue <= -criticalThreshold
            ? 'critical'
            : 'below_target'
    return {
        organizationOid: organization.oid,
        readiness: 'ready',
        isPreliminary: false,
        actualTypeCount,
        plannedTypeCount,
        coveragePercent,
        rawActiveTypeCount,
        epguActiveTypeCount: epguActiveTypeIds.size,
        knownApplicabilityCount,
        requiredTypeCount: requiredTypes.length,
        notRequiredTypeCount: notRequiredTypeIds.size,
        missingApplicabilityRuleCount: 0,
        unknownApplicabilityCount: 0,
        manualOverrideCount,
        blockedByRegionalGisCount,
        missingAtInstitutionCount,
        unknownGisCapabilityCount,
        handledInExternalSystemCount,
        unexpectedRegisteredTypeCount:
            unexpectedRegisteredTypeIds.length,
        status: 'calculated',
        businessStatus,
        deviationValue,
        details: {
            readiness: 'ready',
            isPreliminary: false,
            rawActiveTypeCount,
            epguActiveTypeCount: epguActiveTypeIds.size,
            actualTypeCount,
            plannedTypeCount,
            coveragePercent,
            knownApplicabilityCount,
            requiredTypeCount: requiredTypes.length,
            notRequiredTypeCount: notRequiredTypeIds.size,
            manualOverrideCount,
            blockedByRegionalGisCount,
            missingAtInstitutionCount,
            unknownGisCapabilityCount,
            handledInExternalSystemCount,
            unexpectedRegisteredTypeCount:
                unexpectedRegisteredTypeIds.length,
        },
    }
}
