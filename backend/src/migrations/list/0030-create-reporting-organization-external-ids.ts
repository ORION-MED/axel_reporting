import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 30,
        name: 'create_reporting_organization_external_ids',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_organization_external_ids (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            system TEXT NOT NULL,
            external_id TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(system, external_id),
            CONSTRAINT reporting_organization_external_ids_system_chk
                CHECK (system IN ('фомс', 'фрмо', 'прочее')),
            CONSTRAINT reporting_organization_external_ids_external_id_chk
                CHECK (btrim(external_id) <> '')
        );

        CREATE INDEX IF NOT EXISTS reporting_organization_external_ids_org_idx
            ON reporting_organization_external_ids(organization_oid);
        `,
}
