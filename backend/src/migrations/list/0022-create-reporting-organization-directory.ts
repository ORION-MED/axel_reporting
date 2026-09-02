import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 22,
        name: 'create_reporting_organization_directory',
        upSql: `
        ALTER TABLE reporting_import_runs
        ALTER COLUMN period_id DROP NOT NULL;

        CREATE TABLE IF NOT EXISTS reporting_organizations (
            oid TEXT PRIMARY KEY,
            official_full_name TEXT NOT NULL,
            official_short_name TEXT NOT NULL DEFAULT '',
            common_name TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '',
            latitude DOUBLE PRECISION,
            longitude DOUBLE PRECISION,
            location_source TEXT NOT NULL DEFAULT '',
            location_precision TEXT NOT NULL DEFAULT 'unknown',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_organizations_oid_chk
                CHECK (btrim(oid) <> ''),
            CONSTRAINT reporting_organizations_name_chk
                CHECK (btrim(official_full_name) <> ''),
            CONSTRAINT reporting_organizations_location_precision_chk
                CHECK (location_precision IN ('exact', 'street', 'locality', 'approximate', 'unknown')),
            CONSTRAINT reporting_organizations_latitude_chk
                CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
            CONSTRAINT reporting_organizations_longitude_chk
                CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
            CONSTRAINT reporting_organizations_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_organizations_active_name_idx
            ON reporting_organizations(is_active, official_short_name);

        CREATE TABLE IF NOT EXISTS reporting_organization_aliases (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL,
            alias_kind TEXT NOT NULL DEFAULT 'source',
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(organization_oid, normalized_alias),
            CONSTRAINT reporting_organization_aliases_alias_chk
                CHECK (btrim(alias) <> '' AND btrim(normalized_alias) <> ''),
            CONSTRAINT reporting_organization_aliases_kind_chk
                CHECK (alias_kind IN ('official_full', 'official_short', 'common', 'source', 'legacy'))
        );

        CREATE INDEX IF NOT EXISTS reporting_organization_aliases_normalized_idx
            ON reporting_organization_aliases(normalized_alias);

        CREATE TABLE IF NOT EXISTS reporting_subdivisions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            source_key TEXT NOT NULL,
            external_oid TEXT,
            name TEXT NOT NULL,
            short_name TEXT NOT NULL DEFAULT '',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(organization_oid, source_key),
            UNIQUE(id, organization_oid),
            CONSTRAINT reporting_subdivisions_source_key_chk
                CHECK (btrim(source_key) <> ''),
            CONSTRAINT reporting_subdivisions_name_chk
                CHECK (btrim(name) <> ''),
            CONSTRAINT reporting_subdivisions_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_subdivisions_organization_active_idx
            ON reporting_subdivisions(organization_oid, is_active);
        CREATE INDEX IF NOT EXISTS reporting_subdivisions_external_oid_idx
            ON reporting_subdivisions(external_oid)
            WHERE external_oid IS NOT NULL AND btrim(external_oid) <> '';
        `,
}
