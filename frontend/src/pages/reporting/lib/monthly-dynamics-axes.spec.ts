import { describe, expect, it } from 'vitest'
import {
    BAR_BAND,
    LINE_BAND_BOTTOM,
    LINE_BAND_TOP,
    barDomain,
    lineDomain,
} from './monthly-dynamics-axes'

/**
 * Правка методолога от 28.08.2026: линия доли и столбики не должны перекрываться.
 * Проверяем не картинку, а домены осей — именно они разводят их по высоте.
 *
 * Доля высоты считается от низа поля: recharts кладёт минимум домена вниз.
 */
function heightFraction(value: number, [min, max]: [number, number]): number {
    return (value - min) / (max - min)
}

describe('оси диаграммы динамики', () => {
    it('самый высокий столбик не выходит за свою полосу', () => {
        const domain = barDomain([100, 250, null, 40])
        expect(heightFraction(250, domain)).toBeCloseTo(BAR_BAND, 5)
    })

    it('столбики всегда считаются от нуля', () => {
        // От нуля — потому что столбик показывает объём: усечённый снизу,
        // он врёт о соотношении месяцев.
        expect(barDomain([100, 250])[0]).toBe(0)
    })

    it('пустой ряд не ломает домен', () => {
        expect(barDomain([null, null])).toEqual([0, 1])
    })

    it('линия ложится в верхнюю полосу и не достаёт до столбиков', () => {
        const domain = lineDomain([101.03, 86.74, 47.58, 66.49])
        expect(heightFraction(47.58, domain)).toBeCloseTo(LINE_BAND_BOTTOM, 5)
        expect(heightFraction(101.03, domain)).toBeCloseTo(LINE_BAND_TOP, 5)
        // Полоса линии начинается выше, чем кончается полоса столбиков.
        expect(LINE_BAND_BOTTOM).toBeGreaterThan(BAR_BAND)
    })

    it('линия считается от размаха значений, а не от нуля', () => {
        // Иначе доля 47…101 % превратилась бы в почти прямую, и ни майский
        // всплеск, ни июньский провал на ней не читались бы. Ширина домена
        // задаётся размахом: 53,45 п.п. на полосу в 0,28 высоты.
        const [min, max] = lineDomain([47.58, 101.03])
        expect(max - min).toBeCloseTo((101.03 - 47.58) / (LINE_BAND_TOP - LINE_BAND_BOTTOM), 5)
        // Нижняя граница при этом уходит ниже нуля — и это нормально: ось скрыта,
        // никто её не читает, а полоса линии остаётся на своём месте.
        expect(min).toBeLessThan(0)
        expect(heightFraction(47.58, [min, max])).toBeCloseTo(LINE_BAND_BOTTOM, 5)
    })

    it('одинаковые значения не дают деления на ноль', () => {
        const domain = lineDomain([70, 70, 70])
        expect(Number.isFinite(domain[0])).toBe(true)
        expect(domain[1]).toBeGreaterThan(domain[0])
    })

    it('пропуски месяцев игнорируются', () => {
        expect(lineDomain([null, 70, null])).toEqual(lineDomain([70]))
    })
})
