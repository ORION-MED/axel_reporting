import type { Migration } from '../migration.types'

/**
 * Нормализованные строки новой формы условий обязательности СЭМД.
 * Сама таблица хранит методологический источник для аудита; при подтверждении импорта
 * правила материализуются в reporting_organization_semd_requirements для быстрого расчёта.
 */
export const migration: Migration = {
        id: 36,
        name: 'create_reporting_semd_applicability_rules',
        upSql: `
        CREATE TABLE IF NOT EXISTS reporting_semd_applicability_rules (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            source_import_id UUID NOT NULL
                REFERENCES reporting_import_runs(id) ON DELETE CASCADE,
            semd_type_id UUID NOT NULL
                REFERENCES reporting_semd_types(id) ON DELETE CASCADE,
            semd_type_code TEXT NOT NULL,
            document_name TEXT NOT NULL DEFAULT '',
            requirement_status TEXT NOT NULL,
            subdivision_type TEXT NOT NULL DEFAULT '',
            subdivision_kind TEXT NOT NULL DEFAULT '',
            condition_code TEXT NOT NULL DEFAULT 'none',
            condition_text TEXT NOT NULL DEFAULT '',
            organization_names JSONB NOT NULL DEFAULT '[]'::jsonb,
            comment TEXT NOT NULL DEFAULT '',
            source_row_number INTEGER NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE(source_import_id, source_row_number),
            CONSTRAINT reporting_semd_applicability_rules_status_chk
                CHECK (requirement_status IN ('required', 'not_required', 'unknown')),
            CONSTRAINT reporting_semd_applicability_rules_condition_chk
                CHECK (condition_code IN (
                    'none',
                    'attached_population',
                    'attached_child_population',
                    'license_1080_1',
                    'license_1080_4',
                    'license_1090_4',
                    'license_1090_6',
                    'day_hospital_group',
                    'specialized_organization',
                    'custom'
                )),
            CONSTRAINT reporting_semd_applicability_rules_row_chk
                CHECK (source_row_number > 0),
            CONSTRAINT reporting_semd_applicability_rules_names_chk
                CHECK (jsonb_typeof(organization_names) = 'array'),
            CONSTRAINT reporting_semd_applicability_rules_metadata_chk
                CHECK (jsonb_typeof(metadata) = 'object')
        );

        CREATE INDEX IF NOT EXISTS reporting_semd_applicability_rules_type_idx
            ON reporting_semd_applicability_rules(semd_type_id, requirement_status);
        CREATE INDEX IF NOT EXISTS reporting_semd_applicability_rules_import_idx
            ON reporting_semd_applicability_rules(source_import_id, source_row_number);
        `,
}
