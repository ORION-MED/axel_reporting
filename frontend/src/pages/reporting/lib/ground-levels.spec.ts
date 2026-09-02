import { describe, expect, it } from 'vitest'
import {
    GROUND_LEVELS,
    GROUND_LEVEL_ORDER,
    groundLevelView,
    visibleGrounds,
    type InstitutionSemdType,
} from './reporting-helpers'

/**
 * В6 (ВКС 31.07.2026): «В интерфейс сервиса необходимо выводить все эти приоритеты
 * обязательности». Тест держит расшифровки уровней и порядок вывода оснований.
 */

function semdType(
    grounds: Array<{ level: number; text: string }>,
): InstitutionSemdType {
    return {
        semdTypeId: 'type-1',
        nsiTypeCode: '121',
        officialOid: null,
        officialName5pr: null,
        name: 'Протокол цитологического исследования',
        documentFormat: 'CDA',
        requirementStatus: 'required',
        baseRequirementStatus: 'required',
        requirementGrounds: grounds,
        resultStatus: 'required_missing',
        documentCount: 0,
        registered: false,
        gisAvailable: null,
        requirementReason: '',
        requirementSource: '',
        baseRequirementReason: '',
        baseRequirementSource: '',
        manualOverride: null,
        evidence: [],
    } as unknown as InstitutionSemdType
}

describe('groundLevelView (В6)', () => {
    it('описывает все четыре уровня из методики', () => {
        expect(GROUND_LEVEL_ORDER).toEqual([1, 2, 3, 4])
        for (const level of GROUND_LEVEL_ORDER) {
            expect(GROUND_LEVELS[level].label).toBe(`Приоритет ${level}`)
            expect(GROUND_LEVELS[level].description.length).toBeGreaterThan(20)
        }
    })

    it('уровень 2 закрывает две причины входимости — госзадание и региональный акт', () => {
        // Пример методолога: ТМК раньше не были в терпрограмме, но были утверждены
        // региональным актом. Оба пути должны быть названы в расшифровке.
        const description = groundLevelView(2).description
        expect(description).toContain('государственным заданием')
        expect(description).toContain('региональным актом')
    })

    it('уровень 1 объясняет, почему ФРМО перестаёт быть вопросом', () => {
        expect(groundLevelView(1).description).toContain('ФРМО')
    })

    it('неизвестный уровень не роняет интерфейс, а честно сообщает о пробеле', () => {
        const view = groundLevelView(7)
        expect(view.label).toBe('Приоритет 7')
        expect(view.description).toContain('форму_1')
    })

    it('не утверждает, как уровни соединяются между собой', () => {
        // Формулировка «работают по ИЛИ» до снятия противоречия (раздел 6.1 ТЗ)
        // в интерфейс не выводится.
        const texts = GROUND_LEVEL_ORDER.map((level) => groundLevelView(level).description)
        for (const text of texts) {
            expect(text).not.toMatch(/\bили\b/i)
        }
    })
})

describe('visibleGrounds (В6)', () => {
    it('сортирует основания по возрастанию приоритета', () => {
        const grounds = visibleGrounds(semdType([
            { level: 2, text: 'наличие объема МП, утвержденного государственным заданием' },
            { level: 1, text: 'условия входимости ТВСП МО в показатель' },
        ]))

        expect(grounds.map((ground) => ground.level)).toEqual([1, 2])
    })

    it('убирает повторы — форма_1 правится руками', () => {
        const grounds = visibleGrounds(semdType([
            { level: 4, text: 'оказание МП' },
            { level: 4, text: 'Оказание МП' },
            { level: 4, text: '  оказание МП  ' },
        ]))

        expect(grounds).toHaveLength(1)
    })

    it('отбрасывает пустые основания', () => {
        const grounds = visibleGrounds(semdType([
            { level: 1, text: '   ' },
            { level: 2, text: 'наличие объема МП' },
        ]))

        expect(grounds.map((ground) => ground.text)).toEqual(['наличие объема МП'])
    })

    it('на старой форме без приоритетов отдаёт пустой список', () => {
        expect(visibleGrounds(semdType([]))).toEqual([])
    })
})
