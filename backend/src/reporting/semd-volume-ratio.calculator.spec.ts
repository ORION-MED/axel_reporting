import {
    calculateSemdVolumeRatio,
    type SemdVolumeRatioConfig,
    type SemdVolumeRatioInput,
    type SemdVolumeRatioPlan,
} from './semd-volume-ratio.calculator'
import {
    SEMD_VOLUME_RATIO_CONFIGS,
    SEMD_VOLUME_RATIO_INCLUDES_TYPE_551,
    findSemdVolumeRatioConfig,
} from './semd-volume-ratio.config'

/**
 * Доли СЭМД к объёмам ТПГГ — показатели 6.1.3.2.8–6.1.3.2.11 (задача Н7.1).
 * На вход подаются готовые числа, база не нужна.
 */

const SIMPLE: SemdVolumeRatioConfig = {
    indicatorId: 'test_simple',
    code: '6.1.3.2.11',
    semdTypeCodes: ['74'],
    aggregate: 'sum',
    tpggSheetCodes: ['1'],
}

const SUM_OF_TWO: SemdVolumeRatioConfig = {
    indicatorId: 'test_sum',
    code: '6.1.3.2.10',
    semdTypeCodes: ['1', '10'],
    aggregate: 'sum',
    tpggSheetCodes: ['5', '6'],
}

const MAX_OF_TWO: SemdVolumeRatioConfig = {
    indicatorId: 'test_max',
    code: '6.1.3.2.9',
    semdTypeCodes: ['340', '141'],
    aggregate: 'max',
    tpggSheetCodes: ['3.2'],
}

function input(overrides: Partial<SemdVolumeRatioInput> = {}): SemdVolumeRatioInput {
    return {
        organizationOids: ['mo-1'],
        facts: [],
        plans: [],
        // Декабрь: накопительный план равен годовому, поэтому проверки процентов
        // ниже говорят про сам расчёт, а не про месяц отсечки.
        throughMonth: 12,
        ...overrides,
    }
}

/**
 * План с росписью как в файле ТПГГ: месяцы 1–11 расписаны ровно, в декабрь падает
 * остаток. Сумма двенадцати месяцев в точности равна годовому итогу.
 */
function plan(
    organizationOid: string,
    sheetCode: string,
    annualValue: number,
): SemdVolumeRatioPlan {
    const evenMonth = Math.floor(annualValue / 12)
    const monthlyValues: Record<number, number> = {}
    for (let month = 1; month <= 11; month += 1) monthlyValues[month] = evenMonth
    monthlyValues[12] = annualValue - evenMonth * 11
    return { organizationOid, sheetCode, annualValue, monthlyValues }
}

describe('доля СЭМД к объёмам ТПГГ', () => {
    it('считает процент по одному виду и одному листу', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
            plans: [plan('mo-1', '1', 200)],
        }))

        expect(result.organizations[0]).toMatchObject({
            status: 'calculated',
            numerator: 50,
            denominator: 200,
            percent: 25,
        })
        expect(result.region).toMatchObject({ numerator: 50, denominator: 200, percent: 25 })
    })

    it('складывает листы знаменателя и округляет процент до сотых', () => {
        const result = calculateSemdVolumeRatio(SUM_OF_TWO, input({
            facts: [
                { organizationOid: 'mo-1', semdTypeCode: '1', documentCount: 100 },
                { organizationOid: 'mo-1', semdTypeCode: '10', documentCount: 5 },
            ],
            plans: [
                plan('mo-1', '5', 200),
                plan('mo-1', '6', 100),
            ],
        }))

        expect(result.organizations[0].numerator).toBe(105)
        expect(result.organizations[0].denominator).toBe(300)
        expect(result.organizations[0].percent).toBe(35)
    })

    it('для 6.1.3.2.10 выводит оба вида СЭМД отдельными строками', () => {
        // Прямое требование ТЗ методолога от 07.08.2026 к детализации по МО.
        const result = calculateSemdVolumeRatio(SUM_OF_TWO, input({
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '1', documentCount: 7 }],
            plans: [plan('mo-1', '5', 10)],
        }))

        expect(result.organizations[0].numeratorByType).toEqual([
            { semdTypeCode: '1', documentCount: 7 },
            // Вид без регистраций не пропадает из детализации: ноль — это ответ.
            { semdTypeCode: '10', documentCount: 0 },
        ])
    })
})

describe('«наибольшее из двух видов»', () => {
    it('считается по каждой МО отдельно, а не по региону целиком', () => {
        // Решение от 13.08.2026. На курганских данных оба способа дают одно число
        // (вид 340 больше вида 141 у каждой МО), поэтому расхождение молчаливое.
        // Здесь максимум у разных МО даёт разный вид: по региону вышло бы max(10, 12) = 12,
        // по МО — 10 + 12 = 22.
        const result = calculateSemdVolumeRatio(MAX_OF_TWO, input({
            organizationOids: ['mo-1', 'mo-2'],
            facts: [
                { organizationOid: 'mo-1', semdTypeCode: '340', documentCount: 10 },
                { organizationOid: 'mo-1', semdTypeCode: '141', documentCount: 3 },
                { organizationOid: 'mo-2', semdTypeCode: '340', documentCount: 1 },
                { organizationOid: 'mo-2', semdTypeCode: '141', documentCount: 12 },
            ],
            plans: [
                plan('mo-1', '3.2', 100),
                plan('mo-2', '3.2', 100),
            ],
        }))

        expect(result.organizations[0].numerator).toBe(10)
        expect(result.organizations[1].numerator).toBe(12)
        // Регион равен сумме сот на карте — ради этого разрез по МО и выбран.
        expect(result.region.numerator).toBe(22)
    })

    it('вид 551 прибавляется к максимуму, а не участвует в выборе максимума', () => {
        const result = calculateSemdVolumeRatio(
            { ...MAX_OF_TWO, additionalSemdTypeCodes: ['551'] },
            input({
                facts: [
                    { organizationOid: 'mo-1', semdTypeCode: '340', documentCount: 10 },
                    { organizationOid: 'mo-1', semdTypeCode: '141', documentCount: 3 },
                    { organizationOid: 'mo-1', semdTypeCode: '551', documentCount: 4 },
                ],
                plans: [plan('mo-1', '3.2', 100)],
            }),
        )

        // max(10, 3) + 4, а не max(10, 3, 4).
        expect(result.organizations[0].numerator).toBe(14)
    })
})

/**
 * Решение методолога и Николая Ермакова на ВКС 15.08.2026: знаменатель считается
 * нарастающим итогом по месяц отчётной даты, а не от годового плана.
 */
describe('накопительный знаменатель', () => {
    it('накапливает план с января по месяц отчётной даты', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 8,
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
            // 4 596 — годовой план вызовов Катайской ЦРБ, разобранный на созвоне.
            plans: [plan('mo-1', '1', 4596)],
        }))

        // 383 × 8, а не 4 596: делить факт восьми месяцев на годовой план — то самое
        // «критическое отклонение» на ровном месте, из-за которого правку и делали.
        expect(result.organizations[0].denominator).toBe(3064)
        // Годовой план остаётся: на карточке он идёт второй цифрой, в скобках.
        expect(result.organizations[0].annualDenominator).toBe(4596)
        expect(result.region.denominator).toBe(3064)
        expect(result.region.annualDenominator).toBe(4596)
    })

    it('декабрьский остаток не размазывается по году', () => {
        // В файле ТПГГ месяцы 1–11 расписаны ровно, а в декабрь падает остаток,
        // поэтому `годовой / 12 × N` дал бы другое число — и разошёлся бы молча.
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 11,
            plans: [{
                organizationOid: 'mo-1',
                sheetCode: '1',
                annualValue: 1200,
                monthlyValues: {
                    1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100,
                    7: 100, 8: 100, 9: 100, 10: 100, 11: 100, 12: 100,
                },
            }],
        }))
        const withRemainder = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 11,
            plans: [{
                organizationOid: 'mo-1',
                sheetCode: '1',
                annualValue: 1200,
                monthlyValues: {
                    1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 50,
                    7: 50, 8: 50, 9: 50, 10: 50, 11: 50, 12: 650,
                },
            }],
        }))

        expect(result.organizations[0].denominator).toBe(1100)
        // Тот же годовой итог, другая роспись — другой накопительный план.
        expect(withRemainder.organizations[0].denominator).toBe(550)
    })

    it('месяцы после отчётной даты в знаменатель не попадают', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 1,
            plans: [plan('mo-1', '1', 1200)],
        }))

        expect(result.organizations[0].denominator).toBe(100)
    })

    it('лист без росписи считается по годовому плану и помечается', () => {
        // Обнулить знаменатель нельзя — показатель обратился бы в прочерк на пустом
        // месте. Берём годовой и говорим об этом: он завышен, значит доля занижена.
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 8,
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
            plans: [{
                organizationOid: 'mo-1',
                sheetCode: '1',
                annualValue: 1200,
                monthlyValues: {},
            }],
        }))

        expect(result.organizations[0].denominator).toBe(1200)
        expect(result.organizations[0].usedAnnualFallback).toBe(true)
        expect(result.region.annualFallbackOrganizationCount).toBe(1)
    })

    it('объём утверждён, но на прошедшие месяцы не расписан — прочерк, а не ноль', () => {
        // Роспись целиком на декабрь законна. Ноль читался бы как невыполнение,
        // хотя делить снова не на что.
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 8,
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
            plans: [{
                organizationOid: 'mo-1',
                sheetCode: '1',
                annualValue: 900,
                monthlyValues: { 12: 900 },
            }],
        }))

        expect(result.organizations[0]).toMatchObject({
            // Объём утверждён — это свойство года, а не месяца.
            status: 'calculated',
            denominator: 0,
            annualDenominator: 900,
            percent: null,
        })
    })

    it('несколько строк по одному листу складываются помесячно', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 2,
            plans: [
                { organizationOid: 'mo-1', sheetCode: '1', annualValue: 30, monthlyValues: { 1: 10, 2: 20 } },
                { organizationOid: 'mo-1', sheetCode: '1', annualValue: 7, monthlyValues: { 1: 3, 2: 4 } },
            ],
        }))

        expect(result.organizations[0].denominator).toBe(37)
        expect(result.organizations[0].annualDenominator).toBe(37)
    })

    it('месяц вне 1–12 не роняет расчёт', () => {
        const zero = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 0,
            plans: [plan('mo-1', '1', 1200)],
        }))
        const beyond = calculateSemdVolumeRatio(SIMPLE, input({
            throughMonth: 99,
            plans: [plan('mo-1', '1', 1200)],
        }))

        expect(zero.organizations[0].denominator).toBe(0)
        expect(beyond.organizations[0].denominator).toBe(1200)
    })
})

describe('МО без утверждённого объёма', () => {
    it('есть факт, плана нет — процент не считается', () => {
        // Показывать такую МО нулём нельзя: это не невыполнение, делить не на что.
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
        }))

        expect(result.organizations[0]).toMatchObject({
            status: 'no_approved_volume',
            numerator: 50,
            denominator: null,
            percent: null,
        })
    })

    it('нулевой объём в терпрограмме равен отсутствию МО в ней', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
            plans: [plan('mo-1', '1', 0)],
        }))

        expect(result.organizations[0].status).toBe('no_approved_volume')
    })

    it('ни факта, ни плана — МО в показателе не участвует', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input())

        expect(result.organizations[0].status).toBe('not_participating')
        expect(result.organizations[0].percent).toBeNull()
    })

    it('регион показывает, сколько числителя пришло от МО без плана', () => {
        // Знаменатель складывается только по МО с утверждённым объёмом, а числитель —
        // по всем: эта часть завышает региональный процент, и её видно.
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            organizationOids: ['mo-1', 'mo-2', 'mo-3'],
            facts: [
                { organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 40 },
                { organizationOid: 'mo-2', semdTypeCode: '74', documentCount: 10 },
            ],
            plans: [plan('mo-1', '1', 200)],
        }))

        expect(result.region).toMatchObject({
            numerator: 50,
            denominator: 200,
            numeratorWithoutPlan: 10,
            organizationCount: 3,
            calculatedOrganizationCount: 1,
            factWithoutPlanOrganizationCount: 1,
            notParticipatingOrganizationCount: 1,
        })
    })

    it('без единого плана региональный процент не считается', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
        }))

        expect(result.region.percent).toBeNull()
    })
})

describe('подготовка входных данных', () => {
    it('факты МО вне целевого контура в расчёт не идут', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [
                { organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 10 },
                { organizationOid: 'чужая-мо', semdTypeCode: '74', documentCount: 999 },
            ],
            plans: [plan('mo-1', '1', 100)],
        }))

        expect(result.region.numerator).toBe(10)
    })

    it('объёмы МО вне целевого контура в знаменатель не идут', () => {
        // В терпрограмме есть частные и федеральные МО (РЖД-Медицина, НМИЦ Илизарова
        // и другие), которых нет среди целевых. Их объёмы завысили бы региональный
        // знаменатель, а на карте таких сот нет — регион перестал бы быть суммой сот.
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 50 }],
            plans: [
                plan('mo-1', '1', 100),
                plan('чужая-мо', '1', 900),
            ],
        }))

        expect(result.region.denominator).toBe(100)
        expect(result.region.percent).toBe(50)
    })

    it('несколько строк по одному виду складываются, а не перезаписываются', () => {
        // Один вид приходит несколькими строками — например, в разных форматах документа.
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [
                { organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 10 },
                { organizationOid: 'mo-1', semdTypeCode: '74', documentCount: 5 },
            ],
            plans: [plan('mo-1', '1', 100)],
        }))

        expect(result.organizations[0].numerator).toBe(15)
    })

    it('виды и листы вне конфигурации игнорируются', () => {
        const result = calculateSemdVolumeRatio(SIMPLE, input({
            facts: [{ organizationOid: 'mo-1', semdTypeCode: '2', documentCount: 999 }],
            plans: [plan('mo-1', '5', 999)],
        }))

        expect(result.organizations[0]).toMatchObject({
            numerator: 0,
            denominator: null,
            status: 'not_participating',
        })
    })
})

describe('конфигурация показателей-долей', () => {
    it('коды показателей — те, что есть в перечне', () => {
        // «ДН» — диспансерное наблюдение (Д-21). Кода в «Приложении 2» у него
        // нет, буквенный выбран намеренно: числовой прочитался бы как номер
        // оттуда. Считается той же машинерией, что и четыре официальных.
        expect(SEMD_VOLUME_RATIO_CONFIGS.map((config) => config.code))
            .toEqual(['6.1.3.2.8', '6.1.3.2.9', '6.1.3.2.10', '6.1.3.2.11', 'ДН'])
    })

    it('диспансерное наблюдение считается по виду 85 и листу 2.2', () => {
        // Знаменатель — итог листа, без разбивки по группам заболеваний:
        // вид СЭМД один, а групп в файле фонда четыре, и заболевания
        // в документе не записано.
        const config = findSemdVolumeRatioConfig('semd_dispensary_observation')

        expect(config?.semdTypeCodes).toEqual(['85'])
        expect(config?.tpggSheetCodes).toEqual(['2.2'])
        expect(config?.aggregate).toBe('sum')
    })

    it('«наибольшее» стоит только у 6.1.3.2.9', () => {
        const withMax = SEMD_VOLUME_RATIO_CONFIGS
            .filter((config) => config.aggregate === 'max')
            .map((config) => config.code)

        expect(withMax).toEqual(['6.1.3.2.9'])
    })

    it('разметка листов ТПГГ — из письменного ТЗ методолога от 07.08.2026', () => {
        expect(findSemdVolumeRatioConfig('semd_outpatient_epicrisis')?.tpggSheetCodes)
            .toEqual(['2', '3', '4'])
        expect(findSemdVolumeRatioConfig('semd_preventive_exam')?.tpggSheetCodes)
            .toEqual(['3.2', '3.3', '3.4', '3.5', '3.6', '3.7', '3.8', '3.9'])
        expect(findSemdVolumeRatioConfig('semd_inpatient_discharge')?.tpggSheetCodes)
            .toEqual(['5', '6', '7', '8', '9'])
        expect(findSemdVolumeRatioConfig('semd_ambulance_call_card')?.tpggSheetCodes)
            .toEqual(['1'])
    })

    it('лист 3 и подлисты 3.х не пересекаются — двойного счёта нет', () => {
        const sheet3 = SEMD_VOLUME_RATIO_CONFIGS
            .filter((config) => config.tpggSheetCodes.includes('3'))
            .map((config) => config.code)
        const subsheets = SEMD_VOLUME_RATIO_CONFIGS
            .filter((config) => config.tpggSheetCodes.some((code) => code.startsWith('3.')))
            .map((config) => config.code)

        expect(sheet3).toEqual(['6.1.3.2.8'])
        expect(subsheets).toEqual(['6.1.3.2.9'])
    })

    it('вид 551 выключен — ждём ответа методолога', () => {
        expect(SEMD_VOLUME_RATIO_INCLUDES_TYPE_551).toBe(false)
        expect(findSemdVolumeRatioConfig('semd_preventive_exam')?.additionalSemdTypeCodes)
            .toEqual([])
    })

    it('неизвестный показатель конфигурации не имеет', () => {
        expect(findSemdVolumeRatioConfig('semd_types_epgu_coverage')).toBeNull()
    })
})
