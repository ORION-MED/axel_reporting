import * as ExcelJS from 'exceljs'
import {
    extractApplicabilityOrganizationNames,
    loadApplicabilityMatrixWorkbook,
} from './applicability-matrix-xlsx'

async function buildWorkbookBuffer(rows: unknown[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Форма условий')
    worksheet.addRow(['Условия обязательности'])
    worksheet.addRow(['Пояснение'])
    worksheet.addRow([])
    worksheet.addRow([
        '№',
        'Код Вид МД',
        'Документ',
        'Решение',
        'Тип подразделения',
        'Вид подразделения',
        'Дополнительное условие',
        'Комментарий методолога',
        'Проверка строки',
    ])
    rows.forEach((row) => worksheet.addRow(row))
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('applicability matrix parser', () => {
    it('applies accepted demo decisions and removes subsumed stationary rows', async () => {
        const buffer = await buildWorkbookBuffer([
            [1, '1', 'Эпикриз', 'обязателен', 'Стационарный', '', '', ''],
            [2, '1', 'Эпикриз', 'обязателен', 'Стационарный', 'Дневной стационар', '', ''],
            [3, '34', 'Направление МСЭ', 'не обязателен', 'Амбулаторный', '', 'Возможен для узкоспециализированных МО', 'ГБУ КООД, ГКУ КОПБ'],
            [4, '340', 'Профосмотр', 'обязателен', 'Амбулаторный', '', 'при наличии лицензии 1080.4', 'ГБУ КОБ № 2'],
        ])

        const parsed = await loadApplicabilityMatrixWorkbook(buffer)

        expect(parsed.sourceRuleCount).toBe(4)
        expect(parsed.rules).toHaveLength(3)
        expect(parsed.ignoredRedundantRows).toEqual([6])

        const specialized = parsed.rules.find((rule) => rule.semdTypeCode === '34')!
        expect(specialized.requirementStatus).toBe('required')
        expect(specialized.conditionCode).toBe('specialized_organization')
        expect(specialized.organizationNames).toEqual(['ГБУ КООД', 'ГКУ КОПБ'])

        const licensed = parsed.rules.find((rule) => rule.semdTypeCode === '340')!
        expect(licensed.conditionCode).toBe('license_1080_4')
        expect(licensed.subdivisionType).toBe('')
        expect(licensed.organizationNames).toEqual(['ГБУ КОБ № 2'])
    })

    it('читает лицензию 1090.5 — управление транспортным средством', async () => {
        // Регрессия 26.08.2026. В матрице встречаются пять кодов лицензий,
        // а веток разбора было четыре: 1090.5 молча уходил в «условия нет».
        // Виды 8 и 475 из-за этого становились обязательными всем 33 МО
        // вместо семнадцати, у которых лицензия есть.
        const buffer = await buildWorkbookBuffer([
            [
                1, '8', 'Заключение о противопоказаниях к управлению ТС',
                'обязателен', 'Амбулаторный', '',
                'наличие лицензии на вид мед.деятельности 1090.5. медицинскому '
                + 'освидетельствованию на наличие медицинских противопоказаний '
                + 'к управлению транспортным средством',
                '',
            ],
        ])

        const parsed = await loadApplicabilityMatrixWorkbook(buffer)

        expect(parsed.rules[0].conditionCode).toBe('license_1090_5')
    })

    it('«стационарной МП или дневного стационара» — не то же, что дневной стационар', async () => {
        // Регрессия 28.08.2026. Формулировка вида 341 содержит два способа
        // выполнить условие, а уходила в day_hospital_group, где проверялся
        // только дневной стационар. Медорганизации с круглосуточными
        // отделениями оставались необязанными — замечание методолога.
        const buffer = await buildWorkbookBuffer([
            [
                1, '341', 'Осмотр лечащим врачом', 'обязателен', 'Стационарный', '',
                'оказание стационарной МП или в условиях дневного стационара', '',
            ],
            [
                2, '389', 'Эпикриз дневного стационара', 'обязателен', 'Амбулаторный', '',
                'все дневные стационары', '',
            ],
        ])

        const parsed = await loadApplicabilityMatrixWorkbook(buffer)

        const both = parsed.rules.find((rule) => rule.semdTypeCode === '341')
        expect(both?.conditionCode).toBe('inpatient_or_day_hospital')

        // Правило, где речь только про дневные стационары, остаётся прежним.
        const dayOnly = parsed.rules.find((rule) => rule.semdTypeCode === '389')
        expect(dayOnly?.conditionCode).toBe('day_hospital_group')
    })

    it('отмечает строки без перечня МО, но не объявляет это предупреждением', async () => {
        // Вид 68: методолог написала «Перечень МО определяется по справочнику признаков МО»
        // и наименований не оставила. Парсер справочника не видит, поэтому только помечает
        // строку; закрыто условие или нет, решает импортёр.
        const buffer = await buildWorkbookBuffer([
            [1, '68', 'Заключение об усыновлении', 'обязателен', '', '',
                'Обязателен для МО с прикрепленным населением',
                'Перечень МО определяется по справочнику признаков МО'],
            [2, '2', 'Эпикриз амбулаторный', 'обязателен', 'Амбулаторный', '', '', ''],
        ])

        const parsed = await loadApplicabilityMatrixWorkbook(buffer)

        expect(parsed.rowsWithoutOrganizationList).toEqual([5])
        expect(parsed.warnings.join(' ')).not.toContain('список МО')
    })

    it('extracts slash and comma separated organization names from comments', () => {
        expect(extractApplicabilityOrganizationNames(
            'Рабочий список: / ГБУ Катайская ЦРБ / ГБУ МРБ № 1 / ГБУ КООД, ГКУ КОПБ (под вопросом)',
        )).toEqual([
            'ГБУ Катайская ЦРБ',
            'ГБУ МРБ № 1',
            'ГБУ КООД',
            'ГКУ КОПБ',
        ])
    })

    it('extracts organization names separated only by repeated legal-form prefixes', () => {
        expect(extractApplicabilityOrganizationNames(
            'В Курганской области таких МО 3. ГБУ «Далматовская ЦРБ» ГБУ КОБ № 2 ГБУ МРБ № 1',
        )).toEqual([
            'ГБУ «Далматовская ЦРБ»',
            'ГБУ КОБ № 2',
            'ГБУ МРБ № 1',
        ])
    })

    /**
     * Р9 (дополнение формы_1 от 28.07): колонки «Приоритет обязательности 1..4».
     * У вида бывает 1–2 основания; несколько трактуются как ИЛИ.
     */
    it('reads requirement grounds from the priority columns', async () => {
        const workbook = new ExcelJS.Workbook()
        const worksheet = workbook.addWorksheet('Форма условий')
        worksheet.addRow(['Условия обязательности'])
        worksheet.addRow(['Пояснение'])
        worksheet.addRow([])
        worksheet.addRow([
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
        ])
        worksheet.addRow([
            1, '121', 'Протокол цитологического исследования', 'обязателен',
            'Лабораторно-диагностический', '', '', '', 'ГОТОВО',
            'условия входимости ТВСП МО в показатель',
            'наличие объема МП, утвержденного государственным заданием региона',
            '', '',
        ])
        worksheet.addRow([
            2, '39', 'Медицинская справка', 'обязателен',
            'Амбулаторный', '', '', '', 'ГОТОВО',
            '', '', '', 'наличие прикрепленного населения',
        ])

        const parsed = await loadApplicabilityMatrixWorkbook(
            Buffer.from(await workbook.xlsx.writeBuffer()),
        )

        const cytology = parsed.rules.find((rule) => rule.semdTypeCode === '121')
        expect(cytology?.grounds).toEqual([
            { level: 1, text: 'условия входимости ТВСП МО в показатель' },
            {
                level: 2,
                text: 'наличие объема МП, утвержденного государственным заданием региона',
            },
        ])

        const certificate = parsed.rules.find((rule) => rule.semdTypeCode === '39')
        expect(certificate?.grounds).toEqual([
            { level: 4, text: 'наличие прикрепленного населения' },
        ])
    })

    it('keeps parsing forms without the priority columns', async () => {
        const buffer = await buildWorkbookBuffer([
            [1, '2', 'Эпикриз амбулаторный', 'обязателен', 'Амбулаторный', '', '', ''],
        ])

        const parsed = await loadApplicabilityMatrixWorkbook(buffer)

        expect(parsed.rules).toHaveLength(1)
        expect(parsed.rules[0].grounds).toEqual([])
    })
})
