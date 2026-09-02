import {
    buildSemdMonthlySeries,
    type MonthlySeriesInput,
} from './semd-monthly-series'
import type { SemdVolumeRatioConfig } from './semd-volume-ratio.calculator'

/**
 * Помесячные кривые «план против факта» (Д-9).
 *
 * Главное, что здесь защищается, — разница между «нулём» и «нет данных».
 * На графике это два совершенно разных утверждения: ноль говорит «месяц был,
 * документов не зарегистрировали», прочерк — «выгрузка за месяц не пришла».
 * Спутать их значит показать директору департамента провал, которого не было.
 */

const SUM_CONFIG: SemdVolumeRatioConfig = {
    indicatorId: 'semd_outpatient_epicrisis',
    code: '6.1.3.2.8',
    semdTypeCodes: ['2'],
    aggregate: 'sum',
    tpggSheetCodes: ['2', '3'],
}

/** 6.1.3.2.9: наибольшее из двух видов, а не их сумма. */
const MAX_CONFIG: SemdVolumeRatioConfig = {
    indicatorId: 'semd_preventive_exam',
    code: '6.1.3.2.9',
    semdTypeCodes: ['340', '141'],
    aggregate: 'max',
    tpggSheetCodes: ['3.2'],
}

function seriesFor(overrides: Partial<MonthlySeriesInput> = {}) {
    return buildSemdMonthlySeries({
        config: SUM_CONFIG,
        organizationOids: ['oid-1', 'oid-2'],
        facts: [],
        plans: [],
        loadedMonths: [],
        ...overrides,
    })
}

function pointAt(points: ReturnType<typeof seriesFor>, month: number) {
    return points.find((point) => point.month === month)!
}

describe('buildSemdMonthlySeries', () => {
    it('всегда отдаёт двенадцать точек', () => {
        // Ось X — календарный год целиком: иначе кривая, оборванная на июле,
        // выглядит как выполненный год.
        expect(seriesFor()).toHaveLength(12)
        expect(seriesFor().map((point) => point.month))
            .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    })

    it('незагруженный месяц — прочерк, а не ноль', () => {
        const points = seriesFor({
            loadedMonths: [1],
            facts: [
                { month: 1, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 100 },
            ],
        })

        expect(pointAt(points, 1).fact).toBe(100)
        expect(pointAt(points, 2).fact).toBeNull()
    })

    it('загруженный месяц без нужных видов — честный ноль', () => {
        // Выгрузка пришла, и в ней по этим видам пусто. Это утверждение о данных,
        // а не их отсутствие.
        const points = seriesFor({
            loadedMonths: [3],
            facts: [
                { month: 3, organizationOid: 'oid-1', semdTypeCode: '999', documentCount: 50 },
            ],
        })

        expect(pointAt(points, 3).fact).toBe(0)
    })

    it('регион складывает факты медорганизаций', () => {
        const points = seriesFor({
            loadedMonths: [4],
            facts: [
                { month: 4, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 30 },
                { month: 4, organizationOid: 'oid-2', semdTypeCode: '2', documentCount: 12 },
            ],
        })

        expect(pointAt(points, 4).fact).toBe(42)
    })

    it('МО вне контура в кривую не попадает', () => {
        // Тот же контур, что у показателя: чужие факты не должны поднимать кривую.
        const points = seriesFor({
            loadedMonths: [4],
            facts: [
                { month: 4, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 30 },
                { month: 4, organizationOid: 'oid-9', semdTypeCode: '2', documentCount: 900 },
            ],
        })

        expect(pointAt(points, 4).fact).toBe(30)
    })

    it('строки подразделений одной МО складываются', () => {
        const points = seriesFor({
            loadedMonths: [5],
            facts: [
                { month: 5, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 7 },
                { month: 5, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 3 },
            ],
        })

        expect(pointAt(points, 5).fact).toBe(10)
    })

    it('агрегат max берётся внутри МО, а не по региону', () => {
        // Ключевой случай 6.1.3.2.9. Максимум по региону дал бы 30, сумма
        // максимумов по МО — 40. Показатель считает вторым способом, и кривая
        // обязана считать так же, иначе точка графика разойдётся с карточкой.
        const points = buildSemdMonthlySeries({
            config: MAX_CONFIG,
            organizationOids: ['oid-1', 'oid-2'],
            loadedMonths: [6],
            plans: [],
            facts: [
                { month: 6, organizationOid: 'oid-1', semdTypeCode: '340', documentCount: 30 },
                { month: 6, organizationOid: 'oid-1', semdTypeCode: '141', documentCount: 5 },
                { month: 6, organizationOid: 'oid-2', semdTypeCode: '340', documentCount: 2 },
                { month: 6, organizationOid: 'oid-2', semdTypeCode: '141', documentCount: 10 },
            ],
        })

        expect(pointAt(points, 6).fact).toBe(40)
    })

    it('план складывается по листам знаменателя и по МО', () => {
        const points = seriesFor({
            plans: [
                {
                    organizationOid: 'oid-1',
                    sheetCode: '2',
                    monthlyValues: { 1: 100, 2: 200 },
                },
                {
                    organizationOid: 'oid-2',
                    sheetCode: '3',
                    monthlyValues: { 1: 50 },
                },
            ],
        })

        expect(pointAt(points, 1).plan).toBe(150)
        expect(pointAt(points, 2).plan).toBe(200)
        // Месяц без росписи при загруженной терпрограмме — ноль плана, и это правда:
        // объём на него не расписан.
        expect(pointAt(points, 3).plan).toBe(0)
    })

    it('лист вне знаменателя показателя в план не идёт', () => {
        const points = seriesFor({
            plans: [
                {
                    organizationOid: 'oid-1',
                    sheetCode: '3.2',
                    monthlyValues: { 1: 999 },
                },
            ],
        })

        expect(pointAt(points, 1).plan).toBeNull()
    })

    it('без росписи вовсе плановая линия не рисуется', () => {
        // Прочерк, а не нулевая линия по всему году: нулевая читалась бы как
        // «объём не утверждён», хотя терпрограмма просто не загружена.
        const points = seriesFor()

        expect(points.every((point) => point.plan === null)).toBe(true)
    })

    it('кривая одной МО считается тем же кодом', () => {
        const points = seriesFor({
            organizationOids: ['oid-2'],
            loadedMonths: [7],
            facts: [
                { month: 7, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 30 },
                { month: 7, organizationOid: 'oid-2', semdTypeCode: '2', documentCount: 12 },
            ],
            plans: [
                { organizationOid: 'oid-1', sheetCode: '2', monthlyValues: { 7: 500 } },
                { organizationOid: 'oid-2', sheetCode: '2', monthlyValues: { 7: 40 } },
            ],
        })

        expect(pointAt(points, 7).fact).toBe(12)
        expect(pointAt(points, 7).plan).toBe(40)
    })

    describe('доля от плана — линия поверх столбиков', () => {
        // ТЗ от 24.08.2026: третья серия «доля СЭМД (от плана)» с подписями
        // «январь; 101». Проценты выше ста — норма: в январе СЭМД
        // зарегистрировано больше, чем случаев по плану месяца.
        it('считается от планового объёма месяца', () => {
            const points = seriesFor({
                loadedMonths: [1],
                facts: [
                    { month: 1, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 269_727 },
                ],
                plans: [
                    { organizationOid: 'oid-1', sheetCode: '2', monthlyValues: { 1: 266_979 } },
                ],
            })

            expect(pointAt(points, 1).ratio).toBe(101.03)
        })

        it('без выгрузки за месяц доли нет — прочерк, а не ноль', () => {
            const points = seriesFor({
                loadedMonths: [],
                plans: [
                    { organizationOid: 'oid-1', sheetCode: '2', monthlyValues: { 2: 1_000 } },
                ],
            })

            expect(pointAt(points, 2).ratio).toBeNull()
        })

        it('нулевой план не даёт бесконечности', () => {
            const points = seriesFor({
                loadedMonths: [3],
                facts: [
                    { month: 3, organizationOid: 'oid-1', semdTypeCode: '2', documentCount: 5 },
                ],
                plans: [
                    { organizationOid: 'oid-1', sheetCode: '2', monthlyValues: { 4: 10 } },
                ],
            })

            expect(pointAt(points, 3).plan).toBe(0)
            expect(pointAt(points, 3).ratio).toBeNull()
        })
    })
})
