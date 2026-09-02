import type { Migration } from '../migration.types'

/**
 * Целевое значение на конец года — вторая цифра рядом с месячным.
 *
 * Повод — ВКС 15.08.2026 (00:12:47): методолог увидела на карточке «Целевое
 * значение 70 %» и спросила, почему не 95. Разобрались: 70 — это план **на август**
 * из «Приложения 2», а 95 % — на конец 2026 года. Система показывала правильное
 * число, но без подписи оно читается как чужое.
 *
 * Годовое значение в «Приложении 2» есть всегда (колонка «На конец 2026 года»),
 * а до сих пор оно использовалось только как запасное, когда месячного нет
 * (`target-plan-import.service.ts`), и нигде не сохранялось.
 *
 * Оценка выполнения по-прежнему считается по **месячному** значению: мониторим
 * состояние на текущий момент, а не итог года. Годовое — только подпись.
 */
export const migration: Migration = {
    id: 47,
    name: 'add_target_year_end_value',
    upSql: `
    ALTER TABLE reporting_indicator_values
        ADD COLUMN IF NOT EXISTS target_year_end_value NUMERIC;

    ALTER TABLE reporting_organization_indicator_values
        ADD COLUMN IF NOT EXISTS target_year_end_value NUMERIC;
    `,
}
