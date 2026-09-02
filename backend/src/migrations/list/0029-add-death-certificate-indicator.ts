import type { Migration } from '../migration.types'

export const migration: Migration = {
        id: 29,
        name: 'add_death_certificate_indicator',
        upSql: `
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
            'semd_death_certificate',
            '6.1.3.2.13',
            'Доля медицинских свидетельств о смерти, сформированных в форме ЭМД и зарегистрированных в РЭМД ЕГИСЗ',
            '%',
            'Дмссрэмд = Кфмссрэмд / Кпмссагс × 100',
            'Все успешно зарегистрированные СЭМД «Медицинское свидетельство о смерти», «Медицинское свидетельство о перинатальной смерти» (включая бумажные формы)',
            'Акты гражданского состояния о смерти по данным ЕГР ЗАГС с применением критериев методики',
            'ready',
            TRUE,
            55,
            '{
                "contextSource": "Методики расчёта показателей по цифровизации здравоохранения.pdf",
                "methodologyPage": 51,
                "numeratorAggregation": "sum",
                "numeratorGroups": [
                    "Медицинское свидетельство о смерти",
                    "Документ, содержащий сведения медицинского свидетельства о смерти в бумажной форме",
                    "Медицинское свидетельство о перинатальной смерти",
                    "Документ, содержащий сведения медицинского свидетельства о перинатальной смерти в бумажной форме"
                ],
                "denominatorSource": "ЕГР ЗАГС",
                "denominatorFiltersRequired": [
                    "уникальный человек",
                    "дата смерти в отчетном периоде",
                    "регион АГС о смерти = место смерти",
                    "исключить записи МСС без указания МО",
                    "исключить МСС со стоп-словами в поле МО"
                ],
                "periodicity": "monthly_cumulative",
                "annualBasis": "second_half",
                "criticalDeviationPoints": 10
            }'::jsonb,
            'percent',
            'ratio_percent',
            FALSE
        )
        ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            title = EXCLUDED.title,
            unit = EXCLUDED.unit,
            formula_text = EXCLUDED.formula_text,
            numerator_label = EXCLUDED.numerator_label,
            denominator_label = EXCLUDED.denominator_label,
            methodology_status = EXCLUDED.methodology_status,
            is_mvp = EXCLUDED.is_mvp,
            sort_order = EXCLUDED.sort_order,
            metadata = EXCLUDED.metadata,
            value_kind = EXCLUDED.value_kind,
            calculation_type = EXCLUDED.calculation_type,
            is_pilot = EXCLUDED.is_pilot,
            updated_at = now();
        `,
}
