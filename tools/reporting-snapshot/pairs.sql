-- Знаменатель показателя: обязательность по каждой паре «МО × вид СЭМД».
-- Срез не зависит от периода — обязательность живёт в справочнике, а не в расчёте.
SELECT
    o.oid                 AS organization_oid,
    o.official_short_name AS organization,
    t.code                AS semd_code,
    t.name                AS semd_name,
    r.requirement_status,
    r.reason,
    r.source_name
FROM reporting_organization_semd_requirements r
JOIN reporting_organizations o ON o.oid = r.organization_oid
JOIN reporting_semd_types t ON t.id = r.semd_type_id
ORDER BY o.oid, (t.code ~ '^[0-9]+$') DESC, length(t.code), t.code;
