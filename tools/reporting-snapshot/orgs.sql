-- Итог по каждой МО за период: числитель, знаменатель, процент.
--
-- Показатель обязан быть в срезе. Пока показателей с разрезом по МО был один
-- (6.1.3.2.7), строка однозначно определялась организацией. С 13.08.2026 их шесть —
-- добавились четыре доли к объёмам ТПГГ и показатель 27, — и без indicator_id
-- сравнение снимков молча сопоставляло строки разных показателей.
SELECT
    v.indicator_id,
    v.organization_oid,
    v.organization_name AS organization,
    v.numerator,
    v.denominator,
    v.fact_value,
    v.target_value,
    v.status
FROM reporting_organization_indicator_values v
JOIN reporting_periods p ON p.id = v.period_id
WHERE p.code = :'period_code'
ORDER BY v.indicator_id, v.organization_oid;
