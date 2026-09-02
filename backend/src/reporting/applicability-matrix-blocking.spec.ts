import {
    ORGANIZATION_DIRECTORY_IS_REQUIRED,
    buildMatrixBlockingErrors,
    buildMatrixOrphanedInclusionWarning,
    type MatrixBlockingInput,
} from './applicability-matrix-blocking'

/**
 * Блокировки применения матрицы применимости, и главная из них — справочник признаков МО
 * (Н13, требование методолога от 07.08.2026).
 */

const CLEAN: MatrixBlockingInput = {
    organizationCount: 37,
    epguTypeCount: 36,
    expectedEpguTypeCount: 36,
    unknownSemdTypeCodes: [],
    missingMatrixSemdTypeCodes: [],
    directoryLoaded: true,
    unmatchedExclusionOrganizationNames: [],
}

function errorsFor(overrides: Partial<MatrixBlockingInput> = {}) {
    return buildMatrixBlockingErrors({ ...CLEAN, ...overrides })
}

describe('блокировки применения матрицы применимости', () => {
    it('на полном комплекте источников не блокирует ничего', () => {
        expect(errorsFor()).toEqual([])
    })

    it('несопоставленное имя в «если МО НЕ …» блокирует применение', () => {
        // В обычном перечне такое имя лишь сужает состав МО, и это видно по цифрам.
        // В перечне-исключении наоборот: МО остаётся обязанной, состав прежний,
        // и правка методолога молча не срабатывает.
        const errors = errorsFor({ unmatchedExclusionOrganizationNames: ['ГСП'] })

        expect(errors).toHaveLength(1)
        expect(errors[0]).toContain('если МО НЕ')
        expect(errors[0]).toContain('ГСП')
    })

    it('справочник признаков МО не загружен — матрицу применить нельзя', () => {
        const errors = errorsFor({ directoryLoaded: false })

        expect(errors).toHaveLength(1)
        // Текст обязан называть шаг и объяснять последствие: иначе пользователь
        // не поймёт, какой из девяти файлов ему не хватает.
        expect(errors[0]).toContain('шаг 5')
        expect(errors[0]).toContain('прикреплённое население')
        expect(errors[0]).toContain('комментариев формы_1')
    })

    it('флаг обязательности включён — это точка отката Н13', () => {
        expect(ORGANIZATION_DIRECTORY_IS_REQUIRED).toBe(true)
    })

    it('прежние блокировки сохранились и складываются со справочником', () => {
        const errors = errorsFor({
            organizationCount: 0,
            unknownSemdTypeCodes: ['999'],
            directoryLoaded: false,
        })

        expect(errors).toHaveLength(3)
        expect(errors[0]).toContain('числитель РЭМД')
        expect(errors[1]).toContain('999')
        expect(errors[2]).toContain('шаг 5')
    })

    it('число ЕПГУ-видов сверяется с ожидаемым составом справочника, а не с константой 36', () => {
        // Ожидаемое число приходит параметром и не связано с целью показателя:
        // с 20.08.2026 цель 35 (Соглашение), а справочник ЕПГУ даёт 36 видов.
        const errors = errorsFor({ epguTypeCount: 36, expectedEpguTypeCount: 35 })

        expect(errors).toEqual(['В справочнике ЕПГУ найдено 36 видов СЭМД вместо 35.'])
    })

    it('вид, известный справочнику, но недоступный на ЕПГУ, не блокирует', () => {
        // Форма с 07.08 описывает все 145 видов Перечня № 5пр, а не только целевые.
        expect(errorsFor({ unknownSemdTypeCodes: [] })).toEqual([])
    })

    it('ЕПГУ-код без правил в форме остаётся блокирующим', () => {
        expect(errorsFor({ missingMatrixSemdTypeCodes: ['68'] }))
            .toEqual(['В матрице нет правил для ЕПГУ-кодов: 68.'])
    })
})

/**
 * Перечень-включение без единого адресата («если МО - Санаторий», а санатория среди
 * 37 МО нет). С 25.08.2026 это предупреждение, а не блокировка: неверный исход убран
 * в самом расчёте — `evaluateRule` возвращает «не определено», когда перечень назван,
 * но не сопоставлен ни с одной МО (см. `organization-list-columns.spec.ts`). Молча
 * ошибиться нельзя по построению, а останавливать загрузку всех 145 видов из-за трёх
 * несоразмерно.
 *
 * Поэтому осиротевшие перечни в `MatrixBlockingInput` больше не передаются вовсе:
 * блокировке о них знать нечего. Единственный канал — предупреждение ниже.
 */
describe('перечень МО без адресата', () => {
    const ORPHANED = [
        { organizationName: 'Санаторий', semdTypeCodes: ['48', '50', '357'] },
    ]

    it('предупреждение называет и организацию, и виды', () => {
        // Без перечня видов методолог не поймёт, какие строки формы править.
        const warning = buildMatrixOrphanedInclusionWarning(ORPHANED)

        expect(warning).toContain('Санаторий')
        expect(warning).toContain('48, 50, 357')
        expect(warning).toContain('не определено')
    })

    it('без осиротевших перечней предупреждения нет', () => {
        expect(buildMatrixOrphanedInclusionWarning([])).toBe('')
    })
})
