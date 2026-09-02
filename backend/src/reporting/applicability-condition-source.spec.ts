import * as ExcelJS from 'exceljs'
import {
    extractConditionOrganizationNames,
    loadApplicabilityMatrixWorkbook,
    parseConditionOrganizationList,
} from './applicability-matrix-xlsx'

/**
 * Откуда берётся условие правила — заполненная форма на 145 видов (возврат методолога
 * от 13.08.2026).
 *
 * До неё условие читалось только из колонки «Дополнительное условие», и это работало,
 * потому что методолог писала его дважды — и туда, и в колонку приоритета. В форме
 * на 145 видов дублирования нет: 81 правило из 227 несёт условие только в приоритетах.
 * Без разбора приоритетов эти правила становятся безусловными, и знаменатель 6.1.3.2.7
 * раздувается молча.
 */

const HEADER = [
    '№',
    'Код Вид МД',
    'Документ',
    'Решение',
    'Тип подразделения',
    'Вид подразделения',
    'Дополнительное условие',
    'Комментарий методолога',
    'Проверка строки',
    'Приоритет обязательности 1 - есть условия входимости, утвержденные МЗ РФ',
    'Приоритет обязательности 2 - утверждено госзаданием и(или) региональными актами региона',
    'Приоритет обязательности 3 - наличие лицензий на отдельные виды МП',
    'Приоритет обязательности 4',
]

interface RuleRow {
    code: string
    decision?: string
    subdivisionType?: string
    condition?: string
    comment?: string
    ground1?: string
    ground3?: string
    ground4?: string
}

async function parse(rows: RuleRow[]) {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Форма условий')
    worksheet.addRow(['Условия обязательности 145 видов СЭМД'])
    worksheet.addRow(['Пояснение'])
    worksheet.addRow([])
    worksheet.addRow(HEADER)
    rows.forEach((row, index) => worksheet.addRow([
        index + 1,
        row.code,
        'Документ',
        row.decision ?? 'обязателен',
        row.subdivisionType ?? 'Амбулаторный',
        '',
        row.condition ?? '',
        row.comment ?? '',
        'ГОТОВО',
        row.ground1 ?? '',
        '',
        row.ground3 ?? '',
        row.ground4 ?? '',
    ]))
    const parsed = await loadApplicabilityMatrixWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer()),
    )
    return parsed.rules
}

describe('условие из колонок приоритетов', () => {
    it('прикреплённое население в приоритете 4 задаёт условие', async () => {
        const [rule] = await parse([{ code: '39', ground4: 'наличие прикрепленного населения' }])

        expect(rule.conditionCode).toBe('attached_population')
    })

    it('понимает падеж «прикрепленного взрослого населения» — вид 68', async () => {
        const [rule] = await parse([
            { code: '68', ground4: 'наличие прикрепленного взрослого населения' },
        ])

        expect(rule.conditionCode).toBe('attached_population')
    })

    it('детское население отличается от взрослого', async () => {
        const [rule] = await parse([
            { code: '49', ground4: 'наличие прикрепленного детского населения' },
        ])

        expect(rule.conditionCode).toBe('attached_child_population')
    })

    it('лицензия в приоритете 3 задаёт условие', async () => {
        const [rule] = await parse([
            { code: '141', ground3: 'при наличии лицензии на вид мед.деятельности 1080.4' },
        ])

        expect(rule.conditionCode).toBe('license_1080_4')
    })

    it('подпись условия называет ячейку, из которой оно взято', async () => {
        // Иначе в предпросмотре у сработавшего правила видно «условие: пусто».
        const [rule] = await parse([
            { code: '39', ground4: 'наличие прикрепленного населения' },
        ])

        expect(rule.conditionText).toBe('наличие прикрепленного населения')
    })

    it('участие в ЛЛО в приоритете 4 задаёт условие', async () => {
        // Виды 37 и 38 («Льготный рецепт…»). Признак появился в справочнике МО 13.08.2026 —
        // без него льготный рецепт был бы обязателен у всех 37 МО, а участвуют 24.
        const [rule] = await parse([{
            code: '37',
            ground4: 'реализация государственных и региональных программ '
                + 'по обеспечению населения ЛЛО',
        }])

        expect(rule.conditionCode).toBe('llo_program')
    })

    it('«лло» внутри слова условием не считается', async () => {
        const [rule] = await parse([{ code: '3', ground4: 'аллопатическая помощь' }])

        expect(rule.conditionCode).toBe('none')
    })

    it('основание, которое не сужает перечень МО, условием не становится', async () => {
        // «оказание гражданам медицинской помощи» верно для всех МО. Превратить его
        // в custom значило бы отправить правило в «не определено» на пустом месте.
        const [rule] = await parse([
            { code: '3', ground4: 'оказание гражданам медицинской помощи' },
        ])

        expect(rule.conditionCode).toBe('none')
    })

    it('«Дополнительное условие» побеждает приоритет', async () => {
        // Обратная совместимость: прежние формы заполнены в обоих местах и не должны
        // читаться по-новому.
        const [rule] = await parse([{
            code: '49',
            condition: 'Обязателен для МО с прикрепленным детским населением',
            ground4: 'наличие прикрепленного населения',
        }])

        expect(rule.conditionCode).toBe('attached_child_population')
    })
})

describe('перечень МО из условия «если МО - …»', () => {
    it('разбирает список с правовыми формами', () => {
        expect(extractConditionOrganizationNames('если МО - ГБУ КООД, ГКУ КОПБ, ГБУ КОКВД'))
            .toEqual(['ГБУ КООД', 'ГКУ КОПБ', 'ГБУ КОКВД'])
    })

    it('разбирает короткие имена без правовой формы', () => {
        // Прежний разбор искал наименования по префиксам ГБУ/ГКУ/АО и такое не видел.
        expect(extractConditionOrganizationNames('если МО - Бюро СМЭ')).toEqual(['Бюро СМЭ'])
        expect(extractConditionOrganizationNames('если МО -Диспансер')).toEqual(['Диспансер'])
    })

    it('текст без «если МО» перечнем не считается', () => {
        expect(extractConditionOrganizationNames('все дневные стационары')).toEqual([])
        expect(extractConditionOrganizationNames('')).toEqual([])
    })

    it('перечень из условия попадает в правило', async () => {
        const [rule] = await parse([
            { code: '13', decision: 'условно', condition: 'если МО - КОПАБ' },
        ])

        expect(rule.organizationNames).toEqual(['КОПАБ'])
        expect(rule.conditionExcludesOrganizations).toBe(false)
    })
})

/**
 * Форма от 18.08.2026: ответ методолога на Н21 записан перечнем через отрицание.
 * Разбор без флага прочитал бы «всем, кроме пяти» как «только этим пяти» —
 * ровно противоположный состав обязательных видов, и по цифрам это не видно.
 */
describe('перечень-исключение «если МО НЕ …»', () => {
    it('снимает «НЕ» и помечает перечень исключением', () => {
        expect(parseConditionOrganizationList(
            'если МО НЕ КОПАБ, КОБСМЭ, КОСПК, ГСП, КОЦМП',
        )).toEqual({
            names: ['КОПАБ', 'КОБСМЭ', 'КОСПК', 'ГСП', 'КОЦМП'],
            excluded: true,
        })
    })

    it('разбирает перечень из одного имени', () => {
        expect(parseConditionOrganizationList('если МО НЕ ГСП'))
            .toEqual({ names: ['ГСП'], excluded: true })
    })

    it('тире перед «НЕ» ничего не меняет', () => {
        expect(parseConditionOrganizationList('если МО - НЕ ГСП'))
            .toEqual({ names: ['ГСП'], excluded: true })
    })

    it('перечень-включение исключением не считается', () => {
        expect(parseConditionOrganizationList('если МО - КООД'))
            .toEqual({ names: ['КООД'], excluded: false })
        // Слитное написание методолог тоже допускает — «если МО -Диспансер».
        expect(parseConditionOrganizationList('если МО -Диспансер'))
            .toEqual({ names: ['Диспансер'], excluded: false })
    })

    it('строка получает собственный код условия, а не «не определено»', async () => {
        // `custom` означал бы «условие не разобрано» — то есть вид 7 стал бы
        // неопределённым у всех 37 МО вместо обязательного у 29.
        const [rule] = await parse([{
            code: '7',
            subdivisionType: 'Лабораторно-диагностический',
            condition: 'если МО НЕ КОПАБ, КОБСМЭ',
        }])

        expect(rule.conditionCode).toBe('organization_list_except')
        expect(rule.conditionExcludesOrganizations).toBe(true)
        expect(rule.organizationNames).toEqual(['КОПАБ', 'КОБСМЭ'])
    })
})

describe('рабочая подмена статуса у видов 34 и 85', () => {
    it('не трогает строку с явным перечнем МО', async () => {
        // Методолог написала «не обязателен, если МО — эти шесть». Подмена превратила бы
        // это в ровно противоположное: «этим шести обязателен».
        const [rule] = await parse([{
            code: '85',
            decision: 'не обязателен',
            condition: 'если МО - ГБУ КООД, ГКУ КОПБ',
        }])

        expect(rule.requirementStatus).toBe('not_required')
        expect(rule.normalizationNotes).toEqual([])
    })

    it('без перечня работает как раньше', async () => {
        const [rule] = await parse([{
            code: '85',
            decision: 'не обязателен',
            condition: 'Возможен для узкоспециализированных МО',
        }])

        expect(rule.requirementStatus).toBe('required')
        expect(rule.normalizationNotes).toHaveLength(1)
    })
})
