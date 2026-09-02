import type { Migration } from '../migration.types'

/**
 * ТЗ 6.1.3.2.7 (delta 2026-07-17), п.2 — привязка факта числителя к подразделению по «OID СП МО».
 * Отдельная таблица разбивки, чтобы НЕ трогать `reporting_remd_facts` (там факт агрегируется до
 * уровня организации — этот расчёт показателя менять нельзя). Здесь хранится более тонкая
 * разбивка «факт по подразделению» — для матрицы применимости и диагностики. subdivision_oid —
 * простой TEXT, без FK: ~9% строк числителя не находят подразделение в ФРМР («подразделение
 * неизвестно»), их нельзя терять.
 */
export const migration: Migration = {
        id: 35,
        name: 'create_reporting_remd_subdivision_facts',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_remd_subdivision_facts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
            organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            subdivision_oid TEXT,
            subdivision_name TEXT NOT NULL DEFAULT '',
            semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            document_count BIGINT NOT NULL DEFAULT 0,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            source_name TEXT NOT NULL DEFAULT '',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_remd_subdivision_facts_count_chk
                CHECK (document_count >= 0),
            CONSTRAINT reporting_remd_subdivision_facts_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE UNIQUE INDEX IF NOT EXISTS reporting_remd_subdivision_facts_uidx
            ON reporting_remd_subdivision_facts(
                period_id,
                organization_oid,
                COALESCE(subdivision_oid, ''),
                semd_type_id
            );
        CREATE INDEX IF NOT EXISTS reporting_remd_subdivision_facts_period_org_idx
            ON reporting_remd_subdivision_facts(period_id, organization_oid);
        CREATE INDEX IF NOT EXISTS reporting_remd_subdivision_facts_subdivision_idx
            ON reporting_remd_subdivision_facts(subdivision_oid)
            WHERE subdivision_oid IS NOT NULL;
        `,
}
