import type { Migration } from '../migration.types'

/**
 * Помесячная роспись объёмов терпрограммы — для знаменателя долей
 * 6.1.3.2.8–6.1.3.2.11.
 *
 * Решение методолога и Николая Ермакова на ВКС 15.08.2026: знаменатель считается
 * не от годового плана, а нарастающим итогом по месяц отчётной даты. Иначе семь
 * месяцев факта делятся на двенадцать месяцев плана, и все четыре показателя
 * оказываются в «критическом отклонении» без всякой на то причины.
 *
 * `annual_value` **сохраняется**: на карточке показываются две цифры —
 * накопительная и годовая в скобках («План на август 3 064 (за год 4 596)»).
 *
 * Пустой объект — законное значение: у листа может не оказаться росписи, тогда
 * расчёт откатывается на годовой план и помечается предварительным. Значения
 * заполняются переимпортом ТПГГ, обратной засыпки нет — в файле роспись есть
 * с самого начала, просто её не читали.
 */
export const migration: Migration = {
    id: 46,
    name: 'add_tpgg_monthly_values',
    upSql: `
    ALTER TABLE reporting_tpgg_plan_values
        ADD COLUMN IF NOT EXISTS monthly_values JSONB NOT NULL DEFAULT '{}'::jsonb;

    ALTER TABLE reporting_tpgg_plan_values
        DROP CONSTRAINT IF EXISTS reporting_tpgg_plan_values_monthly_values_chk;

    ALTER TABLE reporting_tpgg_plan_values
        ADD CONSTRAINT reporting_tpgg_plan_values_monthly_values_chk
            CHECK (jsonb_typeof(monthly_values) = 'object');
    `,
}
