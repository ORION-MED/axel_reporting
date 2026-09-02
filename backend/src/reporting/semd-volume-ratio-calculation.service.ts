import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { calculateBusinessAssessment } from './engine/ratio-percent.calculator'
import {
    calculateSemdVolumeRatio,
    numeratorCodes,
    type SemdVolumeRatioConfig,
    type SemdVolumeRatioOrganizationValue,
    type SemdVolumeRatioResult,
    type SemdVolumeRatioTypeBreakdown,
} from './semd-volume-ratio.calculator'
import {
    SEMD_VOLUME_RATIO_CONFIGS,
    findSemdVolumeRatioConfig,
} from './semd-volume-ratio.config'
import { buildVolumeRatioFindings } from './semd-volume-ratio-findings'

const INSERT_BATCH_SIZE = 300

/** Целевые значения показателя: месячное из «Приложения 2» и на конец года. */
interface IndicatorTarget {
    targetValue: number | null
    targetYearEndValue: number | null
}

/**
 * Оркестратор четырёх показателей-долей (6.1.3.2.8–6.1.3.2.11): собирает сырые числа,
 * отдаёт их чистой функции `calculateSemdVolumeRatio` и сохраняет результат в те же
 * таблицы, из которых читают дашборд и карта (`reporting_indicator_values`,
 * `reporting_organization_indicator_values`).
 *
 * Никакой логики расчёта здесь нет и быть не должно — она вся в калькуляторе, покрытом
 * юнит-тестами. Здесь только SQL и раскладка результата по колонкам.
 *
 * Расчёт 6.1.3.2.7 не затрагивается: общего кода с ним — только чтение фактов РЭМД
 * и объёмов ТПГГ, обе таблицы только читаются.
 */
@Injectable()
export class SemdVolumeRatioCalculationService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    /** Показатели, которые умеет считать этот сервис. */
    supports(indicatorId: string): boolean {
        return findSemdVolumeRatioConfig(indicatorId) !== null
    }

    /**
     * Пересчёт всех четырёх долей. Вызывается при открытии вкладки «Показатели»,
     * где значения показываются рядом: считать только выбранный смысла нет.
     * Показатели независимы, поэтому падение одного не должно ронять остальные —
     * ошибка возвращается в списке, а не бросается.
     */
    async recalculateAll(periodId: string): Promise<Array<{
        indicatorId: string
        error: string | null
    }>> {
        const outcomes: Array<{ indicatorId: string; error: string | null }> = []
        for (const config of SEMD_VOLUME_RATIO_CONFIGS) {
            try {
                await this.recalculate(periodId, config.indicatorId)
                outcomes.push({ indicatorId: config.indicatorId, error: null })
            } catch (error) {
                outcomes.push({
                    indicatorId: config.indicatorId,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
        return outcomes
    }

    async recalculate(
        periodId: string,
        indicatorId: string,
    ): Promise<SemdVolumeRatioResult> {
        const config = findSemdVolumeRatioConfig(indicatorId)
        if (!config) {
            throw new NotFoundException(
                `Показатель ${indicatorId} не считается по объёмам ТПГГ`,
            )
        }

        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            // Тот же замок, что у 6.1.3.2.7: пересчёт запускается с дашборда, и два
            // параллельных запроса иначе пишут одни и те же строки.
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));`,
                [String(periodId), config.indicatorId],
            )

            const period = await this.loadPeriod(client, periodId)
            const organizations = await this.loadOrganizations(client)
            const [facts, plans, target, semdTypeNames, execution] = await Promise.all([
                this.loadFacts(client, periodId, config),
                this.loadPlans(client, period.reportingYear, config),
                this.loadTargetValue(client, periodId, config.indicatorId),
                this.loadSemdTypeNames(client, config),
                this.loadExecution(client, period.reportingYear, config),
            ])

            const result = calculateSemdVolumeRatio(config, {
                organizationOids: organizations.map((organization) => organization.oid),
                facts,
                plans,
                throughMonth: period.throughMonth,
            })

            await this.saveRegionalValue(
                client,
                periodId,
                config,
                result,
                target,
                semdTypeNames,
                period.throughMonth,
                execution,
            )
            await this.saveOrganizationValues(
                client,
                periodId,
                config,
                organizations,
                result,
                target,
                semdTypeNames,
                period.throughMonth,
                execution,
            )
            await this.saveFindings(client, periodId, config.indicatorId, result)

            await client.query('COMMIT')
            return result
        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    }

    private async loadPeriod(
        client: PoolClient,
        periodId: string,
    ): Promise<{ reportingYear: number; throughMonth: number }> {
        const result = await client.query(
            `
            SELECT date_from::text AS "dateFrom",
                   date_to::text AS "dateTo"
            FROM reporting_periods
            WHERE id = $1;
            `,
            [periodId],
        )
        const period = result.rows[0]
        if (!period) throw new NotFoundException('Отчетный период не найден')

        const reportingDate = period.dateTo ?? period.dateFrom ?? ''
        const parsedYear = Number(String(reportingDate).slice(0, 4))
        const parsedMonth = Number(String(reportingDate).slice(5, 7))
        return {
            reportingYear: Number.isInteger(parsedYear)
                ? parsedYear
                : new Date().getFullYear(),
            /**
             * Месяц накопления плана берётся из отчётной даты периода, а не из
             * системной: иначе пересчёт прошлого периода однажды дал бы другую
             * цифру, и снимки «до/после» перестали бы что-либо значить.
             * Месяц берётся из текста, а не через `new Date`: конструктор снова
             * завёл бы разговор про часовой пояс. Сам `toDateString` сдвиг больше
             * не делает — исправлено 20.08.2026.
             */
            throughMonth: Number.isInteger(parsedMonth)
                && parsedMonth >= 1
                && parsedMonth <= 12
                ? parsedMonth
                : 12,
        }
    }

    private async loadOrganizations(client: PoolClient): Promise<OrganizationRow[]> {
        const result = await client.query(`
            SELECT oid,
                   official_full_name AS "officialFullName",
                   official_short_name AS "officialShortName",
                   common_name AS "commonName",
                   address,
                   latitude::float8 AS latitude,
                   longitude::float8 AS longitude,
                   location_source AS "locationSource",
                   location_precision AS "locationPrecision"
            FROM reporting_organizations
            WHERE is_active = TRUE
            ORDER BY official_short_name, official_full_name, oid;
        `)
        return result.rows.map((row) => ({
            oid: String(row.oid),
            officialFullName: String(row.officialFullName ?? ''),
            officialShortName: String(row.officialShortName ?? ''),
            commonName: String(row.commonName ?? ''),
            address: String(row.address ?? ''),
            latitude: row.latitude === null ? null : Number(row.latitude),
            longitude: row.longitude === null ? null : Number(row.longitude),
            locationSource: String(row.locationSource ?? ''),
            locationPrecision: String(row.locationPrecision ?? 'unknown'),
        }))
    }

    /** Регистрации нужных видов СЭМД в разрезе МО. Виды сопоставляются по «Вид МД». */
    private async loadFacts(
        client: PoolClient,
        periodId: string,
        config: SemdVolumeRatioConfig,
    ) {
        const result = await client.query(
            `
            SELECT fact.organization_oid AS "organizationOid",
                   semd.nsi_oid AS "semdTypeCode",
                   fact.document_count::float8 AS "documentCount"
            FROM reporting_remd_facts fact
            JOIN reporting_semd_types semd ON semd.id = fact.semd_type_id
            WHERE fact.period_id = $1
              AND fact.scope_level = 'organization'
              AND semd.nsi_oid = ANY($2::text[]);
            `,
            [periodId, [...numeratorCodes(config)]],
        )
        return result.rows.map((row) => ({
            organizationOid: String(row.organizationOid),
            semdTypeCode: String(row.semdTypeCode),
            documentCount: Number(row.documentCount ?? 0),
        }))
    }

    /**
     * Объёмы ТПГГ берутся по отчётному году, а не по периоду: терпрограмма годовая
     * и может быть загружена в другом периоде того же года — так же читает её импортёр
     * матрицы применимости.
     *
     * **Только последняя загрузка года.** Одну и ту же терпрограмму грузят в каждый новый
     * период, и в базе Курганской области лежат четыре одинаковых импорта за 2026 год.
     * Импортёру матрицы это безразлично — он проверяет «есть ли объём больше нуля», —
     * а здесь объёмы складываются, и без отбора знаменатель вырос бы вчетверо.
     * Правило простое и предсказуемое: терпрограмма на год одна, последняя загрузка
     * вытесняет предыдущие.
     */
    /**
     * Исполнение терпрограммы по реестрам ОМС (Д-10).
     *
     * Читается по году и по тем же листам, что знаменатель показателя, — иначе
     * рядом с планом встал бы факт по другой совокупности, и три числа карточки
     * оказались бы про разное.
     *
     * Строки без `organization_oid` пропускаются: это организации вне контура
     * (ЧУЗ «РЖД-Медицина», частные клиники), они сохранены справочно.
     */
    private async loadExecution(
        client: PoolClient,
        reportingYear: number,
        config: SemdVolumeRatioConfig,
    ): Promise<ExecutionFacts> {
        const result = await client.query(
            `
            SELECT organization_oid AS "organizationOid",
                   sum(fact_value)::float8 AS "factValue",
                   sum(plan_value)::float8 AS "planValue",
                   min(from_month)::int AS "fromMonth",
                   max(to_month)::int AS "toMonth"
            FROM reporting_tpgg_execution_values
            WHERE reporting_year = $1
              AND sheet_code = ANY($2::text[])
              AND organization_oid IS NOT NULL
            GROUP BY organization_oid;
            `,
            [reportingYear, [...config.tpggSheetCodes]],
        )
        const byOrganization = new Map<string, { factValue: number; planValue: number }>()
        let fromMonth: number | null = null
        let toMonth: number | null = null
        for (const row of result.rows) {
            byOrganization.set(String(row.organizationOid), {
                factValue: Number(row.factValue ?? 0),
                planValue: Number(row.planValue ?? 0),
            })
            const rowFrom = row.fromMonth === null ? null : Number(row.fromMonth)
            const rowTo = row.toMonth === null ? null : Number(row.toMonth)
            if (rowFrom !== null && (fromMonth === null || rowFrom < fromMonth)) {
                fromMonth = rowFrom
            }
            if (rowTo !== null && (toMonth === null || rowTo > toMonth)) {
                toMonth = rowTo
            }
        }
        return { byOrganization, fromMonth, toMonth }
    }

    private async loadPlans(
        client: PoolClient,
        reportingYear: number,
        config: SemdVolumeRatioConfig,
    ) {
        const result = await client.query(
            `
            SELECT organization_oid AS "organizationOid",
                   sheet_code AS "sheetCode",
                   annual_value::float8 AS "annualValue",
                   monthly_values AS "monthlyValues"
            FROM reporting_tpgg_plan_values
            WHERE reporting_year = $1
              AND organization_oid IS NOT NULL
              AND sheet_code = ANY($2::text[])
              AND source_import_id = (
                  SELECT source_import_id
                  FROM reporting_tpgg_plan_values
                  WHERE reporting_year = $1
                  ORDER BY created_at DESC
                  LIMIT 1
              );
            `,
            [reportingYear, [...config.tpggSheetCodes]],
        )
        return result.rows.map((row) => ({
            organizationOid: String(row.organizationOid),
            sheetCode: String(row.sheetCode),
            annualValue: Number(row.annualValue ?? 0),
            monthlyValues: toMonthlyValues(row.monthlyValues),
        }))
    }

    /**
     * Наименования видов СЭМД для детализации числителя. Калькулятор знает только коды —
     * подписи добавляются здесь, при сохранении: «выводим значения СЭМД по обоим видам»
     * из ТЗ методолога означает читаемые названия, а не «Вид МД 1» и «Вид МД 10».
     */
    private async loadSemdTypeNames(
        client: PoolClient,
        config: SemdVolumeRatioConfig,
    ): Promise<Map<string, string>> {
        const result = await client.query(
            `
            SELECT nsi_oid AS "semdTypeCode",
                   COALESCE(NULLIF(btrim(official_name_5pr), ''), name) AS "name"
            FROM reporting_semd_types
            WHERE nsi_oid = ANY($1::text[]);
            `,
            [[...numeratorCodes(config)]],
        )
        return new Map(
            result.rows.map((row) => [String(row.semdTypeCode), String(row.name ?? '')]),
        )
    }

    /**
     * Плановое значение приходит из «Приложения 2» отдельной загрузкой и пересчётом
     * не управляется. Для новых показателей целевых процентов пока нет ни в Приложении 2,
     * ни в ТЗ (вопрос 9.7) — тогда оценка выполнения остаётся «не оценивался».
     */
    private async loadTargetValue(
        client: PoolClient,
        periodId: string,
        indicatorId: string,
    ): Promise<IndicatorTarget> {
        const result = await client.query(
            `
            SELECT target_value::float8 AS "targetValue",
                   target_year_end_value::float8 AS "targetYearEndValue"
            FROM reporting_indicator_values
            WHERE period_id = $1 AND indicator_id = $2;
            `,
            [periodId, indicatorId],
        )
        const row = result.rows[0]
        const targetValue = toNullableNumber(row?.targetValue)
        return {
            /**
             * Обычно цель приходит из «Приложения 2» вместе с плановыми
             * значениями. У показателей вне «Приложения 2» её взять неоткуда,
             * и без цели сота на карте остаётся серой при верной цифре —
             * ровно то, из-за чего скрыт показатель 1.24.
             *
             * Поэтому у таких показателей цель лежит в самом справочнике,
             * в `metadata.fixedTargetValue`. Она уступает загруженной: если
             * методолог однажды пришлёт «Приложение 2» с этим показателем,
             * победит присланное, а не зашитое.
             */
            targetValue: targetValue
                ?? await this.loadFixedTargetValue(client, indicatorId),
            /**
             * Целевое на конец года стоит рядом с месячным на карточке: методолог
             * 15.08.2026 приняла месячные 70 % за неверные, помня годовые 95 %.
             * Оценка выполнения по-прежнему считается по месячному.
             */
            targetYearEndValue: toNullableNumber(row?.targetYearEndValue),
        }
    }

    /** Цель, зашитая в справочник показателей: только для тех, кого нет в «Приложении 2». */
    private async loadFixedTargetValue(
        client: PoolClient,
        indicatorId: string,
    ): Promise<number | null> {
        const result = await client.query(
            `
            SELECT (metadata->>'fixedTargetValue')::float8 AS "fixedTargetValue"
            FROM reporting_indicators
            WHERE id = $1;
            `,
            [indicatorId],
        )
        return toNullableNumber(result.rows[0]?.fixedTargetValue)
    }

    private async saveRegionalValue(
        client: PoolClient,
        periodId: string,
        config: SemdVolumeRatioConfig,
        result: SemdVolumeRatioResult,
        target: IndicatorTarget,
        semdTypeNames: ReadonlyMap<string, string>,
        throughMonth: number,
        execution: ExecutionFacts,
    ): Promise<void> {
        const { region } = result
        const calculated = region.percent !== null
        // Оценка выполнения — по месячному целевому: мониторим состояние на текущий
        // момент, а не итог года. Годовое идёт рядом только подписью.
        const assessment = calculateBusinessAssessment(region.percent, target.targetValue)

        await client.query(
            `
            INSERT INTO reporting_indicator_values (
                indicator_id,
                period_id,
                numerator,
                denominator,
                fact_value,
                status,
                deviation_value,
                business_status,
                note,
                source_name,
                calculation_details,
                target_value
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
            ON CONFLICT (indicator_id, period_id) DO UPDATE SET
                numerator = EXCLUDED.numerator,
                denominator = EXCLUDED.denominator,
                fact_value = EXCLUDED.fact_value,
                status = EXCLUDED.status,
                deviation_value = EXCLUDED.deviation_value,
                business_status = EXCLUDED.business_status,
                note = EXCLUDED.note,
                source_name = EXCLUDED.source_name,
                calculation_details = EXCLUDED.calculation_details,
                -- Целевым значением владеет импорт «Приложения 2», и перетирать
                -- его расчётом нельзя. Но у показателей вне «Приложения 2» цель
                -- приходить неоткуда, и пустая клетка означала бы «оценки нет»
                -- при посчитанной оценке. Поэтому заполняется только дырка.
                target_value = COALESCE(
                    reporting_indicator_values.target_value,
                    EXCLUDED.target_value
                ),
                updated_at = now();
            `,
            [
                config.indicatorId,
                periodId,
                region.numerator,
                region.denominator,
                region.percent,
                calculated ? 'calculated' : 'awaiting_data',
                assessment.deviationValue,
                assessment.businessStatus,
                this.regionNote(region),
                SOURCE_NAME,
                JSON.stringify({
                    ...region,
                    aggregate: config.aggregate,
                    // Д-10: факт исполнения терпрограммы по реестрам ОМС — третья
                    // колонка карточки. Он стоит рядом с планом, а не подменяет
                    // знаменатель: в макете методолога от 25.08.2026 доля считается
                    // по-прежнему от плана (8 163 / 20 174 = 40,46 %).
                    execution: regionExecution(execution),
                    // Месяц, по который накоплен план: интерфейс подписывает им
                    // знаменатель («План на август»), а не считает сам.
                    throughMonth,
                    numeratorByType: withTypeNames(region.numeratorByType, semdTypeNames),
                }),
                target.targetValue,
            ],
        )
    }

    private regionNote(region: SemdVolumeRatioResult['region']): string {
        if (region.percent === null) {
            return 'Утверждённых объёмов по нужным видам медицинской помощи '
                + 'в терпрограмме не найдено — знаменатель не собрался.'
        }
        if (region.factWithoutPlanOrganizationCount === 0) return ''
        // Числитель собирается по всем МО, знаменатель — только по тем, у кого объём
        // утверждён. Разницу видно тут, а не только в деталях расчёта.
        return `${region.factWithoutPlanOrganizationCount} МО зарегистрировали СЭМД, `
            + 'но утверждённого объёма по этим видам помощи в терпрограмме нет '
            + `(${region.numeratorWithoutPlan} документов в числителе без знаменателя).`
    }

    private async saveOrganizationValues(
        client: PoolClient,
        periodId: string,
        config: SemdVolumeRatioConfig,
        organizations: readonly OrganizationRow[],
        result: SemdVolumeRatioResult,
        target: IndicatorTarget,
        semdTypeNames: ReadonlyMap<string, string>,
        throughMonth: number,
        execution: ExecutionFacts,
    ): Promise<void> {
        const activeOids = organizations.map((organization) => organization.oid)
        await client.query(
            `
            DELETE FROM reporting_organization_indicator_values
            WHERE period_id = $1
              AND indicator_id = $2
              AND NOT (organization_oid = ANY($3::text[]));
            `,
            [periodId, config.indicatorId, activeOids],
        )

        const organizationByOid = new Map(
            organizations.map((organization) => [organization.oid, organization]),
        )
        for (const batch of chunk(result.organizations, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((value, index) => {
                const offset = index * 21
                const organization = organizationByOid.get(value.organizationOid)!
                const assessment = calculateBusinessAssessment(value.percent, target.targetValue)
                values.push(
                    config.indicatorId,
                    periodId,
                    organization.oid,
                    organization.officialShortName
                        || organization.commonName
                        || organization.officialFullName,
                    organization.officialFullName,
                    organization.address,
                    organization.latitude,
                    organization.longitude,
                    organization.locationSource,
                    organization.locationPrecision,
                    value.numerator,
                    value.denominator,
                    value.percent,
                    target.targetValue,
                    target.targetYearEndValue,
                    value.status === 'calculated' ? 'calculated' : 'not_calculated',
                    assessment.deviationValue,
                    assessment.businessStatus,
                    organizationNote(value),
                    SOURCE_NAME,
                    JSON.stringify({
                        ...value,
                        throughMonth,
                        execution: execution.byOrganization.get(value.organizationOid)
                            ? {
                                ...execution.byOrganization.get(value.organizationOid)!,
                                fromMonth: execution.fromMonth,
                                toMonth: execution.toMonth,
                            }
                            : null,
                        numeratorByType: withTypeNames(value.numeratorByType, semdTypeNames),
                    }),
                )
                return `(
                    $${offset + 1}, $${offset + 2}, $${offset + 3},
                    $${offset + 4}, $${offset + 5}, $${offset + 6},
                    $${offset + 7}, $${offset + 8}, $${offset + 9},
                    $${offset + 10}, $${offset + 11}, $${offset + 12},
                    $${offset + 13}, $${offset + 14}, $${offset + 15},
                    $${offset + 16}, $${offset + 17}, $${offset + 18},
                    $${offset + 19}, $${offset + 20}, $${offset + 21}::jsonb
                )`
            })

            await client.query(
                `
                INSERT INTO reporting_organization_indicator_values (
                    indicator_id,
                    period_id,
                    organization_oid,
                    organization_name,
                    organization_full_name,
                    address,
                    latitude,
                    longitude,
                    location_source,
                    location_precision,
                    numerator,
                    denominator,
                    fact_value,
                    target_value,
                    target_year_end_value,
                    status,
                    deviation_value,
                    business_status,
                    note,
                    source_name,
                    calculation_details
                )
                VALUES ${placeholders.join(',')}
                ON CONFLICT (indicator_id, period_id, organization_oid)
                DO UPDATE SET
                    organization_name = EXCLUDED.organization_name,
                    organization_full_name = EXCLUDED.organization_full_name,
                    address = EXCLUDED.address,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    location_source = EXCLUDED.location_source,
                    location_precision = EXCLUDED.location_precision,
                    numerator = EXCLUDED.numerator,
                    denominator = EXCLUDED.denominator,
                    fact_value = EXCLUDED.fact_value,
                    target_value = EXCLUDED.target_value,
                    target_year_end_value = EXCLUDED.target_year_end_value,
                    status = EXCLUDED.status,
                    deviation_value = EXCLUDED.deviation_value,
                    business_status = EXCLUDED.business_status,
                    note = EXCLUDED.note,
                    source_name = EXCLUDED.source_name,
                    calculation_details = EXCLUDED.calculation_details,
                    updated_at = now();
                `,
                values,
            )
        }
    }

    /**
     * Н20: находки показателя-доли.
     *
     * Таблица `reporting_diagnostic_findings` общая и рассчитана на любой показатель —
     * ключ включает `indicator_id`. До 18.08.2026 писал в неё только расчёт 6.1.3.2.7,
     * поэтому удаление тоже идёт по паре «период + показатель»: чужие находки
     * пересчёт доли трогать не должен.
     *
     * `semd_type_id` у этих находок пустой: перевыполнение относится к МО целиком,
     * а не к отдельному виду СЭМД. Колонка это допускает.
     */
    private async saveFindings(
        client: PoolClient,
        periodId: string,
        indicatorId: string,
        result: SemdVolumeRatioResult,
    ): Promise<void> {
        await client.query(
            `
            DELETE FROM reporting_diagnostic_findings
            WHERE period_id = $1
              AND indicator_id = $2;
            `,
            [periodId, indicatorId],
        )

        const findings = buildVolumeRatioFindings(result)
        if (findings.length === 0) return

        for (const batch of chunk(findings, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((finding, index) => {
                const offset = index * 9
                values.push(
                    periodId,
                    indicatorId,
                    finding.organizationOid,
                    finding.findingCode,
                    finding.severity,
                    finding.cause,
                    finding.responsibilityArea,
                    finding.recommendation,
                    JSON.stringify(finding.evidence),
                )
                return `(
                    $${offset + 1}, $${offset + 2}, $${offset + 3},
                    $${offset + 4}, $${offset + 5}, $${offset + 6},
                    $${offset + 7}, $${offset + 8}, $${offset + 9}::jsonb
                )`
            })
            await client.query(
                `
                INSERT INTO reporting_diagnostic_findings (
                    period_id,
                    indicator_id,
                    organization_oid,
                    finding_code,
                    severity,
                    cause,
                    responsibility_area,
                    recommendation,
                    evidence
                )
                VALUES ${placeholders.join(',')};
                `,
                values,
            )
        }
    }
}

const SOURCE_NAME = 'РЭМД + объёмы ТПГГ'

interface OrganizationRow {
    oid: string
    officialFullName: string
    officialShortName: string
    commonName: string
    address: string
    latitude: number | null
    longitude: number | null
    locationSource: string
    locationPrecision: string
}

/** Подпись на карточке МО. Ноль вместо процента был бы враньём — объясняем, почему пусто. */
export function organizationNote(value: SemdVolumeRatioOrganizationValue): string {
    if (value.status === 'no_approved_volume') {
        return 'Утверждённого объёма по этим видам медицинской помощи в терпрограмме нет — '
            + `процент не рассчитывается. Зарегистрировано СЭМД: ${value.numerator}.`
    }
    if (value.status === 'not_participating') {
        return 'МО не участвует в показателе: ни утверждённого объёма в терпрограмме, '
            + 'ни зарегистрированных СЭМД.'
    }
    return ''
}

function withTypeNames(
    breakdown: readonly SemdVolumeRatioTypeBreakdown[],
    semdTypeNames: ReadonlyMap<string, string>,
): Array<SemdVolumeRatioTypeBreakdown & { semdTypeName: string }> {
    return breakdown.map((item) => ({
        ...item,
        semdTypeName: semdTypeNames.get(item.semdTypeCode) ?? '',
    }))
}

/**
 * Роспись из JSONB. Драйвер отдаёт колонку уже разобранной, но строки в базе,
 * загруженные до миграции 0046, несут пустой объект — это законное значение,
 * калькулятор откатится на годовой план и пометит расчёт.
 */
function toMonthlyValues(raw: unknown): Record<number, number> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const source = raw as Record<string, unknown>
    const values: Record<number, number> = {}
    for (const [key, value] of Object.entries(source)) {
        const month = Number(key)
        if (!Number.isInteger(month) || month < 1 || month > 12) continue
        const parsed = Number(value)
        if (!Number.isFinite(parsed)) continue
        values[month] = parsed
    }
    return values
}

function toNullableNumber(value: unknown): number | null {
    if (value === null || typeof value === 'undefined') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function chunk<T>(items: readonly T[], size: number): T[][] {
    const batches: T[][] = []
    for (let index = 0; index < items.length; index += size) {
        batches.push(items.slice(index, index + size))
    }
    return batches
}

/**
 * Факт исполнения по медорганизациям и общий интервал среза.
 *
 * Интервал один на все строки: фонд выгружает срез целиком, и разные месяцы
 * в одном показателе означали бы, что файлы грузили вразнобой. Берётся
 * наименьшее начало и наибольший конец — так подпись честна и в этом случае.
 */
interface ExecutionFacts {
    byOrganization: Map<string, { factValue: number; planValue: number }>
    fromMonth: number | null
    toMonth: number | null
}

/**
 * Регион — сумма исполнения по медорганизациям контура. `null`, когда файлов
 * исполнения нет вовсе: ноль в карточке читался бы как «ничего не сделано».
 */
function regionExecution(execution: ExecutionFacts) {
    if (execution.byOrganization.size === 0) return null
    let factValue = 0
    let planValue = 0
    for (const item of execution.byOrganization.values()) {
        factValue += item.factValue
        planValue += item.planValue
    }
    return {
        factValue,
        planValue,
        fromMonth: execution.fromMonth,
        toMonth: execution.toMonth,
    }
}
