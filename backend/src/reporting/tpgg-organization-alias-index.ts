import { normalizeTpggOrganizationName } from './tpgg-workbook-parser'

/**
 * Сопоставление наименований медорганизаций из файлов терпрограммы и фонда ОМС
 * с записями справочника.
 *
 * Вынесено из импорта терпрограммы, когда за ним пришёл второй потребитель —
 * загрузка исполнения (Д-10). Наименования в обоих источниках пишет один и тот же
 * фонд, и расходиться правила сопоставления не должны: одна МО, попавшая
 * в исполнение под другим написанием, тихо выпадет из третьей колонки, и это
 * будет выглядеть как «данных нет», а не как несопоставленное имя.
 *
 * Индекс намеренно отдаёт **список** организаций на нормализованное имя,
 * а не одну: у нескольких МО области совпадают короткие наименования, и такую
 * неоднозначность вызывающий обязан заметить, а не получить произвольную первую.
 */

export interface AliasIndexOrganization {
    oid: string
    officialFullName: string
    officialShortName: string
    commonName: string
    /** Уже нормализованные синонимы из `reporting_organization_aliases`. */
    aliases: string[]
}

export function buildOrganizationAliasIndex<T extends AliasIndexOrganization>(
    organizations: readonly T[],
): Map<string, T[]> {
    const index = new Map<string, T[]>()
    for (const organization of organizations) {
        const aliases = new Set([
            organization.officialFullName,
            organization.officialShortName,
            organization.commonName,
            ...organization.aliases,
        ])
        for (const alias of aliases) {
            const normalized = normalizeTpggOrganizationName(alias)
            if (!normalized) continue
            const matches = index.get(normalized) ?? []
            if (!matches.some((candidate) => candidate.oid === organization.oid)) {
                matches.push(organization)
            }
            index.set(normalized, matches)
        }
    }
    return index
}

/**
 * Единственное совпадение или `null`. `null` означает и «не нашлось»,
 * и «нашлось несколько» — оба случая для расчёта одинаково непригодны,
 * а различить их вызывающий может по самому индексу.
 */
export function resolveOrganizationByName<T extends AliasIndexOrganization>(
    index: ReadonlyMap<string, T[]>,
    name: string,
): T | null {
    const matches = index.get(normalizeTpggOrganizationName(name))
    return matches && matches.length === 1 ? matches[0] : null
}
