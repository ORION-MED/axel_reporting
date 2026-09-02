import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common'
import { Pool, type PoolClient } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { toIsoString } from './reporting-format.util'
import {
    PILOT_INDICATOR_ID,
    PILOT_TARGET_TYPES,
    type FindingToSave,
    type OrganizationRow,
    type PilotCalculationReadiness,
    type PilotCalculationResult,
    type PilotDiagnosticFinding,
    type PilotInstitutionDetails,
    type PilotRequirementOverrideHistoryEntry,
    type PilotRequirementStatus,
    type RequirementRow,
    type SemdTypeRow,
} from './pilot-calculation.types'
import {
    addEpguVisibilitySourceMismatchFindings,
    addDataQualityFindings,
    addGisDirectoryConflictFindings,
    addReferenceFindings,
    addTpggOrganizationAbsentFindings,
    calculateOrganization,
    calculatePilotCoverage,
    classifyPilotInstitutionSemd,
    readinessNote,
    requirementKey,
    resolvePilotReferenceReadiness,
    resolvePilotRequirementStatus,
    resolvePrimaryEpguVisible,
} from './pilot-calculation.pure'

export {
    PILOT_INDICATOR_ID,
    type PilotCalculationResult,
    type PilotDiagnosticFinding,
    type PilotInstitutionDetails,
    type PilotRequirementOverrideHistoryEntry,
}

const INSERT_BATCH_SIZE = 300

/**
 * Orchestrator for the 6.1.3.2.7 pilot indicator: collects raw data (facts, applicability
 * rules, manual overrides — roadmap step 1.3 layer a), delegates the actual calculation and
 * diagnostics building to the pure functions in pilot-calculation.pure.ts (layers b/c), then
 * persists the result. Read-only lookups (diagnostics list, institution details, override
 * history) live here too since they are thin DB-mapping methods, not calculation logic.
 */
@Injectable()
export class PilotIndicatorCalculationService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async recalculate(periodId: string): Promise<PilotCalculationResult> {
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));`,
                [String(periodId), PILOT_INDICATOR_ID],
            )

            const periodResult = await client.query(
                `
                SELECT id::text,
                       date_from::text AS "dateFrom",
                       date_to::text AS "dateTo"
                FROM reporting_periods
                WHERE id = $1;
                `,
                [periodId],
            )
            const period = periodResult.rows[0]
            if (!period) {
                throw new NotFoundException('Отчетный период не найден')
            }
            const reportingDate = period.dateTo ?? period.dateFrom ?? null

            const [
                organizationResult,
                semdTypeResult,
                factResult,
                requirementResult,
                importResult,
                numeratorImportResult,
                subdivisionCountResult,
                unknownSubdivisionResult,
                applicabilityRuleCountResult,
                gisDirectoryConflictResult,
                tpggAbsentRequirementResult,
            ] = await Promise.all([
                client.query(
                    `
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
                    `,
                ),
                client.query(
                    `
                    SELECT semd.id::text,
                           semd.code,
                           semd.nsi_oid AS "nsiOid",
                           semd.official_oid AS "officialOid",
                           semd.official_name_5pr AS "officialName5pr",
                           semd.epgu_visible_registry AS "epguVisibleRegistry",
                           semd.name,
                           CASE
                               WHEN semd.nsi_oid IS NULL THEN semd.epgu_available
                               WHEN $1::date IS NULL THEN semd.epgu_available
                               WHEN version_state.active_version_count > 0
                                   THEN version_state.epgu_available
                               ELSE NULL
                           END AS "epguAvailable"
                    FROM reporting_semd_types semd
                    LEFT JOIN LATERAL (
                        SELECT COUNT(*)::int AS active_version_count,
                               BOOL_OR(version.epgu_available = TRUE) AS epgu_available
                        FROM reporting_semd_type_versions version
                        WHERE version.semd_type_id = semd.id
                          AND version.metadata->>'source' = 'emd_nsi_csv'
                          AND (
                              $1::date IS NULL
                              OR version.effective_from IS NULL
                              OR version.effective_from <= $1::date
                          )
                          AND (
                              $1::date IS NULL
                              OR version.effective_to IS NULL
                              OR version.effective_to >= $1::date
                          )
                    ) version_state ON TRUE
                    WHERE semd.is_active = TRUE
                      AND (
                          semd.nsi_oid IS NULL
                          OR $1::date IS NULL
                          OR version_state.active_version_count > 0
                      )
                    ORDER BY semd.name, semd.code;
                    `,
                    [reportingDate],
                ),
                client.query(
                    `
                    SELECT scope_level AS "scopeLevel",
                           organization_oid AS "organizationOid",
                           semd_type_id::text AS "semdTypeId",
                           SUM(document_count)::float8 AS "documentCount"
                    FROM reporting_remd_facts
                    WHERE period_id = $1
                      AND document_count > 0
                    GROUP BY scope_level, organization_oid, semd_type_id;
                    `,
                    [periodId],
                ),
                client.query(
                    `
                    WITH imported AS (
                        SELECT DISTINCT ON (organization_oid, semd_type_id)
                               organization_oid,
                               semd_type_id,
                               requirement_status,
                               gis_available,
                               reason,
                               source_name
                        FROM reporting_organization_semd_requirements
                        WHERE (
                                $1::date IS NULL
                                OR effective_from <= $1::date
                              )
                          AND (
                                $1::date IS NULL
                                OR effective_to IS NULL
                                OR effective_to >= $1::date
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
                               requirement_status,
                               reason
                        FROM reporting_organization_semd_requirement_overrides
                        WHERE period_id = $2
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
                           ) AS "requirementStatus",
                           -- Р3 (решение от 29.07): явный каскад по уровням источника.
                           -- 1) осознанное значение по паре МО × вид;
                           -- 2) справочник МИАЦ по виду (региональный);
                           -- 3) факт РЭМД по региону — «вид кем-то зарегистрирован,
                           --    значит ГИС его технически умеет»;
                           -- 4) NULL — «не уточнено».
                           -- Раньше уровень 3 записывался в требования при импорте ТПГГ и
                           -- всегда стоял на позиции 1, из-за чего справочник МИАЦ не мог
                           -- сработать ни разу.
                           COALESCE(
                               imported.gis_available,
                               gis_dir.is_available,
                               regional_fact.is_available
                           ) AS "gisAvailable",
                           CASE
                               WHEN manual_override.requirement_status IS NOT NULL
                                   THEN manual_override.reason
                               ELSE imported.reason
                           END AS reason,
                           CASE
                               WHEN manual_override.requirement_status IS NOT NULL
                                   THEN 'Ручное уточнение'
                               ELSE imported.source_name
                            END AS "sourceName",
                            (
                                manual_override.requirement_status IS NOT NULL
                            ) AS "isManualOverride"
                    FROM imported
                    FULL JOIN manual_override
                      ON manual_override.organization_oid = imported.organization_oid
                     AND manual_override.semd_type_id = imported.semd_type_id
                    LEFT JOIN reporting_semd_gis_availability gis_dir
                      ON gis_dir.semd_type_id = COALESCE(
                          manual_override.semd_type_id,
                          imported.semd_type_id
                      )
                    LEFT JOIN LATERAL (
                        SELECT TRUE AS is_available
                        WHERE EXISTS (
                            SELECT 1
                            FROM reporting_remd_facts fact
                            WHERE fact.period_id = $2
                              AND fact.document_count > 0
                              AND fact.semd_type_id = COALESCE(
                                  manual_override.semd_type_id,
                                  imported.semd_type_id
                              )
                        )
                    ) regional_fact ON TRUE
                    WHERE COALESCE(
                        manual_override.requirement_status,
                        imported.requirement_status
                    ) IS NOT NULL;
                    `,
                    [reportingDate, periodId],
                ),
                client.query(
                    `
                    SELECT id::text
                    FROM reporting_import_runs
                    WHERE period_id = $1
                      AND source_type = 'remd_workbook'
                      AND status = 'completed'
                    ORDER BY completed_at DESC NULLS LAST, created_at DESC
                    LIMIT 1;
                    `,
                    [periodId],
                ),
                // P1/P2/P3: итоги последнего успешного импорта числителя — какие организации,
                // подразделения и виды документов не удалось сопоставить со справочниками.
                client.query(
                    `
                    SELECT details
                    FROM reporting_import_runs
                    WHERE period_id = $1
                      AND source_type = 'remd_numerator_tidy_xlsx'
                      AND status = 'completed'
                    ORDER BY completed_at DESC NULLS LAST, created_at DESC
                    LIMIT 1;
                    `,
                    [periodId],
                ),
                // P5: МО без единого подразделения в ФРМР.
                client.query(
                    `
                    SELECT organization_oid AS "organizationOid",
                           COUNT(*)::int AS "subdivisionCount"
                    FROM reporting_organization_subdivisions
                    WHERE is_active = TRUE
                    GROUP BY organization_oid;
                    `,
                ),
                // P2: подразделения из выгрузки РЭМД, которых нет в ФРМР. Считается здесь,
                // а не берётся из итогов импорта числителя: числитель грузится шагом 4,
                // ФРМР — шагом 5, поэтому импортёр всегда сверяется с ФРМР предыдущей
                // загрузки и после переимпорта ФРМР его цифра устаревает молча.
                client.query(
                    `
                    SELECT facts.subdivision_oid AS oid,
                           COALESCE(
                               NULLIF(org.official_short_name, ''),
                               NULLIF(org.official_full_name, ''),
                               facts.organization_oid
                           ) AS "organizationName",
                           SUM(facts.document_count)::int AS "documentCount"
                    FROM reporting_remd_subdivision_facts facts
                    LEFT JOIN reporting_organization_subdivisions frmr
                           ON frmr.subdivision_oid = facts.subdivision_oid
                          AND frmr.is_active = TRUE
                    LEFT JOIN reporting_organizations org
                           ON org.oid = facts.organization_oid
                    WHERE facts.period_id = $1
                      AND facts.subdivision_oid IS NOT NULL
                      AND frmr.subdivision_oid IS NULL
                    GROUP BY facts.subdivision_oid, org.official_short_name,
                             org.official_full_name, facts.organization_oid;
                    `,
                    [periodId],
                ),
                // P4: загружена ли вообще утверждённая матрица применимости.
                client.query(
                    `
                    SELECT COUNT(*)::int AS "ruleCount"
                    FROM reporting_semd_applicability_rules;
                    `,
                ),
                // Р3: виды, помеченные в справочнике МИАЦ как нереализованные, но при этом
                // фактически зарегистрированные в РЭМД, — расхождение источников.
                client.query(
                    `
                    SELECT gis.semd_type_id::text AS "semdTypeId",
                           semd.name AS "semdTypeName",
                           count(DISTINCT fact.organization_oid)::int
                               AS "registeredOrganizationCount"
                    FROM reporting_semd_gis_availability gis
                    JOIN reporting_semd_types semd ON semd.id = gis.semd_type_id
                    JOIN reporting_remd_facts fact
                      ON fact.semd_type_id = gis.semd_type_id
                     AND fact.period_id = $1
                     AND fact.document_count > 0
                     AND fact.scope_level = 'organization'
                    WHERE gis.is_available = FALSE
                    GROUP BY gis.semd_type_id, semd.name;
                    `,
                    [periodId],
                ),
                // Р10: пары, где обязательность снята из-за отсутствия МО в файле ТПГГ.
                // Пометку ставит импортёр матрицы (metadata.tpggOrganizationAbsent).
                client.query(
                    `
                    SELECT DISTINCT ON (organization_oid, semd_type_id)
                           organization_oid AS "organizationOid",
                           semd_type_id::text AS "semdTypeId"
                    FROM reporting_organization_semd_requirements
                    WHERE metadata->>'tpggOrganizationAbsent' = 'true'
                      AND (
                            $1::date IS NULL
                            OR effective_from <= $1::date
                          )
                      AND (
                            $1::date IS NULL
                            OR effective_to IS NULL
                            OR effective_to >= $1::date
                          )
                    ORDER BY
                        organization_oid,
                        semd_type_id,
                        effective_from DESC,
                        updated_at DESC;
                    `,
                    [reportingDate],
                ),
            ])

            const organizations = organizationResult.rows as OrganizationRow[]
            const semdTypes = semdTypeResult.rows.map((row) => ({
                id: String(row.id),
                code: String(row.code),
                nsiOid: row.nsiOid ? String(row.nsiOid) : null,
                officialOid: row.officialOid ? String(row.officialOid) : null,
                officialName5pr: row.officialName5pr ? String(row.officialName5pr) : null,
                name: String(row.name),
                epguVisibleRegistry:
                    row.epguVisibleRegistry === null
                    || typeof row.epguVisibleRegistry === 'undefined'
                        ? null
                        : Boolean(row.epguVisibleRegistry),
                epguAvailable:
                    row.epguAvailable === null
                    || typeof row.epguAvailable === 'undefined'
                        ? null
                        : Boolean(row.epguAvailable),
            })) as SemdTypeRow[]
            const requirements = requirementResult.rows.map((row) => ({
                organizationOid: String(row.organizationOid),
                semdTypeId: String(row.semdTypeId),
                requirementStatus: row.requirementStatus,
                gisAvailable:
                    row.gisAvailable === null
                    || typeof row.gisAvailable === 'undefined'
                        ? null
                        : Boolean(row.gisAvailable),
                reason: String(row.reason ?? ''),
                sourceName: String(row.sourceName ?? ''),
                isManualOverride: Boolean(row.isManualOverride),
            })) as RequirementRow[]
            const sourceImportId = importResult.rows[0]?.id
                ? String(importResult.rows[0].id)
                : null

            const regionFactTypes = new Set<string>()
            const organizationFactTypes = new Map<string, Set<string>>()
            for (const fact of factResult.rows) {
                const semdTypeId = String(fact.semdTypeId)
                if (fact.scopeLevel === 'region') {
                    regionFactTypes.add(semdTypeId)
                } else if (
                    fact.scopeLevel === 'organization'
                    && fact.organizationOid
                ) {
                    const oid = String(fact.organizationOid)
                    const types = organizationFactTypes.get(oid) ?? new Set<string>()
                    types.add(semdTypeId)
                    organizationFactTypes.set(oid, types)
                }
            }
            if (regionFactTypes.size === 0) {
                for (const types of organizationFactTypes.values()) {
                    for (const typeId of types) regionFactTypes.add(typeId)
                }
            }

            const referenceTypes = semdTypes.filter(
                (type) => type.nsiOid !== null,
            )
            // Roadmap Пакет A, задача 10 — основной флаг видимости на ЕПГУ теперь берется из
            // doc_visible (справочник 1253), с fallback на прежний SHOW_PATIENT (1520), пока
            // 1253 не покрывает данный вид МД — см. resolvePrimaryEpguVisible.
            const epguTypes = referenceTypes.filter(
                (type) => resolvePrimaryEpguVisible(type) === true,
            )
            const epguTypeIds = new Set(epguTypes.map((type) => type.id))
            const epguUnavailableTypeCount = referenceTypes.filter(
                (type) => resolvePrimaryEpguVisible(type) === false,
            ).length
            const unknownEpguTypes = referenceTypes.filter(
                (type) => resolvePrimaryEpguVisible(type) === null,
            )
            const unknownActiveTypes = unknownEpguTypes.filter(
                (type) => regionFactTypes.has(type.id),
            )
            const hasRemdData =
                regionFactTypes.size > 0
                || organizationFactTypes.size > 0
            const referenceReadiness = resolvePilotReferenceReadiness({
                catalogTypeCount: referenceTypes.length,
                unknownTypeCount: unknownEpguTypes.length,
                epguAvailableTypeCount: epguTypes.length,
                hasRemdData,
            })
            const referenceReady = referenceReadiness === 'ready'
            const actualRegionTypeCount = referenceReady
                ? epguTypes.filter((type) => regionFactTypes.has(type.id)).length
                : null
            const plannedRegionTypeCount = referenceReady
                ? epguTypes.length
                : null
            const regionalCoverage = calculatePilotCoverage(
                actualRegionTypeCount,
                plannedRegionTypeCount,
            )
            // Задача 8 (Пакет A) — региональный список видов СЭМД: какие из целевых видов
            // покрыты хотя бы одной МО региона. Использует те же epguTypes/regionFactTypes,
            // что уже считаются для actualRegionTypeCount выше — доп. агрегации не требуется.
            const regionTypeCoverage = epguTypes.map((type) => ({
                id: type.id,
                code: type.code,
                name: type.name,
                nsiOid: type.nsiOid,
                officialOid: type.officialOid,
                officialName5pr: type.officialName5pr,
                covered: regionFactTypes.has(type.id),
            }))

            const requirementByKey = new Map(
                requirements.map((requirement) => [
                    requirementKey(
                        requirement.organizationOid,
                        requirement.semdTypeId,
                    ),
                    requirement,
                ]),
            )
            const findings: FindingToSave[] = []
            addReferenceFindings(
                findings,
                referenceReadiness,
                referenceTypes,
                unknownEpguTypes,
                unknownActiveTypes,
            )
            addEpguVisibilitySourceMismatchFindings(findings, referenceTypes)

            // Правила качества данных P1–P5 (согласовательный файл 23.07). Строятся по итогам
            // импорта числителя и наполненности справочников, а не по расчёту процента.
            const numeratorDetails = (numeratorImportResult.rows[0]?.details ?? null) as
                | Record<string, unknown>
                | null
            const toStringArray = (value: unknown): string[] => (
                Array.isArray(value) ? value.map((item) => String(item)) : []
            )
            const organizationOidsWithSubdivisions = new Set(
                subdivisionCountResult.rows.map((row) => String(row.organizationOid)),
            )
            addDataQualityFindings(findings, {
                numeratorImport: numeratorDetails
                    ? {
                        unmatchedDocumentTypeNames: toStringArray(
                            numeratorDetails.unmatchedDocumentTypeNames,
                        ),
                        unmatchedOrganizationOids: toStringArray(
                            numeratorDetails.unmatchedOrganizationOids,
                        ),
                    }
                    : null,
                unknownSubdivisions: unknownSubdivisionResult.rows.map((row) => ({
                    oid: String(row.oid),
                    organizationName: String(row.organizationName),
                    documentCount: Number(row.documentCount ?? 0),
                })),
                applicabilityRuleCount: Number(
                    applicabilityRuleCountResult.rows[0]?.ruleCount ?? 0,
                ),
                organizationsWithoutSubdivisions: organizations
                    .filter(
                        (organization) =>
                            !organizationOidsWithSubdivisions.has(organization.oid),
                    )
                    .map((organization) => ({
                        oid: organization.oid,
                        name: organization.officialShortName
                            || organization.officialFullName
                            || organization.oid,
                    })),
            })

            addGisDirectoryConflictFindings(
                findings,
                gisDirectoryConflictResult.rows.map((row) => ({
                    semdTypeId: String(row.semdTypeId),
                    semdTypeName: String(row.semdTypeName ?? ''),
                    registeredOrganizationCount: Number(
                        row.registeredOrganizationCount ?? 0,
                    ),
                })),
            )

            // Р10: снятие обязательности по отсутствию МО в ТПГГ — допущение, а не показание
            // источника. Показываем его явно, чтобы методолог подтвердил или опроверг.
            addTpggOrganizationAbsentFindings(
                findings,
                tpggAbsentRequirementResult.rows.map((row) => ({
                    organizationOid: String(row.organizationOid),
                    semdTypeId: String(row.semdTypeId),
                })),
            )

            const organizationCalculations = organizations.map(
                (organization) => calculateOrganization({
                    organization,
                    epguTypes,
                    epguTypeIds,
                    referenceReady,
                    referenceReadiness,
                    factTypeIds:
                        organizationFactTypes.get(organization.oid)
                        ?? new Set<string>(),
                    requirementByKey,
                    findings,
                }),
            )

            if (
                referenceReady
                && actualRegionTypeCount !== null
                && actualRegionTypeCount < PILOT_TARGET_TYPES
            ) {
                findings.push({
                    organizationOid: null,
                    semdTypeId: null,
                    findingCode: 'regional_target_not_met',
                    severity: 'warning',
                    cause:
                        `Зарегистрировано ${actualRegionTypeCount} видов СЭМД из целевых ${PILOT_TARGET_TYPES}.`,
                    responsibilityArea: 'МИАЦ / региональный орган управления здравоохранением',
                    recommendation:
                        'Разобрать отсутствующие виды по применимости к МО и доступности в региональной ГИС.',
                    evidence: {
                        actualTypeCount: actualRegionTypeCount,
                        targetTypeCount: PILOT_TARGET_TYPES,
                        deficitTypeCount:
                            PILOT_TARGET_TYPES - actualRegionTypeCount,
                    },
                })
            }

            const regionDetails = {
                readiness: referenceReadiness,
                actualTypeCount: actualRegionTypeCount,
                plannedTypeCount: plannedRegionTypeCount,
                coveragePercent: regionalCoverage,
                targetTypeCount: PILOT_TARGET_TYPES,
                rawActiveTypeCount: regionFactTypes.size,
                catalogTypeCount: referenceTypes.length,
                epguAvailableTypeCount: epguTypes.length,
                epguUnavailableTypeCount,
                epguUnknownTypeCount: unknownEpguTypes.length,
                unknownActiveTypeCount: unknownActiveTypes.length,
                sourceImportId,
                reportingDate,
            }
            await this.saveRegionalValue(
                client,
                periodId,
                regionDetails,
                sourceImportId,
            )
            await this.saveOrganizationValues(
                client,
                periodId,
                organizations,
                organizationCalculations,
                sourceImportId,
            )
            await this.saveFindings(
                client,
                periodId,
                sourceImportId,
                findings,
            )

            await client.query('COMMIT')
            return {
                periodId,
                indicatorId: PILOT_INDICATOR_ID,
                calculatedAt: new Date().toISOString(),
                sourceImportId,
                region: {
                    readiness: referenceReadiness,
                    actualTypeCount: actualRegionTypeCount,
                    plannedTypeCount: plannedRegionTypeCount,
                    coveragePercent: regionalCoverage,
                    targetTypeCount: PILOT_TARGET_TYPES,
                    rawActiveTypeCount: regionFactTypes.size,
                    catalogTypeCount: referenceTypes.length,
                    epguAvailableTypeCount: epguTypes.length,
                    epguUnavailableTypeCount,
                    epguUnknownTypeCount: unknownEpguTypes.length,
                    unknownActiveTypeCount: unknownActiveTypes.length,
                    types: regionTypeCoverage,
                },
                organizations: organizationCalculations.map((calculation) => ({
                    organizationOid: calculation.organizationOid,
                    readiness: calculation.readiness,
                    isPreliminary: calculation.isPreliminary,
                    actualTypeCount: calculation.actualTypeCount,
                    plannedTypeCount: calculation.plannedTypeCount,
                    coveragePercent: calculation.coveragePercent,
                    rawActiveTypeCount: calculation.rawActiveTypeCount,
                    epguActiveTypeCount: calculation.epguActiveTypeCount,
                    knownApplicabilityCount:
                        calculation.knownApplicabilityCount,
                    requiredTypeCount: calculation.requiredTypeCount,
                    notRequiredTypeCount:
                        calculation.notRequiredTypeCount,
                    missingApplicabilityRuleCount:
                        calculation.missingApplicabilityRuleCount,
                    unknownApplicabilityCount:
                        calculation.unknownApplicabilityCount,
                    manualOverrideCount:
                        calculation.manualOverrideCount,
                    blockedByRegionalGisCount:
                        calculation.blockedByRegionalGisCount,
                    missingAtInstitutionCount:
                        calculation.missingAtInstitutionCount,
                    unknownGisCapabilityCount:
                        calculation.unknownGisCapabilityCount,
                    handledInExternalSystemCount:
                        calculation.handledInExternalSystemCount,
                    unexpectedRegisteredTypeCount:
                        calculation.unexpectedRegisteredTypeCount,
                })),
                findingCount: findings.length,
            }
        } catch (err) {
            await client.query('ROLLBACK')
            throw err
        } finally {
            client.release()
        }
    }

    /**
     * Н20: показатель задаётся параметром, а не константой. Таблица находок общая,
     * и с 18.08.2026 в неё пишет ещё расчёт долей — читать всегда по 6.1.3.2.7
     * значило бы, что находки долей есть в базе, но их никто не видит.
     *
     * Значение по умолчанию оставлено пилотным: так прежние вызовы (карточка МО
     * и свод причин у 6.1.3.2.7) ведут себя ровно как раньше.
     */
    async listDiagnostics(options: {
        periodId: string
        organizationOid?: string
        indicatorId?: string
    }): Promise<PilotDiagnosticFinding[]> {
        const params: unknown[] = [
            options.periodId,
            options.indicatorId?.trim() || PILOT_INDICATOR_ID,
        ]
        const organizationFilter = options.organizationOid
            ? `AND finding.organization_oid = $3`
            : ''
        if (options.organizationOid) params.push(options.organizationOid)

        const result = await this.pool.query(
            `
            SELECT finding.id::text,
                   finding.period_id::text AS "periodId",
                   finding.indicator_id AS "indicatorId",
                   finding.organization_oid AS "organizationOid",
                   finding.semd_type_id::text AS "semdTypeId",
                   semd.name AS "semdTypeName",
                   finding.finding_code AS "findingCode",
                   finding.severity,
                   finding.cause,
                   finding.responsibility_area AS "responsibilityArea",
                   finding.recommendation,
                   finding.evidence,
                   finding.status,
                   finding.source_import_id::text AS "sourceImportId",
                   finding.created_at AS "createdAt",
                   finding.updated_at AS "updatedAt"
            FROM reporting_diagnostic_findings finding
            LEFT JOIN reporting_semd_types semd ON semd.id = finding.semd_type_id
            WHERE finding.period_id = $1
              AND finding.indicator_id = $2
              AND finding.status = 'active'
              ${organizationFilter}
            ORDER BY
                CASE finding.severity
                    WHEN 'error' THEN 1
                    WHEN 'warning' THEN 2
                    ELSE 3
                END,
                semd.name NULLS FIRST,
                finding.created_at;
            `,
            params,
        )

        return result.rows.map((row) => ({
            id: String(row.id),
            periodId: String(row.periodId),
            indicatorId: String(row.indicatorId),
            organizationOid: row.organizationOid
                ? String(row.organizationOid)
                : null,
            semdTypeId: row.semdTypeId ? String(row.semdTypeId) : null,
            semdTypeName: row.semdTypeName
                ? String(row.semdTypeName)
                : null,
            findingCode: String(row.findingCode),
            severity: row.severity,
            cause: String(row.cause),
            responsibilityArea: String(row.responsibilityArea ?? ''),
            recommendation: String(row.recommendation ?? ''),
            evidence:
                row.evidence
                && typeof row.evidence === 'object'
                && !Array.isArray(row.evidence)
                    ? row.evidence
                    : {},
            status: row.status,
            sourceImportId: row.sourceImportId
                ? String(row.sourceImportId)
                : null,
            createdAt: toIsoString(row.createdAt),
            updatedAt: toIsoString(row.updatedAt),
        }))
    }

    async setInstitutionRequirementOverride(options: {
        periodId: string
        organizationOid: string
        semdTypeId: string
        requirementStatus: 'required' | 'not_required' | null
        reason: string
        userId: number
    }): Promise<PilotInstitutionDetails> {
        const reason = options.reason.trim()
        if (!reason) {
            throw new BadRequestException(
                'Укажите основание ручного уточнения',
            )
        }
        if (
            options.requirementStatus !== null
            && options.requirementStatus !== 'required'
            && options.requirementStatus !== 'not_required'
        ) {
            throw new BadRequestException(
                'Допустимые значения: required или not_required',
            )
        }

        const entityResult = await this.pool.query(
            `
            SELECT
                EXISTS(
                    SELECT 1 FROM reporting_periods WHERE id = $1
                ) AS "periodExists",
                EXISTS(
                    SELECT 1
                    FROM reporting_organizations
                    WHERE oid = $2 AND is_active = TRUE
                ) AS "organizationExists",
                EXISTS(
                    SELECT 1
                    FROM reporting_semd_types
                    WHERE id = $3 AND is_active = TRUE
                ) AS "semdTypeExists";
            `,
            [
                options.periodId,
                options.organizationOid,
                options.semdTypeId,
            ],
        )
        const entities = entityResult.rows[0]
        if (!entities?.periodExists) {
            throw new NotFoundException('Отчетный период не найден')
        }
        if (!entities?.organizationExists) {
            throw new NotFoundException(
                'Медицинская организация не найдена',
            )
        }
        if (!entities?.semdTypeExists) {
            throw new NotFoundException('Вид СЭМД не найден')
        }

        await this.pool.query(
            `
            INSERT INTO reporting_organization_semd_requirement_overrides (
                period_id,
                organization_oid,
                semd_type_id,
                requirement_status,
                reason,
                created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6);
            `,
            [
                options.periodId,
                options.organizationOid,
                options.semdTypeId,
                options.requirementStatus,
                reason,
                options.userId,
            ],
        )

        await this.recalculate(options.periodId)
        return this.getInstitutionDetails({
            periodId: options.periodId,
            organizationOid: options.organizationOid,
        })
    }

    async listInstitutionRequirementOverrideHistory(options: {
        periodId: string
        organizationOid: string
        semdTypeId?: string
    }): Promise<PilotRequirementOverrideHistoryEntry[]> {
        const entityResult = await this.pool.query(
            `
            SELECT
                EXISTS(
                    SELECT 1 FROM reporting_periods WHERE id = $1
                ) AS "periodExists",
                EXISTS(
                    SELECT 1
                    FROM reporting_organizations
                    WHERE oid = $2 AND is_active = TRUE
                ) AS "organizationExists",
                CASE
                    WHEN $3::uuid IS NULL THEN TRUE
                    ELSE EXISTS(
                        SELECT 1
                        FROM reporting_semd_types
                        WHERE id = $3::uuid AND is_active = TRUE
                    )
                END AS "semdTypeExists";
            `,
            [
                options.periodId,
                options.organizationOid,
                options.semdTypeId ?? null,
            ],
        )
        const entities = entityResult.rows[0]
        if (!entities?.periodExists) {
            throw new NotFoundException('Отчетный период не найден')
        }
        if (!entities?.organizationExists) {
            throw new NotFoundException(
                'Медицинская организация не найдена',
            )
        }
        if (!entities?.semdTypeExists) {
            throw new NotFoundException('Вид СЭМД не найден')
        }

        const result = await this.pool.query(
            `
            WITH latest AS (
                SELECT DISTINCT ON (period_id, organization_oid, semd_type_id)
                       id
                FROM reporting_organization_semd_requirement_overrides
                WHERE period_id = $1
                  AND organization_oid = $2
                  AND (
                      $3::uuid IS NULL
                      OR semd_type_id = $3::uuid
                  )
                ORDER BY
                    period_id,
                    organization_oid,
                    semd_type_id,
                    created_at DESC,
                    id DESC
            )
            SELECT row.id::text AS id,
                   row.period_id::text AS "periodId",
                   row.organization_oid AS "organizationOid",
                   semd.id::text AS "semdTypeId",
                   semd.nsi_oid AS "nsiTypeCode",
                   semd.name AS "semdTypeName",
                   row.requirement_status AS "requirementStatus",
                   row.reason,
                   row.created_at AS "createdAt",
                   COALESCE(users.login, 'пользователь') AS "createdBy",
                   (latest.id IS NOT NULL) AS "isCurrent"
            FROM reporting_organization_semd_requirement_overrides row
            JOIN reporting_semd_types semd ON semd.id = row.semd_type_id
            LEFT JOIN users ON users.id = row.created_by
            LEFT JOIN latest ON latest.id = row.id
            WHERE row.period_id = $1
              AND row.organization_oid = $2
              AND (
                  $3::uuid IS NULL
                  OR row.semd_type_id = $3::uuid
              )
            ORDER BY row.created_at DESC, row.id DESC;
            `,
            [
                options.periodId,
                options.organizationOid,
                options.semdTypeId ?? null,
            ],
        )

        return result.rows.map((row) => ({
            id: String(row.id),
            periodId: String(row.periodId),
            organizationOid: String(row.organizationOid),
            semdTypeId: String(row.semdTypeId),
            nsiTypeCode: String(row.nsiTypeCode ?? ''),
            semdTypeName: String(row.semdTypeName),
            requirementStatus:
                row.requirementStatus === 'required'
                || row.requirementStatus === 'not_required'
                    ? row.requirementStatus
                    : null,
            reason: String(row.reason ?? ''),
            createdAt: toIsoString(row.createdAt),
            createdBy: String(row.createdBy ?? 'пользователь'),
            isCurrent: Boolean(row.isCurrent),
        }))
    }

    async getInstitutionDetails(options: {
        periodId: string
        organizationOid: string
    }): Promise<PilotInstitutionDetails> {
        const [periodResult, organizationResult] = await Promise.all([
            this.pool.query(
                `
                SELECT id::text,
                       date_from::text AS "dateFrom",
                       date_to::text AS "dateTo"
                FROM reporting_periods
                WHERE id = $1;
                `,
                [options.periodId],
            ),
            this.pool.query(
                `
                SELECT oid,
                       official_full_name AS "fullName",
                       official_short_name AS "shortName",
                       common_name AS "commonName",
                       address
                FROM reporting_organizations
                WHERE oid = $1
                  AND is_active = TRUE;
                `,
                [options.organizationOid],
            ),
        ])
        const period = periodResult.rows[0]
        if (!period) {
            throw new NotFoundException('Отчетный период не найден')
        }
        const organization = organizationResult.rows[0]
        if (!organization) {
            throw new NotFoundException('Медицинская организация не найдена')
        }
        const reportingDate = String(
            period.dateTo ?? period.dateFrom ?? '',
        ) || null

        const typeResult = await this.pool.query(
            `
            SELECT semd.id::text AS "semdTypeId",
                   semd.nsi_oid AS "nsiTypeCode",
                   semd.official_oid AS "officialOid",
                   semd.official_name_5pr AS "officialName5pr",
                   semd.name,
                   semd.document_format AS "documentFormat",
                   requirement.requirement_status AS "baseRequirementStatus",
                   requirement.gis_available AS "requirementGisAvailable",
                   requirement.reason AS "requirementReason",
                   requirement.source_name AS "requirementSource",
                   requirement.metadata AS "requirementMetadata",
                   manual_override.requirement_status
                       AS "manualRequirementStatus",
                   manual_override.reason AS "manualReason",
                   manual_override.created_at AS "manualCreatedAt",
                   manual_override.created_by AS "manualCreatedBy",
                   COALESCE(fact.document_count, 0)::float8
                       AS "documentCount",
                   -- Р3 (решение от 29.07): тот же каскад, что и в расчёте причин —
                   -- пара МО × вид → справочник МИАЦ → факт РЭМД по региону → «не уточнено».
                   -- Справочник поднят выше факта: явное решение владельца ГИС весомее
                   -- вывода «раз где-то зарегистрирован, значит умеет».
                   CASE
                       WHEN requirement.gis_available IS NOT NULL
                           THEN requirement.gis_available
                       WHEN gis_dir.is_available IS NOT NULL
                           THEN gis_dir.is_available
                       WHEN regional_fact.is_available = TRUE THEN TRUE
                       ELSE NULL
                   END AS "gisAvailable"
            FROM reporting_semd_types semd
            LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS active_version_count,
                       BOOL_OR(version.epgu_available = TRUE)
                           AS epgu_available
                FROM reporting_semd_type_versions version
                WHERE version.semd_type_id = semd.id
                  AND version.metadata->>'source' = 'emd_nsi_csv'
                  AND (
                      $3::date IS NULL
                      OR version.effective_from IS NULL
                      OR version.effective_from <= $3::date
                  )
                  AND (
                      $3::date IS NULL
                      OR version.effective_to IS NULL
                      OR version.effective_to >= $3::date
                  )
            ) version_state ON TRUE
            LEFT JOIN LATERAL (
                SELECT row.requirement_status,
                       row.gis_available,
                       row.reason,
                       row.source_name,
                       row.metadata
                FROM reporting_organization_semd_requirements row
                WHERE row.organization_oid = $2
                  AND row.semd_type_id = semd.id
                  AND (
                      $3::date IS NULL
                      OR row.effective_from <= $3::date
                  )
                  AND (
                      $3::date IS NULL
                      OR row.effective_to IS NULL
                      OR row.effective_to >= $3::date
                  )
                ORDER BY row.effective_from DESC, row.updated_at DESC
                LIMIT 1
            ) requirement ON TRUE
            LEFT JOIN LATERAL (
                SELECT row.requirement_status,
                       row.reason,
                       row.created_at,
                       COALESCE(users.login, 'пользователь') AS created_by
                FROM reporting_organization_semd_requirement_overrides row
                LEFT JOIN users ON users.id = row.created_by
                WHERE row.period_id = $1
                  AND row.organization_oid = $2
                  AND row.semd_type_id = semd.id
                ORDER BY row.created_at DESC, row.id DESC
                LIMIT 1
            ) manual_override ON TRUE
            LEFT JOIN LATERAL (
                SELECT SUM(remd.document_count) AS document_count
                FROM reporting_remd_facts remd
                WHERE remd.period_id = $1
                  AND remd.scope_level = 'organization'
                  AND remd.organization_oid = $2
                  AND remd.semd_type_id = semd.id
            ) fact ON TRUE
            LEFT JOIN LATERAL (
                SELECT TRUE AS is_available
                FROM reporting_remd_facts remd
                WHERE remd.period_id = $1
                  AND remd.semd_type_id = semd.id
                  AND remd.document_count > 0
                LIMIT 1
            ) regional_fact ON TRUE
            LEFT JOIN reporting_semd_gis_availability gis_dir
              ON gis_dir.semd_type_id = semd.id
            WHERE semd.is_active = TRUE
              AND semd.nsi_oid IS NOT NULL
              AND (
                  CASE
                      WHEN semd.epgu_visible_registry IS NOT NULL
                          THEN semd.epgu_visible_registry
                      WHEN $3::date IS NULL THEN semd.epgu_available
                      WHEN version_state.active_version_count > 0
                          THEN version_state.epgu_available
                      ELSE NULL
                  END
              ) = TRUE
            ORDER BY
                CASE
                    WHEN semd.nsi_oid ~ '^[0-9]+$'
                        THEN semd.nsi_oid::bigint
                    ELSE 999999999
                END,
                semd.name;
            `,
            [
                options.periodId,
                options.organizationOid,
                reportingDate,
            ],
        )

        const types = typeResult.rows.map((row) => {
            const baseRequirementStatus: PilotRequirementStatus =
                row.baseRequirementStatus === 'required'
                || row.baseRequirementStatus === 'not_required'
                || row.baseRequirementStatus === 'unknown'
                    ? row.baseRequirementStatus
                    : 'missing'
            const manualRequirementStatus =
                row.manualRequirementStatus === 'required'
                || row.manualRequirementStatus === 'not_required'
                    ? row.manualRequirementStatus
                    : null
            const requirementStatus = resolvePilotRequirementStatus(
                baseRequirementStatus,
                manualRequirementStatus,
            )
            const documentCount = Number(row.documentCount) || 0
            const registered = documentCount > 0
            const gisAvailable =
                row.gisAvailable === null
                || typeof row.gisAvailable === 'undefined'
                    ? null
                    : Boolean(row.gisAvailable)
            const metadata =
                row.requirementMetadata
                && typeof row.requirementMetadata === 'object'
                && !Array.isArray(row.requirementMetadata)
                    ? row.requirementMetadata
                    : {}
            const rawEvidence = Array.isArray(metadata.evidence)
                ? metadata.evidence
                : []
            return {
                semdTypeId: String(row.semdTypeId),
                nsiTypeCode: String(row.nsiTypeCode ?? ''),
                officialOid: row.officialOid ? String(row.officialOid) : null,
                officialName5pr: row.officialName5pr ? String(row.officialName5pr) : null,
                name: String(row.name),
                documentFormat: String(row.documentFormat ?? ''),
                requirementStatus,
                baseRequirementStatus,
                resultStatus: classifyPilotInstitutionSemd({
                    requirementStatus,
                    registered,
                    gisAvailable,
                }),
                documentCount,
                registered,
                gisAvailable,
                requirementReason: manualRequirementStatus
                    ? String(row.manualReason ?? '')
                    : String(row.requirementReason ?? ''),
                requirementSource: manualRequirementStatus
                    ? 'Ручное уточнение'
                    : String(row.requirementSource ?? ''),
                baseRequirementReason: String(
                    row.requirementReason ?? '',
                ),
                baseRequirementSource: String(
                    row.requirementSource ?? '',
                ),
                // Р9: основания обязательности вида для этой МО («Приоритет обязательности»
                // из формы_1). Обычно 1–2; выводятся в колонке «Основание».
                // Наружу отдаём только level и text: рабочая заметка методолога
                // (metadata.grounds[].workingNote) остаётся на сервере для аудита и
                // на клиент не передаётся вовсе.
                requirementGrounds: (Array.isArray(metadata.grounds)
                    ? metadata.grounds
                    : []
                ).flatMap((item: unknown) => {
                    const ground =
                        item && typeof item === 'object' && !Array.isArray(item)
                            ? item as Record<string, unknown>
                            : {}
                    const text = String(ground.text ?? '').trim()
                    if (!text) return []
                    const level = Number(ground.level)
                    return [{
                        level: Number.isFinite(level) ? level : 4,
                        text,
                    }]
                }),
                manualOverride: manualRequirementStatus
                    ? {
                        status: manualRequirementStatus,
                        reason: String(row.manualReason ?? ''),
                        createdAt: toIsoString(
                            row.manualCreatedAt,
                        ),
                        createdBy: String(
                            row.manualCreatedBy ?? 'пользователь',
                        ),
                    }
                    : null,
                evidence: rawEvidence.map((item: unknown) => {
                    const evidence =
                        item
                        && typeof item === 'object'
                        && !Array.isArray(item)
                            ? item as Record<string, unknown>
                            : {}
                    const rowNumber = Number(evidence.rowNumber)
                    const annualValue = Number(evidence.annualValue)
                    return {
                        sheetName: String(evidence.sheetName ?? ''),
                        sheetCode: String(evidence.sheetCode ?? ''),
                        rowNumber: Number.isFinite(rowNumber)
                            ? rowNumber
                            : null,
                        annualValue: Number.isFinite(annualValue)
                            ? annualValue
                            : null,
                        organizationName: String(
                            evidence.organizationName ?? '',
                        ),
                    }
                }),
            }
        }) as PilotInstitutionDetails['types']

        const required = types.filter(
            (type) => type.requirementStatus === 'required',
        )
        const registeredRequiredTypeCount = required.filter(
            (type) => type.registered,
        ).length
        const notRequiredTypeCount = types.filter(
            (type) => type.requirementStatus === 'not_required',
        ).length
        const unknownApplicabilityCount = types.filter(
            (type) =>
                type.requirementStatus === 'unknown'
                || type.requirementStatus === 'missing',
        ).length
        return {
            periodId: options.periodId,
            indicatorId: PILOT_INDICATOR_ID,
            reportingDate,
            organization: {
                oid: String(organization.oid),
                name: String(
                    organization.shortName
                    || organization.commonName
                    || organization.fullName,
                ),
                fullName: String(organization.fullName),
                address: String(organization.address ?? ''),
            },
            summary: {
                totalTypeCount: types.length,
                registeredTypeCount: types.filter(
                    (type) => type.registered,
                ).length,
                knownApplicabilityCount:
                    required.length + notRequiredTypeCount,
                requiredTypeCount: required.length,
                registeredRequiredTypeCount,
                missingRequiredTypeCount:
                    required.length - registeredRequiredTypeCount,
                notRequiredTypeCount,
                unknownApplicabilityCount,
                manualOverrideCount: types.filter(
                    (type) => type.manualOverride !== null,
                ).length,
                coveragePercent: calculatePilotCoverage(
                    registeredRequiredTypeCount,
                    required.length,
                ),
                isPreliminary: unknownApplicabilityCount > 0
                    && required.length > 0,
            },
            types,
        }
    }

    private async saveRegionalValue(
        client: PoolClient,
        periodId: string,
        details: Record<string, unknown> & {
            readiness: PilotCalculationReadiness
            actualTypeCount: number | null
            plannedTypeCount: number | null
            coveragePercent: number | null
        },
        sourceImportId: string | null,
    ): Promise<void> {
        const ready = details.readiness === 'ready'
        const actual = ready ? details.actualTypeCount : null
        // Целевое и на месяц, и на конец года — одно число: показатель накопительный,
        // «35 видов» из Соглашения относится к концу 2026 года. Импорт «Приложения 2»
        // этот показатель не трогает (он auto-managed), и до 20.08.2026 клетка
        // «Целевое на конец года» в выгрузке Н19 оставалась пустой — при открытой
        // развилке «35 или 36» заполнить её было нечем.
        const target = PILOT_TARGET_TYPES
        const deviation = actual === null ? null : actual - target
        const businessStatus = actual === null
            ? 'not_assessed'
            : actual >= target
                ? 'target_met'
                : deviation! <= -10
                    ? 'critical'
                    : 'below_target'
        const sourceName = ready
            ? 'РЭМД + справочник ЭМД/НСИ'
            : 'РЭМД; ожидается справочник ЭМД/НСИ'
        const note = ready
            ? 'Автоматический расчет по уникальным видам СЭМД с признаком доступности на ЕПГУ.'
            : readinessNote(details.readiness)

        await client.query(
            `
            INSERT INTO reporting_indicator_values (
                indicator_id,
                period_id,
                numerator,
                denominator,
                fact_value,
                secondary_value,
                target_value,
                target_year_end_value,
                status,
                deviation_value,
                business_status,
                note,
                source_name,
                calculation_details
            )
            VALUES (
                $1, $2, $3, $4, $3, $5, $6, $6, $7, $8, $9, $10, $11, $12::jsonb
            )
            ON CONFLICT (indicator_id, period_id) DO UPDATE SET
                numerator = EXCLUDED.numerator,
                denominator = EXCLUDED.denominator,
                fact_value = EXCLUDED.fact_value,
                secondary_value = EXCLUDED.secondary_value,
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
            [
                PILOT_INDICATOR_ID,
                periodId,
                actual,
                ready ? details.plannedTypeCount : null,
                ready ? details.coveragePercent : null,
                target,
                ready ? 'calculated' : 'awaiting_data',
                deviation,
                businessStatus,
                note,
                sourceName,
                JSON.stringify({
                    ...details,
                    sourceImportId,
                }),
            ],
        )
    }

    private async saveOrganizationValues(
        client: PoolClient,
        periodId: string,
        organizations: OrganizationRow[],
        calculations: Array<
            PilotCalculationResult['organizations'][number] & {
                details: Record<string, unknown>
                status:
                    | 'awaiting_data'
                    | 'calculated'
                    | 'not_calculated'
                businessStatus:
                    | 'not_assessed'
                    | 'target_met'
                    | 'below_target'
                    | 'critical'
                deviationValue: number | null
            }
        >,
        sourceImportId: string | null,
    ): Promise<void> {
        const activeOids = organizations.map((organization) => organization.oid)
        await client.query(
            `
            DELETE FROM reporting_organization_indicator_values
            WHERE period_id = $1
              AND indicator_id = $2
              AND NOT (organization_oid = ANY($3::text[]));
            `,
            [periodId, PILOT_INDICATOR_ID, activeOids],
        )

        const organizationByOid = new Map(
            organizations.map((organization) => [
                organization.oid,
                organization,
            ]),
        )
        for (const batch of this.chunk(calculations, INSERT_BATCH_SIZE)) {
            const values: unknown[] = []
            const placeholders = batch.map((calculation, index) => {
                const offset = index * 21
                const organization = organizationByOid.get(
                    calculation.organizationOid,
                )!
                values.push(
                    PILOT_INDICATOR_ID,
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
                    calculation.actualTypeCount,
                    calculation.plannedTypeCount,
                    calculation.actualTypeCount,
                    calculation.coveragePercent,
                    calculation.plannedTypeCount,
                    calculation.status,
                    calculation.deviationValue,
                    calculation.businessStatus,
                    calculation.isPreliminary
                        ? 'Предварительный расчет по подтвержденным правилам; применимость видов СЭМД заполнена не полностью'
                        : readinessNote(calculation.readiness),
                    sourceImportId
                        ? 'РЭМД + справочники применимости'
                        : 'Ожидается РЭМД',
                    JSON.stringify({
                        ...calculation.details,
                        sourceImportId,
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

    private async saveFindings(
        client: PoolClient,
        periodId: string,
        sourceImportId: string | null,
        findings: FindingToSave[],
    ): Promise<void> {
        await client.query(
            `
            DELETE FROM reporting_diagnostic_findings
            WHERE period_id = $1
              AND indicator_id = $2;
            `,
            [periodId, PILOT_INDICATOR_ID],
        )

        for (const batch of this.chunk(findings, INSERT_BATCH_SIZE)) {
            const expandedValues: unknown[] = []
            const correctedPlaceholders = batch.map((finding, index) => {
                const offset = index * 11
                expandedValues.push(
                    periodId,
                    PILOT_INDICATOR_ID,
                    finding.organizationOid,
                    finding.semdTypeId,
                    finding.findingCode,
                    finding.severity,
                    finding.cause,
                    finding.responsibilityArea,
                    finding.recommendation,
                    JSON.stringify(finding.evidence),
                    sourceImportId,
                )
                return `(
                    $${offset + 1}, $${offset + 2}, $${offset + 3},
                    $${offset + 4}, $${offset + 5}, $${offset + 6},
                    $${offset + 7}, $${offset + 8}, $${offset + 9},
                    $${offset + 10}::jsonb, $${offset + 11}
                )`
            })
            await client.query(
                `
                INSERT INTO reporting_diagnostic_findings (
                    period_id,
                    indicator_id,
                    organization_oid,
                    semd_type_id,
                    finding_code,
                    severity,
                    cause,
                    responsibility_area,
                    recommendation,
                    evidence,
                    source_import_id
                )
                VALUES ${correctedPlaceholders.join(',')};
                `,
                expandedValues,
            )
        }
    }

    private chunk<T>(items: T[], size: number): T[][] {
        const result: T[][] = []
        for (let index = 0; index < items.length; index += size) {
            result.push(items.slice(index, index + size))
        }
        return result
    }
}
