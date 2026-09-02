import {
    BadRequestException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common'
import { Pool } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'

/**
 * Р3: справочник технической реализации видов СЭМД в региональной ГИС (владелец — МИАЦ).
 * Признак региональный, «не уточнено» = отсутствие строки. Пустой справочник эквивалентен
 * прежнему поведению — см. reporting_semd_gis_availability (миграция 0037) и вязку в
 * pilot-indicator-calculation.service.ts.
 */
export interface SemdGisAvailabilityRow {
    semdTypeId: string
    code: string
    nsiTypeCode: string | null
    name: string
    officialName5pr: string | null
    isAvailable: boolean | null
    note: string
    updatedAt: string | null
}

@Injectable()
export class ReportingGisAvailabilityService {
    constructor(@Inject(APP_DB_POOL) private readonly pool: Pool) {}

    async list(): Promise<SemdGisAvailabilityRow[]> {
        const result = await this.pool.query(
            `
            SELECT semd.id::text AS "semdTypeId",
                   semd.code,
                   semd.nsi_oid AS "nsiTypeCode",
                   semd.name,
                   semd.official_name_5pr AS "officialName5pr",
                   gis.is_available AS "isAvailable",
                   COALESCE(gis.note, '') AS note,
                   gis.updated_at::text AS "updatedAt"
            FROM reporting_semd_types semd
            LEFT JOIN reporting_semd_gis_availability gis
                ON gis.semd_type_id = semd.id
            WHERE semd.is_active = TRUE
              AND semd.nsi_oid IS NOT NULL
              AND COALESCE(semd.epgu_visible_registry, semd.epgu_available) = TRUE
            ORDER BY semd.name;
            `,
        )
        return result.rows.map((row) => this.mapRow(row))
    }

    async set(
        semdTypeId: string,
        isAvailable: boolean | null,
        note: string,
        userId: number,
    ): Promise<SemdGisAvailabilityRow> {
        const cleanId = String(semdTypeId || '').trim()
        if (!cleanId) {
            throw new BadRequestException('Укажите вид СЭМД')
        }
        const exists = await this.pool.query(
            `SELECT 1 FROM reporting_semd_types WHERE id = $1;`,
            [cleanId],
        )
        if (!exists.rows[0]) {
            throw new NotFoundException('Вид СЭМД не найден')
        }

        if (isAvailable === null) {
            // «Не уточнено» — убираем явную запись, gisAvailable снова считается по каскаду.
            await this.pool.query(
                `DELETE FROM reporting_semd_gis_availability WHERE semd_type_id = $1;`,
                [cleanId],
            )
        } else {
            await this.pool.query(
                `
                INSERT INTO reporting_semd_gis_availability (
                    semd_type_id, is_available, note, updated_by, updated_at
                )
                VALUES ($1, $2, $3, $4, now())
                ON CONFLICT (semd_type_id) DO UPDATE SET
                    is_available = EXCLUDED.is_available,
                    note = EXCLUDED.note,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = now();
                `,
                [cleanId, isAvailable, String(note ?? '').slice(0, 2000), userId],
            )
        }

        const updated = (await this.list()).find(
            (row) => row.semdTypeId === cleanId,
        )
        if (!updated) {
            throw new NotFoundException('Вид СЭМД не входит в перечень показателя')
        }
        return updated
    }

    private mapRow(row: Record<string, unknown>): SemdGisAvailabilityRow {
        return {
            semdTypeId: String(row.semdTypeId),
            code: String(row.code),
            nsiTypeCode: row.nsiTypeCode ? String(row.nsiTypeCode) : null,
            name: String(row.name),
            officialName5pr: row.officialName5pr
                ? String(row.officialName5pr)
                : null,
            isAvailable:
                row.isAvailable === null || typeof row.isAvailable === 'undefined'
                    ? null
                    : Boolean(row.isAvailable),
            note: String(row.note ?? ''),
            updatedAt: row.updatedAt ? String(row.updatedAt) : null,
        }
    }
}
