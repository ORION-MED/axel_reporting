import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 18,
        name: 'add_reporting_import_mode',
        upSql: `
        ALTER TABLE reporting_import_runs
        ADD COLUMN IF NOT EXISTS import_mode TEXT NOT NULL DEFAULT 'merge';

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'reporting_import_runs_mode_chk'
            ) THEN
                ALTER TABLE reporting_import_runs
                ADD CONSTRAINT reporting_import_runs_mode_chk
                CHECK (import_mode IN ('merge', 'replace'));
            END IF;
        END
        $$;
        `,
}
