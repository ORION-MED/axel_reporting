import { Inject, Injectable } from '@nestjs/common'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { calculateBusinessAssessment } from './engine/ratio-percent.calculator'

/**
 * Показатель 1.24 — доля ТВСП, формирующих справку о постановке на учёт
 * по беременности.
 *
 * Считается по перечню входимости Минздрава: знаменатель — здания с планом,
 * числитель — здания с фактом. Оба числа даёт сам перечень, поэтому расчёт
 * сводится к двум суммам.
 *
 * **Числитель считается по нашим выгрузкам, знаменатель — по перечню.**
 * Знаменатель иначе взять неоткуда: только Минздрав говорит, какие ТВСП обязаны
 * передавать справку. А числитель по перечню застыл бы на месяце его выпуска,
 * поэтому здания, реально передавшие вид 343, берутся из последней нарастающей
 * выгрузки РЭМД — с тех пор как импорт начал сохранять идентификатор здания.
 *
 * Рядом сохраняется и собственный факт Минздрава: расхождение между ним и нашим
 * числителем — само по себе полезная величина, оно означает либо другой период,
 * либо разное понимание того, какое здание считать передавшим.
 *
 * **Значение относится к месяцу перечня, а не к отчётной дате периода.**
 * Текущий перечень подписан «по итогам июня 2026 года». Месяц выносится
 * в детали расчёта, чтобы интерфейс мог это сказать.
 */

export const PREGNANCY_REGISTRATION_INDICATOR_ID = 'semd_pregnancy_registration'
const SOURCE_NAME = 'Перечень входимости Минздрава'

export interface PregnancyRegistrationResult {
    numerator: number
    denominator: number
    percent: number | null
    organizationCount: number
    /** Здания, где справку не передают, — по ним и идёт разговор. */
    missingBuildings: Array<{
        organizationOid: string
        organizationName: string
        buildingName: string
        buildingAddress: string
    }>
    /** Факт из самого перечня — для сверки с нашим числителем. */
    registerFact: number
    registerMonth: number | null
    registerYear: number | null
    registerTitle: string
    /** Разрез по медорганизациям: у одной МО бывает несколько зданий. */
    organizations: PregnancyRegistrationOrganization[]
}

export interface PregnancyRegistrationOrganization {
    organizationOid: string
    organizationName: string
    /** Сколько ТВСП этой МО в перечне. */
    denominator: number
    /** Сколько из них передают справку. */
    numerator: number
    percent: number | null
    buildings: Array<{ name: string; address: string; transmits: boolean }>
}

@Injectable()
export class PregnancyRegistrationCalculationService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async recalculate(periodId: string): Promise<PregnancyRegistrationResult | null> {
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));`,
                [String(periodId), PREGNANCY_REGISTRATION_INDICATOR_ID],
            )

            const rows = await this.loadRegister(client)
            if (rows.length === 0) {
                // Перечень не загружен — показатель остаётся в состоянии
                // «ожидаются данные», а не показывает ноль.
                await this.saveAwaitingData(client, periodId)
                await client.query('COMMIT')
                return null
            }

            const denominator = rows.reduce((sum, row) => sum + row.planValue, 0)
            const registerFact = rows.reduce((sum, row) => sum + row.factValue, 0)
            // Числитель — здания перечня, которые по нашим выгрузкам передали
            // вид 343. Здание, передавшее справку, но в перечень не включённое,
            // в числитель не идёт: доля обязана оставаться в пределах ста
            // процентов, а вопрос «почему его нет в перечне» — к методологу.
            const transmitting = await this.loadTransmittingBuildings(client, periodId)
            const numerator = transmitting.size > 0
                ? rows.filter(
                    (row) => row.planValue > 0 && transmitting.has(row.buildingId),
                ).length
                : registerFact
            const percent = denominator > 0
                ? Math.round((numerator / denominator) * 10_000) / 100
                : null

            // Пометка «передаёт» ставится один раз и дальше используется всюду:
            // иначе свод по МО и список отстающих считались бы по разным правилам.
            const marked = rows.map((row) => ({
                ...row,
                transmits: transmitting.size > 0
                    ? transmitting.has(row.buildingId)
                    : row.factValue > 0,
            }))

            const result: PregnancyRegistrationResult = {
                numerator,
                denominator,
                percent,
                organizationCount: new Set(rows.map((row) => row.organizationOid)).size,
                missingBuildings: marked
                    .filter((row) => row.planValue > 0 && !row.transmits)
                    .map((row) => ({
                        organizationOid: row.organizationOid,
                        organizationName: row.organizationName,
                        buildingName: row.buildingName,
                        buildingAddress: row.buildingAddress,
                    })),
                registerFact,
                registerMonth: rows[0].registerMonth,
                registerYear: rows[0].registerYear,
                registerTitle: rows[0].registerTitle,
                organizations: groupByOrganization(marked),
            }

            await this.saveValue(client, periodId, result)
            await this.saveOrganizationValues(client, periodId, result)
            await client.query('COMMIT')
            return result
        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    }

    /**
     * Здания, передавшие вид 343 по нашим выгрузкам. Берётся последняя
     * нарастающая: она содержит всё с начала года, а помесячная — только
     * свой месяц, и здание, передавшее справку в марте, из неё выпало бы.
     *
     * Пустое множество означает, что помесячные выгрузки ещё не загружены;
     * тогда числитель остаётся из перечня, и показатель работает как раньше.
     */
    private async loadTransmittingBuildings(
        client: PoolClient,
        periodId: string,
    ): Promise<Set<string>> {
        const result = await client.query(
            `
            SELECT DISTINCT facts.building_id AS "buildingId"
            FROM reporting_remd_building_facts facts
            JOIN reporting_semd_types type ON type.id = facts.semd_type_id
            WHERE facts.period_id = $1
              AND facts.coverage = 'cumulative'
              AND facts.document_count > 0
              AND type.nsi_oid = '343'
              AND facts.month = (
                  SELECT max(month) FROM reporting_remd_building_facts
                  WHERE period_id = $1 AND coverage = 'cumulative'
              );
            `,
            [periodId],
        )
        return new Set(result.rows.map((row) => String(row.buildingId)))
    }

    private async loadRegister(client: PoolClient) {
        const result = await client.query(
            `
            SELECT register.organization_oid AS "organizationOid",
                   register.building_id AS "buildingId",
                   COALESCE(
                       NULLIF(organization.official_short_name, ''),
                       register.organization_name
                   ) AS "organizationName",
                   register.building_name AS "buildingName",
                   register.building_address AS "buildingAddress",
                   register.plan_value::int AS "planValue",
                   register.fact_value::int AS "factValue",
                   register.register_month::int AS "registerMonth",
                   register.register_year::int AS "registerYear",
                   register.register_title AS "registerTitle"
            FROM reporting_inclusion_registers register
            JOIN reporting_semd_types type ON type.id = register.semd_type_id
            LEFT JOIN reporting_organizations organization
                   ON organization.oid = register.organization_oid
            WHERE type.nsi_oid = '343'
            ORDER BY "organizationName", register.building_name;
            `,
        )
        return result.rows.map((row) => ({
            organizationOid: String(row.organizationOid),
            buildingId: String(row.buildingId ?? ''),
            organizationName: String(row.organizationName ?? ''),
            buildingName: String(row.buildingName ?? ''),
            buildingAddress: String(row.buildingAddress ?? ''),
            planValue: Number(row.planValue ?? 0),
            factValue: Number(row.factValue ?? 0),
            registerMonth: row.registerMonth === null ? null : Number(row.registerMonth),
            registerYear: row.registerYear === null ? null : Number(row.registerYear),
            registerTitle: String(row.registerTitle ?? ''),
        }))
    }

    private async saveValue(
        client: PoolClient,
        periodId: string,
        result: PregnancyRegistrationResult,
    ): Promise<void> {
        const target = await this.loadTargetValue(client, periodId)
        const assessment = calculateBusinessAssessment(result.percent, target)
        await client.query(
            `
            INSERT INTO reporting_indicator_values (
                indicator_id, period_id, numerator, denominator, fact_value,
                status, deviation_value, business_status, note, source_name,
                calculation_details
            )
            VALUES ($1, $2, $3, $4, $5, 'calculated', $6, $7, $8, $9, $10::jsonb)
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
                updated_at = now();
            `,
            [
                PREGNANCY_REGISTRATION_INDICATOR_ID,
                periodId,
                result.numerator,
                result.denominator,
                result.percent,
                assessment.deviationValue,
                assessment.businessStatus,
                this.note(result),
                SOURCE_NAME,
                JSON.stringify(result),
            ],
        )
    }

    /**
     * Значения по медорганизациям — без них на карте у показателя не будет
     * ни одной соты, и выбрать его на дашборде бессмысленно.
     *
     * В контур входят только МО из перечня: их тринадцать из тридцати семи.
     * Остальные двадцать четыре Минздрав в знаменатель не включил, и рисовать
     * им ноль было бы неправдой — они этот вид не обязаны формировать вовсе.
     * Поэтому строки прочих МО удаляются, а не создаются пустыми.
     */
    private async saveOrganizationValues(
        client: PoolClient,
        periodId: string,
        result: PregnancyRegistrationResult,
    ): Promise<void> {
        const oids = result.organizations.map((item) => item.organizationOid)
        await client.query(
            `DELETE FROM reporting_organization_indicator_values
             WHERE indicator_id = $1 AND period_id = $2
               AND NOT (organization_oid = ANY($3::text[]));`,
            [PREGNANCY_REGISTRATION_INDICATOR_ID, periodId, oids],
        )
        if (oids.length === 0) return

        const geo = await this.loadOrganizationGeo(client, oids)
        for (const item of result.organizations) {
            const place = geo.get(item.organizationOid)
            const assessment = calculateBusinessAssessment(item.percent, null)
            const missing = item.buildings.filter((building) => !building.transmits)
            await client.query(
                `
                INSERT INTO reporting_organization_indicator_values (
                    indicator_id, period_id, organization_oid, organization_name,
                    organization_full_name, address, latitude, longitude,
                    location_source, location_precision,
                    numerator, denominator, fact_value, status,
                    deviation_value, business_status, note, source_name,
                    calculation_details
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                        $11, $12, $13, 'calculated', $14, $15, $16, $17, $18::jsonb)
                ON CONFLICT (indicator_id, period_id, organization_oid) DO UPDATE SET
                    organization_name = EXCLUDED.organization_name,
                    numerator = EXCLUDED.numerator,
                    denominator = EXCLUDED.denominator,
                    fact_value = EXCLUDED.fact_value,
                    status = EXCLUDED.status,
                    deviation_value = EXCLUDED.deviation_value,
                    business_status = EXCLUDED.business_status,
                    note = EXCLUDED.note,
                    source_name = EXCLUDED.source_name,
                    calculation_details = EXCLUDED.calculation_details,
                    updated_at = now();
                `,
                [
                    PREGNANCY_REGISTRATION_INDICATOR_ID,
                    periodId,
                    item.organizationOid,
                    item.organizationName,
                    place?.fullName ?? '',
                    place?.address ?? '',
                    place?.latitude ?? null,
                    place?.longitude ?? null,
                    place?.locationSource ?? '',
                    place?.locationPrecision ?? 'unknown',
                    item.numerator,
                    item.denominator,
                    item.percent,
                    assessment.deviationValue,
                    assessment.businessStatus,
                    missing.length === 0
                        ? `Все ${item.denominator} ТВСП передают справку.`
                        : `Не передают справку: ${missing
                            .map((building) => building.name)
                            .join(', ')}.`,
                    SOURCE_NAME,
                    JSON.stringify(item),
                ],
            )
        }
    }

    private async loadOrganizationGeo(client: PoolClient, oids: readonly string[]) {
        const result = await client.query(
            `SELECT oid,
                    official_full_name AS "fullName",
                    address,
                    latitude::float8 AS latitude,
                    longitude::float8 AS longitude,
                    location_source AS "locationSource",
                    location_precision AS "locationPrecision"
             FROM reporting_organizations
             WHERE oid = ANY($1::text[]);`,
            [[...oids]],
        )
        return new Map(result.rows.map((row) => [String(row.oid), {
            fullName: String(row.fullName ?? ''),
            address: String(row.address ?? ''),
            latitude: row.latitude === null ? null : Number(row.latitude),
            longitude: row.longitude === null ? null : Number(row.longitude),
            locationSource: String(row.locationSource ?? ''),
            locationPrecision: String(row.locationPrecision ?? 'unknown'),
        }]))
    }

    /**
     * Перечень не загружен. Пишется «ожидаются данные», а не ноль: ноль
     * означал бы, что справку не передаёт никто.
     */
    private async saveAwaitingData(client: PoolClient, periodId: string): Promise<void> {
        await client.query(
            `
            INSERT INTO reporting_indicator_values (
                indicator_id, period_id, status, note, source_name, calculation_details
            )
            VALUES ($1, $2, 'awaiting_data', $3, $4, '{}'::jsonb)
            ON CONFLICT (indicator_id, period_id) DO UPDATE SET
                numerator = NULL, denominator = NULL, fact_value = NULL,
                status = 'awaiting_data', deviation_value = NULL,
                business_status = 'not_assessed',
                note = EXCLUDED.note, source_name = EXCLUDED.source_name,
                calculation_details = '{}'::jsonb, updated_at = now();
            `,
            [
                PREGNANCY_REGISTRATION_INDICATOR_ID,
                periodId,
                'Не загружен перечень входимости ТВСП по профилю «Акушерство '
                + 'и гинекология» — знаменатель показателя брать неоткуда.',
                SOURCE_NAME,
            ],
        )
        await client.query(
            `DELETE FROM reporting_organization_indicator_values
             WHERE indicator_id = $1 AND period_id = $2;`,
            [PREGNANCY_REGISTRATION_INDICATOR_ID, periodId],
        )
    }

    private note(result: PregnancyRegistrationResult): string {
        const period = result.registerMonth
            ? ` по итогам ${MONTHS[result.registerMonth - 1]} ${result.registerYear ?? ''}`.trimEnd()
            : ''
        const missing = result.missingBuildings.length
        const divergence = result.registerFact === result.numerator
            ? ''
            : ` По самому перечню${period} — ${result.registerFact}.`
        return `${result.numerator} из ${result.denominator} ТВСП передают справку`
            + (missing > 0 ? `, не передают ${missing}.` : '.')
            + divergence
    }

    private async loadTargetValue(
        client: PoolClient,
        periodId: string,
    ): Promise<number | null> {
        const result = await client.query(
            `SELECT target_value::float8 AS "targetValue"
             FROM reporting_indicator_values
             WHERE indicator_id = $1 AND period_id = $2;`,
            [PREGNANCY_REGISTRATION_INDICATOR_ID, periodId],
        )
        const value = result.rows[0]?.targetValue
        return value === null || value === undefined ? null : Number(value)
    }
}

const MONTHS = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

/**
 * Свод строк перечня по медорганизациям. У одной МО бывает несколько ТВСП —
 * у МРБ № 8 их три, — и доля считается по ним, а не по одному зданию.
 */
function groupByOrganization(
    rows: readonly {
        organizationOid: string
        organizationName: string
        buildingName: string
        buildingAddress: string
        planValue: number
        transmits: boolean
    }[],
): PregnancyRegistrationOrganization[] {
    const byOid = new Map<string, PregnancyRegistrationOrganization>()
    for (const row of rows) {
        const item = byOid.get(row.organizationOid) ?? {
            organizationOid: row.organizationOid,
            organizationName: row.organizationName,
            denominator: 0,
            numerator: 0,
            percent: null,
            buildings: [],
        }
        item.denominator += row.planValue
        item.numerator += row.transmits ? 1 : 0
        item.buildings.push({
            name: row.buildingName,
            address: row.buildingAddress,
            transmits: row.transmits,
        })
        byOid.set(row.organizationOid, item)
    }
    for (const item of byOid.values()) {
        item.percent = item.denominator > 0
            ? Math.round((item.numerator / item.denominator) * 10_000) / 100
            : null
    }
    return [...byOid.values()]
}
