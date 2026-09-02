import { describe, expect, it } from 'vitest'
import type { ReportingDiagnosticFinding } from '@shared/lib/reporting-api'
import { groupFindings } from './diagnostic-findings'

function finding(
    overrides: Partial<ReportingDiagnosticFinding>,
): ReportingDiagnosticFinding {
    return {
        id: Math.random().toString(36).slice(2),
        periodId: 'period-1',
        indicatorId: 'semd_types_epgu_coverage',
        organizationOid: '1.2.3',
        semdTypeId: null,
        semdTypeName: null,
        findingCode: 'regional_gis_capability_unknown',
        severity: 'warning',
        cause: 'Возможность формирования вида в региональной ГИС не уточнена.',
        responsibilityArea: 'МИАЦ / поставщик региональной ГИС',
        recommendation: 'Уточнить у поставщика ГИС.',
        evidence: {},
        status: 'active',
        sourceImportId: null,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
        ...overrides,
    }
}

describe('groupFindings (FR-11)', () => {
    it('сводит одинаковую причину по разным видам СЭМД в одну группу', () => {
        const groups = groupFindings([
            finding({ semdTypeName: 'Протокол консультации' }),
            finding({ semdTypeName: 'Выписной эпикриз стационара' }),
            finding({ semdTypeName: 'Протокол лабораторного исследования' }),
        ])

        expect(groups).toHaveLength(1)
        expect(groups[0].findingCount).toBe(3)
        expect(groups[0].semdTypeNames).toEqual([
            'Выписной эпикриз стационара',
            'Протокол консультации',
            'Протокол лабораторного исследования',
        ])
    })

    it('не смешивает разные коды причин', () => {
        const groups = groupFindings([
            finding({ semdTypeName: 'Протокол консультации' }),
            finding({
                findingCode: 'semd_not_implemented_in_regional_gis',
                cause: 'Вид не реализован в региональной ГИС.',
                semdTypeName: 'Протокол ТМК',
            }),
        ])

        expect(groups).toHaveLength(2)
    })

    it('в региональном своде показывает список затронутых МО по именам', () => {
        const groups = groupFindings(
            [
                finding({ organizationOid: '1.2.3', semdTypeName: 'Протокол консультации' }),
                finding({ organizationOid: '4.5.6', semdTypeName: 'Протокол консультации' }),
                finding({ organizationOid: '4.5.6', semdTypeName: 'Выписной эпикриз стационара' }),
            ],
            { '1.2.3': 'ГБУ «КООД»', '4.5.6': 'ГБУ «ШГБ»' },
        )

        expect(groups).toHaveLength(1)
        expect(groups[0].organizationNames).toEqual(['ГБУ «КООД»', 'ГБУ «ШГБ»'])
        expect(groups[0].findingCount).toBe(3)
    })

    it('сортирует группы по критичности, затем по числу записей', () => {
        const groups = groupFindings([
            finding({ semdTypeName: 'Вид 1' }),
            finding({ semdTypeName: 'Вид 2' }),
            finding({
                findingCode: 'required_semd_not_registered',
                cause: 'Вид обязателен, но не зарегистрирован.',
                severity: 'error',
                semdTypeName: 'Вид 3',
            }),
        ])

        expect(groups[0].severity).toBe('error')
        expect(groups[1].findingCount).toBe(2)
    })
})
