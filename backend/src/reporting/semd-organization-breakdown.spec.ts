import { buildOrganizationBreakdown } from './semd-organization-breakdown'
import type {
    MonthlySeriesFact,
    MonthlySeriesPlan,
} from './semd-monthly-series'
import type { SemdVolumeRatioConfig } from './semd-volume-ratio.calculator'

/**
 * Разрез по медорганизациям (Д-25).
 *
 * Главное, что здесь защищается, — разница между «ноль случаев» и «реестров
 * не прислали». На точечной диаграмме первое означает медорганизацию,
 * которая ничего не сделала, второе — что её там быть не должно вовсе.
 * Поставить её в ноль по горизонтали значит оболгать.
 */

const CONFIG: SemdVolumeRatioConfig = {
    indicatorId: 'semd_outpatient_epicrisis',
    code: '6.1.3.2.8',
    semdTypeCodes: ['2'],
    aggregate: 'sum',
    tpggSheetCodes: ['2'],
}

const MAX_CONFIG: SemdVolumeRatioConfig = {
    indicatorId: 'semd_preventive_exam',
    code: '6.1.3.2.9',
    semdTypeCodes: ['340', '141'],
    aggregate: 'max',
    tpggSheetCodes: ['3.2'],
}

const ORGANIZATIONS = [
    { oid: 'oid-1', name: 'ГБУ «Первая»' },
    { oid: 'oid-2', name: 'ГБУ «Вторая»' },
]

const PLANS: MonthlySeriesPlan[] = [
    { organizationOid: 'oid-1', sheetCode: '2', monthlyValues: { 1: 1_000, 2: 1_000 } },
    { organizationOid: 'oid-2', sheetCode: '2', monthlyValues: { 1: 500, 2: 500 } },
]

const FACTS: MonthlySeriesFact[] = [
    { month: 1, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 900 },
    { month: 2, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 800 },
    { month: 1, organizationOid: 'oid-2', semdTypeCode: '2', documentCount: 250 },
    { month: 2, organizationOid: 'oid-2', semdTypeCode: '2', documentCount: 300 },
]

function breakdown(overrides: Partial<Parameters<typeof buildOrganizationBreakdown>[0]> = {}) {
    return buildOrganizationBreakdown({
        config: CONFIG,
        organizations: ORGANIZATIONS,
        facts: FACTS,
        plans: PLANS,
        loadedMonths: [1, 2],
        executionByOrganization: new Map([['oid-1', 2_000], ['oid-2', 400]]),
        fromMonth: 1,
        toMonth: 2,
        ...overrides,
    })
}

describe('buildOrganizationBreakdown', () => {
    it('доля по месяцам считается внутри каждой МО', () => {
        const rows = breakdown().rows

        expect(rows[0].monthlyRatios.slice(0, 2)).toEqual([90, 80])
        expect(rows[1].monthlyRatios.slice(0, 2)).toEqual([50, 60])
    })

    it('отдаёт двенадцать месяцев, а не только загруженные', () => {
        // Тепловая карта — календарный год: строка, обрывающаяся на разной
        // ширине у разных МО, читается как разные периоды наблюдения.
        expect(breakdown().rows[0].monthlyRatios).toHaveLength(12)
        expect(breakdown().rows[0].monthlyRatios[11]).toBeNull()
    })

    it('точка рассеяния — СЭМД против случаев за месяцы среза', () => {
        const rows = breakdown().rows

        expect(rows[0].semdInSlice).toBe(1_700)
        expect(rows[0].caseFact).toBe(2_000)
        expect(rows[0].percentOfFact).toBe(85)
    })

    it('МО без реестров ОМС остаётся без точки, а не с нулём по горизонтали', () => {
        const rows = breakdown({
            executionByOrganization: new Map([['oid-1', 2_000]]),
        }).rows

        expect(rows[1].caseFact).toBeNull()
        expect(rows[1].percentOfFact).toBeNull()
        // Помесячные доли при этом есть: они считаются от плана, а не от реестров.
        expect(rows[1].monthlyRatios[0]).toBe(50)
    })

    it('без среза исполнения рассеяния нет, а тепловая карта остаётся', () => {
        const result = breakdown({ fromMonth: null, toMonth: null })

        expect(result.fromMonth).toBeNull()
        expect(result.rows[0].semdInSlice).toBeNull()
        expect(result.rows[0].percentOfFact).toBeNull()
        expect(result.rows[0].monthlyRatios[0]).toBe(90)
    })

    it('агрегат max берётся внутри МО — тем же кодом, что и общая кривая', () => {
        // Если бы разрез считал числитель своей формулой, у 6.1.3.2.9 он дал бы
        // сумму видов вместо наибольшего, и тепловая карта разошлась бы
        // с диаграммой незаметно.
        const rows = buildOrganizationBreakdown({
            config: MAX_CONFIG,
            organizations: [ORGANIZATIONS[0]],
            facts: [
                { month: 1, organizationOid: 'oid-1', semdTypeCode: '340', documentCount: 30 },
                { month: 1, organizationOid: 'oid-1', semdTypeCode: '141', documentCount: 70 },
            ],
            plans: [
                { organizationOid: 'oid-1', sheetCode: '3.2', monthlyValues: { 1: 100 } },
            ],
            loadedMonths: [1],
            executionByOrganization: new Map(),
            fromMonth: null,
            toMonth: null,
        }).rows

        expect(rows[0].monthlyRatios[0]).toBe(70)
    })
})
