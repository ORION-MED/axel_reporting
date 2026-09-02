import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 14,
        name: 'create_reporting_organization_values',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_organization_indicator_values (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            indicator_id TEXT NOT NULL REFERENCES reporting_indicators(id) ON DELETE CASCADE,
            period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
            organization_oid TEXT NOT NULL,
            organization_name TEXT NOT NULL,
            organization_full_name TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            latitude NUMERIC,
            longitude NUMERIC,
            location_source TEXT NOT NULL DEFAULT '',
            location_precision TEXT NOT NULL DEFAULT 'unknown',
            numerator NUMERIC,
            denominator NUMERIC,
            fact_value NUMERIC,
            target_value NUMERIC,
            status TEXT NOT NULL DEFAULT 'awaiting_data',
            note TEXT NOT NULL DEFAULT '',
            source_name TEXT NOT NULL DEFAULT '',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(indicator_id, period_id, organization_oid),
            CONSTRAINT reporting_organization_indicator_values_status_chk
                CHECK (status IN ('awaiting_data', 'calculated', 'methodology_in_development', 'not_calculated')),
            CONSTRAINT reporting_organization_indicator_values_precision_chk
                CHECK (location_precision IN ('exact', 'street', 'locality', 'approximate', 'unknown'))
        );

        CREATE INDEX IF NOT EXISTS reporting_organization_values_period_indicator_idx
            ON reporting_organization_indicator_values(period_id, indicator_id);
        CREATE INDEX IF NOT EXISTS reporting_organization_values_oid_idx
            ON reporting_organization_indicator_values(organization_oid);
        `,
}
