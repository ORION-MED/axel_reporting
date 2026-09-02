import { describe, expect, it } from 'vitest'
import type { ReportingOrganizationIndicatorValue } from '@shared/lib/reporting-api'
import { DEFAULT_ORGANIZATION_SORT, sortOrganizations } from './reporting-helpers'

/**
 * В3 (ВКС 31.07.2026): «В правой части можно ли сделать сортировку по умолчанию
 * от большего к меньшему?» Отдельно проверяем судьбу МО без процента — АО
 * «Курганфармация» показывается справочно, вне процента, и не должна оказываться
 * ни в начале списка, ни в середине.
 */

function organization(
    name: string,
    percent: number | null,
): ReportingOrganizationIndicatorValue {
    return {
        organizationOid: `oid-${name}`,
        organizationName: name,
        organizationFullName: name,
        indicatorId: 'semd_types_epgu_coverage',
        factValue: null,
        secondaryValue: percent,
        targetValue: 35,
        planValue: null,
        status: 'calculated',
        readiness: 'ready',
        calculationDetails: {},
    } as unknown as ReportingOrganizationIndicatorValue
}

const KOOD = organization('ГБУ "КООД"', 68.75)
const SHGB = organization('ГБУ "ШГБ"', 76.47)
const KOPNB = organization('ГКУ "КОПНБ"', 100)
const KOSPK = organization('ГКУ "КОСПК"', 0)
const PHARM = organization('АО "КУРГАНФАРМАЦИЯ"', null)

describe('sortOrganizations (В3)', () => {
    it('по умолчанию сортирует по убыванию процента', () => {
        const sorted = sortOrganizations([KOOD, KOSPK, KOPNB, SHGB])

        expect(sorted.map((item) => item.organizationName)).toEqual([
            'ГКУ "КОПНБ"',
            'ГБУ "ШГБ"',
            'ГБУ "КООД"',
            'ГКУ "КОСПК"',
        ])
    })

    it('умолчание — именно убывание', () => {
        expect(DEFAULT_ORGANIZATION_SORT).toBe('percent_desc')
    })

    it('МО без процента уходит в конец при убывании', () => {
        const sorted = sortOrganizations([PHARM, KOOD, KOPNB])

        expect(sorted[sorted.length - 1].organizationName).toBe('АО "КУРГАНФАРМАЦИЯ"')
    })

    it('МО без процента уходит в конец и при возрастании', () => {
        const sorted = sortOrganizations([PHARM, KOOD, KOSPK], 'percent_asc')

        expect(sorted.map((item) => item.organizationName)).toEqual([
            'ГКУ "КОСПК"',
            'ГБУ "КООД"',
            'АО "КУРГАНФАРМАЦИЯ"',
        ])
    })

    it('при равном проценте порядок устойчив — по названию', () => {
        const first = organization('ГБУ "Б"', 75)
        const second = organization('ГБУ "А"', 75)

        expect(sortOrganizations([first, second]).map((item) => item.organizationName))
            .toEqual(['ГБУ "А"', 'ГБУ "Б"'])
    })

    it('режим «по названию» игнорирует процент', () => {
        const sorted = sortOrganizations([KOPNB, PHARM, KOOD], 'name')

        expect(sorted.map((item) => item.organizationName)).toEqual([
            'АО "КУРГАНФАРМАЦИЯ"',
            'ГБУ "КООД"',
            'ГКУ "КОПНБ"',
        ])
    })

    it('не мутирует исходный массив', () => {
        const source = [KOOD, KOPNB]
        sortOrganizations(source)

        expect(source.map((item) => item.organizationName)).toEqual([
            'ГБУ "КООД"',
            'ГКУ "КОПНБ"',
        ])
    })
})
