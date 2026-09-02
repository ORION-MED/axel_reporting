import { describe, expect, it } from 'vitest'
import type {
    ReportingIndicator,
    ReportingOrganizationIndicatorValue,
} from '@shared/lib/reporting-api'
import {
    executionFactLabel,
    getIndicatorNotes,
    getVisibleIndicatorNotes,
    organizationStatusView,
    semdTypeCountText,
    semdTypeRegistryDetails,
    semdVolumeRatioDetails,
    semdVolumeRatioStatusLabel,
    indicatorMenuLabel,
    indicatorNumberView,
    targetValueLabel,
    volumePlanLabel,
} from './reporting-helpers'

/**
 * Отображение показателей-долей к объёмам ТПГГ (6.1.3.2.8–6.1.3.2.11), задача Н7.3.
 *
 * Главное, что здесь проверяется: сота и строка списка отличают «нет утверждённого
 * объёма» от нуля. Ноль означал бы невыполнение, а объёма в терпрограмме просто нет —
 * делить не на что (7.1.2 ТЗ).
 */

function organization(
    details: Record<string, unknown>,
    overrides: Partial<ReportingOrganizationIndicatorValue> = {},
): ReportingOrganizationIndicatorValue {
    return {
        organizationOid: 'oid-1',
        organizationName: 'ГБУ «Тест»',
        organizationFullName: 'ГБУ «Тест»',
        indicatorId: 'semd_ambulance_call_card',
        numerator: 50,
        denominator: 200,
        factValue: 25,
        secondaryValue: null,
        targetValue: 70,
        status: 'calculated',
        businessStatus: 'not_assessed',
        calculationDetails: details,
        ...overrides,
    } as unknown as ReportingOrganizationIndicatorValue
}

const CALCULATED = {
    status: 'calculated',
    numeratorByType: [{ semdTypeCode: '74', semdTypeName: 'Карта вызова', documentCount: 50 }],
    denominatorBySheet: [{ sheetCode: '1', annualValue: 200 }],
}

describe('распознавание доли к объёмам ТПГГ', () => {
    it('находит детали расчёта по форме данных, а не по коду показателя', () => {
        expect(semdVolumeRatioDetails(organization(CALCULATED))).toMatchObject({
            status: 'calculated',
        })
    })

    it('значения других показателей не трогает', () => {
        // У 6.1.3.2.7 в деталях лежит readiness и никакого numeratorByType.
        expect(semdVolumeRatioDetails(organization({ readiness: 'ready' }))).toBeNull()
    })

    it('пустые детали расчёта не ломают разбор', () => {
        expect(semdVolumeRatioDetails(organization({}))).toBeNull()
    })

    it('неизвестное состояние отбрасывается целиком', () => {
        // Чужая структура с похожим полем не должна проходить за долю ТПГГ.
        expect(semdVolumeRatioDetails(organization({
            status: 'что-то новое',
            numeratorByType: [],
        }))).toBeNull()
    })

    it('без разбивки по листам возвращает пустой список, а не падает', () => {
        expect(semdVolumeRatioDetails(organization({
            status: 'calculated',
            numeratorByType: [],
        }))?.denominatorBySheet).toEqual([])
    })
})

/**
 * Накопительный план по месяц отчётной даты и годовой рядом — решение ВКС 15.08.2026:
 * «накопительная цифра на текущий месяц, в скобках итоговая за год».
 */
describe('накопительный план на карточке', () => {
    it('читает годовой план и месяц накопления', () => {
        const details = semdVolumeRatioDetails(organization({
            ...CALCULATED,
            annualDenominator: 4596,
            throughMonth: 8,
        }))

        expect(details).toMatchObject({
            annualDenominator: 4596,
            throughMonth: 8,
            usedAnnualFallback: false,
        })
    })

    it('подписывает знаменатель месяцем отчётной даты', () => {
        expect(volumePlanLabel(8)).toBe('План на август')
        expect(volumePlanLabel(1)).toBe('План на январь')
        expect(volumePlanLabel(12)).toBe('План на декабрь')
    })

    /**
     * Показатель, не пересчитанный после перехода на накопительный план, месяца
     * в деталях не несёт. Подписать его «План на август» значило бы соврать:
     * там лежит годовое число.
     */
    it('без месяца в деталях остаётся прежняя подпись', () => {
        expect(volumePlanLabel(null)).toBe('План (госзадание)')
        expect(semdVolumeRatioDetails(organization(CALCULATED))).toMatchObject({
            annualDenominator: null,
            throughMonth: null,
        })
    })

    it('мусор вместо месяца читается как его отсутствие', () => {
        for (const throughMonth of [0, 13, 8.5, '8', null]) {
            expect(semdVolumeRatioDetails(organization({
                ...CALCULATED,
                throughMonth,
            }))?.throughMonth).toBeNull()
        }
    })

    /**
     * Целевое тоже месячное — 15.08.2026 методолог приняла «70 %» за ошибку, помня
     * годовые 95 %. Месяц в подписи снимает вопрос, годовое рядом даёт опору.
     */
    it('подписывает целевое месяцем отчётной даты', () => {
        expect(targetValueLabel(8)).toBe('Целевое на август')
        expect(targetValueLabel(12)).toBe('Целевое на декабрь')
    })

    it('без месяца целевое подписано как раньше', () => {
        expect(targetValueLabel(null)).toBe('Целевое значение')
    })

    it('видит откат знаменателя на годовой план', () => {
        expect(semdVolumeRatioDetails(organization({
            ...CALCULATED,
            usedAnnualFallback: true,
        }))?.usedAnnualFallback).toBe(true)
    })
})

/**
 * Подпись в выпадающем списке над картой (Н16, ВКС 15.08.2026): раньше там стояли
 * одни коды, и между чем переключаешься — непонятно.
 */
describe('подпись показателя в списке', () => {
    it('склеивает номер «Приложения 2» с коротким именем', () => {
        expect(indicatorMenuLabel({
            code: '6.1.3.2.11',
            shortTitle: 'Карта вызова скорой',
            appendix2Number: '23',
        })).toBe('23 · Карта вызова скорой')
    })

    /**
     * У показателя «Виды СЭМД в РЭМД» номера нет: в «Приложении 2» его не существует,
     * а № 27 там занят маммографией с ИИ. Выдумать номер значило бы поставить рядом
     * с настоящими номерами документа несуществующий.
     */
    it('без номера показывает одно короткое имя', () => {
        expect(indicatorMenuLabel({
            code: '27',
            shortTitle: 'Виды СЭМД в РЭМД',
            appendix2Number: '',
        })).toBe('Виды СЭМД в РЭМД')
    })

    it('без короткого имени откатывается на код', () => {
        expect(indicatorMenuLabel({ code: '6.1.3.2.14' })).toBe('6.1.3.2.14')
        expect(indicatorMenuLabel({
            code: '6.1.3.2.14',
            shortTitle: '   ',
            appendix2Number: '25',
        })).toBe('6.1.3.2.14')
    })
})

/**
 * Рекомендации методолога от 22.08.2026: «Изменить нумерацию согласно Приложения 2».
 * В таблице «Показатели» стоял код 6.1.3.2.x, а методолог сверяет строки по номеру
 * из «Приложения 2».
 */
describe('номер показателя в таблице «Показатели»', () => {
    it('показывает номер «Приложения 2», а прежний код уводит в подпись', () => {
        expect(indicatorNumberView({
            code: '6.1.3.2.9',
            appendix2Number: '21',
        })).toEqual({ number: '21', codeNote: 'п. 6.1.3.2.9' })
    })

    /**
     * У «Видов СЭМД в РЭМД» номера в «Приложении 2» нет. Тогда номером остаётся
     * собственный код — иначе строка потеряет обозначение вовсе, — а подпись пуста:
     * повторять код под ним самим незачем.
     */
    it('без номера «Приложения 2» оставляет код и не дублирует его подписью', () => {
        expect(indicatorNumberView({ code: '27', appendix2Number: '' }))
            .toEqual({ number: '27', codeNote: '' })
        expect(indicatorNumberView({ code: '27' }))
            .toEqual({ number: '27', codeNote: '' })
    })
})

describe('показатель 27 «Виды СЭМД, регистрируемые в РЭМД»', () => {
    it('распознаётся по своим деталям расчёта', () => {
        expect(semdTypeRegistryDetails(organization({
            registeredTypeCount: 20,
            typesOutsideRegistryCount: 4,
        }))).toEqual({ registeredTypeCount: 20, typesOutsideRegistryCount: 4, plan: null })
    })

    it('не путается с долей к объёмам ТПГГ', () => {
        expect(semdTypeRegistryDetails(organization(CALCULATED))).toBeNull()
        expect(semdVolumeRatioDetails(organization({ registeredTypeCount: 20 }))).toBeNull()
    })

    it('без счётчика видов вне Перечня подставляет ноль', () => {
        expect(semdTypeRegistryDetails(organization({ registeredTypeCount: 0 })))
            .toEqual({ registeredTypeCount: 0, typesOutsideRegistryCount: 0, plan: null })
    })

    /** Н18.2: план приходит в деталях расчёта, отдельным объектом. */
    it('читает план по матрице применимости', () => {
        expect(semdTypeRegistryDetails(organization({
            registeredTypeCount: 46,
            typesOutsideRegistryCount: 4,
            plan: {
                requiredTypeCount: 31,
                registeredRequiredTypeCount: 25,
                percent: 80.65,
                undefinedTypeCount: 2,
            },
        }))?.plan).toEqual({
            requiredTypeCount: 31,
            registeredRequiredTypeCount: 25,
            percent: 80.65,
            undefinedTypeCount: 2,
        })
    })

    it('план без обязательных видов остаётся планом, а не пропадает', () => {
        expect(semdTypeRegistryDetails(organization({
            registeredTypeCount: 0,
            plan: {
                requiredTypeCount: 0,
                registeredRequiredTypeCount: 0,
                percent: null,
                undefinedTypeCount: 0,
            },
        }))?.plan).toMatchObject({ requiredTypeCount: 0, percent: null })
    })

    /** Мусор в деталях не должен ронять карточку — плана просто нет. */
    it('план без числа обязательных видов игнорируется', () => {
        expect(semdTypeRegistryDetails(organization({
            registeredTypeCount: 5,
            plan: { percent: 50 },
        }))?.plan).toBeNull()
    })
})

describe('подписи состояний', () => {
    it('«нет утверждённого объёма» — отдельное состояние, не ноль', () => {
        expect(semdVolumeRatioStatusLabel('no_approved_volume'))
            .toBe('Нет утверждённого объёма')
    })

    it('«не участвует в показателе» — ни факта, ни плана', () => {
        expect(semdVolumeRatioStatusLabel('not_participating'))
            .toBe('Не участвует в показателе')
    })

    it('рассчитанное состояние подписи не требует', () => {
        expect(semdVolumeRatioStatusLabel('calculated')).toBe('')
    })
})

describe('статус МО в списке', () => {
    it('МО без утверждённого объёма помечается предупреждением', () => {
        const view = organizationStatusView(organization(
            { ...CALCULATED, status: 'no_approved_volume' },
            { factValue: null, denominator: null, status: 'not_calculated' },
        ))

        expect(view).toEqual({ label: 'Нет утверждённого объёма', color: 'warning' })
    })

    it('МО вне показателя не красится тревожным цветом', () => {
        const view = organizationStatusView(organization(
            { ...CALCULATED, status: 'not_participating' },
            { factValue: null, denominator: null, numerator: 0, status: 'not_calculated' },
        ))

        expect(view).toEqual({ label: 'Не участвует в показателе', color: 'default' })
    })

    it('рассчитанная МО оценивается планом, как раньше', () => {
        const view = organizationStatusView(organization(CALCULATED, {
            businessStatus: 'below_target',
        }))

        expect(view.label).not.toBe('Нет утверждённого объёма')
    })
})

describe('пометки на карточке показателя (Н8)', () => {
    function indicator(metadata: Record<string, unknown>): ReportingIndicator {
        return { id: 'test', code: '6.1.3.2.9', metadata } as unknown as ReportingIndicator
    }

    it('порядок пометок фиксирован: источник, период, перечень видов помощи', () => {
        const notes = getIndicatorNotes(indicator({
            denominatorScopeNote: 'перечень видов помощи',
            periodNote: 'нарастающим итогом',
            denominatorSourceNote: 'знаменатель из ТПГГ',
        }))

        expect(notes.map((note) => note.text)).toEqual([
            'знаменатель из ТПГГ',
            'нарастающим итогом',
            'перечень видов помощи',
        ])
    })

    it('несогласованная формулировка помечается', () => {
        const notes = getIndicatorNotes(indicator({
            denominatorSourceNote: 'знаменатель из ТПГГ',
            denominatorSourceNoteStatus: 'awaiting_methodologist_approval',
        }))

        expect(notes[0].draft).toBe(true)
    })

    it('дословный текст методолога согласован и без пометки', () => {
        const notes = getIndicatorNotes(indicator({
            denominatorScopeNote: 'В расчет знаменателя включены следующие виды…',
        }))

        expect(notes[0].draft).toBe(false)
    })

    it('пустые и отсутствующие тексты пропускаются', () => {
        expect(getIndicatorNotes(indicator({ periodNote: '   ' }))).toEqual([])
        expect(getIndicatorNotes(indicator({}))).toEqual([])
    })

    it('у показателя 6.1.3.2.7 пометок нет — он считается по методике', () => {
        expect(getIndicatorNotes(indicator({ workingTargetValue: 35 }))).toEqual([])
    })

    it('несогласованные пометки скрыты от пользователя, согласованные видны', () => {
        // Решение от 14.08.2026: черновые формулировки не показываем до согласования,
        // но дословный текст методолога остаётся — она сама просила вывести его
        // на карточку.
        const visible = getVisibleIndicatorNotes(indicator({
            denominatorSourceNote: 'черновик про ТПГГ',
            denominatorSourceNoteStatus: 'awaiting_methodologist_approval',
            denominatorScopeNote: 'В расчет знаменателя включены следующие виды…',
        }))

        expect(visible.map((note) => note.text))
            .toEqual(['В расчет знаменателя включены следующие виды…'])
    })
})

/** Подписи планов уходят в карточку МО, «81 видов» там читается как небрежность. */
describe('склонение числа видов', () => {
    it('единственное число', () => {
        expect(semdTypeCountText(1)).toBe('1 вид')
        expect(semdTypeCountText(81)).toBe('81 вид')
    })

    it('от двух до четырёх', () => {
        expect(semdTypeCountText(2)).toBe('2 вида')
        expect(semdTypeCountText(24)).toBe('24 вида')
    })

    it('множественное число', () => {
        expect(semdTypeCountText(0)).toBe('0 видов')
        expect(semdTypeCountText(5)).toBe('5 видов')
        expect(semdTypeCountText(46)).toBe('46 видов')
    })

    /** Одиннадцать–четырнадцать — исключение: «11 видов», а не «11 вид». */
    it('подростковые числа не берут единственное число', () => {
        expect(semdTypeCountText(11)).toBe('11 видов')
        expect(semdTypeCountText(12)).toBe('12 видов')
        expect(semdTypeCountText(114)).toBe('114 видов')
    })
})

/**
 * Третья колонка карточки МО — исполнение терпрограммы по реестрам ОМС (Д-10).
 *
 * Проверяется ровно то, что легко сломать незаметно: отличие «нет данных»
 * от нуля и месяцы в подписи. Срез фонда не совпадает с отчётной датой периода,
 * и число без интервала читается как факт на сегодня — то есть заниженным вдвое.
 */
describe('исполнение ТПГГ на карточке МО', () => {
    it('читает факт исполнения из деталей расчёта', () => {
        const details = semdVolumeRatioDetails(organization({
            ...CALCULATED,
            execution: { factValue: 11111, planValue: 20174, fromMonth: 1, toMonth: 6 },
        }))

        expect(details?.execution).toEqual({
            factValue: 11111,
            planValue: 20174,
            fromMonth: 1,
            toMonth: 6,
        })
    })

    it('без файлов исполнения — null, а не ноль', () => {
        // Ноль в карточке означал бы, что случаев не было; их просто не загрузили.
        // Николай прямо описал сценарий показа: «в третьей колонке вместо
        // прочерков появились цифры».
        expect(semdVolumeRatioDetails(organization(CALCULATED))?.execution).toBeNull()
    })

    it('мусор в деталях не превращается в число', () => {
        const details = semdVolumeRatioDetails(organization({
            ...CALCULATED,
            execution: { factValue: 'много' },
        }))

        expect(details?.execution).toBeNull()
    })

    it('подпись называет интервал среза', () => {
        expect(executionFactLabel(1, 6)).toBe('Факт ТПГГ (случаев), январь–июнь')
    })

    it('срез в один месяц подписывается одним месяцем', () => {
        expect(executionFactLabel(6, 6)).toBe('Факт ТПГГ (случаев), июнь')
    })

    it('без интервала подпись остаётся без месяцев', () => {
        // Файлы профилактики хранят период так, что Excel превратил его
        // в «1999-01-01»; врать про месяцы в этом случае нельзя.
        expect(executionFactLabel(null, null)).toBe('Факт ТПГГ (случаев)')
        expect(executionFactLabel(1, null)).toBe('Факт ТПГГ (случаев)')
    })
})
