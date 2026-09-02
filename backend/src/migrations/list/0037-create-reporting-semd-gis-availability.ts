import type { Migration } from '../migration.types'

/**
 * Р3 (ТЗ доработок форма_1, 2026-07-24): справочник технической реализации видов СЭМД
 * в региональной ГИС. Признак региональный (не по МУ) и владеет им МИАЦ. Одна строка на
 * вид СЭМД: is_available = TRUE «реализовано» / FALSE «не реализовано». «Не уточнено» —
 * это отсутствие строки, чтобы не смешивать «нет решения» с явным FALSE.
 *
 * Пустой справочник эквивалентен прежнему поведению: gisAvailable по-прежнему берётся из
 * per-МУ requirement.gis_available и факта РЭМД, а этот справочник подключается только как
 * fallback, когда явного значения нет (см. pilot-indicator-calculation.service.ts).
 */
export const migration: Migration = {
    id: 37,
    name: 'create_reporting_semd_gis_availability',
    upSql: `
    CREATE TABLE IF NOT EXISTS reporting_semd_gis_availability (
        semd_type_id UUID PRIMARY KEY
            REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
        is_available BOOLEAN NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    `,
}
