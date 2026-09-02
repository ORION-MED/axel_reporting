import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 20,
        name: 'add_reporting_business_status',
        upSql: `
        ALTER TABLE reporting_indicator_values
        ADD COLUMN IF NOT EXISTS deviation_value NUMERIC,
        ADD COLUMN IF NOT EXISTS business_status TEXT NOT NULL DEFAULT 'not_assessed';

        ALTER TABLE reporting_organization_indicator_values
        ADD COLUMN IF NOT EXISTS deviation_value NUMERIC,
        ADD COLUMN IF NOT EXISTS business_status TEXT NOT NULL DEFAULT 'not_assessed';

        ALTER TABLE reporting_import_indicator_snapshots
        ADD COLUMN IF NOT EXISTS deviation_value NUMERIC,
        ADD COLUMN IF NOT EXISTS business_status TEXT NOT NULL DEFAULT 'not_assessed';

        ALTER TABLE reporting_import_organization_snapshots
        ADD COLUMN IF NOT EXISTS deviation_value NUMERIC,
        ADD COLUMN IF NOT EXISTS business_status TEXT NOT NULL DEFAULT 'not_assessed';

        UPDATE reporting_indicators
        SET metadata = jsonb_set(metadata, '{criticalDeviationPoints}', '10'::jsonb, TRUE)
        WHERE NOT (metadata ? 'criticalDeviationPoints');

        UPDATE reporting_indicator_values
        SET deviation_value = CASE
                WHEN fact_value IS NOT NULL AND target_value IS NOT NULL
                    THEN round(fact_value - target_value, 2)
                ELSE NULL
            END,
            business_status = CASE
                WHEN fact_value IS NULL OR target_value IS NULL THEN 'not_assessed'
                WHEN fact_value >= target_value THEN 'target_met'
                WHEN fact_value - target_value <= -10 THEN 'critical'
                ELSE 'below_target'
            END;

        UPDATE reporting_organization_indicator_values
        SET deviation_value = CASE
                WHEN fact_value IS NOT NULL AND target_value IS NOT NULL
                    THEN round(fact_value - target_value, 2)
                ELSE NULL
            END,
            business_status = CASE
                WHEN fact_value IS NULL OR target_value IS NULL THEN 'not_assessed'
                WHEN fact_value >= target_value THEN 'target_met'
                WHEN fact_value - target_value <= -10 THEN 'critical'
                ELSE 'below_target'
            END;

        UPDATE reporting_import_indicator_snapshots
        SET deviation_value = CASE
                WHEN fact_value IS NOT NULL AND target_value IS NOT NULL
                    THEN round(fact_value - target_value, 2)
                ELSE NULL
            END,
            business_status = CASE
                WHEN fact_value IS NULL OR target_value IS NULL THEN 'not_assessed'
                WHEN fact_value >= target_value THEN 'target_met'
                WHEN fact_value - target_value <= -10 THEN 'critical'
                ELSE 'below_target'
            END;

        UPDATE reporting_import_organization_snapshots
        SET deviation_value = CASE
                WHEN fact_value IS NOT NULL AND target_value IS NOT NULL
                    THEN round(fact_value - target_value, 2)
                ELSE NULL
            END,
            business_status = CASE
                WHEN fact_value IS NULL OR target_value IS NULL THEN 'not_assessed'
                WHEN fact_value >= target_value THEN 'target_met'
                WHEN fact_value - target_value <= -10 THEN 'critical'
                ELSE 'below_target'
            END;

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_indicator_values_business_status_chk'
            ) THEN
                ALTER TABLE reporting_indicator_values
                ADD CONSTRAINT reporting_indicator_values_business_status_chk
                CHECK (business_status IN ('not_assessed', 'target_met', 'below_target', 'critical'));
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_organization_values_business_status_chk'
            ) THEN
                ALTER TABLE reporting_organization_indicator_values
                ADD CONSTRAINT reporting_organization_values_business_status_chk
                CHECK (business_status IN ('not_assessed', 'target_met', 'below_target', 'critical'));
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_import_indicator_snapshots_business_status_chk'
            ) THEN
                ALTER TABLE reporting_import_indicator_snapshots
                ADD CONSTRAINT reporting_import_indicator_snapshots_business_status_chk
                CHECK (business_status IN ('not_assessed', 'target_met', 'below_target', 'critical'));
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_import_organization_snapshots_business_status_chk'
            ) THEN
                ALTER TABLE reporting_import_organization_snapshots
                ADD CONSTRAINT reporting_import_organization_snapshots_business_status_chk
                CHECK (business_status IN ('not_assessed', 'target_met', 'below_target', 'critical'));
            END IF;
        END
        $$;
        `,
}
