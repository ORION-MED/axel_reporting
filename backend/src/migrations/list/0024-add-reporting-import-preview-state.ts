import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 24,
        name: 'add_reporting_import_preview_state',
        upSql: `
        ALTER TABLE reporting_import_runs
        DROP CONSTRAINT IF EXISTS reporting_import_runs_status_chk;

        ALTER TABLE reporting_import_runs
        ADD CONSTRAINT reporting_import_runs_status_chk
        CHECK (status IN ('previewed', 'processing', 'completed', 'failed', 'cancelled'));

        ALTER TABLE reporting_import_runs
        ADD COLUMN IF NOT EXISTS preview_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

        CREATE INDEX IF NOT EXISTS reporting_import_runs_preview_status_idx
            ON reporting_import_runs(status, preview_expires_at)
            WHERE status = 'previewed';
        `,
}
