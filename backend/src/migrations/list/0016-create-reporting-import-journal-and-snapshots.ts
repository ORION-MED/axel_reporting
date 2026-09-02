import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 16,
        name: 'create_reporting_import_journal_and_snapshots',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_import_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
            source_type TEXT NOT NULL DEFAULT 'remd_excel',
            original_filename TEXT NOT NULL,
            object_key TEXT NOT NULL,
            file_sha256 CHAR(64) NOT NULL,
            file_size BIGINT NOT NULL,
            status TEXT NOT NULL DEFAULT 'processing',
            organization_rows INTEGER NOT NULL DEFAULT 0,
            indicator_values_count INTEGER NOT NULL DEFAULT 0,
            organization_values_count INTEGER NOT NULL DEFAULT 0,
            warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            error_message TEXT NOT NULL DEFAULT '',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            completed_at TIMESTAMPTZ,
            CONSTRAINT reporting_import_runs_status_chk
                CHECK (status IN ('processing', 'completed', 'failed')),
            CONSTRAINT reporting_import_runs_file_size_chk
                CHECK (file_size >= 0),
            CONSTRAINT reporting_import_runs_warnings_chk
                CHECK (jsonb_typeof(warnings) = 'array'),
            CONSTRAINT reporting_import_runs_details_chk
                CHECK (jsonb_typeof(details) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_import_runs_period_created_idx
            ON reporting_import_runs(period_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS reporting_import_runs_checksum_idx
            ON reporting_import_runs(file_sha256);

        CREATE TABLE IF NOT EXISTS reporting_import_indicator_snapshots (
            import_id UUID NOT NULL REFERENCES reporting_import_runs(id) ON DELETE CASCADE,
            indicator_id TEXT NOT NULL REFERENCES reporting_indicators(id) ON DELETE CASCADE,
            numerator NUMERIC,
            denominator NUMERIC,
            fact_value NUMERIC,
            target_value NUMERIC,
            status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            source_name TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(import_id, indicator_id),
            CONSTRAINT reporting_import_indicator_snapshots_status_chk
                CHECK (status IN ('awaiting_data', 'calculated', 'methodology_in_development', 'not_calculated'))
        );

        CREATE TABLE IF NOT EXISTS reporting_import_organization_snapshots (
            import_id UUID NOT NULL REFERENCES reporting_import_runs(id) ON DELETE CASCADE,
            indicator_id TEXT NOT NULL REFERENCES reporting_indicators(id) ON DELETE CASCADE,
            organization_oid TEXT NOT NULL,
            organization_name TEXT NOT NULL,
            organization_full_name TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            location_source TEXT NOT NULL DEFAULT '',
            location_precision TEXT NOT NULL DEFAULT 'unknown',
            numerator NUMERIC,
            denominator NUMERIC,
            fact_value NUMERIC,
            target_value NUMERIC,
            status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            source_name TEXT NOT NULL DEFAULT '',
            PRIMARY KEY(import_id, indicator_id, organization_oid),
            CONSTRAINT reporting_import_organization_snapshots_status_chk
                CHECK (status IN ('awaiting_data', 'calculated', 'methodology_in_development', 'not_calculated')),
            CONSTRAINT reporting_import_organization_snapshots_precision_chk
                CHECK (location_precision IN ('exact', 'street', 'locality', 'approximate', 'unknown'))
        );

        CREATE INDEX IF NOT EXISTS reporting_import_organization_snapshots_import_indicator_idx
            ON reporting_import_organization_snapshots(import_id, indicator_id);
        `,
}
