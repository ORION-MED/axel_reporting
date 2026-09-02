-- Раскладка причин за период: что система предъявляет, кому и по какому виду.
SELECT
    f.finding_code,
    f.severity,
    f.responsibility_area,
    coalesce(o.official_short_name, '—') AS organization,
    coalesce(t.code, '—')                AS semd_code
FROM reporting_diagnostic_findings f
JOIN reporting_periods p ON p.id = f.period_id
LEFT JOIN reporting_organizations o ON o.oid = f.organization_oid
LEFT JOIN reporting_semd_types t ON t.id = f.semd_type_id
WHERE p.code = :'period_code'
  AND f.status = 'active'
ORDER BY f.finding_code, organization, semd_code;
