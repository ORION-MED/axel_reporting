import type { Migration } from '../migration.types'

/**
 * Два синонима МО под перечни-исключения формы от 18.08.2026.
 *
 * В условиях «если МО НЕ КОПАБ, КОБСМЭ, КОСПК, ГСП, КОЦМП» и «если МО НЕ ГСП»
 * методолог пишет сокращения, которых нет ни в наименованиях ФРМО, ни в колонке
 * «краткое наименование для отображения»:
 *
 *   ГСП   → МАУЗ ГСП       (префикс МАУЗ сопоставление не срезает — в списке
 *                           правовых форм `organizationNameVariants` его нет)
 *   КОЦМП → КОЦМП ЛФ и СМ  (в справочнике имя с хвостом «ЛФ и СМ»)
 *
 * Без них исключение не срабатывает молча: МО остаётся обязанной, а цифры
 * выглядят прежними. Поэтому же несопоставленное имя в условии-исключении
 * блокирует применение матрицы (`applicability-matrix-blocking.ts`).
 *
 * `alias_kind = 'legacy'` — как и в миграции 0049: это рабочие сокращения
 * методолога, а не официальные наименования из ФРМО.
 */
export const migration: Migration = {
    id: 51,
    name: 'seed_exclusion_list_aliases',
    upSql: `
    INSERT INTO reporting_organization_aliases (
        organization_oid,
        alias,
        normalized_alias,
        alias_kind
    )
    SELECT source.oid,
           source.alias,
           lower(btrim(replace(source.alias, 'ё', 'е'))),
           'legacy'
    FROM (VALUES
        ('1.2.643.5.1.13.13.12.2.45.4270', 'ГСП'),
        ('1.2.643.5.1.13.13.12.2.45.4324', 'КОЦМП')
    ) AS source(oid, alias)
    JOIN reporting_organizations organization ON organization.oid = source.oid
    ON CONFLICT (organization_oid, normalized_alias) DO NOTHING;
    `,
}
