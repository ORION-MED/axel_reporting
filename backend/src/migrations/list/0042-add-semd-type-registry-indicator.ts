import type { Migration } from '../migration.types'

/**
 * Показатель «Виды СЭМД, регистрируемые в РЭМД ЕГИСЗ» — слайд 27 методики
 * от 10.07.2026 (задача Н7.4).
 *
 * **Код временный.** Номера у показателя нет ни в одном присланном перечне;
 * методолог на ВКС 07.08 предложила держать «27» по номеру слайда, до официального
 * номера. Отсюда и `codeStatus: "temporary"` в metadata — чтобы при сверке
 * с федеральным перечнем было видно, что это наша договорённость, а не выписка.
 *
 * Числитель — сколько видов Перечня № 5пр регион реально регистрирует, знаменатель —
 * число видов в самом Перечне (145 в текущей загрузке; берётся из данных, не из
 * константы). Разрез по МО осмыслен: «сколько видов регистрирует эта МО».
 *
 * Точка отката: удаление строки индикатора. Расчёты 6.1.3.2.7 и долей к объёмам ТПГГ
 * не затрагиваются — общего кода нет, таблица фактов только читается.
 */
export const migration: Migration = {
    id: 42,
    name: 'add_semd_type_registry_indicator',
    upSql: `
    DO $$
    BEGIN
        ALTER TABLE reporting_indicators
            DROP CONSTRAINT IF EXISTS reporting_indicators_calculation_type_chk;
        ALTER TABLE reporting_indicators
            ADD CONSTRAINT reporting_indicators_calculation_type_chk
            CHECK (calculation_type IN (
                'manual',
                'ratio_percent',
                'semd_type_coverage',
                'semd_volume_ratio',
                'semd_type_registry'
            ));
    END $$;

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
        'semd_types_remd_registry',
        '27',
        'Виды электронных медицинских документов, которые регистрируются в РЭМД ЕГИСЗ',
        '%',
        '',
        'Количество видов СЭМД Перечня № 5пр, по которым в отчётном периоде '
            || 'зарегистрирован хотя бы один документ',
        'Количество видов СЭМД в Перечне, утверждённом приказом № 5пр',
        'ready',
        TRUE,
        5,
        '{
            "contextSource": "ТЗ методолога от 07.08.2026",
            "methodologySource": "Методики расчёта показателей по цифровизации здравоохранения от 10.07.2026",
            "methodologyPage": 27,
            "periodicity": "monthly_cumulative",
            "codeStatus": "temporary",
            "codeNote": "Официального номера у показателя нет ни в одном перечне. Код 27 взят по номеру слайда методики — временное решение методолога от 07.08.2026, требует подтверждения руководителем проекта.",
            "denominatorSource": "Перечень № 5пр",
            "denominatorScopeNote": "Знаменатель — виды Перечня № 5пр, в которые входят и 36 видов показателя 6.1.3.2.7.",
            "numeratorScopeNote": "Виды, которые регистрируются в РЭМД, но в Перечень № 5пр не входят, в числитель не включаются: иначе доля от 145 видов могла бы превысить 100 %. Их количество показывается отдельной пометкой.",
            "numeratorScopeNoteStatus": "awaiting_methodologist_approval",
            "regionIsNotSumOfOrganizations": true,
            "criticalDeviationPoints": 10
        }'::jsonb,
        'percent',
        'semd_type_registry',
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
