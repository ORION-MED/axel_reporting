import { normalizeTpggOrganizationName } from './tpgg-workbook-parser'

/**
 * Сопоставление наименований МО из перечней матрицы применимости с реестром.
 *
 * От индекса терпрограммы (`tpgg-organization-alias-index.ts`) отличается двумя
 * вещами, из-за которых их не свести в один:
 *
 * 1. Здесь у каждого имени два варианта — исходный и без правовой формы («ГБУ
 *    "КОКБ"» и «кокб»): методолог пишет в перечнях сокращения, а фонд в файлах
 *    терпрограммы — полные наименования, и срезать форму там значило бы склеить
 *    разные МО.
 * 2. Здесь есть **групповые** синонимы — имя, намеренно закреплённое за
 *    несколькими МО. Такое одно: «Санаторий» у видов 48, 50 и 357, за ним стоят
 *    ГБУ «Санаторий "Озеро Горькое"» и ГБУ «Детский санаторий "Космос"».
 *
 * Всё, что совпало с несколькими МО не через групповой синоним, остаётся
 * неоднозначным и в расчёт не идёт: «Диспансер» у вида 90 подходит четырём
 * организациям, и выбрать за методолога нельзя.
 */

export interface MatrixAliasOrganization {
    oid: string
    officialFullName: string
    officialShortName: string
    commonName: string
    aliases: string[]
    /** Синонимы с `alias_kind = 'group'` — разрешённые совпадения на несколько МО. */
    groupAliases: string[]
}

export interface MatrixOrganizationAliasIndex<T extends MatrixAliasOrganization> {
    byName: Map<string, T[]>
    byGroupName: Map<string, T[]>
}

export type MatrixOrganizationMatchStatus = 'none' | 'single' | 'group' | 'ambiguous'

export interface MatrixOrganizationMatch<T extends MatrixAliasOrganization> {
    status: MatrixOrganizationMatchStatus
    organizations: T[]
}

/** Исходное нормализованное имя и оно же без правовой формы и «Курганской области». */
export function matrixOrganizationNameVariants(value: string): string[] {
    const normalized = normalizeTpggOrganizationName(value)
    if (!normalized) return []
    const simplified = normalized
        .replace(/^(?:гбу|гку|гауз|фгбу|обуз|бу|ао)\s+/u, '')
        .replace(/\s+курганской области$/u, '')
        .trim()
    return [...new Set([normalized, simplified].filter(Boolean))]
}

export function buildMatrixOrganizationAliasIndex<T extends MatrixAliasOrganization>(
    organizations: readonly T[],
): MatrixOrganizationAliasIndex<T> {
    return {
        // Групповые синонимы входят и в общий индекс: сначала имя ищется как любое
        // другое, и лишь потом, когда МО нашлось несколько, проверяется, объявлена ли
        // группа. Иначе «Санаторий» не находился бы вовсе.
        byName: buildIndex(organizations, (organization) => [
            organization.officialFullName,
            organization.officialShortName,
            organization.commonName,
            ...organization.aliases,
            ...organization.groupAliases,
        ]),
        byGroupName: buildIndex(organizations, (organization) => organization.groupAliases),
    }
}

/**
 * Кого имел в виду перечень.
 *
 * `group` возвращается только при полном совпадении состава: если под именем нашлась
 * ещё и посторонняя МО, это уже не объявленная группа, а неоднозначность — и решать
 * её должен методолог, а не разбор.
 */
export function resolveMatrixOrganizations<T extends MatrixAliasOrganization>(
    index: MatrixOrganizationAliasIndex<T>,
    name: string,
): MatrixOrganizationMatch<T> {
    const matches = lookup(index.byName, name)
    if (matches.length === 0) return { status: 'none', organizations: [] }
    if (matches.length === 1) return { status: 'single', organizations: matches }

    const group = lookup(index.byGroupName, name)
    if (group.length === matches.length) return { status: 'group', organizations: group }
    return { status: 'ambiguous', organizations: [] }
}

function buildIndex<T extends MatrixAliasOrganization>(
    organizations: readonly T[],
    aliasesOf: (organization: T) => string[],
): Map<string, T[]> {
    const index = new Map<string, T[]>()
    for (const organization of organizations) {
        for (const alias of new Set(aliasesOf(organization))) {
            for (const variant of matrixOrganizationNameVariants(alias)) {
                const matches = index.get(variant) ?? []
                if (!matches.some((candidate) => candidate.oid === organization.oid)) {
                    matches.push(organization)
                }
                index.set(variant, matches)
            }
        }
    }
    return index
}

function lookup<T extends MatrixAliasOrganization>(
    index: ReadonlyMap<string, T[]>,
    name: string,
): T[] {
    const matches = new Map<string, T>()
    for (const variant of matrixOrganizationNameVariants(name)) {
        for (const organization of index.get(variant) ?? []) {
            matches.set(organization.oid, organization)
        }
    }
    return [...matches.values()]
}
