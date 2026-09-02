import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool, type PoolClient } from 'pg'
import { createHash, randomUUID } from 'crypto'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import { getOrganizationGeo, type LocationPrecision } from './organization-geo'
import {
    extractRemdNumerators,
    getRemdIndicatorCalculationRule,
    type RemdAggregationStrategy,
    type RemdExtractedItem,
    type RemdMatchedGroup,
} from './remd-import'
import { runWorkbookParseInWorker } from './workers/run-in-worker'
import { ReportingPeriodsService } from './reporting-periods.service'
import type {
    ReportingCalculationType,
    ReportingIndicatorValueKind,
} from './reporting-domain.types'
import {
    cleanText,
    mapCalculationDetails,
    toBusinessStatus,
    toIsoString,
    toLocationPrecision,
    toNullableNumber,
    type ReportingBusinessStatus,
    type ReportingImportMode,
} from './reporting-format.util'
import { IndicatorCalculatorRegistry } from './engine/indicator-calculator.registry'
import { calculateBusinessAssessment } from './engine/ratio-percent.calculator'

type MethodologyStatus = 'ready' | 'in_development'
type ReportingValueStatus =
    | 'awaiting_data'
    | 'calculated'
    | 'methodology_in_development'
    | 'not_calculated'

export interface ReportingIndicator {
    id: string
    code: string
    title: string
    /**
     * Короткое имя для выпадающего списка над картой: по одному коду
     * «6.1.3.2.11» непонятно, между чем переключаешься (ВКС 15.08.2026).
     * В «Приложении 2» короткого имени нет — заведено миграцией 0048.
     */
    shortTitle: string
    /** Номер показателя в «Приложении 2». Пусто — показателя там нет. */
    appendix2Number: string
    unit: string
    formulaText: string
    numeratorLabel: string
    denominatorLabel: string
    methodologyStatus: MethodologyStatus
    isMvp: boolean
    valueKind: ReportingIndicatorValueKind
    calculationType: ReportingCalculationType
    isPilot: boolean
    sortOrder: number
    metadata: Record<string, unknown>
    createdAt: string
    updatedAt: string
}

export interface ReportingIndicatorValue {
    id: string
    indicatorId: string
    periodId: string
    numerator: number | null
    denominator: number | null
    factValue: number | null
    secondaryValue: number | null
    targetValue: number | null
    /**
     * Целевое на конец года из «Приложения 2». Рядом с месячным: методолог 15.08.2026
     * приняла месячные 70 % за ошибку, помня годовые 95 %. Оценка выполнения
     * по-прежнему считается по месячному.
     */
    targetYearEndValue: number | null
    status: ReportingValueStatus
    deviationValue: number | null
    businessStatus: ReportingBusinessStatus
    calculationDetails: Record<string, unknown>
    note: string
    sourceName: string
    createdBy: number | null
    updatedBy: number | null
    createdAt: string
    updatedAt: string
}

export interface ReportingOrganizationIndicatorValue {
    id: string
    indicatorId: string
    periodId: string
    organizationOid: string
    organizationName: string
    organizationFullName: string
    address: string
    latitude: number | null
    longitude: number | null
    locationSource: string
    locationPrecision: LocationPrecision
    numerator: number | null
    denominator: number | null
    factValue: number | null
    secondaryValue: number | null
    targetValue: number | null
    /**
     * Целевое на конец года из «Приложения 2». Рядом с месячным: методолог 15.08.2026
     * приняла месячные 70 % за ошибку, помня годовые 95 %. Оценка выполнения
     * по-прежнему считается по месячному.
     */
    targetYearEndValue: number | null
    targetSource: 'organization' | 'period' | 'none'
    relativePercent: number | null
    status: ReportingValueStatus
    deviationValue: number | null
    businessStatus: ReportingBusinessStatus
    calculationDetails: Record<string, unknown>
    note: string
    sourceName: string
    createdBy: number | null
    updatedBy: number | null
    createdAt: string
    updatedAt: string
}

export interface UpsertReportingValueDto {
    periodId?: string
    numerator?: number | string | null
    denominator?: number | string | null
    targetValue?: number | string | null
    note?: string | null
    sourceName?: string | null
}

export interface ReportingRemdImportResult {
    importId: string
    importMode: ReportingImportMode
    periodId: string
    sourceName: string
    fileSha256: string
    organizationRows: number
    importedCount: number
    organizationValuesImported: number
    denominatorIndicatorsImported: number
    organizationDenominatorsImported: number
    values: ReportingIndicatorValue[]
    matchedColumns: Array<{
        indicatorId: string
        code: string
        numerator: number
        denominator: number | null
        targetValue: number | null
        denominatorColumn: { index: number; header: string; sum: number } | null
        targetColumn: { index: number; header: string } | null
        aggregation: RemdAggregationStrategy
        columns: Array<{ index: number; header: string; sum: number }>
        groups: RemdMatchedGroup[]
    }>
    warnings: string[]
}

/**
 * Legacy 5-indicator MVP circuit (6.1.3.2.8-6.1.3.2.12): CRUD for regional/organization
 * indicator values plus the original synchronous REMD Excel importer. Kept alongside the
 * newer pilot circuit (see PilotIndicatorCalculationService) per roadmap step 1.1 — not
 * developed further, only reorganized.
 */
@Injectable()
export class ReportingValuesService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly periods: ReportingPeriodsService,
        private readonly calculators: IndicatorCalculatorRegistry,
    ) {}

    async listIndicators(): Promise<ReportingIndicator[]> {
        const res = await this.pool.query(`
            SELECT id,
                   code,
                   title,
                   short_title AS "shortTitle",
                   appendix2_number AS "appendix2Number",
                   unit,
                   formula_text AS "formulaText",
                   numerator_label AS "numeratorLabel",
                   denominator_label AS "denominatorLabel",
                   methodology_status AS "methodologyStatus",
                   is_mvp AS "isMvp",
                   value_kind AS "valueKind",
                   calculation_type AS "calculationType",
                   is_pilot AS "isPilot",
                   sort_order AS "sortOrder",
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
            FROM reporting_indicators
            WHERE is_mvp = TRUE
            -- Порядок «Приложения 2»: методолог просила перейти на его нумерацию,
            -- а список шёл вперемешку. Номер — текст, поэтому приводим к числу,
            -- иначе «20» встало бы между «2» и «3». Показатель без номера
            -- («Виды СЭМД в РЭМД», в «Приложении 2» его нет) уходит в конец,
            -- а не притворяется нулевым.
            ORDER BY (
                       CASE
                           WHEN appendix2_number ~ '^[0-9]+$'
                               THEN appendix2_number::int
                           ELSE NULL
                       END
                   ) ASC NULLS LAST,
                   sort_order ASC,
                   code ASC;
        `)

        return res.rows.map((row) => this.mapIndicator(row))
    }

    async listValues(periodId: string): Promise<ReportingIndicatorValue[]> {
        await this.periods.ensurePeriodExists(periodId)

        const res = await this.pool.query(
            `
            SELECT id::text,
                   indicator_id AS "indicatorId",
                   period_id::text AS "periodId",
                   numerator::float8 AS numerator,
                   denominator::float8 AS denominator,
                   fact_value::float8 AS "factValue",
                   secondary_value::float8 AS "secondaryValue",
                   target_value::float8 AS "targetValue",
                   target_year_end_value::float8 AS "targetYearEndValue",
                   status,
                   deviation_value::float8 AS "deviationValue",
                   business_status AS "businessStatus",
                   calculation_details AS "calculationDetails",
                   note,
                   source_name AS "sourceName",
                   created_by AS "createdBy",
                   updated_by AS "updatedBy",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
            FROM reporting_indicator_values
            WHERE period_id = $1
            ORDER BY updated_at DESC;
            `,
            [periodId],
        )

        return res.rows.map((row) => this.mapValue(row))
    }

    async countPeriodOrganizations(periodId: string): Promise<number> {
        const res = await this.pool.query(
            `
            SELECT COUNT(DISTINCT organization_oid)::int AS count
            FROM reporting_organization_indicator_values
            WHERE period_id = $1;
            `,
            [periodId],
        )
        return Number(res.rows[0]?.count) || 0
    }

    async listOrganizationValues(
        periodId: string,
        indicatorId: string,
    ): Promise<ReportingOrganizationIndicatorValue[]> {
        await this.periods.ensurePeriodExists(periodId)
        await this.getIndicator(indicatorId)

        const res = await this.pool.query(
            `
            SELECT value.id::text,
                   value.indicator_id AS "indicatorId",
                   value.period_id::text AS "periodId",
                   value.organization_oid AS "organizationOid",
                   value.organization_name AS "organizationName",
                   value.organization_full_name AS "organizationFullName",
                   value.address,
                   value.latitude::float8 AS latitude,
                   value.longitude::float8 AS longitude,
                   value.location_source AS "locationSource",
                   value.location_precision AS "locationPrecision",
                   value.numerator::float8 AS numerator,
                   value.denominator::float8 AS denominator,
                   value.fact_value::float8 AS "factValue",
                   value.secondary_value::float8 AS "secondaryValue",
                   COALESCE(value.target_value, regional.target_value)::float8 AS "targetValue",
                   COALESCE(
                       value.target_year_end_value,
                       regional.target_year_end_value
                   )::float8 AS "targetYearEndValue",
                   CASE
                       WHEN value.target_value IS NOT NULL THEN 'organization'
                       WHEN regional.target_value IS NOT NULL THEN 'period'
                       ELSE 'none'
                   END AS "targetSource",
                   value.status,
                   value.deviation_value::float8 AS "storedDeviationValue",
                   value.business_status AS "storedBusinessStatus",
                   value.calculation_details AS "calculationDetails",
                   value.note,
                   value.source_name AS "sourceName",
                   value.created_by AS "createdBy",
                   value.updated_by AS "updatedBy",
                   value.created_at AS "createdAt",
                   value.updated_at AS "updatedAt",
                   indicator.metadata ->> 'criticalDeviationPoints' AS "criticalDeviationPoints",
                   indicator.calculation_type AS "calculationType"
            FROM reporting_organization_indicator_values value
            JOIN reporting_indicators indicator ON indicator.id = value.indicator_id
            LEFT JOIN reporting_indicator_values regional
              ON regional.period_id = value.period_id
             AND regional.indicator_id = value.indicator_id
            WHERE value.period_id = $1
              AND value.indicator_id = $2
            ORDER BY value.numerator DESC NULLS LAST, value.organization_name ASC;
            `,
            [periodId, indicatorId],
        )

        const maxNumerator = res.rows.reduce((max, row) => {
            const numerator = toNullableNumber(row.numerator) ?? 0
            return Math.max(max, numerator)
        }, 0)

        return res.rows.map((row) => this.mapOrganizationValue(row, maxNumerator))
    }

    async upsertValue(
        userId: number,
        indicatorId: string,
        body: UpsertReportingValueDto,
    ): Promise<ReportingIndicatorValue> {
        const periodId = cleanText(body.periodId, 80)
        if (!periodId) {
            throw new BadRequestException('Укажите отчетный период')
        }

        const indicator = await this.getIndicator(indicatorId)
        await this.periods.ensurePeriodExists(periodId)

        const numerator = this.parseMetricNumber(body.numerator, 'Числитель')
        const denominator = this.parseMetricNumber(body.denominator, 'Знаменатель')
        const targetValue = this.parseMetricNumber(body.targetValue, 'Целевое значение', {
            max: 100,
        })
        const note = cleanText(body.note, 2_000)
        const sourceName = cleanText(body.sourceName, 256)
        const calculated = this.calculateIndicatorValue(
            indicator,
            numerator,
            denominator,
            targetValue,
        )

        const res = await this.pool.query(
            `
            INSERT INTO reporting_indicator_values (
                indicator_id,
                period_id,
                numerator,
                denominator,
                fact_value,
                target_value,
                status,
                deviation_value,
                business_status,
                note,
                source_name,
                created_by,
                updated_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
            ON CONFLICT (indicator_id, period_id) DO UPDATE SET
                numerator = EXCLUDED.numerator,
                denominator = EXCLUDED.denominator,
                fact_value = EXCLUDED.fact_value,
                target_value = EXCLUDED.target_value,
                status = EXCLUDED.status,
                deviation_value = EXCLUDED.deviation_value,
                business_status = EXCLUDED.business_status,
                note = EXCLUDED.note,
                source_name = EXCLUDED.source_name,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
            RETURNING id::text,
                      indicator_id AS "indicatorId",
                      period_id::text AS "periodId",
                      numerator::float8 AS numerator,
                      denominator::float8 AS denominator,
                      fact_value::float8 AS "factValue",
                      target_value::float8 AS "targetValue",
                   target_year_end_value::float8 AS "targetYearEndValue",
                      status,
                      deviation_value::float8 AS "deviationValue",
                      business_status AS "businessStatus",
                      note,
                      source_name AS "sourceName",
                      created_by AS "createdBy",
                      updated_by AS "updatedBy",
                      created_at AS "createdAt",
                      updated_at AS "updatedAt";
            `,
            [
                indicatorId,
                periodId,
                numerator,
                denominator,
                calculated.factValue,
                targetValue,
                calculated.status,
                calculated.deviationValue,
                calculated.businessStatus,
                note,
                sourceName,
                userId,
            ],
        )

        return this.mapValue(res.rows[0])
    }

    async importRemdExcel(
        userId: number,
        periodId: string,
        fileBuffer: Buffer,
        originalFilename: string,
        importMode: string = 'merge',
    ): Promise<ReportingRemdImportResult> {
        const cleanPeriodId = cleanText(periodId, 80)
        if (!cleanPeriodId) {
            throw new BadRequestException('Укажите отчетный период')
        }
        if (importMode !== 'merge' && importMode !== 'replace') {
            throw new BadRequestException('Некорректный режим импорта')
        }
        const reportingDate = await this.periods.getPeriodReportingDate(cleanPeriodId)
        const sourceName = cleanText(originalFilename, 256) || 'Импорт Excel СЭМД/РЭМД'
        const importId = randomUUID()
        const fileSha256 = createHash('sha256').update(fileBuffer).digest('hex')
        const objectFilename = this.buildImportObjectFilename(sourceName)
        const objectKey = `reporting/imports/${cleanPeriodId}/${importId}/${objectFilename}`

        await this.pool.query(
            `
            INSERT INTO reporting_import_runs (
                id,
                period_id,
                source_type,
                import_mode,
                original_filename,
                object_key,
                file_sha256,
                file_size,
                status,
                created_by
            )
            VALUES ($1, $2, 'remd_excel', $3, $4, $5, $6, $7, 'processing', $8);
            `,
            [
                importId,
                cleanPeriodId,
                importMode,
                sourceName,
                objectKey,
                fileSha256,
                fileBuffer.length,
                userId,
            ],
        )

        let extracted: ReturnType<typeof extractRemdNumerators>
        let indicators: ReportingIndicator[]

        try {
            await this.s3.uploadBuffer(
                objectKey,
                fileBuffer,
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            )

            extracted = await runWorkbookParseInWorker<ReturnType<typeof extractRemdNumerators>>({
                kind: 'legacy-remd',
                fileBuffer,
                reportingDate,
            })
            indicators = await this.listIndicators()
            const duplicateImportRes = await this.pool.query(
                `
                SELECT id::text, created_at AS "createdAt"
                FROM reporting_import_runs
                WHERE period_id = $1
                  AND file_sha256 = $2
                  AND status = 'completed'
                  AND id <> $3
                ORDER BY created_at DESC
                LIMIT 1;
                `,
                [cleanPeriodId, fileSha256, importId],
            )
            if (duplicateImportRes.rows[0]) {
                extracted.warnings.push(
                    `Этот файл уже успешно загружался в выбранный период (${toIsoString(duplicateImportRes.rows[0].createdAt)}).`,
                )
            }
        } catch (err) {
            await this.markImportFailed(importId, err)
            throw err
        }

        const indicatorById = new Map(indicators.map((indicator) => [indicator.id, indicator]))
        const denominatorReplacementIndicatorIds = extracted.items
            .filter((item) => item.denominatorColumn !== null)
            .map((item) => item.indicatorId)
        const targetReplacementIndicatorIds = extracted.items
            .filter((item) => item.targetColumn !== null)
            .map((item) => item.indicatorId)
        const savedValues: ReportingIndicatorValue[] = []
        let savedOrganizationValueCount = 0
        let savedOrganizationDenominatorCount = 0

        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')

            const existingRes = await client.query(
                `
                SELECT indicator_id AS "indicatorId",
                       denominator::float8 AS denominator,
                       target_value::float8 AS "targetValue",
                   target_year_end_value::float8 AS "targetYearEndValue",
                       note
                FROM reporting_indicator_values
                WHERE period_id = $1
                FOR UPDATE;
                `,
                [cleanPeriodId],
            )
            const existingByIndicatorId = new Map(
                existingRes.rows.map((row) => [row.indicatorId, row]),
            )

            const existingOrganizationRes = await client.query(
                `
                SELECT indicator_id AS "indicatorId",
                       organization_oid AS "organizationOid",
                       denominator::float8 AS denominator,
                       target_value::float8 AS "targetValue",
                   target_year_end_value::float8 AS "targetYearEndValue",
                       note
                FROM reporting_organization_indicator_values
                WHERE period_id = $1
                FOR UPDATE;
                `,
                [cleanPeriodId],
            )
            const existingOrganizationByKey = new Map(
                existingOrganizationRes.rows.map((row) => [
                    this.buildOrganizationValueKey(row.indicatorId, row.organizationOid),
                    row,
                ]),
            )

            if (importMode === 'replace') {
                await client.query(
                    `
                    UPDATE reporting_indicator_values value
                    SET numerator = NULL,
                        fact_value = NULL,
                        deviation_value = NULL,
                        business_status = 'not_assessed',
                        status = CASE
                            WHEN indicator.methodology_status = 'in_development'
                                THEN 'methodology_in_development'
                            ELSE 'awaiting_data'
                        END,
                        source_name = '',
                        updated_by = $2,
                        updated_at = now()
                    FROM reporting_indicators indicator
                    WHERE value.indicator_id = indicator.id
                      AND value.period_id = $1
                      AND indicator.is_mvp = TRUE;
                    `,
                    [cleanPeriodId, userId],
                )
                await client.query(
                    `
                    UPDATE reporting_organization_indicator_values value
                    SET numerator = NULL,
                        fact_value = NULL,
                        deviation_value = NULL,
                        business_status = 'not_assessed',
                        status = CASE
                            WHEN indicator.methodology_status = 'in_development'
                                THEN 'methodology_in_development'
                            ELSE 'awaiting_data'
                        END,
                        source_name = '',
                        updated_by = $2,
                        updated_at = now()
                    FROM reporting_indicators indicator
                    WHERE value.indicator_id = indicator.id
                      AND value.period_id = $1
                      AND indicator.is_mvp = TRUE;
                    `,
                    [cleanPeriodId, userId],
                )
                if (denominatorReplacementIndicatorIds.length > 0) {
                    await client.query(
                        `
                        UPDATE reporting_indicator_values
                        SET denominator = NULL,
                            fact_value = NULL,
                            deviation_value = NULL,
                            business_status = 'not_assessed',
                            updated_by = $2,
                            updated_at = now()
                        WHERE period_id = $1
                          AND indicator_id = ANY($3::text[]);
                        `,
                        [cleanPeriodId, userId, denominatorReplacementIndicatorIds],
                    )
                    await client.query(
                        `
                        UPDATE reporting_organization_indicator_values
                        SET denominator = NULL,
                            fact_value = NULL,
                            deviation_value = NULL,
                            business_status = 'not_assessed',
                            updated_by = $2,
                            updated_at = now()
                        WHERE period_id = $1
                          AND indicator_id = ANY($3::text[]);
                        `,
                        [cleanPeriodId, userId, denominatorReplacementIndicatorIds],
                    )
                }
                if (targetReplacementIndicatorIds.length > 0) {
                    await client.query(
                        `
                        UPDATE reporting_indicator_values
                        SET target_value = NULL,
                            deviation_value = NULL,
                            business_status = 'not_assessed',
                            updated_by = $2,
                            updated_at = now()
                        WHERE period_id = $1
                          AND indicator_id = ANY($3::text[]);
                        `,
                        [cleanPeriodId, userId, targetReplacementIndicatorIds],
                    )
                    await client.query(
                        `
                        UPDATE reporting_organization_indicator_values
                        SET target_value = NULL,
                            deviation_value = NULL,
                            business_status = 'not_assessed',
                            updated_by = $2,
                            updated_at = now()
                        WHERE period_id = $1
                          AND indicator_id = ANY($3::text[]);
                        `,
                        [cleanPeriodId, userId, targetReplacementIndicatorIds],
                    )
                }
                await client.query(
                    `
                    DELETE FROM reporting_organization_indicator_components
                    WHERE period_id = $1
                      AND source_type = 'remd_excel';
                    `,
                    [cleanPeriodId],
                )
            }

            for (const item of extracted.items) {
                const indicator = indicatorById.get(item.indicatorId)
                if (!indicator) {
                    extracted.warnings.push(`Показатель ${item.indicatorId} не найден в справочнике`)
                    continue
                }

                const existing = existingByIndicatorId.get(item.indicatorId) as any | undefined
                const denominator = item.denominatorColumn
                    ? item.denominator
                    : toNullableNumber(existing?.denominator)
                const targetValue = item.targetColumn
                    ? item.targetValue
                    : toNullableNumber(existing?.targetValue)
                const note = typeof existing?.note === 'string' ? existing.note : ''
                const calculated = this.calculateIndicatorValue(
                    indicator,
                    item.numerator,
                    denominator,
                    targetValue,
                )

                const res = await client.query(
                    `
                    INSERT INTO reporting_indicator_values (
                        indicator_id,
                        period_id,
                        numerator,
                        denominator,
                        fact_value,
                        target_value,
                        status,
                        deviation_value,
                        business_status,
                        note,
                        source_name,
                        created_by,
                        updated_by
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
                    ON CONFLICT (indicator_id, period_id) DO UPDATE SET
                        numerator = EXCLUDED.numerator,
                        denominator = EXCLUDED.denominator,
                        fact_value = EXCLUDED.fact_value,
                        target_value = EXCLUDED.target_value,
                        status = EXCLUDED.status,
                        deviation_value = EXCLUDED.deviation_value,
                        business_status = EXCLUDED.business_status,
                        source_name = EXCLUDED.source_name,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = now()
                    RETURNING id::text,
                              indicator_id AS "indicatorId",
                              period_id::text AS "periodId",
                              numerator::float8 AS numerator,
                              denominator::float8 AS denominator,
                              fact_value::float8 AS "factValue",
                              target_value::float8 AS "targetValue",
                   target_year_end_value::float8 AS "targetYearEndValue",
                              status,
                              deviation_value::float8 AS "deviationValue",
                              business_status AS "businessStatus",
                              note,
                              source_name AS "sourceName",
                              created_by AS "createdBy",
                              updated_by AS "updatedBy",
                              created_at AS "createdAt",
                              updated_at AS "updatedAt";
                    `,
                    [
                        item.indicatorId,
                        cleanPeriodId,
                        item.numerator,
                        denominator,
                        calculated.factValue,
                        targetValue,
                        calculated.status,
                        calculated.deviationValue,
                        calculated.businessStatus,
                        note,
                        sourceName,
                        userId,
                    ],
                )

                savedValues.push(this.mapValue(res.rows[0]))

                for (const organization of item.organizations) {
                    const geo = getOrganizationGeo(organization.oid)
                    const existingOrganization = existingOrganizationByKey.get(
                        this.buildOrganizationValueKey(item.indicatorId, organization.oid),
                    ) as any | undefined
                    const organizationDenominator = item.denominatorColumn
                        ? (organization.denominator ?? null)
                        : toNullableNumber(existingOrganization?.denominator)
                    const organizationTargetValue = item.targetColumn
                        ? (organization.targetValue ?? item.targetValue)
                        : toNullableNumber(existingOrganization?.targetValue)
                    const organizationNote = typeof existingOrganization?.note === 'string'
                        ? existingOrganization.note
                        : ''
                    const organizationCalculated = this.calculateIndicatorValue(
                        indicator,
                        organization.numerator,
                        organizationDenominator,
                        organizationTargetValue,
                    )

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
                            status,
                            deviation_value,
                            business_status,
                            note,
                            source_name,
                            created_by,
                            updated_by
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20)
                        ON CONFLICT (indicator_id, period_id, organization_oid) DO UPDATE SET
                            organization_name = EXCLUDED.organization_name,
                            organization_full_name = EXCLUDED.organization_full_name,
                            numerator = EXCLUDED.numerator,
                            denominator = EXCLUDED.denominator,
                            fact_value = EXCLUDED.fact_value,
                            target_value = EXCLUDED.target_value,
                            status = EXCLUDED.status,
                            deviation_value = EXCLUDED.deviation_value,
                            business_status = EXCLUDED.business_status,
                            source_name = EXCLUDED.source_name,
                            updated_by = EXCLUDED.updated_by,
                            updated_at = now();
                        `,
                        [
                            item.indicatorId,
                            cleanPeriodId,
                            organization.oid,
                            organization.name,
                            '',
                            geo?.address ?? '',
                            geo?.latitude ?? null,
                            geo?.longitude ?? null,
                            geo?.locationSource ?? '',
                            geo?.locationPrecision ?? 'unknown',
                            organization.numerator,
                            organizationDenominator,
                            organizationCalculated.factValue,
                            organizationTargetValue,
                            organizationCalculated.status,
                            organizationCalculated.deviationValue,
                            organizationCalculated.businessStatus,
                            organizationNote,
                            sourceName,
                            userId,
                        ],
                    )
                    for (const [componentKey, componentValue] of Object.entries(organization.components)) {
                        await client.query(
                            `
                            INSERT INTO reporting_organization_indicator_components (
                                indicator_id,
                                period_id,
                                organization_oid,
                                component_key,
                                source_type,
                                value,
                                source_import_id
                            )
                            VALUES ($1, $2, $3, $4, 'remd_excel', $5, $6)
                            ON CONFLICT (
                                indicator_id,
                                period_id,
                                organization_oid,
                                component_key,
                                source_type
                            ) DO UPDATE SET
                                value = EXCLUDED.value,
                                source_import_id = EXCLUDED.source_import_id,
                                updated_at = now();
                            `,
                            [
                                item.indicatorId,
                                cleanPeriodId,
                                organization.oid,
                                componentKey,
                                componentValue,
                                importId,
                            ],
                        )
                    }
                    savedOrganizationValueCount += 1
                    if (item.denominatorColumn && organizationDenominator !== null) {
                        savedOrganizationDenominatorCount += 1
                    }
                }
            }

            const recalculatedValues = await this.recalculateRemdCurrentValues(
                client,
                cleanPeriodId,
                reportingDate,
                extracted.items,
                indicatorById,
                sourceName,
                userId,
            )
            savedValues.splice(0, savedValues.length, ...recalculatedValues)

            if (importMode === 'replace') {
                await client.query(
                    `
                    DELETE FROM reporting_organization_indicator_values value
                    USING reporting_indicators indicator
                    WHERE value.indicator_id = indicator.id
                      AND value.period_id = $1
                      AND indicator.is_mvp = TRUE
                      AND value.numerator IS NULL
                      AND value.denominator IS NULL
                      AND value.target_value IS NULL
                      AND btrim(value.note) = '';
                    `,
                    [cleanPeriodId],
                )
            }

            await client.query(
                `
                INSERT INTO reporting_import_indicator_snapshots (
                    import_id,
                    indicator_id,
                    numerator,
                    denominator,
                    fact_value,
                    target_value,
                    status,
                    deviation_value,
                    business_status,
                    note,
                    source_name
                )
                SELECT $1,
                       value.indicator_id,
                       value.numerator,
                       value.denominator,
                       value.fact_value,
                       value.target_value,
                       value.status,
                       value.deviation_value,
                       value.business_status,
                       value.note,
                       value.source_name
                FROM reporting_indicator_values value
                JOIN reporting_indicators indicator ON indicator.id = value.indicator_id
                WHERE value.period_id = $2
                  AND indicator.is_mvp = TRUE;
                `,
                [importId, cleanPeriodId],
            )
            await client.query(
                `
                INSERT INTO reporting_import_organization_snapshots (
                    import_id,
                    indicator_id,
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
                    status,
                    deviation_value,
                    business_status,
                    note,
                    source_name
                )
                SELECT $1,
                       value.indicator_id,
                       value.organization_oid,
                       value.organization_name,
                       value.organization_full_name,
                       value.address,
                       value.latitude,
                       value.longitude,
                       value.location_source,
                       value.location_precision,
                       value.numerator,
                       value.denominator,
                       value.fact_value,
                       COALESCE(value.target_value, regional.target_value),
                       value.status,
                       value.deviation_value,
                       value.business_status,
                       value.note,
                       value.source_name
                FROM reporting_organization_indicator_values value
                JOIN reporting_indicators indicator ON indicator.id = value.indicator_id
                LEFT JOIN reporting_indicator_values regional
                  ON regional.period_id = value.period_id
                 AND regional.indicator_id = value.indicator_id
                WHERE value.period_id = $2
                  AND indicator.is_mvp = TRUE;
                `,
                [importId, cleanPeriodId],
            )

            const details = {
                importMode,
                reportingDate,
                matchedIndicators: extracted.items.map((item) => ({
                    indicatorId: item.indicatorId,
                    numerator: item.numerator,
                    denominator: item.denominator,
                    targetValue: item.targetValue,
                    denominatorColumn: item.denominatorColumn,
                    targetColumn: item.targetColumn,
                    aggregation: item.aggregation,
                    groups: item.groups,
                })),
            }
            await client.query(
                `
                UPDATE reporting_import_runs
                SET status = 'completed',
                    organization_rows = $2,
                    indicator_values_count = $3,
                    organization_values_count = $4,
                    warnings = $5::jsonb,
                    details = $6::jsonb,
                    error_message = '',
                    completed_at = now()
                WHERE id = $1;
                `,
                [
                    importId,
                    extracted.organizationRows,
                    savedValues.length,
                    savedOrganizationValueCount,
                    JSON.stringify(extracted.warnings),
                    JSON.stringify(details),
                ],
            )

            await client.query('COMMIT')
        } catch (err) {
            await client.query('ROLLBACK')
            await this.markImportFailed(importId, err)
            throw err
        } finally {
            client.release()
        }

        return {
            importId,
            importMode,
            periodId: cleanPeriodId,
            sourceName,
            fileSha256,
            organizationRows: extracted.organizationRows,
            importedCount: savedValues.length,
            organizationValuesImported: savedOrganizationValueCount,
            denominatorIndicatorsImported: extracted.items.filter(
                (item) => item.denominatorColumn && item.denominator !== null,
            ).length,
            organizationDenominatorsImported: savedOrganizationDenominatorCount,
            values: savedValues,
            matchedColumns: extracted.items.map((item) => {
                const indicator = indicatorById.get(item.indicatorId)
                return {
                    indicatorId: item.indicatorId,
                    code: indicator?.code ?? item.indicatorId,
                    numerator: item.numerator,
                    denominator: item.denominator,
                    targetValue: item.targetValue,
                    denominatorColumn: item.denominatorColumn,
                    targetColumn: item.targetColumn,
                    aggregation: item.aggregation,
                    columns: item.columns,
                    groups: item.groups,
                }
            }),
            warnings: extracted.warnings,
        }
    }

    private async getIndicator(id: string): Promise<ReportingIndicator> {
        const res = await this.pool.query(
            `
            SELECT id,
                   code,
                   title,
                   short_title AS "shortTitle",
                   appendix2_number AS "appendix2Number",
                   unit,
                   formula_text AS "formulaText",
                   numerator_label AS "numeratorLabel",
                   denominator_label AS "denominatorLabel",
                   methodology_status AS "methodologyStatus",
                   is_mvp AS "isMvp",
                   value_kind AS "valueKind",
                   calculation_type AS "calculationType",
                   is_pilot AS "isPilot",
                   sort_order AS "sortOrder",
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
            FROM reporting_indicators
            WHERE id = $1;
            `,
            [id],
        )

        const row = res.rows[0]
        if (!row) {
            throw new NotFoundException('Показатель отчетности не найден')
        }
        return this.mapIndicator(row)
    }

    private async recalculateRemdCurrentValues(
        client: PoolClient,
        periodId: string,
        reportingDate: string | null,
        items: RemdExtractedItem[],
        indicatorById: Map<string, ReportingIndicator>,
        sourceName: string,
        userId: number,
    ): Promise<ReportingIndicatorValue[]> {
        const values: ReportingIndicatorValue[] = []

        const uniqueItems = new Map(items.map((item) => [item.indicatorId, item]))
        for (const item of uniqueItems.values()) {
            const indicatorId = item.indicatorId
            const indicator = indicatorById.get(indicatorId)
            const rule = getRemdIndicatorCalculationRule(indicatorId, reportingDate)
            if (!indicator || !rule) continue

            const componentRes = await client.query(
                `
                SELECT organization_oid AS "organizationOid",
                       component_key AS "componentKey",
                       value::float8 AS value
                FROM reporting_organization_indicator_components
                WHERE period_id = $1
                  AND indicator_id = $2
                  AND source_type = 'remd_excel';
                `,
                [periodId, indicatorId],
            )
            const currentRes = await client.query(
                `
                SELECT denominator::float8 AS denominator,
                       target_value::float8 AS "targetValue"
                FROM reporting_indicator_values
                WHERE period_id = $1
                  AND indicator_id = $2
                FOR UPDATE;
                `,
                [periodId, indicatorId],
            )
            const targetValue = item.targetColumn
                ? item.targetValue
                : toNullableNumber(currentRes.rows[0]?.targetValue)
            const organizationMetricRes = await client.query(
                `
                SELECT organization_oid AS "organizationOid",
                       denominator::float8 AS denominator,
                       target_value::float8 AS "targetValue"
                FROM reporting_organization_indicator_values
                WHERE period_id = $1
                  AND indicator_id = $2;
                `,
                [periodId, indicatorId],
            )
            const organizationMetrics = new Map(
                organizationMetricRes.rows.map((row) => [row.organizationOid, row]),
            )

            const groupTotals = new Map(rule.groupKeys.map((key) => [key, 0]))
            const organizationComponents = new Map<string, Map<string, number>>()
            for (const row of componentRes.rows) {
                const value = toNullableNumber(row.value) ?? 0
                if (groupTotals.has(row.componentKey)) {
                    groupTotals.set(
                        row.componentKey,
                        (groupTotals.get(row.componentKey) ?? 0) + value,
                    )
                }
                const components = organizationComponents.get(row.organizationOid) ?? new Map()
                components.set(row.componentKey, value)
                organizationComponents.set(row.organizationOid, components)
            }

            let selectedGroupKeys = rule.groupKeys
            if (rule.aggregation === 'max' && rule.groupKeys.length > 0) {
                let selectedKey = rule.groupKeys[0]
                for (const key of rule.groupKeys.slice(1)) {
                    if ((groupTotals.get(key) ?? 0) > (groupTotals.get(selectedKey) ?? 0)) {
                        selectedKey = key
                    }
                }
                selectedGroupKeys = [selectedKey]
            }

            let regionalNumerator = 0
            for (const [organizationOid, components] of organizationComponents) {
                const numerator = selectedGroupKeys.reduce(
                    (sum, key) => sum + (components.get(key) ?? 0),
                    0,
                )
                regionalNumerator += numerator
                const metrics = organizationMetrics.get(organizationOid) as any | undefined
                const organizationDenominator = toNullableNumber(metrics?.denominator)
                const organizationTargetValue = toNullableNumber(metrics?.targetValue)
                    ?? targetValue
                const organizationCalculated = this.calculateIndicatorValue(
                    indicator,
                    numerator,
                    organizationDenominator,
                    organizationTargetValue,
                )
                await client.query(
                    `
                    UPDATE reporting_organization_indicator_values
                    SET numerator = $4,
                        fact_value = $5,
                        status = $6,
                        deviation_value = $7,
                        business_status = $8,
                        updated_by = $9,
                        updated_at = now()
                    WHERE period_id = $1
                      AND indicator_id = $2
                      AND organization_oid = $3;
                    `,
                    [
                        periodId,
                        indicatorId,
                        organizationOid,
                        numerator,
                        organizationCalculated.factValue,
                        organizationCalculated.status,
                        organizationCalculated.deviationValue,
                        organizationCalculated.businessStatus,
                        userId,
                    ],
                )
            }

            let denominator = toNullableNumber(currentRes.rows[0]?.denominator)
            if (item.denominatorColumn) {
                const denominatorRes = await client.query(
                    `
                    SELECT SUM(denominator) FILTER (WHERE numerator IS NOT NULL)::float8 AS denominator,
                           COUNT(*) FILTER (WHERE numerator IS NOT NULL)::int AS "organizationCount",
                           COUNT(denominator) FILTER (WHERE numerator IS NOT NULL)::int AS "denominatorCount"
                    FROM reporting_organization_indicator_values
                    WHERE period_id = $1
                      AND indicator_id = $2;
                    `,
                    [periodId, indicatorId],
                )
                const organizationCount = Number(denominatorRes.rows[0]?.organizationCount)
                const denominatorCount = Number(denominatorRes.rows[0]?.denominatorCount)
                denominator = organizationCount > 0 && denominatorCount === organizationCount
                    ? toNullableNumber(denominatorRes.rows[0]?.denominator)
                    : null
            }
            const calculated = this.calculateIndicatorValue(
                indicator,
                regionalNumerator,
                denominator,
                targetValue,
            )
            const updatedRes = await client.query(
                `
                UPDATE reporting_indicator_values
                SET numerator = $3,
                    denominator = $4,
                    fact_value = $5,
                     target_value = $6,
                     status = $7,
                     deviation_value = $8,
                     business_status = $9,
                     source_name = $10,
                     updated_by = $11,
                    updated_at = now()
                WHERE period_id = $1
                  AND indicator_id = $2
                RETURNING id::text,
                          indicator_id AS "indicatorId",
                          period_id::text AS "periodId",
                          numerator::float8 AS numerator,
                          denominator::float8 AS denominator,
                          fact_value::float8 AS "factValue",
                           target_value::float8 AS "targetValue",
                   target_year_end_value::float8 AS "targetYearEndValue",
                           status,
                           deviation_value::float8 AS "deviationValue",
                           business_status AS "businessStatus",
                           note,
                          source_name AS "sourceName",
                          created_by AS "createdBy",
                          updated_by AS "updatedBy",
                          created_at AS "createdAt",
                          updated_at AS "updatedAt";
                `,
                [
                    periodId,
                    indicatorId,
                    regionalNumerator,
                    denominator,
                    calculated.factValue,
                    targetValue,
                    calculated.status,
                    calculated.deviationValue,
                    calculated.businessStatus,
                    sourceName,
                    userId,
                ],
            )
            if (updatedRes.rows[0]) {
                values.push(this.mapValue(updatedRes.rows[0]))
            }
        }

        return values
    }

    private async markImportFailed(importId: string, err: unknown): Promise<void> {
        const errorMessage = cleanText(
            err instanceof Error ? err.message : String(err),
            2_000,
        )
        try {
            await this.pool.query(
                `
                UPDATE reporting_import_runs
                SET status = 'failed',
                    error_message = $2,
                    completed_at = now()
                WHERE id = $1
                  AND status = 'processing';
                `,
                [importId, errorMessage],
            )
        } catch {
            // The original import error is more useful to the caller than a journal update error.
        }
    }

    private buildImportObjectFilename(originalFilename: string): string {
        const fileName = originalFilename.split(/[\\/]/).pop() || 'remd-import.xlsx'
        const sanitized = fileName
            .replace(/[^\p{L}\p{N}._-]+/gu, '_')
            .replace(/^[_ .-]+|[_ .-]+$/g, '')
            .slice(0, 160)
        if (!sanitized) return 'remd-import.xlsx'
        return sanitized.toLowerCase().endsWith('.xlsx')
            ? sanitized
            : `${sanitized}.xlsx`
    }

    private calculateIndicatorValue(
        indicator: ReportingIndicator,
        numerator: number | null,
        denominator: number | null,
        targetValue: number | null,
    ): {
        status: ReportingValueStatus
        factValue: number | null
        deviationValue: number | null
        businessStatus: ReportingBusinessStatus
    } {
        return this.calculators.require(indicator.calculationType).calculate(
            indicator,
            { numerator, denominator, targetValue },
        )
    }

    private parseMetricNumber(
        value: unknown,
        label: string,
        limits: { min?: number; max?: number } = {},
    ): number | null {
        if (value === null || typeof value === 'undefined' || value === '') {
            return null
        }

        const normalized = typeof value === 'string' ? value.replace(',', '.').trim() : value
        if (normalized === '') {
            return null
        }

        const numberValue = Number(normalized)
        if (!Number.isFinite(numberValue)) {
            throw new BadRequestException(`${label}: укажите число`)
        }
        const min = limits.min ?? 0
        if (numberValue < min) {
            throw new BadRequestException(`${label}: значение не может быть меньше ${min}`)
        }
        if (typeof limits.max === 'number' && numberValue > limits.max) {
            throw new BadRequestException(`${label}: значение не может быть больше ${limits.max}`)
        }

        return numberValue
    }

    private buildOrganizationValueKey(indicatorId: string, organizationOid: string): string {
        return `${indicatorId}\u0000${organizationOid}`
    }

    private mapIndicator(row: any): ReportingIndicator {
        return {
            id: row.id,
            code: row.code,
            title: row.title,
            shortTitle: String(row.shortTitle ?? ''),
            appendix2Number: String(row.appendix2Number ?? ''),
            unit: row.unit,
            formulaText: row.formulaText,
            numeratorLabel: row.numeratorLabel,
            denominatorLabel: row.denominatorLabel,
            methodologyStatus: row.methodologyStatus,
            isMvp: Boolean(row.isMvp),
            valueKind: row.valueKind ?? 'percent',
            calculationType: row.calculationType ?? 'ratio_percent',
            isPilot: Boolean(row.isPilot),
            sortOrder: Number(row.sortOrder),
            metadata: row.metadata ?? {},
            createdAt: toIsoString(row.createdAt),
            updatedAt: toIsoString(row.updatedAt),
        }
    }

    private mapValue(row: any): ReportingIndicatorValue {
        return {
            id: row.id,
            indicatorId: row.indicatorId,
            periodId: row.periodId,
            numerator: toNullableNumber(row.numerator),
            denominator: toNullableNumber(row.denominator),
            factValue: toNullableNumber(row.factValue),
            secondaryValue: toNullableNumber(row.secondaryValue),
            targetValue: toNullableNumber(row.targetValue),
            targetYearEndValue: toNullableNumber(row.targetYearEndValue),
            status: row.status,
            deviationValue: toNullableNumber(row.deviationValue),
            businessStatus: toBusinessStatus(row.businessStatus),
            calculationDetails: mapCalculationDetails(row.calculationDetails),
            note: row.note ?? '',
            sourceName: row.sourceName ?? '',
            createdBy: row.createdBy === null ? null : Number(row.createdBy),
            updatedBy: row.updatedBy === null ? null : Number(row.updatedBy),
            createdAt: toIsoString(row.createdAt),
            updatedAt: toIsoString(row.updatedAt),
        }
    }

    private mapOrganizationValue(
        row: any,
        maxNumerator: number,
    ): ReportingOrganizationIndicatorValue {
        const numerator = toNullableNumber(row.numerator)
        const relativePercent = numerator !== null && maxNumerator > 0
            ? Math.round((numerator / maxNumerator) * 10_000) / 100
            : null
        const targetValue = toNullableNumber(row.targetValue)
        const assessment = row.calculationType === 'semd_type_coverage'
            ? {
                deviationValue: toNullableNumber(row.storedDeviationValue),
                businessStatus: toBusinessStatus(row.storedBusinessStatus),
            }
            : calculateBusinessAssessment(
                toNullableNumber(row.factValue),
                targetValue,
                row.criticalDeviationPoints,
            )

        return {
            id: row.id,
            indicatorId: row.indicatorId,
            periodId: row.periodId,
            organizationOid: row.organizationOid,
            organizationName: row.organizationName,
            organizationFullName: row.organizationFullName ?? '',
            address: row.address ?? '',
            latitude: toNullableNumber(row.latitude),
            longitude: toNullableNumber(row.longitude),
            locationSource: row.locationSource ?? '',
            locationPrecision: toLocationPrecision(row.locationPrecision),
            numerator,
            denominator: toNullableNumber(row.denominator),
            factValue: toNullableNumber(row.factValue),
            secondaryValue: toNullableNumber(row.secondaryValue),
            targetValue,
            targetYearEndValue: toNullableNumber(row.targetYearEndValue),
            targetSource: row.targetSource === 'organization' || row.targetSource === 'period'
                ? row.targetSource
                : 'none',
            relativePercent,
            status: row.status,
            deviationValue: assessment.deviationValue,
            businessStatus: assessment.businessStatus,
            calculationDetails: mapCalculationDetails(row.calculationDetails),
            note: row.note ?? '',
            sourceName: row.sourceName ?? '',
            createdBy: row.createdBy === null ? null : Number(row.createdBy),
            updatedBy: row.updatedBy === null ? null : Number(row.updatedBy),
            createdAt: toIsoString(row.createdAt),
            updatedAt: toIsoString(row.updatedAt),
        }
    }
}
