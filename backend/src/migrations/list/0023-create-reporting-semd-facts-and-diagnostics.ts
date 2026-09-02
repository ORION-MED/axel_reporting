import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 23,
        name: 'create_reporting_semd_facts_and_diagnostics',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_semd_types (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code TEXT NOT NULL UNIQUE,
            nsi_oid TEXT,
            name TEXT NOT NULL,
            document_format TEXT NOT NULL DEFAULT '',
            version_label TEXT NOT NULL DEFAULT '',
            epgu_available BOOLEAN,
            effective_from DATE,
            effective_to DATE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_semd_types_code_chk
                CHECK (btrim(code) <> ''),
            CONSTRAINT reporting_semd_types_name_chk
                CHECK (btrim(name) <> ''),
            CONSTRAINT reporting_semd_types_effective_dates_chk
                CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
            CONSTRAINT reporting_semd_types_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE UNIQUE INDEX IF NOT EXISTS reporting_semd_types_nsi_oid_uidx
            ON reporting_semd_types(nsi_oid)
            WHERE nsi_oid IS NOT NULL AND btrim(nsi_oid) <> '';
        CREATE INDEX IF NOT EXISTS reporting_semd_types_epgu_active_idx
            ON reporting_semd_types(epgu_available, is_active);

        CREATE TABLE IF NOT EXISTS reporting_semd_type_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            version_label TEXT NOT NULL,
            name TEXT NOT NULL,
            document_format TEXT NOT NULL DEFAULT '',
            epgu_available BOOLEAN,
            effective_from DATE,
            effective_to DATE,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(semd_type_id, version_label),
            CONSTRAINT reporting_semd_type_versions_version_chk
                CHECK (btrim(version_label) <> ''),
            CONSTRAINT reporting_semd_type_versions_name_chk
                CHECK (btrim(name) <> ''),
            CONSTRAINT reporting_semd_type_versions_effective_dates_chk
                CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
            CONSTRAINT reporting_semd_type_versions_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_semd_type_versions_effective_idx
            ON reporting_semd_type_versions(semd_type_id, effective_from, effective_to);

        CREATE TABLE IF NOT EXISTS reporting_semd_type_aliases (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL,
            document_format TEXT NOT NULL DEFAULT '',
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(semd_type_id, normalized_alias, document_format),
            CONSTRAINT reporting_semd_type_aliases_alias_chk
                CHECK (btrim(alias) <> '' AND btrim(normalized_alias) <> '')
        );

        CREATE INDEX IF NOT EXISTS reporting_semd_type_aliases_normalized_idx
            ON reporting_semd_type_aliases(normalized_alias);

        CREATE TABLE IF NOT EXISTS reporting_organization_semd_requirements (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_oid TEXT NOT NULL REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            requirement_status TEXT NOT NULL DEFAULT 'unknown',
            gis_available BOOLEAN,
            reason TEXT NOT NULL DEFAULT '',
            source_name TEXT NOT NULL DEFAULT '',
            effective_from DATE NOT NULL DEFAULT DATE '1900-01-01',
            effective_to DATE,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(organization_oid, semd_type_id, effective_from),
            CONSTRAINT reporting_organization_semd_requirements_status_chk
                CHECK (requirement_status IN ('required', 'not_required', 'unknown')),
            CONSTRAINT reporting_organization_semd_requirements_dates_chk
                CHECK (effective_to IS NULL OR effective_to >= effective_from),
            CONSTRAINT reporting_organization_semd_requirements_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_organization_semd_requirements_lookup_idx
            ON reporting_organization_semd_requirements(
                organization_oid,
                requirement_status,
                effective_from,
                effective_to
            );

        CREATE TABLE IF NOT EXISTS reporting_remd_facts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
            scope_level TEXT NOT NULL,
            organization_oid TEXT REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            subdivision_id UUID,
            semd_type_id UUID NOT NULL REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            document_count BIGINT NOT NULL DEFAULT 0,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            source_name TEXT NOT NULL DEFAULT '',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_remd_facts_scope_chk
                CHECK (
                    (scope_level = 'region' AND organization_oid IS NULL AND subdivision_id IS NULL)
                    OR (scope_level = 'organization' AND organization_oid IS NOT NULL AND subdivision_id IS NULL)
                    OR (scope_level = 'subdivision' AND organization_oid IS NOT NULL AND subdivision_id IS NOT NULL)
                ),
            CONSTRAINT reporting_remd_facts_count_chk
                CHECK (document_count >= 0),
            CONSTRAINT reporting_remd_facts_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object'),
            CONSTRAINT reporting_remd_facts_subdivision_organization_fk
                FOREIGN KEY (subdivision_id, organization_oid)
                REFERENCES reporting_subdivisions(id, organization_oid)
                ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS reporting_remd_facts_region_uidx
            ON reporting_remd_facts(period_id, semd_type_id)
            WHERE scope_level = 'region';
        CREATE UNIQUE INDEX IF NOT EXISTS reporting_remd_facts_organization_uidx
            ON reporting_remd_facts(period_id, organization_oid, semd_type_id)
            WHERE scope_level = 'organization';
        CREATE UNIQUE INDEX IF NOT EXISTS reporting_remd_facts_subdivision_uidx
            ON reporting_remd_facts(period_id, subdivision_id, semd_type_id)
            WHERE scope_level = 'subdivision';
        CREATE INDEX IF NOT EXISTS reporting_remd_facts_period_scope_idx
            ON reporting_remd_facts(period_id, scope_level);

        CREATE TABLE IF NOT EXISTS reporting_quality_issues (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id UUID REFERENCES reporting_periods(id) ON DELETE CASCADE,
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE CASCADE,
            entity_type TEXT NOT NULL,
            entity_key TEXT NOT NULL DEFAULT '',
            issue_code TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'warning',
            title TEXT NOT NULL,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'open',
            resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            resolved_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_quality_issues_entity_type_chk
                CHECK (entity_type IN (
                    'import',
                    'organization',
                    'subdivision',
                    'semd_type',
                    'fact',
                    'reconciliation'
                )),
            CONSTRAINT reporting_quality_issues_severity_chk
                CHECK (severity IN ('info', 'warning', 'error')),
            CONSTRAINT reporting_quality_issues_status_chk
                CHECK (status IN ('open', 'ignored', 'resolved')),
            CONSTRAINT reporting_quality_issues_details_chk
                CHECK (jsonb_typeof(details) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_quality_issues_import_status_idx
            ON reporting_quality_issues(source_import_id, status, severity);
        CREATE INDEX IF NOT EXISTS reporting_quality_issues_period_status_idx
            ON reporting_quality_issues(period_id, status, severity);

        CREATE TABLE IF NOT EXISTS reporting_diagnostic_findings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            period_id UUID NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
            indicator_id TEXT NOT NULL REFERENCES reporting_indicators(id) ON DELETE CASCADE,
            organization_oid TEXT REFERENCES reporting_organizations(oid) ON DELETE CASCADE,
            semd_type_id UUID REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            finding_code TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'warning',
            cause TEXT NOT NULL,
            responsibility_area TEXT NOT NULL DEFAULT '',
            recommendation TEXT NOT NULL DEFAULT '',
            evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
            status TEXT NOT NULL DEFAULT 'active',
            source_import_id UUID REFERENCES reporting_import_runs(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT reporting_diagnostic_findings_severity_chk
                CHECK (severity IN ('info', 'warning', 'error')),
            CONSTRAINT reporting_diagnostic_findings_status_chk
                CHECK (status IN ('active', 'resolved', 'not_applicable')),
            CONSTRAINT reporting_diagnostic_findings_evidence_chk
                CHECK (jsonb_typeof(evidence) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_diagnostic_findings_period_indicator_idx
            ON reporting_diagnostic_findings(period_id, indicator_id, severity);
        CREATE INDEX IF NOT EXISTS reporting_diagnostic_findings_organization_idx
            ON reporting_diagnostic_findings(organization_oid, status)
            WHERE organization_oid IS NOT NULL;
        `,
}
