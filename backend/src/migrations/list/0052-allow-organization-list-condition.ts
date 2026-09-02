import type { Migration } from '../migration.types'

/**
 * Условие `organization_list` — перечень МО, которым вид обязателен
 * («если МО - КООД», «если МО - Бюро СМЭ»).
 *
 * Зеркало `organization_list_except` из миграции 0050: там членство в перечне
 * снимает обязательность, здесь даёт. Появился вместе с флагом
 * `CONDITIONAL_STATUS_IS_REQUIRED`: пока «условно» читается как «не определено»,
 * адресата у таких правил нет и код не используется.
 *
 * Миграция нужна независимо от значения флага — иначе включение флага уронит
 * подтверждение матрицы на вставке, как это было 14.08.2026 с `llo_program`.
 * Перечень значений продублирован в `APPLICABILITY_CONDITION_CODES`;
 * синхронность держит тест `applicability-condition-codes.spec.ts`.
 */
export const migration: Migration = {
    id: 52,
    name: 'allow_organization_list_condition',
    upSql: `
    DO $$
    BEGIN
        ALTER TABLE reporting_semd_applicability_rules
            DROP CONSTRAINT IF EXISTS reporting_semd_applicability_rules_condition_chk;
        ALTER TABLE reporting_semd_applicability_rules
            ADD CONSTRAINT reporting_semd_applicability_rules_condition_chk
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
                'llo_program',
                'organization_list',
                'organization_list_except',
                'custom'
            ));
    END $$;
    `,
}
