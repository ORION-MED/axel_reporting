import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { calculateBusinessAssessment } from './engine/ratio-percent.calculator'
import {
    calculateSemdTypeRegistry,
    type SemdTypeRegistryRequirement,
    type SemdTypeRegistryResult,
    type SemdTypeRegistryStatus,
    type SemdTypeRegistryTypeBreakdown,
} from './semd-type-registry.calculator'

export const SEMD_TYPE_REGISTRY_INDICATOR_ID = 'semd_types_remd_registry'

const INSERT_BATCH_SIZE = 300

/**
 * Оркестратор показателя 27 «Виды СЭМД, регистрируемые в РЭМД ЕГИСЗ» (задача Н7.4).
 * Логика расчёта — в чистой функции `calculateSemdTypeRegistry`, здесь только SQL
 * и раскладка результата по колонкам.
 */
@Injectable()
export class SemdTypeRegistryCalculationService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async recalculate(periodId: string): Promise<SemdTypeRegistryCalculation> {
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));`,
                [String(periodId), SEMD_TYPE_REGISTRY_INDICATOR_ID],
            )

            await this.assertPeriodExists(client, periodId)
            const organizations = await this.loadOrganizations(client)
            const [facts, registryTypes, targetValue, typeMeta, requirements] = await Promise.all([
                this.loadFacts(client, periodId),
                this.loadRegistryTypes(client),
                this.loadTargetValue(client, periodId),
                this.loadTypeNames(client),
                this.loadRequirements(client, periodId),
            ])

            const result = calculateSemdTypeRegistry({
                organizationOids: organizations.map((organization) => organization.oid),
                registryTypeIds: registryTypes.map((type) => type.semdTypeId),
                facts,
                requirements,
            })

            const prior = await this.loadPriorYearTotals(client, periodId)
            const regionTypes = withTypeMeta(result.region.types, typeMeta, prior)
            await this.saveRegionalValue(client, periodId, result, targetValue, regionTypes)
            await this.saveOrganizationValues(
                client,
                periodId,
                organizations,
                result,
                targetValue,
            )

            await client.query('COMMIT')
            return { ...result, regionTypes }
        } catch (error) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    }

    private async assertPeriodExists(client: PoolClient, periodId: string): Promise<void> {
        const result = await client.query(
            `SELECT 1 FROM reporting_periods WHERE id = $1;`,
            [periodId],
        )
        if (result.rowCount === 0) throw new NotFoundException('Отчетный период не найден')
    }

    /**
     * Применимость видов к МО для планового значения (Н18.2).
     *
     * Каскад тот же, что у показателя 6.1.3.2.7: ручное уточнение по паре
     * «МО × вид» главнее импортированного правила. Иначе одно и то же решение
     * методолога давало бы двум показателям разный состав обязательных видов.
     *
     * Отчётная дата берётся из периода: правила версионируются, и пересчёт
     * прошлого периода обязан дать прежний план.
     */
    private async loadRequirements(
        client: PoolClient,
        periodId: string,
    ): Promise<SemdTypeRegistryRequirement[]> {
        const result = await client.query(
            `
            WITH period AS (
                SELECT COALESCE(date_to, date_from) AS reporting_date
                FROM reporting_periods
                WHERE id = $1
            ),
            imported AS (
                SELECT DISTINCT ON (organization_oid, semd_type_id)
                       organization_oid,
                       semd_type_id,
                       requirement_status
                FROM reporting_organization_semd_requirements, period
                WHERE (
                        period.reporting_date IS NULL
                        OR effective_from <= period.reporting_date
                      )
                  AND (
                        period.reporting_date IS NULL
                        OR effective_to IS NULL
                        OR effective_to >= period.reporting_date
                      )
                ORDER BY
                    organization_oid,
                    semd_type_id,
                    effective_from DESC,
                    updated_at DESC
            ),
            manual_override AS (
                SELECT DISTINCT ON (organization_oid, semd_type_id)
                       organization_oid,
                       semd_type_id,
                       requirement_status
                FROM reporting_organization_semd_requirement_overrides
                WHERE period_id = $1
                ORDER BY
                    organization_oid,
                    semd_type_id,
                    created_at DESC,
                    id DESC
            )
            SELECT COALESCE(
                       manual_override.organization_oid,
                       imported.organization_oid
                   ) AS "organizationOid",
                   COALESCE(
                       manual_override.semd_type_id,
                       imported.semd_type_id
                   )::text AS "semdTypeId",
                   COALESCE(
                       manual_override.requirement_status,
                       imported.requirement_status
                   ) AS "status"
            FROM imported
            FULL JOIN manual_override
              ON manual_override.organization_oid = imported.organization_oid
             AND manual_override.semd_type_id = imported.semd_type_id
            WHERE COALESCE(
                manual_override.requirement_status,
                imported.requirement_status
            ) IS NOT NULL;
            `,
            [periodId],
        )
        return result.rows.map((row) => ({
            organizationOid: String(row.organizationOid),
            semdTypeId: String(row.semdTypeId),
            status: String(row.status) as SemdTypeRegistryRequirement['status'],
        }))
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

    /**
     * Признак «вид входит в Перечень № 5пр» — наличие официального наименования
     * по Перечню: оно проставляется импортом самого Перечня (шаг 3 загрузки).
     *
     * **Источник фактов — нарастающая выгрузка, если она загружена** (Д-11).
     * Указание методолога от 25.08.2026: «для показателя 27 по региону и по МО
     * количество уникальных СЭМД берём из выгрузки нарастающим итогом».
     *
     * Причина не в удобстве. Узкая выгрузка шага 4 строится по подведомственным
     * ОУЗ, и АО «Курганфармация» в неё не попадает — вместе с ней теряется
     * «Отпуск по рецепту», единственный вид, который регистрирует только она.
     * Отсюда 73 вида вместо 74: 7 190 780 − 6 745 535 = 445 245 документов
     * сходятся до документа. В нарастающих выгрузках с марта — 37 МО и 74 вида.
     *
     * Остальные показатели продолжают считаться от шага 4: их числители —
     * документы за отчётный период, а не виды, и подменять им источник никто
     * не просил.
     */
    private async loadFacts(client: PoolClient, periodId: string) {
        const cumulativeMonth = await this.loadLatestCumulativeMonth(client, periodId)
        const result = cumulativeMonth === null
            ? await client.query(
                `
                SELECT fact.organization_oid AS "organizationOid",
                       fact.semd_type_id::text AS "semdTypeId",
                       fact.document_count::float8 AS "documentCount",
                       (
                           semd.official_name_5pr IS NOT NULL
                           AND btrim(semd.official_name_5pr) <> ''
                       ) AS "inRegistry"
                FROM reporting_remd_facts fact
                JOIN reporting_semd_types semd ON semd.id = fact.semd_type_id
                WHERE fact.period_id = $1
                  AND fact.scope_level = 'organization';
                `,
                [periodId],
            )
            : await client.query(
                `
                SELECT fact.organization_oid AS "organizationOid",
                       fact.semd_type_id::text AS "semdTypeId",
                       fact.document_count::float8 AS "documentCount",
                       (
                           semd.official_name_5pr IS NOT NULL
                           AND btrim(semd.official_name_5pr) <> ''
                       ) AS "inRegistry"
                FROM reporting_remd_interval_facts fact
                JOIN reporting_semd_types semd ON semd.id = fact.semd_type_id
                WHERE fact.period_id = $1
                  AND fact.coverage = 'cumulative'
                  AND fact.month = $2;
                `,
                [periodId, cumulativeMonth],
            )
        return result.rows.map((row) => ({
            organizationOid: String(row.organizationOid),
            semdTypeId: String(row.semdTypeId),
            documentCount: Number(row.documentCount ?? 0),
            inRegistry: Boolean(row.inRegistry),
        }))
    }

    /**
     * Самая полная нарастающая выгрузка периода. Методолог прислала шесть,
     * от «янв-фев» до «янв-июль», — берём последнюю, остальные остаются историей.
     *
     * `null` означает «нарастающих выгрузок нет»: тогда показатель считается
     * от числителя шага 4, как считался до Д-11.
     */
    private async loadLatestCumulativeMonth(
        client: PoolClient,
        periodId: string,
    ): Promise<number | null> {
        const result = await client.query(
            `SELECT max(month) AS "month"
             FROM reporting_remd_interval_facts
             WHERE period_id = $1 AND coverage = 'cumulative';`,
            [periodId],
        )
        const month = result.rows[0]?.month
        return month === null || month === undefined ? null : Number(month)
    }

    /**
     * Виды Перечня № 5пр — знаменатель. Раньше отсюда возвращалось только их
     * количество; для разбора «каких видов не хватает» нужен сам состав.
     * Порядок — по официальному наименованию, чтобы список в окне был устойчив
     * между пересчётами.
     */
    private async loadRegistryTypes(
        client: PoolClient,
    ): Promise<Array<{ semdTypeId: string }>> {
        const result = await client.query(`
            SELECT id AS "semdTypeId"
            FROM reporting_semd_types
            WHERE official_name_5pr IS NOT NULL AND btrim(official_name_5pr) <> ''
            ORDER BY official_name_5pr, id;
        `)
        return result.rows.map((row) => ({ semdTypeId: String(row.semdTypeId) }))
    }

    /**
     * Наименования и коды для окна разбора. Калькулятор знает только идентификаторы —
     * подписи подставляются здесь, как и у долей к объёмам ТПГГ.
     */
    private async loadTypeNames(client: PoolClient): Promise<Map<string, SemdTypeMeta>> {
        const result = await client.query(`
            SELECT id AS "semdTypeId",
                   nsi_oid AS "nsiOid",
                   name,
                   official_oid AS "officialOid",
                   official_name_5pr AS "officialName5pr"
            FROM reporting_semd_types;
        `)
        return new Map(result.rows.map((row) => [String(row.semdTypeId), {
            semdTypeId: String(row.semdTypeId),
            nsiOid: row.nsiOid === null ? null : String(row.nsiOid),
            name: String(row.name ?? ''),
            officialOid: row.officialOid === null ? null : String(row.officialOid),
            officialName5pr: row.officialName5pr === null ? null : String(row.officialName5pr),
        }]))
    }

    /**
     * Итоги прошлого года по видам: сколько документов и сколько МО.
     *
     * Год берётся не «текущий минус один», а максимальный из загруженных
     * и меньший отчётного: методолог прислала 2025-й, но прислать могут
     * и более ранний, а гадать за неё незачем.
     */
    private async loadPriorYearTotals(
        client: PoolClient,
        periodId: string,
    ): Promise<PriorYearTotals> {
        const result = await client.query(
            `
            SELECT facts.semd_type_id::text AS "semdTypeId",
                   sum(facts.document_count)::float8 AS "documentCount",
                   count(DISTINCT facts.organization_oid)::int AS "organizationCount",
                   facts.reporting_year AS "reportingYear"
            FROM reporting_remd_annual_facts facts
            WHERE facts.reporting_year = (
                SELECT max(inner_facts.reporting_year)
                FROM reporting_remd_annual_facts inner_facts
                WHERE inner_facts.reporting_year < (
                    -- Год периода — из текста даты: своей колонки года у периодов
                    -- нет, а конструктор Date снова завёл бы разговор про часовой пояс.
                    SELECT left(COALESCE(date_to, date_from)::text, 4)::int
                    FROM reporting_periods WHERE id = $1
                )
            )
            GROUP BY facts.semd_type_id, facts.reporting_year;
            `,
            [periodId],
        )
        if (result.rows.length === 0) {
            return {
                year: null,
                documentCountByType: new Map(),
                organizationCountByType: new Map(),
            }
        }
        return {
            year: Number(result.rows[0].reportingYear),
            documentCountByType: new Map(result.rows.map((row) => [
                String(row.semdTypeId),
                Number(row.documentCount ?? 0),
            ])),
            organizationCountByType: new Map(result.rows.map((row) => [
                String(row.semdTypeId),
                Number(row.organizationCount ?? 0),
            ])),
        }
    }

    private async loadTargetValue(
        client: PoolClient,
        periodId: string,
    ): Promise<number | null> {
        const result = await client.query(
            `
            SELECT target_value::float8 AS "targetValue"
            FROM reporting_indicator_values
            WHERE period_id = $1 AND indicator_id = $2;
            `,
            [periodId, SEMD_TYPE_REGISTRY_INDICATOR_ID],
        )
        const value = result.rows[0]?.targetValue
        return value === null || value === undefined ? null : Number(value)
    }

    private async saveRegionalValue(
        client: PoolClient,
        periodId: string,
        result: SemdTypeRegistryResult,
        targetValue: number | null,
        regionTypes: readonly SemdTypeRegistryTypeView[],
    ): Promise<void> {
        const { region } = result
        const calculated = region.percent !== null
        const assessment = planAssessment(region.plan, region.percent, targetValue)

        await client.query(
            `
            INSERT INTO reporting_indicator_values (
                indicator_id,
                period_id,
                numerator,
                denominator,
                fact_value,
                secondary_value,
                status,
                deviation_value,
                business_status,
                note,
                source_name,
                calculation_details
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
            ON CONFLICT (indicator_id, period_id) DO UPDATE SET
                numerator = EXCLUDED.numerator,
                denominator = EXCLUDED.denominator,
                fact_value = EXCLUDED.fact_value,
                secondary_value = EXCLUDED.secondary_value,
                status = EXCLUDED.status,
                deviation_value = EXCLUDED.deviation_value,
                business_status = EXCLUDED.business_status,
                note = EXCLUDED.note,
                source_name = EXCLUDED.source_name,
                calculation_details = EXCLUDED.calculation_details,
                updated_at = now();
            `,
            [
                SEMD_TYPE_REGISTRY_INDICATOR_ID,
                periodId,
                region.registeredTypeCount,
                region.registryTypeCount,
                region.percent,
                // Исполнение плана — вторая цифра, а не сам показатель: в отчётность
                // уходит доля от 145 видов Перечня, а планом меряется только то,
                // что регион обязан регистрировать по матрице.
                region.plan?.percent ?? null,
                calculated ? 'calculated' : 'awaiting_data',
                assessment.deviationValue,
                assessment.businessStatus,
                regionNote(region),
                SOURCE_NAME,
                // Разбор по видам сохраняется с наименованиями: окно показателя
                // читает готовый список, а не сопоставляет идентификаторы заново.
                JSON.stringify({ ...region, types: regionTypes }),
            ],
        )
    }

    private async saveOrganizationValues(
        client: PoolClient,
        periodId: string,
        organizations: readonly OrganizationRow[],
        result: SemdTypeRegistryResult,
        targetValue: number | null,
    ): Promise<void> {
        const activeOids = organizations.map((organization) => organization.oid)
        await client.query(
            `
            DELETE FROM reporting_organization_indicator_values
            WHERE period_id = $1
              AND indicator_id = $2
              AND NOT (organization_oid = ANY($3::text[]));
            `,
            [periodId, SEMD_TYPE_REGISTRY_INDICATOR_ID, activeOids],
        )

        const organizationByOid = new Map(
            organizations.map((organization) => [organization.oid, organization]),
        )
        for (const batch of chunk(result.organizations, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((value, index) => {
                const offset = index * 21
                const organization = organizationByOid.get(value.organizationOid)!
                const assessment = planAssessment(value.plan, value.percent, targetValue)
                values.push(
                    SEMD_TYPE_REGISTRY_INDICATOR_ID,
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
                    value.registeredTypeCount,
                    result.region.registryTypeCount,
                    value.percent,
                    value.plan?.percent ?? null,
                    targetValue,
                    value.percent === null ? 'awaiting_data' : 'calculated',
                    assessment.deviationValue,
                    assessment.businessStatus,
                    organizationNote(
                        value.typesOutsideRegistryCount,
                        value.plan?.undefinedTypeCount ?? 0,
                    ),
                    SOURCE_NAME,
                    JSON.stringify(value),
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
                    secondary_value,
                    target_value,
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
                    secondary_value = EXCLUDED.secondary_value,
                    target_value = EXCLUDED.target_value,
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
}

const SOURCE_NAME = 'РЭМД + Перечень № 5пр'

/**
 * Бизнес-оценка у этого показателя **не выставляется от плана** — сознательно.
 *
 * План по матрице говорит, сколько видов МО обязана регистрировать, но целевого
 * значения у показателя нет ни в «Приложении 2», ни в других требованиях: методолог
 * подтвердила это на ВКС 15.08.2026. Подставив цель «100 % обязательных», мы получили
 * бы на данных 08.2026 «критическое отклонение» у всех 37 МО — оценку, которой никто
 * не давал, и карту одного цвета.
 *
 * Поэтому план идёт второй цифрой и раскрашивает соты по шкале Минздрава (как
 * у 6.1.3.2.7), а `business_status` остаётся тем, чем был: оценкой против целевого
 * из «Приложения 2», которого нет.
 */
function planAssessment(
    _plan: SemdTypeRegistryResult['region']['plan'],
    percent: number | null,
    targetValue: number | null,
) {
    return calculateBusinessAssessment(percent, targetValue)
}

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

export function regionNote(
    region: SemdTypeRegistryResult['region'],
): string {
    if (region.percent === null) {
        return 'Перечень № 5пр не загружен — знаменатель показателя неизвестен.'
    }
    const parts: string[] = []
    if (region.typesOutsideRegistryCount > 0) {
        // С 21.08.2026 эти виды входят в числитель — ответ методолога на В-07: «МЗ РФ
        // считает все виды зарегистрированных СЭМД, не учитывая вхождение в 5-пр».
        // Пометка осталась, потому что она же просила сохранить признак справочно.
        parts.push(
            `Из них ${region.typesOutsideRegistryCount} видов в Перечень № 5пр `
            + 'не входят: в числитель они включены, в знаменателе их нет.',
        )
    }
    if (region.plan !== null) {
        parts.push(
            `План по матрице применимости: ${region.plan.requiredTypeCount} видов, `
            + `зарегистрировано ${region.plan.registeredRequiredTypeCount}.`,
        )
    }
    if ((region.plan?.undefinedTypeCount ?? 0) > 0) {
        parts.push(
            `План занижен: по ${region.plan!.undefinedTypeCount} видам применимость `
            + 'не определена, в план они не включены.',
        )
    }
    return parts.join(' ')
}

/**
 * Пометка про заниженный план — прямое требование Н18.2: у МО с неразобранными
 * правилами часть видов не попала ни в «обязателен», ни в «не обязателен», и план
 * без оговорки читается как полный.
 */
export function organizationNote(
    typesOutsideRegistryCount: number,
    undefinedTypeCount = 0,
): string {
    const parts: string[] = []
    if (typesOutsideRegistryCount > 0) {
        parts.push(
            `Ещё ${typesOutsideRegistryCount} видов вне Перечня № 5пр — в расчёт не входят.`,
        )
    }
    if (undefinedTypeCount > 0) {
        parts.push(
            `План занижен: по ${undefinedTypeCount} видам применимость не определена, `
            + 'в план они не включены.',
        )
    }
    return parts.join(' ')
}

function chunk<T>(items: readonly T[], size: number): T[][] {
    const batches: T[][] = []
    for (let index = 0; index < items.length; index += size) {
        batches.push(items.slice(index, index + size))
    }
    return batches
}

/** Метаданные вида СЭМД: калькулятор оперирует идентификаторами, подписи живут здесь. */
interface SemdTypeMeta {
    semdTypeId: string
    nsiOid: string | null
    name: string
    officialOid: string | null
    officialName5pr: string | null
}

/**
 * Строка окна разбора показателя (Н18.1, ВКС 15.08.2026): методолог насчитала
 * 74 зарегистрированных вида против наших 70 и просила показать, что именно
 * не попадает в расчёт.
 */
export type SemdTypeRegistryTypeView = SemdTypeMeta & {
    status: SemdTypeRegistryStatus
    organizationCount: number
    documentCount: number
    /**
     * Итоги прошлого года — Д-28, просьба методолога от 28.08.2026. Нужны,
     * чтобы увидеть виды, которые в прошлом году регистрировались, а в этом
     * ещё нет: «это зона ответственности МО».
     *
     * `null` — выгрузка за прошлый год не загружена. Ноль означал бы «вид
     * не регистрировали», а это другое утверждение.
     */
    priorYear: number | null
    priorYearDocumentCount: number | null
    priorYearOrganizationCount: number | null
}

interface PriorYearTotals {
    year: number | null
    documentCountByType: ReadonlyMap<string, number>
    organizationCountByType: ReadonlyMap<string, number>
}

export interface SemdTypeRegistryCalculation extends SemdTypeRegistryResult {
    regionTypes: SemdTypeRegistryTypeView[]
}

function withTypeMeta(
    types: readonly SemdTypeRegistryTypeBreakdown[],
    meta: ReadonlyMap<string, SemdTypeMeta>,
    prior: PriorYearTotals,
): SemdTypeRegistryTypeView[] {
    return types.map((type) => ({
        // Вид без метаданных в норме невозможен — оба списка из одной таблицы.
        // Пустые подписи лучше пропажи строки: пропавший вид не заметят.
        semdTypeId: type.semdTypeId,
        nsiOid: null,
        name: '',
        officialOid: null,
        officialName5pr: null,
        ...meta.get(type.semdTypeId),
        priorYear: prior.year,
        priorYearDocumentCount: prior.year === null
            ? null
            : prior.documentCountByType.get(type.semdTypeId) ?? 0,
        priorYearOrganizationCount: prior.year === null
            ? null
            : prior.organizationCountByType.get(type.semdTypeId) ?? 0,
        status: type.status,
        organizationCount: type.organizationCount,
        documentCount: type.documentCount,
    }))
}
