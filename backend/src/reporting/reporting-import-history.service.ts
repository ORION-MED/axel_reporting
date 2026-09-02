import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool } from 'pg'
import type { Readable } from 'stream'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import type { LocationPrecision } from './organization-geo'
import { ReportingPeriodsService } from './reporting-periods.service'
import {
    cleanText,
    toBusinessStatus,
    toIsoString,
    toLocationPrecision,
    toNullableNumber,
    type ReportingBusinessStatus,
    type ReportingImportMode,
} from './reporting-format.util'

type ReportingImportStatus =
    | 'previewed'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'cancelled'

export interface ReportingImportRun {
    id: string
    periodId: string
    periodName: string
    sourceType: string
    importMode: ReportingImportMode
    originalFilename: string
    fileSha256: string
    fileSize: number
    status: ReportingImportStatus
    organizationRows: number
    indicatorValuesCount: number
    organizationValuesCount: number
    warnings: string[]
    details: Record<string, unknown>
    errorMessage: string
    createdBy: number | null
    createdAt: string
    completedAt: string | null
}

export interface ReportingImportSnapshot {
    importRun: ReportingImportRun
    values: Array<{
        indicatorId: string
        numerator: number | null
        denominator: number | null
        factValue: number | null
        targetValue: number | null
        status: string
        deviationValue: number | null
        businessStatus: ReportingBusinessStatus
        note: string
        sourceName: string
    }>
    organizations: Array<{
        indicatorId: string
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
        targetValue: number | null
        status: string
        deviationValue: number | null
        businessStatus: ReportingBusinessStatus
        note: string
        sourceName: string
    }>
}

@Injectable()
export class ReportingImportHistoryService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
        private readonly periods: ReportingPeriodsService,
    ) {}

    async listImports(periodId?: string): Promise<ReportingImportRun[]> {
        const cleanPeriodId = cleanText(periodId, 80)
        if (cleanPeriodId) {
            await this.periods.ensurePeriodExists(cleanPeriodId)
        }

        const params: unknown[] = []
        const where = cleanPeriodId
            ? 'WHERE run.period_id = $1'
            : ''
        if (cleanPeriodId) params.push(cleanPeriodId)

        const res = await this.pool.query(
            `
            SELECT run.id::text,
                   run.period_id::text AS "periodId",
                   period.name AS "periodName",
                   run.source_type AS "sourceType",
                   run.import_mode AS "importMode",
                   run.original_filename AS "originalFilename",
                   run.file_sha256 AS "fileSha256",
                   run.file_size::float8 AS "fileSize",
                   run.status,
                   run.organization_rows AS "organizationRows",
                   run.indicator_values_count AS "indicatorValuesCount",
                   run.organization_values_count AS "organizationValuesCount",
                   run.warnings,
                   run.details,
                   run.error_message AS "errorMessage",
                   run.created_by AS "createdBy",
                   run.created_at AS "createdAt",
                   run.completed_at AS "completedAt"
            FROM reporting_import_runs run
            JOIN reporting_periods period ON period.id = run.period_id
            ${where}
            ORDER BY run.created_at DESC
            LIMIT 100;
            `,
            params,
        )

        return res.rows.map((row) => this.mapImportRun(row))
    }

    async getImportRun(id: string): Promise<ReportingImportRun> {
        const res = await this.pool.query(
            `
            SELECT run.id::text,
                   run.period_id::text AS "periodId",
                   period.name AS "periodName",
                   run.source_type AS "sourceType",
                   run.import_mode AS "importMode",
                   run.original_filename AS "originalFilename",
                   run.file_sha256 AS "fileSha256",
                   run.file_size::float8 AS "fileSize",
                   run.status,
                   run.organization_rows AS "organizationRows",
                   run.indicator_values_count AS "indicatorValuesCount",
                   run.organization_values_count AS "organizationValuesCount",
                   run.warnings,
                   run.details,
                   run.error_message AS "errorMessage",
                   run.created_by AS "createdBy",
                   run.created_at AS "createdAt",
                   run.completed_at AS "completedAt"
            FROM reporting_import_runs run
            JOIN reporting_periods period ON period.id = run.period_id
            WHERE run.id = $1;
            `,
            [id],
        )
        if (!res.rows[0]) {
            throw new NotFoundException('Импорт отчетности не найден')
        }
        return this.mapImportRun(res.rows[0])
    }

    async getImportSnapshot(importId: string): Promise<ReportingImportSnapshot> {
        const importRun = await this.getImportRun(importId)
        const [valuesRes, organizationsRes] = await Promise.all([
            this.pool.query(
                `
                SELECT indicator_id AS "indicatorId",
                       numerator::float8 AS numerator,
                       denominator::float8 AS denominator,
                       fact_value::float8 AS "factValue",
                       target_value::float8 AS "targetValue",
                       status,
                       deviation_value::float8 AS "deviationValue",
                       business_status AS "businessStatus",
                       note,
                       source_name AS "sourceName"
                FROM reporting_import_indicator_snapshots
                WHERE import_id = $1
                ORDER BY indicator_id;
                `,
                [importId],
            ),
            this.pool.query(
                `
                SELECT indicator_id AS "indicatorId",
                       organization_oid AS "organizationOid",
                       organization_name AS "organizationName",
                       organization_full_name AS "organizationFullName",
                       address,
                       latitude::float8 AS latitude,
                       longitude::float8 AS longitude,
                       location_source AS "locationSource",
                       location_precision AS "locationPrecision",
                       numerator::float8 AS numerator,
                       denominator::float8 AS denominator,
                       fact_value::float8 AS "factValue",
                       target_value::float8 AS "targetValue",
                       status,
                       deviation_value::float8 AS "deviationValue",
                       business_status AS "businessStatus",
                       note,
                       source_name AS "sourceName"
                FROM reporting_import_organization_snapshots
                WHERE import_id = $1
                ORDER BY indicator_id, organization_name;
                `,
                [importId],
            ),
        ])

        return {
            importRun,
            values: valuesRes.rows.map((row) => ({
                indicatorId: row.indicatorId,
                numerator: toNullableNumber(row.numerator),
                denominator: toNullableNumber(row.denominator),
                factValue: toNullableNumber(row.factValue),
                targetValue: toNullableNumber(row.targetValue),
                status: row.status,
                deviationValue: toNullableNumber(row.deviationValue),
                businessStatus: toBusinessStatus(row.businessStatus),
                note: row.note ?? '',
                sourceName: row.sourceName ?? '',
            })),
            organizations: organizationsRes.rows.map((row) => ({
                indicatorId: row.indicatorId,
                organizationOid: row.organizationOid,
                organizationName: row.organizationName,
                organizationFullName: row.organizationFullName ?? '',
                address: row.address ?? '',
                latitude: toNullableNumber(row.latitude),
                longitude: toNullableNumber(row.longitude),
                locationSource: row.locationSource ?? '',
                locationPrecision: toLocationPrecision(row.locationPrecision),
                numerator: toNullableNumber(row.numerator),
                denominator: toNullableNumber(row.denominator),
                factValue: toNullableNumber(row.factValue),
                targetValue: toNullableNumber(row.targetValue),
                status: row.status,
                deviationValue: toNullableNumber(row.deviationValue),
                businessStatus: toBusinessStatus(row.businessStatus),
                note: row.note ?? '',
                sourceName: row.sourceName ?? '',
            })),
        }
    }

    async getImportSource(importId: string): Promise<{
        stream: Readable
        originalFilename: string
        fileSize: number
    }> {
        const res = await this.pool.query(
            `
            SELECT object_key AS "objectKey",
                   original_filename AS "originalFilename",
                   file_size::float8 AS "fileSize"
            FROM reporting_import_runs
            WHERE id = $1;
            `,
            [importId],
        )
        const row = res.rows[0]
        if (!row) {
            throw new NotFoundException('Импорт отчетности не найден')
        }
        return {
            stream: await this.s3.getObjectStream(row.objectKey),
            originalFilename: row.originalFilename,
            fileSize: Number(row.fileSize),
        }
    }

    private mapImportRun(row: any): ReportingImportRun {
        const details = row.details && typeof row.details === 'object' && !Array.isArray(row.details)
            ? row.details
            : {}
        return {
            id: row.id,
            periodId: row.periodId,
            periodName: row.periodName ?? '',
            sourceType: row.sourceType ?? '',
            importMode: row.importMode === 'replace' ? 'replace' : 'merge',
            originalFilename: row.originalFilename ?? '',
            fileSha256: row.fileSha256 ?? '',
            fileSize: Number(row.fileSize) || 0,
            status: row.status,
            organizationRows: Number(row.organizationRows) || 0,
            indicatorValuesCount: Number(row.indicatorValuesCount) || 0,
            organizationValuesCount: Number(row.organizationValuesCount) || 0,
            warnings: Array.isArray(row.warnings)
                ? row.warnings.map((warning: unknown) => String(warning))
                : [],
            details,
            errorMessage: row.errorMessage ?? '',
            createdBy: row.createdBy === null ? null : Number(row.createdBy),
            createdAt: toIsoString(row.createdAt),
            completedAt: row.completedAt ? toIsoString(row.completedAt) : null,
        }
    }
}
