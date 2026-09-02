import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 21,
        name: 'add_reporting_pilot_indicator_contract',
        upSql: `
        ALTER TABLE reporting_indicators
        ADD COLUMN IF NOT EXISTS value_kind TEXT NOT NULL DEFAULT 'percent',
        ADD COLUMN IF NOT EXISTS calculation_type TEXT NOT NULL DEFAULT 'ratio_percent',
        ADD COLUMN IF NOT EXISTS is_pilot BOOLEAN NOT NULL DEFAULT FALSE;

        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_indicators_value_kind_chk'
            ) THEN
                ALTER TABLE reporting_indicators
                ADD CONSTRAINT reporting_indicators_value_kind_chk
                CHECK (value_kind IN ('count', 'percent', 'count_and_percent'));
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'reporting_indicators_calculation_type_chk'
            ) THEN
                ALTER TABLE reporting_indicators
                ADD CONSTRAINT reporting_indicators_calculation_type_chk
                CHECK (calculation_type IN ('manual', 'ratio_percent', 'semd_type_coverage'));
            END IF;
        END
        $$;

        UPDATE reporting_indicators
        SET value_kind = 'percent',
            calculation_type = 'ratio_percent',
            is_pilot = FALSE
        WHERE id IN (
            'semd_outpatient_epicrisis',
            'semd_preventive_exam',
            'semd_inpatient_discharge',
            'semd_ambulance_call_card',
            'semd_birth_certificate'
        );

        INSERT INTO reporting_indicators (
            id,
            code,
            title,
            unit,
            formula_text,
            numerator_label,
            denominator_label,
            methodology_status,
            is_mvp,
            sort_order,
            metadata,
            value_kind,
            calculation_type,
            is_pilot
        )
        VALUES (
            'semd_types_epgu_coverage',
            '6.1.3.2.7',
            'Количество видов СЭМД, зарегистрированных в РЭМД ЕГИСЗ и доступных гражданам на ЕПГУ',
            'типов СЭМД',
            'Кф — количество уникальных видов СЭМД, зарегистрированных в РЭМД и доступных на ЕПГУ; покрытие = Кф / Кп × 100',
            'Количество фактически зарегистрированных уникальных видов СЭМД, доступных на ЕПГУ',
            'Количество видов СЭМД, которые должны формироваться с учетом применимости к МУ',
            'ready',
            FALSE,
            1,
            '{
                "contextSource": "AXEL_CONTEXT_TRANSFER_2026-07-04",
                "methodologyPage": 66,
                "periodicity": "monthly_cumulative",
                "primaryValueKind": "count",
                "secondaryValueKind": "percent",
                "workingTargetValue": 35,
                "workingTargetUnit": "types",
                "targetInterpretationStatus": "needs_official_confirmation",
                "requiresEpguAvailability": true,
                "requiresInstitutionApplicability": true
            }'::jsonb,
            'count_and_percent',
            'semd_type_coverage',
            TRUE
        )
        ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            title = EXCLUDED.title,
            unit = EXCLUDED.unit,
            formula_text = EXCLUDED.formula_text,
            numerator_label = EXCLUDED.numerator_label,
            denominator_label = EXCLUDED.denominator_label,
            methodology_status = EXCLUDED.methodology_status,
            sort_order = EXCLUDED.sort_order,
            metadata = EXCLUDED.metadata,
            value_kind = EXCLUDED.value_kind,
            calculation_type = EXCLUDED.calculation_type,
            is_pilot = EXCLUDED.is_pilot,
            updated_at = now();

        CREATE UNIQUE INDEX IF NOT EXISTS reporting_indicators_single_pilot_uidx
            ON reporting_indicators(is_pilot)
            WHERE is_pilot = TRUE;
        `,
}
