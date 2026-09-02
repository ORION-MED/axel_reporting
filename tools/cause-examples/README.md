# Примеры срабатывания причин диагностики

Форма для методолога по трём причинам, которые она пометила «требует обсуждения»
в файле согласования от 18.08.2026 (лист «Действующие причины», колонки O и S,
строки 19, 21, 23; даты в колонке T — 20.08.2026).

Её просьба во всех трёх случаях одна: показать конкретные примеры. Ответить
на это можно только данными — причина срабатывает на реальных OID, и пока их
не видно, обсуждать нечего.

## Что собирается

| Лист | Причина | Содержимое |
|---|---|---|
| «Три причины» | все три | по строке на причину: сколько срабатываний, что это значит на наших данных, колонка «Решение» с выпадающим списком |
| «14 · нет в ФРМР» | `subdivision_not_in_frmr` | полный список подразделений с OID, МО, названием и числом документов; ниже итог по медорганизациям |
| «18 · нет в ТПГГ» | `requirement_waived_organization_absent_from_tpgg` | все пары «МО × вид» |

Причина № 16 отдельного листа не имеет: у неё ровно одно срабатывание —
АО «Курганфармация», и оно целиком помещается в сводную строку.

## Как получить данные

`PERIOD` — рабочий период.

**Подразделения вне ФРМР.** Запрос повторяет тот, что делает сам расчёт
(`pilot-indicator-calculation.service.ts`), включая группировку: считать
по-своему нельзя, иначе число в файле разойдётся с тем, что методолог видит
на экране.

```sql
SELECT facts.subdivision_oid AS oid,
       COALESCE(NULLIF(org.official_short_name,''), NULLIF(org.official_full_name,''),
                facts.organization_oid) AS mo,
       COALESCE(NULLIF(max(facts.subdivision_name),''),'—') AS subdivision,
       SUM(facts.document_count)::int AS docs
FROM reporting_remd_subdivision_facts facts
LEFT JOIN reporting_organization_subdivisions frmr
       ON frmr.subdivision_oid = facts.subdivision_oid AND frmr.is_active = TRUE
LEFT JOIN reporting_organizations org ON org.oid = facts.organization_oid
WHERE facts.period_id = 'PERIOD'
  AND facts.subdivision_oid IS NOT NULL
  AND frmr.subdivision_oid IS NULL
GROUP BY facts.subdivision_oid, org.official_short_name,
         org.official_full_name, facts.organization_oid
ORDER BY docs DESC;
```

**Снятая обязательность.**

```sql
SELECT o.official_short_name AS mo, t.nsi_oid AS code, t.name AS type_name
FROM reporting_diagnostic_findings f
LEFT JOIN reporting_organizations o ON o.oid = f.organization_oid
LEFT JOIN reporting_semd_types t ON t.id = f.semd_type_id
WHERE f.period_id = 'PERIOD'
  AND f.finding_code = 'requirement_waived_organization_absent_from_tpgg'
ORDER BY o.official_short_name, t.nsi_oid::int;
```

**Выгружать обязательно с `--pset=footer=off`:**

```
docker exec axel_server_ready-app-db-1 psql -U telemed -d telemed_app \
  -A -F$'\t' --pset=footer=off -c "<запрос>" > subdiv.tsv
```

Без этого psql дописывает в конец строку «(89 rows)», она попадает в разбор
как ещё одна запись, и восемьдесят девять подразделений превращаются
в девяносто. Сборщик от этого защищён проверкой ключевой колонки, но лучше
не создавать проблему, чем её ловить.

## Запуск

```
python build_examples.py subdiv.tsv waived.tsv out.xlsx
```

## Что показали данные

**№ 18 оказалась машинной формулировкой задачи Д-18.** Тридцать находок — это
три вида (12 патанатомия, 74 карта вызова скорой, 85 диспансерное наблюдение)
у десяти медорганизаций, и все десять работают вне ОМС: КОНД, КОПНБ, ШОПНД,
КОПТД, ШОПТД, КОЦПБС, КОБСМЭ, КОПАБ, КОСПК и Курганфармация.

Это ровно то, о чём методолог говорила на ВКС 24.08 (00:19:28): «госзадание
шире, чем терпрограмма ОМС. Психбольница, психоневрологические диспансеры,
КВД-шники — они оказывают помощь не за ОМС… А нам нужно всё равно их включить
и учитывать, потому что диспансерное наблюдение делают и ОМС-ники,
и бюджетные учреждения».

Вид 85 — диспансерное наблюдение — в списке. То есть причина не «непонятная»,
а показывающая её собственный случай.
