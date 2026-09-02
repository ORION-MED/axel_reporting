import type { Migration } from '../migration.types'

/**
 * ТЗ 6.1.3.2.7 (delta 2026-07-17), п.1 — структурные подразделения из ФРМР как master-data.
 * Отдельная таблица от `reporting_subdivisions` (той пользуется широкоформатный импортёр РЭМД,
 * там подразделения транзакционные, привязаны к фактам). Здесь — справочник подразделений МУ
 * с классификацией (тип/вид) из ФРМР, нужный для матрицы применимости по подразделениям (п.3).
 */
export const migration: Migration = {
        id: 34,
        name: 'create_reporting_organization_subdivisions',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_organization_subdivisions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            subdivision_oid TEXT NOT NULL UNIQUE,
            subdivision_type TEXT NOT NULL DEFAULT '',
            subdivision_kind TEXT NOT NULL DEFAULT '',
            subdivision_name TEXT NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            effective_from DATE,
            effective_to DATE,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_org_subdivisions_subdivision_oid_chk
                CHECK (btrim(subdivision_oid) <> ''),
            CONSTRAINT reporting_org_subdivisions_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_org_subdivisions_org_idx
            ON reporting_organization_subdivisions(organization_oid);
        CREATE INDEX IF NOT EXISTS reporting_org_subdivisions_kind_idx
            ON reporting_organization_subdivisions(subdivision_kind);
        CREATE INDEX IF NOT EXISTS reporting_org_subdivisions_type_idx
            ON reporting_organization_subdivisions(subdivision_type);
        `,
}
