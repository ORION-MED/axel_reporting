import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 26,
        name: 'create_reporting_tpgg_plan_values',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_tpgg_plan_values (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id UUID NOT NULL
                REFERENCES reporting_periods(id) ON DELETE CASCADE,
            reporting_year INTEGER NOT NULL,
            organization_oid TEXT
                REFERENCES reporting_organizations(oid) ON DELETE SET NULL,
            organization_name TEXT NOT NULL,
            normalized_organization_name TEXT NOT NULL,
            sheet_name TEXT NOT NULL,
            sheet_code TEXT NOT NULL DEFAULT '',
            annual_value NUMERIC NOT NULL,
            source_row_number INTEGER NOT NULL,
            source_import_id UUID NOT NULL
                REFERENCES reporting_import_runs(id) ON DELETE CASCADE,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(source_import_id, sheet_name, source_row_number),
            CONSTRAINT reporting_tpgg_plan_values_year_chk
                CHECK (reporting_year BETWEEN 2000 AND 2100),
            CONSTRAINT reporting_tpgg_plan_values_name_chk
                CHECK (
                    btrim(organization_name) <> ''
                    AND btrim(normalized_organization_name) <> ''
                    AND btrim(sheet_name) <> ''
                ),
            CONSTRAINT reporting_tpgg_plan_values_annual_value_chk
                CHECK (annual_value >= 0),
            CONSTRAINT reporting_tpgg_plan_values_source_row_chk
                CHECK (source_row_number > 0),
            CONSTRAINT reporting_tpgg_plan_values_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_tpgg_plan_values_period_idx
            ON reporting_tpgg_plan_values(
                period_id,
                reporting_year,
                organization_oid
            );
        CREATE INDEX IF NOT EXISTS reporting_tpgg_plan_values_section_idx
            ON reporting_tpgg_plan_values(
                reporting_year,
                sheet_code,
                organization_oid
            );
        CREATE INDEX IF NOT EXISTS reporting_tpgg_plan_values_unmatched_idx
            ON reporting_tpgg_plan_values(
                source_import_id,
                normalized_organization_name
            )
            WHERE organization_oid IS NULL;
        `,
}
