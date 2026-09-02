import type { Migration } from '../migration.types'

/**
 * Синоним «Бюро СМЭ» → ГКУ «КОБСМЭ» под перечни-включения формы от 18.08.2026.
 *
 * Шесть правил («если МО - Бюро СМЭ», виды 13, 14, 254, 353, 354, 458) ссылаются
 * на наименование, которого нет ни в ФРМО, ни в колонке «краткое наименование
 * для отображения»: там организация зовётся ГКУ «КОБСМЭ».
 *
 * Пока «условно» читается как «не определено», такое правило даёт «не определено»
 * и проблема хотя бы видна. При включении CONDITIONAL_STATUS_IS_REQUIRED правило
 * молча применится ни к кому, и у КОБСМЭ окажется ноль обязательных видов —
 * см. раздел 7.1 переноса контекста от 20.08.2026.
 *
 * `alias_kind = 'legacy'` — рабочее сокращение методолога, а не наименование ФРМО.
 *
 * Остальные три наименования из тех же 11 правил синонимом не лечатся и ждут
 * методолога: «Санаторий» (виды 48, 50, 357 — среди 37 МО санатория нет вовсе),
 * «Диспансер» (вид 90 — их четыре: КОНД, КОКД, КОКВД, КООД) и
 * «Психоневрологический диспансер» (вид 142 — ШОПНД или КОПНБ, неясно).
 */
export const migration: Migration = {
    id: 53,
    name: 'seed_bureau_sme_alias',
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
        ('1.2.643.5.1.13.13.12.2.45.4295', 'Бюро СМЭ')
    ) AS source(oid, alias)
    JOIN reporting_organizations organization ON organization.oid = source.oid
    ON CONFLICT (organization_oid, normalized_alias) DO NOTHING;
    `,
}
