/**
 * Показатель «Виды СЭМД, регистрируемые в РЭМД ЕГИСЗ» — слайд 27 методики
 * от 10.07.2026. Кода в перечнях показателей нет; методолог на ВКС 07.08 предложила
 * временно считать его номером **27**, по номеру слайда.
 *
 * Числитель — сколько видов регион (или отдельная МО) реально регистрирует,
 * знаменатель — сколько видов в Перечне № 5пр (145).
 * Методолог: «это про 145 видов, в которые входят уже отработанные 35».
 *
 * **Регион не равен сумме МО.** Здесь считаются уникальные виды, а не документы:
 * если один вид регистрируют десять МО, в региональном числителе он один. Поэтому
 * складывать соты карты в региональное значение нельзя — в отличие от долей
 * к объёмам ТПГГ, где регион именно сумма.
 */

export interface SemdTypeRegistryFact {
    organizationOid: string
    semdTypeId: string
    /** Входит ли вид в Перечень № 5пр, то есть в знаменатель показателя. */
    inRegistry: boolean
    documentCount: number
}

/**
 * Применимость вида к МО по матрице (форма 1). `unknown` — правило есть, но
 * условие по этой МО не разобрано; такие виды в план не входят, и по ним ставится
 * пометка, иначе план выглядит заниженным без объяснения.
 */
export interface SemdTypeRegistryRequirement {
    organizationOid: string
    semdTypeId: string
    status: 'required' | 'not_required' | 'unknown'
}

export interface SemdTypeRegistryInput {
    /** Целевой контур МО. Факты прочих организаций игнорируются. */
    organizationOids: readonly string[]
    /**
     * Виды Перечня № 5пр — знаменатель. Раньше передавалось одно число, но для
     * разбора «каких видов не хватает» нужен сам состав: методолог насчитала
     * 74 зарегистрированных вида против наших 70 и просила показать, что именно
     * не попадает в расчёт (ВКС 15.08.2026).
     */
    registryTypeIds: readonly string[]
    facts: readonly SemdTypeRegistryFact[]
    /**
     * Н18.2 (ВКС 15.08.2026): плановое значение показателя — не константа из
     * «Приложения 2», а число видов, обязательных к регистрации по матрице
     * применимости, своё у региона и у каждой МО. Методолог: «плановое значение —
     * это из формы 1».
     *
     * Пусто, если матрица не загружена: тогда плана нет и соты не оцениваются —
     * ровно то состояние, которое было до этой доработки.
     */
    requirements?: readonly SemdTypeRegistryRequirement[]
}

/**
 * Состояние вида в разборе показателя.
 *
 * `outside_registry` — вид регистрируется, но в Перечне № 5пр его нет. С 21.08.2026
 * такие виды **входят** в числитель (см. `NUMERATOR_COUNTS_TYPES_OUTSIDE_REGISTRY`),
 * но статус сохраняется: методолог просила оставить признак невхождения справочно.
 */
export type SemdTypeRegistryStatus =
    | 'registered'
    | 'not_registered'
    | 'outside_registry'

/**
 * Числитель считает все зарегистрированные виды, а не только виды Перечня № 5пр.
 *
 * Ответ методолога на В-07 от 21.08.2026: «МЗ РФ считает все виды зарегистрированных
 * СЭМД, не учитывая вхождение в 5-пр. Нам нужно считать также. Пусть справочно
 * останется фактор невхождения 4 видов в 5-пр. Это может стать важным в какой-то
 * момент». На данных Курганской области числитель региона 69 → 73.
 *
 * Цена решения названа прямо: знаменатель остаётся Перечнем (145 видов), поэтому
 * состав числителя шире состава знаменателя и процент перестаёт быть строгой долей.
 * Теоретически он может превысить 100 %, если видов вне Перечня окажется много.
 * Знаменатель — открытый вопрос к методологу: 145, 149 или план по матрице.
 *
 * ОТКАТ: поставить `false`, пересобрать backend и пересчитать период. Ни миграций,
 * ни правок фронтенда откат не требует — разбор по видам от флага не зависит.
 */
export const NUMERATOR_COUNTS_TYPES_OUTSIDE_REGISTRY = true

export interface SemdTypeRegistryTypeBreakdown {
    semdTypeId: string
    status: SemdTypeRegistryStatus
    /** Сколько МО региона зарегистрировали вид хотя бы одним документом. */
    organizationCount: number
    documentCount: number
}

/**
 * Плановая часть показателя — общая для региона и для МО.
 *
 * **Исполнение считается по пересечению, а не сравнением двух чисел.** У МО может
 * быть 46 зарегистрированных видов Перечня при 31 обязательном, и «46 больше 31»
 * прочиталось бы как перевыполнение — при том что шести обязательных видов нет.
 * Поэтому в числителе исполнения только обязательные виды, которые действительно
 * зарегистрированы.
 */
export interface SemdTypeRegistryPlan {
    /** Сколько видов Перечня обязательны — план. */
    requiredTypeCount: number
    /** Сколько из обязательных зарегистрировано — факт исполнения плана. */
    registeredRequiredTypeCount: number
    /** Исполнение плана в процентах; `null`, если обязательных видов нет. */
    percent: number | null
    /**
     * Виды со статусом «не определено»: условие правила по этой МО не разобрано.
     * В план не входят, поэтому план по такой МО занижен — это надо показать.
     */
    undefinedTypeCount: number
}

export interface SemdTypeRegistryOrganizationValue {
    organizationOid: string
    registeredTypeCount: number
    percent: number | null
    /**
     * Виды, которые МО регистрирует, но которых нет в Перечне № 5пр. В числитель
     * не идут: доля от 145 видов, посчитанная с ними, могла бы превысить 100 %.
     */
    typesOutsideRegistryCount: number
    /** Пусто, если матрица применимости не загружена. */
    plan: SemdTypeRegistryPlan | null
}

export interface SemdTypeRegistryRegionValue {
    registeredTypeCount: number
    registryTypeCount: number
    percent: number | null
    typesOutsideRegistryCount: number
    /** МО, не зарегистрировавшие ни одного вида Перечня. */
    organizationsWithoutRegistrationCount: number
    /**
     * Разбор по видам: весь Перечень плюс зарегистрированные виды вне его.
     * Порядок — виды Перечня в порядке входа, затем внешние.
     */
    types: SemdTypeRegistryTypeBreakdown[]
    /**
     * План по региону — виды, обязательные хотя бы одной МО. Не сумма планов МО:
     * один вид, обязательный десяти организациям, в региональном плане один,
     * как и в числителе самого показателя.
     */
    plan: SemdTypeRegistryPlan | null
}

export interface SemdTypeRegistryResult {
    region: SemdTypeRegistryRegionValue
    organizations: SemdTypeRegistryOrganizationValue[]
}

export function calculateSemdTypeRegistry(
    input: SemdTypeRegistryInput,
): SemdTypeRegistryResult {
    const targetOids = new Set(input.organizationOids)
    /** Вид засчитывается регистрацией только при положительном количестве документов. */
    const facts = input.facts.filter(
        (fact) => targetOids.has(fact.organizationOid) && fact.documentCount > 0,
    )

    const registryTypesByOrganization = new Map<string, Set<string>>()
    const outsideTypesByOrganization = new Map<string, Set<string>>()
    const regionRegistryTypes = new Set<string>()
    const regionOutsideTypes = new Set<string>()
    const documentsByType = new Map<string, number>()
    const organizationsByType = new Map<string, Set<string>>()

    for (const fact of facts) {
        const target = fact.inRegistry ? registryTypesByOrganization : outsideTypesByOrganization
        const types = target.get(fact.organizationOid) ?? new Set<string>()
        types.add(fact.semdTypeId)
        target.set(fact.organizationOid, types)

        if (fact.inRegistry) regionRegistryTypes.add(fact.semdTypeId)
        else regionOutsideTypes.add(fact.semdTypeId)

        // Одна МО может дать несколько строк по одному виду (разные форматы
        // документа) — документы складываем, а МО считаем по одному разу.
        documentsByType.set(
            fact.semdTypeId,
            (documentsByType.get(fact.semdTypeId) ?? 0) + fact.documentCount,
        )
        const organizations = organizationsByType.get(fact.semdTypeId) ?? new Set<string>()
        organizations.add(fact.organizationOid)
        organizationsByType.set(fact.semdTypeId, organizations)
    }

    const registryTypeCount = input.registryTypeIds.length

    // План строится только по видам Перечня: знаменатель показателя — Перечень,
    // и обязательный вид вне его увеличил бы план, не имея шанса попасть в факт.
    const registryTypeIds = new Set(input.registryTypeIds)
    const requirements = (input.requirements ?? []).filter(
        (requirement) => (
            targetOids.has(requirement.organizationOid)
            && registryTypeIds.has(requirement.semdTypeId)
        ),
    )
    const hasRequirements = requirements.length > 0
    const requiredByOrganization = new Map<string, Set<string>>()
    const undefinedByOrganization = new Map<string, Set<string>>()
    const regionRequiredTypes = new Set<string>()
    const regionUndefinedTypes = new Set<string>()
    for (const requirement of requirements) {
        if (requirement.status === 'required') {
            addToIndex(requiredByOrganization, requirement)
            regionRequiredTypes.add(requirement.semdTypeId)
        } else if (requirement.status === 'unknown') {
            addToIndex(undefinedByOrganization, requirement)
            regionUndefinedTypes.add(requirement.semdTypeId)
        }
    }

    const organizations = input.organizationOids.map((organizationOid) => {
        const registeredTypes = registryTypesByOrganization.get(organizationOid) ?? new Set<string>()
        const outsideTypeCount = outsideTypesByOrganization.get(organizationOid)?.size ?? 0
        // Виды вне Перечня входят в числитель, но не в план: обязательной может быть
        // только строка матрицы, а матрица описывает Перечень.
        const registeredTypeCount = NUMERATOR_COUNTS_TYPES_OUTSIDE_REGISTRY
            ? registeredTypes.size + outsideTypeCount
            : registeredTypes.size
        const requiredTypes = requiredByOrganization.get(organizationOid) ?? new Set<string>()
        return {
            organizationOid,
            registeredTypeCount,
            percent: toPercent(registeredTypeCount, registryTypeCount),
            typesOutsideRegistryCount: outsideTypeCount,
            plan: hasRequirements
                ? buildPlan(
                    requiredTypes,
                    registeredTypes,
                    undefinedByOrganization.get(organizationOid)?.size ?? 0,
                )
                : null,
        }
    })

    const breakdown = (
        semdTypeId: string,
        status: SemdTypeRegistryStatus,
    ): SemdTypeRegistryTypeBreakdown => ({
        semdTypeId,
        status,
        organizationCount: organizationsByType.get(semdTypeId)?.size ?? 0,
        documentCount: documentsByType.get(semdTypeId) ?? 0,
    })

    const regionRegisteredTypeCount = NUMERATOR_COUNTS_TYPES_OUTSIDE_REGISTRY
        ? regionRegistryTypes.size + regionOutsideTypes.size
        : regionRegistryTypes.size

    return {
        region: {
            registeredTypeCount: regionRegisteredTypeCount,
            registryTypeCount,
            percent: toPercent(regionRegisteredTypeCount, registryTypeCount),
            typesOutsideRegistryCount: regionOutsideTypes.size,
            // «Не зарегистрировала ни одного вида» считается по видам Перечня:
            // МО, у которой есть только внешний вид, показателя всё равно не даёт.
            organizationsWithoutRegistrationCount: input.organizationOids.filter(
                (oid) => (registryTypesByOrganization.get(oid)?.size ?? 0) === 0,
            ).length,
            types: [
                ...input.registryTypeIds.map((semdTypeId) => breakdown(
                    semdTypeId,
                    regionRegistryTypes.has(semdTypeId) ? 'registered' : 'not_registered',
                )),
                ...[...regionOutsideTypes].map(
                    (semdTypeId) => breakdown(semdTypeId, 'outside_registry'),
                ),
            ],
            plan: hasRequirements
                ? buildPlan(
                    regionRequiredTypes,
                    regionRegistryTypes,
                    regionUndefinedTypes.size,
                )
                : null,
        },
        organizations,
    }
}

function addToIndex(
    index: Map<string, Set<string>>,
    requirement: SemdTypeRegistryRequirement,
): void {
    const types = index.get(requirement.organizationOid) ?? new Set<string>()
    types.add(requirement.semdTypeId)
    index.set(requirement.organizationOid, types)
}

function buildPlan(
    requiredTypes: ReadonlySet<string>,
    registeredTypes: ReadonlySet<string>,
    undefinedTypeCount: number,
): SemdTypeRegistryPlan {
    let registeredRequiredTypeCount = 0
    for (const semdTypeId of requiredTypes) {
        if (registeredTypes.has(semdTypeId)) registeredRequiredTypeCount += 1
    }
    return {
        requiredTypeCount: requiredTypes.size,
        registeredRequiredTypeCount,
        percent: toPercent(registeredRequiredTypeCount, requiredTypes.size),
        undefinedTypeCount,
    }
}

/** Два знака после запятой — как у остальных показателей, чтобы проценты сходились. */
function toPercent(numerator: number, denominator: number): number | null {
    if (denominator <= 0) return null
    return Math.round((numerator / denominator) * 10_000) / 100
}
