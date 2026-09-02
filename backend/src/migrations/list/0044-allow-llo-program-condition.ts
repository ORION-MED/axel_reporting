import type { Migration } from '../migration.types'

/**
 * Условие `llo_program` в правилах применимости.
 *
 * Признак «участие МО в обеспечении граждан ЛЛО» добавлен миграцией 0043, код условия —
 * в типах парсера, а перечень допустимых значений в CHECK таблицы правил остался прежним.
 * Из-за этого подтверждение матрицы падало на вставке:
 * `new row for relation "reporting_semd_applicability_rules" violates check constraint
 * "reporting_semd_applicability_rules_condition_chk"`.
 *
 * Перечень значений продублирован в двух местах — в типе `ApplicabilityConditionCode`
 * и здесь. Добавляя новое условие, править надо оба.
 */
export const migration: Migration = {
    id: 44,
    name: 'allow_llo_program_condition',
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
                'custom'
            ));
    END $$;
    `,
}
