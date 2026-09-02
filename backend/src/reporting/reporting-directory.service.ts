import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import {
    ReportingOrganization,
    ReportingOrganizationExternalId,
    ReportingOrganizationExternalIdSystem,
    ReportingPilotIndicatorContract,
    ReportingSemdType,
} from './reporting-domain.types'

const EXTERNAL_ID_SYSTEMS: ReportingOrganizationExternalIdSystem[] = ['фомс', 'фрмо', 'прочее']

export interface UpdateOrganizationDto {
    officialFullName?: string
    officialShortName?: string
    commonName?: string
    address?: string
    latitude?: number | string | null
    longitude?: number | string | null
    locationPrecision?: string
    isActive?: boolean
}

export interface CreateExternalIdDto {
    system: string
    externalId: string
    note?: string
}

@Injectable()
export class ReportingDirectoryService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async getPilotIndicatorContract(): Promise<ReportingPilotIndicatorContract> {
        const result = await this.pool.query(`
            SELECT id,
                   code,
                   title,
                   unit,
                   value_kind AS "valueKind",
                   calculation_type AS "calculationType",
                   metadata
            FROM reporting_indicators
            WHERE is_pilot = TRUE
            LIMIT 1;
        `)
        const row = result.rows[0]
        if (!row) {
            throw new NotFoundException('Пилотный показатель не настроен')
        }

        return {
            id: String(row.id),
            code: String(row.code),
            title: String(row.title),
            unit: String(row.unit),
            valueKind: row.valueKind,
            calculationType: row.calculationType,
            metadata: this.mapMetadata(row.metadata),
        }
    }

    async listOrganizations(includeInactive = false): Promise<ReportingOrganization[]> {
        const result = await this.pool.query(
            `
            SELECT oid,
                   official_full_name AS "officialFullName",
                   official_short_name AS "officialShortName",
                   common_name AS "commonName",
                   address,
                   latitude,
                   longitude,
                   location_source AS "locationSource",
                   location_precision AS "locationPrecision",
                   activity_type AS "activityType",
                   is_active AS "isActive",
                   source_import_id::text AS "sourceImportId",
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
            FROM reporting_organizations
            WHERE ($1::boolean = TRUE OR is_active = TRUE)
            ORDER BY
                NULLIF(official_short_name, '') ASC NULLS LAST,
                official_full_name ASC,
                oid ASC;
            `,
            [includeInactive],
        )

        return result.rows.map((row) => this.mapOrganization(row))
    }

    async getOrganization(oid: string): Promise<ReportingOrganization> {
        const cleanOid = String(oid || '').trim()
        const result = await this.pool.query(
            `
            SELECT oid,
                   official_full_name AS "officialFullName",
                   official_short_name AS "officialShortName",
                   common_name AS "commonName",
                   address,
                   latitude,
                   longitude,
                   location_source AS "locationSource",
                   location_precision AS "locationPrecision",
                   activity_type AS "activityType",
                   is_active AS "isActive",
                   source_import_id::text AS "sourceImportId",
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
            FROM reporting_organizations
            WHERE oid = $1;
            `,
            [cleanOid],
        )
        const row = result.rows[0]
        if (!row) {
            throw new NotFoundException(`Медицинское учреждение с OID ${cleanOid} не найдено`)
        }
        return this.mapOrganization(row)
    }

    /** Roadmap step 4.2 — master-data organizations, editable via UI instead of the frozen organization-geo.ts file. */
    async updateOrganization(oid: string, patch: UpdateOrganizationDto): Promise<ReportingOrganization> {
        const cleanOid = this.cleanText(oid, 200)
        await this.getOrganization(cleanOid)

        const sets: string[] = []
        const values: unknown[] = [cleanOid]
        const push = (column: string, value: unknown) => {
            values.push(value)
            sets.push(`${column} = $${values.length}`)
        }

        if (patch.officialFullName !== undefined) {
            const value = this.cleanText(patch.officialFullName, 500)
            if (!value) throw new BadRequestException('Официальное наименование не может быть пустым')
            push('official_full_name', value)
        }
        if (patch.officialShortName !== undefined) {
            push('official_short_name', this.cleanText(patch.officialShortName, 300))
        }
        if (patch.commonName !== undefined) {
            push('common_name', this.cleanText(patch.commonName, 300))
        }
        if (patch.isActive !== undefined) {
            push('is_active', Boolean(patch.isActive))
        }

        const touchesLocation = patch.address !== undefined
            || patch.latitude !== undefined
            || patch.longitude !== undefined
            || patch.locationPrecision !== undefined
        if (patch.address !== undefined) {
            push('address', this.cleanText(patch.address, 500))
        }
        if (patch.latitude !== undefined) {
            push('latitude', this.parseCoordinate(patch.latitude, 'Широта', -90, 90))
        }
        if (patch.longitude !== undefined) {
            push('longitude', this.parseCoordinate(patch.longitude, 'Долгота', -180, 180))
        }
        if (patch.locationPrecision !== undefined) {
            const precision = this.cleanText(patch.locationPrecision, 30)
            if (!['exact', 'street', 'locality', 'approximate', 'unknown'].includes(precision)) {
                throw new BadRequestException('Недопустимая точность геолокации')
            }
            push('location_precision', precision)
        }
        if (touchesLocation) {
            push('location_source', 'ручное уточнение (UI)')
        }

        if (sets.length === 0) {
            return this.getOrganization(cleanOid)
        }

        await this.pool.query(
            `UPDATE reporting_organizations SET ${sets.join(', ')}, updated_at = now() WHERE oid = $1;`,
            values,
        )
        return this.getOrganization(cleanOid)
    }

    async listExternalIds(oid: string): Promise<ReportingOrganizationExternalId[]> {
        const cleanOid = this.cleanText(oid, 200)
        const result = await this.pool.query(
            `
            SELECT id::text,
                   organization_oid AS "organizationOid",
                   system,
                   external_id AS "externalId",
                   note,
                   created_by AS "createdBy",
                   created_at AS "createdAt"
            FROM reporting_organization_external_ids
            WHERE organization_oid = $1
            ORDER BY system ASC, external_id ASC;
            `,
            [cleanOid],
        )
        return result.rows.map((row) => this.mapExternalId(row))
    }

    async addExternalId(
        oid: string,
        dto: CreateExternalIdDto,
        userId: number,
    ): Promise<ReportingOrganizationExternalId> {
        const cleanOid = this.cleanText(oid, 200)
        await this.getOrganization(cleanOid)

        const system = this.cleanText(dto.system, 30)
        if (!EXTERNAL_ID_SYSTEMS.includes(system as ReportingOrganizationExternalIdSystem)) {
            throw new BadRequestException(`Система должна быть одной из: ${EXTERNAL_ID_SYSTEMS.join(', ')}`)
        }
        const externalId = this.cleanText(dto.externalId, 200)
        if (!externalId) {
            throw new BadRequestException('Укажите внешний идентификатор')
        }
        const note = this.cleanText(dto.note, 500)

        try {
            const result = await this.pool.query(
                `
                INSERT INTO reporting_organization_external_ids (
                    organization_oid, system, external_id, note, created_by
                )
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id::text,
                          organization_oid AS "organizationOid",
                          system,
                          external_id AS "externalId",
                          note,
                          created_by AS "createdBy",
                          created_at AS "createdAt";
                `,
                [cleanOid, system, externalId, note, userId],
            )
            return this.mapExternalId(result.rows[0])
        } catch (err) {
            if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
                throw new BadRequestException(
                    `Идентификатор «${externalId}» уже сопоставлен другой организации в системе «${system}»`,
                )
            }
            throw err
        }
    }

    async removeExternalId(oid: string, id: string): Promise<void> {
        const cleanOid = this.cleanText(oid, 200)
        const result = await this.pool.query(
            `DELETE FROM reporting_organization_external_ids WHERE id = $1 AND organization_oid = $2;`,
            [this.cleanText(id, 100), cleanOid],
        )
        if (result.rowCount === 0) {
            throw new NotFoundException('Сопоставление не найдено')
        }
    }

    async listSemdTypes(options: {
        includeInactive?: boolean
        epguOnly?: boolean
    } = {}): Promise<ReportingSemdType[]> {
        const result = await this.pool.query(
            `
            SELECT id::text,
                   code,
                   nsi_oid AS "nsiOid",
                   name,
                   document_format AS "documentFormat",
                   version_label AS "versionLabel",
                   epgu_available AS "epguAvailable",
                   effective_from AS "effectiveFrom",
                   effective_to AS "effectiveTo",
                   is_active AS "isActive",
                   source_import_id::text AS "sourceImportId",
                   metadata,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
            FROM reporting_semd_types
            WHERE ($1::boolean = TRUE OR is_active = TRUE)
              AND ($2::boolean = FALSE OR epgu_available = TRUE)
            ORDER BY name ASC, document_format ASC, code ASC;
            `,
            [Boolean(options.includeInactive), Boolean(options.epguOnly)],
        )

        return result.rows.map((row) => this.mapSemdType(row))
    }

    private mapOrganization(row: any): ReportingOrganization {
        return {
            oid: String(row.oid),
            officialFullName: String(row.officialFullName),
            officialShortName: String(row.officialShortName || ''),
            commonName: String(row.commonName || ''),
            address: String(row.address || ''),
            latitude: this.nullableNumber(row.latitude),
            longitude: this.nullableNumber(row.longitude),
            locationSource: String(row.locationSource || ''),
            locationPrecision: row.locationPrecision,
            activityType: row.activityType ? String(row.activityType) : null,
            isActive: Boolean(row.isActive),
            sourceImportId: row.sourceImportId ? String(row.sourceImportId) : null,
            metadata: this.mapMetadata(row.metadata),
            createdAt: this.isoDateTime(row.createdAt),
            updatedAt: this.isoDateTime(row.updatedAt),
        }
    }

    private mapSemdType(row: any): ReportingSemdType {
        return {
            id: String(row.id),
            code: String(row.code),
            nsiOid: row.nsiOid ? String(row.nsiOid) : null,
            name: String(row.name),
            documentFormat: String(row.documentFormat || ''),
            versionLabel: String(row.versionLabel || ''),
            epguAvailable:
                row.epguAvailable === null || typeof row.epguAvailable === 'undefined'
                    ? null
                    : Boolean(row.epguAvailable),
            effectiveFrom: this.dateOnly(row.effectiveFrom),
            effectiveTo: this.dateOnly(row.effectiveTo),
            isActive: Boolean(row.isActive),
            sourceImportId: row.sourceImportId ? String(row.sourceImportId) : null,
            metadata: this.mapMetadata(row.metadata),
            createdAt: this.isoDateTime(row.createdAt),
            updatedAt: this.isoDateTime(row.updatedAt),
        }
    }

    private nullableNumber(value: unknown): number | null {
        if (value === null || typeof value === 'undefined' || value === '') return null
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }

    private dateOnly(value: unknown): string | null {
        if (!value) return null
        if (value instanceof Date) return value.toISOString().slice(0, 10)
        return String(value).slice(0, 10)
    }

    private isoDateTime(value: unknown): string {
        if (value instanceof Date) return value.toISOString()
        return String(value)
    }

    private mapMetadata(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {}
    }

    private mapExternalId(row: any): ReportingOrganizationExternalId {
        return {
            id: String(row.id),
            organizationOid: String(row.organizationOid),
            system: row.system,
            externalId: String(row.externalId),
            note: String(row.note || ''),
            createdBy: row.createdBy === null || typeof row.createdBy === 'undefined'
                ? null
                : Number(row.createdBy),
            createdAt: this.isoDateTime(row.createdAt),
        }
    }

    private parseCoordinate(value: unknown, label: string, min: number, max: number): number | null {
        if (value === null || typeof value === 'undefined' || value === '') return null
        const normalized = typeof value === 'string' ? value.replace(',', '.').trim() : value
        if (normalized === '') return null
        const parsed = Number(normalized)
        if (!Number.isFinite(parsed)) {
            throw new BadRequestException(`${label}: укажите число`)
        }
        if (parsed < min || parsed > max) {
            throw new BadRequestException(`${label}: значение должно быть в диапазоне от ${min} до ${max}`)
        }
        return parsed
    }

    private cleanText(value: unknown, maxLength: number = 1000): string {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    }
}
