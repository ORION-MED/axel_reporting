import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 25,
        name: 'add_pilot_indicator_calculation_details',
        upSql: `
        ALTER TABLE reporting_indicator_values
        ADD COLUMN IF NOT EXISTS secondary_value NUMERIC,
        ADD COLUMN IF NOT EXISTS calculation_details JSONB NOT NULL DEFAULT '{}'::jsonb;

        ALTER TABLE reporting_organization_indicator_values
        ADD COLUMN IF NOT EXISTS secondary_value NUMERIC,
        ADD COLUMN IF NOT EXISTS calculation_details JSONB NOT NULL DEFAULT '{}'::jsonb;

        ALTER TABLE reporting_import_indicator_snapshots
        ADD COLUMN IF NOT EXISTS secondary_value NUMERIC,
        ADD COLUMN IF NOT EXISTS calculation_details JSONB NOT NULL DEFAULT '{}'::jsonb;

        ALTER TABLE reporting_import_organization_snapshots
        ADD COLUMN IF NOT EXISTS secondary_value NUMERIC,
        ADD COLUMN IF NOT EXISTS calculation_details JSONB NOT NULL DEFAULT '{}'::jsonb;

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_indicator_values_calculation_details_chk'
            ) THEN
                ALTER TABLE reporting_indicator_values
                ADD CONSTRAINT reporting_indicator_values_calculation_details_chk
                CHECK (jsonb_typeof(calculation_details) = 'object');
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_organization_values_calculation_details_chk'
            ) THEN
                ALTER TABLE reporting_organization_indicator_values
                ADD CONSTRAINT reporting_organization_values_calculation_details_chk
                CHECK (jsonb_typeof(calculation_details) = 'object');
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_import_indicator_snapshots_calculation_details_chk'
            ) THEN
                ALTER TABLE reporting_import_indicator_snapshots
                ADD CONSTRAINT reporting_import_indicator_snapshots_calculation_details_chk
                CHECK (jsonb_typeof(calculation_details) = 'object');
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_import_organization_snapshots_calculation_details_chk'
            ) THEN
                ALTER TABLE reporting_import_organization_snapshots
                ADD CONSTRAINT reporting_import_organization_snapshots_calculation_details_chk
                CHECK (jsonb_typeof(calculation_details) = 'object');
            END IF;
        END
        $$;

        UPDATE reporting_indicators
        SET title = 'Количество видов электронных медицинских документов, зарегистрированных в РЭМД ЕГИСЗ и доступных гражданам на ЕПГУ',
            formula_text = 'Кф — количество уникальных видов СЭМД, зарегистрированных в РЭМД и доступных на ЕПГУ; контрольное покрытие Д = Кф / Кп × 100',
            numerator_label = 'Фактически зарегистрированные уникальные виды СЭМД с признаком «Доступен на ЕПГУ»',
            denominator_label = 'Виды СЭМД с признаком «Доступен на ЕПГУ» по справочнику ЭМД/НСИ',
            is_mvp = TRUE,
            metadata = metadata || '{
                "denominatorSource": "Справочник ЭМД/НСИ",
                "workingTargetValue": 35,
                "workingTargetUnit": "types",
                "targetInterpretationStatus": "confirmed_2026_plan",
                "targetSource": "Прил 2_Помесячный План достижения показателей в 2026 (1).xlsx",
                "targetSourceRow": 31,
                "criticalDeviationTypes": 10,
                "diagnosticDimensions": [
                    "institution_applicability",
                    "regional_gis_availability",
                    "actual_remd_registration"
                ]
            }'::jsonb,
            updated_at = now()
        WHERE id = 'semd_types_epgu_coverage';
        `,
}
