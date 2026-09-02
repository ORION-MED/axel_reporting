import type { Migration } from '../migration.types'

/**
 * Условие `organization_list_except` в правилах применимости.
 *
 * В форме от 18.08.2026 методолог ответила на Н21 (протоколы лабораторного
 * и цитологического исследований не должны попадать в обязательные патолого-
 * анатомическому бюро и бюро СМЭ) перечнем через отрицание:
 * «если МО НЕ КОПАБ, КОБСМЭ, КОСПК, ГСП, КОЦМП».
 *
 * Перечень значений продублирован в двух местах — в `APPLICABILITY_CONDITION_CODES`
 * и здесь. Добавляя новое условие, править надо оба; синхронность держит тест
 * `applicability-condition-codes.spec.ts`, а не аккуратность автора (14.08.2026
 * рассинхрон уже ронял подтверждение матрицы на вставке).
 */
export const migration: Migration = {
    id: 50,
    name: 'allow_organization_list_except_condition',
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
                'organization_list_except',
                'custom'
            ));
    END $$;
    `,
}
