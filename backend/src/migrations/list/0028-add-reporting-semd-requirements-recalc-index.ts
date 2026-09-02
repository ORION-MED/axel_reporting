import type { Migration } from '../migration.types'

export const migration: Migration = {
    id: 28,
    name: 'add_reporting_semd_requirements_recalc_index',
    upSql: `
        -- PilotIndicatorCalculationService.recalculate() runs a region-wide
        -- DISTINCT ON (organization_oid, semd_type_id) ... ORDER BY organization_oid,
        -- semd_type_id, effective_from DESC, updated_at DESC over this table with no
        -- equality filter (it needs the current rule for every MU at once). Neither the
        -- existing reporting_organization_semd_requirements_lookup_idx (leads with
        -- requirement_status) nor the UNIQUE(organization_oid, semd_type_id, effective_from)
        -- index (effective_from ascending) matches that sort, so this call forces a full
        -- table scan + sort today. Harmless at 37 organizations; recalculate() is invoked on
        -- every dashboard load, import and manual override, so this index removes the sort
        -- before the row count grows by an order of magnitude.
        CREATE INDEX IF NOT EXISTS reporting_organization_semd_requirements_recalc_idx
            ON reporting_organization_semd_requirements(
                organization_oid,
                semd_type_id,
                effective_from DESC,
                updated_at DESC
            );
    `,
}
