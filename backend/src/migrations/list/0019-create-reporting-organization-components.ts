import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 19,
        name: 'create_reporting_organization_components',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_organization_indicator_components (
            indicator_id TEXT NOT NULL REFERENCES reporting_indicators(id) ON DELETE CASCADE,
            period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
            organization_oid TEXT NOT NULL,
            component_key TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'remd_excel',
            value NUMERIC NOT NULL DEFAULT 0,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (
                indicator_id,
                period_id,
                organization_oid,
                component_key,
                source_type
            ),
            CONSTRAINT reporting_organization_components_value_chk
                CHECK (value >= 0)
        );

        CREATE INDEX IF NOT EXISTS reporting_organization_components_period_indicator_idx
            ON reporting_organization_indicator_components(period_id, indicator_id);
        `,
}
