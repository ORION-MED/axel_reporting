import {
    classifyRemdInterval,
    latestCumulativeMonth,
} from './remd-interval-facts'
import type { RemdReportInterval } from './remd-numerator-xlsx'

/**
 * Разделение выгрузок РЭМД на помесячные и нарастающие. Проверяется на тех же
 * интервалах, что стоят в шапках тринадцати файлов от 25.08.2026.
 */

function interval(from: string, to: string): RemdReportInterval {
    const parse = (value: string) => {
        const [day, month, year] = value.split('.').map(Number)
        return { day, month, year }
    }
    return { from: parse(from), to: parse(to) }
}

describe('classifyRemdInterval', () => {
    it('«01.07.2026 - 31.07.2026» — выгрузка за июль', () => {
        expect(classifyRemdInterval(interval('01.07.2026', '31.07.2026')))
            .toEqual({ coverage: 'month', month: 7, year: 2026 })
    })

    it('«01.01.2026 - 31.07.2026» — нарастающий итог по июль', () => {
        // Файлы называются «7.Отчет СЭМД_РЭМД июль» и «7.Отчет СЭМД_РЭМД янв-июль»:
        // по имени они неразличимы, по интервалу — однозначно.
        expect(classifyRemdInterval(interval('01.01.2026', '31.07.2026')))
            .toEqual({ coverage: 'cumulative', month: 7, year: 2026 })
    })

    it('январь считается месяцем, а не нарастающим итогом', () => {
        // «01.01 - 31.01» подходит под оба определения, и числа в них одинаковы.
        // Графику точка нужна, показателю 27 нарастающая за один январь — нет.
        expect(classifyRemdInterval(interval('01.01.2026', '31.01.2026')))
            .toEqual({ coverage: 'month', month: 1, year: 2026 })
    })

    it('неполный последний месяц остаётся месяцем', () => {
        // Выгрузка «по 14.08» — это август по состоянию на сегодня, обычный случай.
        expect(classifyRemdInterval(interval('01.08.2026', '14.08.2026')))
            .toEqual({ coverage: 'month', month: 8, year: 2026 })
    })

    it('интервал не с первого числа не размечается', () => {
        // Часть месяца даёт заниженную точку кривой, и подставить её молча нельзя.
        expect(classifyRemdInterval(interval('15.07.2026', '31.07.2026'))).toBeNull()
    })

    it('произвольный интервал внутри года не размечается', () => {
        // «март-июнь» — ни месяц, ни нарастающий итог с января.
        expect(classifyRemdInterval(interval('01.03.2026', '30.06.2026'))).toBeNull()
    })

    it('выгрузка на стыке лет не размечается', () => {
        // Накопительный итог считается внутри года, как и план ТПГГ.
        expect(classifyRemdInterval(interval('01.12.2025', '31.01.2026'))).toBeNull()
    })

    it('перевёрнутый интервал не размечается', () => {
        expect(classifyRemdInterval(interval('01.07.2026', '31.03.2026'))).toBeNull()
    })

    it('без шапки — решения нет', () => {
        // Месяц спросим у пользователя; угадывать по имени файла нельзя.
        expect(classifyRemdInterval(null)).toBeNull()
    })
})

describe('latestCumulativeMonth', () => {
    it('из шести нарастающих выгрузок берёт самую полную', () => {
        // Присланы «янв-фев» … «янв-июль»: числитель показателя 27 — из последней.
        expect(latestCumulativeMonth([2, 3, 4, 5, 6, 7])).toBe(7)
    })

    it('порядок загрузки значения не имеет', () => {
        expect(latestCumulativeMonth([7, 3, 5])).toBe(7)
    })

    it('нарастающих нет — числителя из них тоже нет', () => {
        expect(latestCumulativeMonth([])).toBeNull()
    })
})
