import {
    buildTargetPlanFactRows,
    type TargetPlanFactIndicator,
    type TargetPlanFactValue,
} from './target-plan-fact-rows'

/**
 * Выгрузка «Приложение 2, но с рассчитанными показателями» — Н19, просьба методолога
 * на ВКС 15.08.2026. Проверяется раскладка по колонкам; файл и пересчёт здесь не нужны.
 */

const AMBULANCE: TargetPlanFactIndicator = {
    id: 'semd_ambulance_call_card',
    code: '6.1.3.2.11',
    title: 'Доля СЭМД «Карта вызова скорой медицинской помощи»…',
    unit: '%',
    appendix2Number: '23',
}

const TYPE_REGISTRY: TargetPlanFactIndicator = {
    id: 'semd_type_registry',
    code: '27',
    title: 'Виды электронных медицинских документов…',
    unit: '%',
    appendix2Number: '',
}

const PILOT: TargetPlanFactIndicator = {
    id: 'semd_types_epgu_coverage',
    code: '6.1.3.2.7',
    title: 'Количество видов электронных медицинских документов…',
    unit: 'типов СЭМД',
    appendix2Number: '16',
}

function value(overrides: Partial<TargetPlanFactValue> = {}): TargetPlanFactValue {
    return {
        indicatorId: AMBULANCE.id,
        factValue: 41.32,
        targetYearEndValue: 95,
        note: '',
        status: 'calculated',
        ...overrides,
    }
}

describe('строки выгрузки показателей', () => {
    it('кладёт факт в колонку месяца отчётной даты, целевое — в конец года', () => {
        const [row] = buildTargetPlanFactRows({
            indicators: [AMBULANCE],
            values: [value()],
            reportingDate: '2026-08-31',
        })

        expect(row).toMatchObject({
            itemNumber: '23',
            indicatorCode: '6.1.3.2.11',
            unit: 'Процент',
            factMonth: 8,
            factValue: 41.32,
            yearEndValue: 95,
        })
    })

    it('единицы переводятся в формулировки «Приложения 2»', () => {
        const rows = buildTargetPlanFactRows({
            indicators: [AMBULANCE, PILOT],
            values: [value(), value({ indicatorId: PILOT.id, factValue: 35 })],
            reportingDate: '2026-08-31',
        })

        expect(rows.map((row) => row.unit)).toEqual(['Процент', 'Единица'])
    })

    /**
     * Методолог просила все шесть показателей. У «Видов СЭМД в РЭМД» номера
     * в «Приложении 2» нет — строка выгружается с пустым номером, а не пропадает
     * и не получает выдуманный.
     */
    it('показатель без номера «Приложения 2» остаётся в выгрузке', () => {
        const rows = buildTargetPlanFactRows({
            indicators: [AMBULANCE, TYPE_REGISTRY],
            values: [value(), value({ indicatorId: TYPE_REGISTRY.id, factValue: 48.28 })],
            reportingDate: '2026-08-31',
        })

        expect(rows).toHaveLength(2)
        expect(rows[1]).toMatchObject({ itemNumber: '', indicatorCode: '27', factValue: 48.28 })
    })

    /**
     * В шаблоне есть колонки только под июнь–ноябрь. Для месяца вне этого окна
     * факт уходит в «конец года», и целевое туда уже не пишется: две разные
     * величины в одной клетке не различить.
     */
    it('месяц вне июня-ноября уводит факт в «конец года» и вытесняет целевое', () => {
        const [row] = buildTargetPlanFactRows({
            indicators: [AMBULANCE],
            values: [value()],
            reportingDate: '2026-12-31',
        })

        expect(row.factMonth).toBeNull()
        expect(row.yearEndValue).toBe(41.32)
        expect(row.notes).toContain('вне помесячного плана')
    })

    it('без отчётной даты выгрузка не падает', () => {
        const [row] = buildTargetPlanFactRows({
            indicators: [AMBULANCE],
            values: [value()],
            reportingDate: null,
        })

        expect(row.factMonth).toBeNull()
        expect(row.notes).toContain('Отчетная дата: не задана')
    })

    it('непосчитанный показатель выгружается пустым и с объяснением', () => {
        const [row] = buildTargetPlanFactRows({
            indicators: [AMBULANCE],
            values: [value({
                factValue: null,
                status: 'awaiting_data',
                note: 'Утверждённых объёмов в терпрограмме не найдено.',
            })],
            reportingDate: '2026-08-31',
        })

        expect(row.factValue).toBeNull()
        expect(row.notes).toContain('Значение не рассчитано.')
        expect(row.notes).toContain('Утверждённых объёмов')
    })

    it('показатель без значения за период не выбрасывается из файла', () => {
        // Пустая строка честнее отсутствующей: методолог сверяет список целиком.
        const [row] = buildTargetPlanFactRows({
            indicators: [AMBULANCE],
            values: [],
            reportingDate: '2026-08-31',
        })

        expect(row).toMatchObject({ indicatorCode: '6.1.3.2.11', factValue: null })
        expect(row.notes).toContain('Значение не рассчитано.')
    })

    /**
     * У «Видов СЭМД в РЭМД» целевого нет вовсе — показателя нет в «Приложении 2».
     * Пустая клетка без оговорки читается как «забыли заполнить». У 6.1.3.2.7
     * с 20.08.2026 целевое на конец года заполняет сам расчёт.
     */
    it('отсутствие целевого на конец года оговаривается', () => {
        const [row] = buildTargetPlanFactRows({
            indicators: [PILOT],
            values: [value({ indicatorId: PILOT.id, factValue: 35, targetYearEndValue: null })],
            reportingDate: '2026-08-31',
        })

        expect(row.yearEndValue).toBeNull()
        expect(row.notes).toContain('Целевое значение на конец года')
    })

    it('при заполненном целевом лишней оговорки нет', () => {
        const [row] = buildTargetPlanFactRows({
            indicators: [AMBULANCE],
            values: [value()],
            reportingDate: '2026-08-31',
        })

        expect(row.notes).not.toContain('Целевое значение на конец года')
    })

    it('базовое значение 2025 года остаётся пустым', () => {
        // Мы его не считаем, и заполнять колонку нулём значило бы выдать
        // отсутствие данных за расчёт.
        const [row] = buildTargetPlanFactRows({
            indicators: [AMBULANCE],
            values: [value()],
            reportingDate: '2026-08-31',
        })

        expect(row.baseline2025).toBeNull()
    })
})
