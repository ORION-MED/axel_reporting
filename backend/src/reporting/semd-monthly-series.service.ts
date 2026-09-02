import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import {
    buildExecutionSummary,
    type ExecutionSummary,
} from './semd-execution-summary'
import {
    buildOrganizationBreakdown,
    type OrganizationBreakdown,
} from './semd-organization-breakdown'
import {
    buildSemdMonthlySeries,
    type MonthlySeriesPoint,
} from './semd-monthly-series'
import { SEMD_TYPE_REGISTRY_INDICATOR_ID } from './semd-type-registry-calculation.service'
import { SEMD_VOLUME_RATIO_CONFIGS } from './semd-volume-ratio.config'

/**
 * Данные для окна «Динамика по месяцам» (Д-9).
 *
 * Читает помесячные выгрузки РЭМД (`reporting_remd_interval_facts`,
 * `coverage = 'month'`) и роспись терпрограммы, отдаёт двенадцать точек
 * на показатель — по региону целиком или по одной МО.
 *
 * **Показатель «Виды СЭМД в РЭМД» устроен иначе и обслуживается тем же методом.**
 * У него нет плана в случаях, зато есть вторая величина, которую методолог
 * попросила показать: «для показателя 27 по региону и по МО количество уникальных
 * СЭМД берём из выгрузки нарастающим итогом, а динамика по кол-ву СЭМД —
 * с каждого месяца». Поэтому у него `plan` пустой, `fact` — все документы месяца,
 * а число видов приходит отдельным рядом.
 */

export interface MonthlyTypeCountPoint {
    month: number
    /** Уникальных видов СЭМД нарастающим итогом с января по этот месяц. */
    uniqueTypeCount: number
}

export interface SemdMonthlySeriesResult {
    periodId: string
    indicatorId: string
    indicatorCode: string
    level: 'region' | 'organization'
    organizationOid: string | null
    organizationName: string | null
    /** Месяцы, за которые выгрузка РЭМД загружена. Пусто — графика ещё нет. */
    loadedMonths: number[]
    points: MonthlySeriesPoint[]
    /** Только у показателя «Виды СЭМД в РЭМД»; у остальных пусто. */
    typeCountPoints: MonthlyTypeCountPoint[]
    /**
     * Блок «от факта»: доля СЭМД от случаев, поданных на оплату в ТФОМС.
     * `null`, если исполнение не загружено или файл не назвал период —
     * у показателя 27 его нет никогда, реестров ОМС для видов не существует.
     */
    executionSummary: ExecutionSummary | null
    /**
     * Разрез по медорганизациям для точечной диаграммы и тепловой карты.
     *
     * Только при разрезе «регион целиком»: когда выбрана одна МО, сравнивать
     * её не с кем, а тепловая карта из одной строки — это та же кривая,
     * нарисованная хуже.
     */
    organizationBreakdown: OrganizationBreakdown | null
}

@Injectable()
export class SemdMonthlySeriesService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async getSeries(
        periodId: string,
        indicatorId: string,
        organizationOid?: string,
    ): Promise<SemdMonthlySeriesResult> {
        const client = await this.pool.connect()
        try {
            const reportingYear = await this.loadReportingYear(client, periodId)
            const organizations = await this.loadOrganizations(
                client,
                organizationOid,
            )
            if (organizationOid && organizations.length === 0) {
                throw new NotFoundException('Медицинская организация не найдена')
            }
            const organizationOids = organizations.map((item) => item.oid)
            const loadedMonths = await this.loadLoadedMonths(client, periodId)

            const base = {
                periodId,
                indicatorId,
                level: (organizationOid ? 'organization' : 'region') as
                    'region' | 'organization',
                organizationOid: organizationOid ?? null,
                /**
                 * Только при разрезе по одной МО. При разрезе «регион целиком»
                 * `organizations` — это все 37, и первая из них попадала
                 * в заголовок дашборда: методолог 28.08.2026 увидела там
                 * «АО "Курганфармация"» вместо «Курганская область».
                 */
                organizationName: organizationOid
                    ? organizations[0]?.name ?? null
                    : null,
                loadedMonths,
            }

            if (indicatorId === SEMD_TYPE_REGISTRY_INDICATOR_ID) {
                return {
                    ...base,
                    indicatorCode: '27',
                    points: await this.buildRegistryPoints(
                        client,
                        periodId,
                        organizationOids,
                        loadedMonths,
                    ),
                    typeCountPoints: await this.loadTypeCountPoints(
                        client,
                        periodId,
                        organizationOids,
                    ),
                    // Реестров ОМС по видам СЭМД не существует: показатель 27
                    // считает виды, а фонд платит за случаи.
                    executionSummary: null,
                    organizationBreakdown: null,
                }
            }

            const config = SEMD_VOLUME_RATIO_CONFIGS.find(
                (item) => item.indicatorId === indicatorId,
            )
            if (!config) {
                throw new NotFoundException(
                    'У этого показателя нет помесячной динамики',
                )
            }

            const [facts, plans, execution, executionByOrganization] = await Promise.all([
                this.loadMonthlyFacts(client, periodId, config.semdTypeCodes.concat(
                    config.additionalSemdTypeCodes ?? [],
                )),
                this.loadMonthlyPlans(client, reportingYear, config.tpggSheetCodes),
                this.loadExecutionSlice(
                    client,
                    reportingYear,
                    config.tpggSheetCodes,
                    organizationOids,
                ),
                this.loadExecutionByOrganization(
                    client,
                    reportingYear,
                    config.tpggSheetCodes,
                    organizationOids,
                ),
            ])

            const points = buildSemdMonthlySeries({
                config,
                organizationOids,
                facts,
                plans,
                loadedMonths,
            })

            return {
                ...base,
                indicatorCode: config.code,
                points,
                typeCountPoints: [],
                executionSummary: execution
                    ? buildExecutionSummary({
                        fromMonth: execution.fromMonth,
                        toMonth: execution.toMonth,
                        executionFact: execution.factValue,
                        points,
                    })
                    : null,
                organizationBreakdown: organizationOid
                    ? null
                    : buildOrganizationBreakdown({
                        config,
                        organizations,
                        facts,
                        plans,
                        loadedMonths,
                        executionByOrganization,
                        fromMonth: execution?.fromMonth ?? null,
                        toMonth: execution?.toMonth ?? null,
                    }),
            }
        } finally {
            client.release()
        }
    }

    /**
     * Кривая показателя 27 — все зарегистрированные документы месяца, без отбора
     * по видам: показатель считает виды, а динамику методолог просила по общему
     * количеству СЭМД. Плана в случаях у него нет.
     */
    private async buildRegistryPoints(
        client: PoolClient,
        periodId: string,
        organizationOids: readonly string[],
        loadedMonths: readonly number[],
    ): Promise<MonthlySeriesPoint[]> {
        const result = await client.query(
            `
            SELECT month, sum(document_count)::float8 AS "documentCount"
            FROM reporting_remd_interval_facts
            WHERE period_id = $1
              AND coverage = 'month'
              AND organization_oid = ANY($2::text[])
            GROUP BY month;
            `,
            [periodId, [...organizationOids]],
        )
        const byMonth = new Map<number, number>(
            result.rows.map((row) => [
                Number(row.month),
                Number(row.documentCount ?? 0),
            ]),
        )
        const loaded = new Set(loadedMonths)
        return Array.from({ length: 12 }, (_unused, index) => index + 1).map(
            (month) => ({
                month,
                plan: null,
                fact: loaded.has(month) ? byMonth.get(month) ?? 0 : null,
                // Доли нет и быть не может: у показателя 27 знаменатель —
                // перечень видов, а не помесячный объём терпрограммы.
                ratio: null,
            }),
        )
    }

    /**
     * Уникальные виды нарастающим итогом. Берутся из нарастающих выгрузок,
     * а не складываются из помесячных: вид, зарегистрированный в марте и в мае,
     * в сумме дал бы два, а он один.
     */
    private async loadTypeCountPoints(
        client: PoolClient,
        periodId: string,
        organizationOids: readonly string[],
    ): Promise<MonthlyTypeCountPoint[]> {
        const result = await client.query(
            `
            SELECT month, count(DISTINCT semd_type_id)::int AS "uniqueTypeCount"
            FROM reporting_remd_interval_facts
            WHERE period_id = $1
              AND coverage = 'cumulative'
              AND organization_oid = ANY($2::text[])
            GROUP BY month
            ORDER BY month;
            `,
            [periodId, [...organizationOids]],
        )
        return result.rows.map((row) => ({
            month: Number(row.month),
            uniqueTypeCount: Number(row.uniqueTypeCount ?? 0),
        }))
    }

    private async loadMonthlyFacts(
        client: PoolClient,
        periodId: string,
        semdTypeCodes: readonly string[],
    ) {
        const result = await client.query(
            `
            SELECT fact.month,
                   fact.organization_oid AS "organizationOid",
                   semd.nsi_oid AS "semdTypeCode",
                   fact.document_count::float8 AS "documentCount"
            FROM reporting_remd_interval_facts fact
            JOIN reporting_semd_types semd ON semd.id = fact.semd_type_id
            WHERE fact.period_id = $1
              AND fact.coverage = 'month'
              AND semd.nsi_oid = ANY($2::text[]);
            `,
            [periodId, [...semdTypeCodes]],
        )
        return result.rows.map((row) => ({
            month: Number(row.month),
            organizationOid: String(row.organizationOid),
            semdTypeCode: String(row.semdTypeCode),
            documentCount: Number(row.documentCount ?? 0),
        }))
    }

    /**
     * Роспись терпрограммы — из последней загрузки года, тем же правилом, что
     * у знаменателя показателя: терпрограмма на год одна, последняя вытесняет
     * предыдущие, иначе четыре одинаковых импорта учетверили бы план.
     */
    private async loadMonthlyPlans(
        client: PoolClient,
        reportingYear: number,
        sheetCodes: readonly string[],
    ) {
        const result = await client.query(
            `
            SELECT organization_oid AS "organizationOid",
                   sheet_code AS "sheetCode",
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
            [reportingYear, [...sheetCodes]],
        )
        return result.rows.map((row) => ({
            organizationOid: String(row.organizationOid),
            sheetCode: String(row.sheetCode),
            monthlyValues: toMonthlyValues(row.monthlyValues),
        }))
    }

    /**
     * Срез исполнения ТПГГ: факт по реестрам ОМС и границы месяцев.
     *
     * Строки без `organization_oid` отбрасываются — это организации вне контура
     * (частные клиники, ФГУП), которые ТЗ просит исключить дословно: «в расчет
     * входят только мониторируемые подведомственные ГБУ и ГКУ + МАУЗ ГСП,
     * частные организации исключаем, ФГУП тоже исключаем».
     *
     * Границы берутся `min`/`max`: файлы фонда приходят пачкой за один и тот же
     * период, но если один из них окажется за другой отрезок, лучше расширить
     * диапазон, чем молча посчитать долю по разным месяцам.
     */
    private async loadExecutionSlice(
        client: PoolClient,
        reportingYear: number,
        sheetCodes: readonly string[],
        organizationOids: readonly string[],
    ): Promise<{ fromMonth: number; toMonth: number; factValue: number } | null> {
        if (organizationOids.length === 0) return null
        const result = await client.query(
            `
            SELECT sum(fact_value)::float8 AS "factValue",
                   min(from_month)::int AS "fromMonth",
                   max(to_month)::int AS "toMonth"
            FROM reporting_tpgg_execution_values
            WHERE reporting_year = $1
              AND sheet_code = ANY($2::text[])
              AND organization_oid = ANY($3::text[]);
            `,
            [reportingYear, [...sheetCodes], [...organizationOids]],
        )
        const row = result.rows[0]
        if (!row || row.fromMonth === null || row.toMonth === null) return null
        return {
            fromMonth: Number(row.fromMonth),
            toMonth: Number(row.toMonth),
            factValue: Number(row.factValue ?? 0),
        }
    }

    /**
     * Тот же срез, но по каждой МО отдельно — для точечной диаграммы.
     *
     * МО, которой в реестрах нет вовсе, в карту не попадает и остаётся без
     * точки. Это не то же, что ноль случаев: ноль означал бы, что фонд
     * не оплатил ни одного, а на деле реестров по ней просто не прислали.
     */
    private async loadExecutionByOrganization(
        client: PoolClient,
        reportingYear: number,
        sheetCodes: readonly string[],
        organizationOids: readonly string[],
    ): Promise<Map<string, number>> {
        if (organizationOids.length === 0) return new Map()
        const result = await client.query(
            `
            SELECT organization_oid AS "organizationOid",
                   sum(fact_value)::float8 AS "factValue"
            FROM reporting_tpgg_execution_values
            WHERE reporting_year = $1
              AND sheet_code = ANY($2::text[])
              AND organization_oid = ANY($3::text[])
            GROUP BY organization_oid;
            `,
            [reportingYear, [...sheetCodes], [...organizationOids]],
        )
        return new Map(
            result.rows.map((row) => [
                String(row.organizationOid),
                Number(row.factValue ?? 0),
            ]),
        )
    }

    private async loadLoadedMonths(
        client: PoolClient,
        periodId: string,
    ): Promise<number[]> {
        const result = await client.query(
            `
            SELECT DISTINCT month
            FROM reporting_remd_interval_facts
            WHERE period_id = $1 AND coverage = 'month'
            ORDER BY month;
            `,
            [periodId],
        )
        return result.rows.map((row) => Number(row.month))
    }

    private async loadOrganizations(
        client: PoolClient,
        organizationOid?: string,
    ): Promise<Array<{ oid: string; name: string }>> {
        const result = organizationOid
            ? await client.query(
                `SELECT oid,
                        coalesce(nullif(official_short_name, ''), official_full_name, oid)
                            AS "name"
                 FROM reporting_organizations
                 WHERE is_active = TRUE AND oid = $1;`,
                [organizationOid],
            )
            : await client.query(
                `SELECT oid,
                        coalesce(nullif(official_short_name, ''), official_full_name, oid)
                            AS "name"
                 FROM reporting_organizations
                 WHERE is_active = TRUE
                 ORDER BY official_short_name, official_full_name, oid;`,
            )
        return result.rows.map((row) => ({
            oid: String(row.oid),
            name: String(row.name ?? ''),
        }))
    }

    private async loadReportingYear(
        client: PoolClient,
        periodId: string,
    ): Promise<number> {
        const result = await client.query(
            `SELECT date_from::text AS "dateFrom", date_to::text AS "dateTo"
             FROM reporting_periods WHERE id = $1;`,
            [periodId],
        )
        const period = result.rows[0]
        if (!period) throw new NotFoundException('Отчетный период не найден')
        // Год берётся из текста даты, а не через `new Date`: конструктор снова
        // завёл бы разговор про часовой пояс, как это было 20.08.2026.
        const parsed = Number(String(period.dateTo ?? period.dateFrom ?? '').slice(0, 4))
        return Number.isInteger(parsed) ? parsed : new Date().getFullYear()
    }
}

/** Роспись хранится как JSONB «месяц → объём»; ключи приходят строками. */
function toMonthlyValues(value: unknown): Record<number, number> {
    const values: Record<number, number> = {}
    if (!value || typeof value !== 'object') return values
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const month = Number(key)
        if (!Number.isInteger(month) || month < 1 || month > 12) continue
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) continue
        values[month] = parsed
    }
    return values
}
