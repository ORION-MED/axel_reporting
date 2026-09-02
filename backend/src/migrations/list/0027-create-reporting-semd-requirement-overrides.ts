import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 27,
        name: 'create_reporting_semd_requirement_overrides',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_organization_semd_requirement_overrides (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id UUID NOT NULL
                REFERENCES reporting_periods(id) ON DELETE CASCADE,
            organization_oid TEXT NOT NULL
                REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            semd_type_id UUID NOT NULL
                REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            requirement_status TEXT,
            reason TEXT NOT NULL,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_organization_semd_requirement_overrides_status_chk
                CHECK (
                    requirement_status IS NULL
                    OR requirement_status IN ('required', 'not_required')
                ),
            CONSTRAINT reporting_organization_semd_requirement_overrides_reason_chk
                CHECK (btrim(reason) <> '')
        );

        CREATE INDEX IF NOT EXISTS reporting_semd_requirement_overrides_lookup_idx
            ON reporting_organization_semd_requirement_overrides(
                period_id,
                organization_oid,
                semd_type_id,
                created_at DESC
            );
        `,
}
