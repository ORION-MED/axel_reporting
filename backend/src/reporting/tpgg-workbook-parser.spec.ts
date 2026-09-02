import * as ExcelJS from 'exceljs'
import {
    normalizeTpggOrganizationName,
    parseTpggWorkbook,
} from './tpgg-workbook-parser'

describe('ТПГГ workbook parser', () => {
    it('extracts annual organization values from different column layouts', () => {
        const workbook = new ExcelJS.Workbook()
        const first = workbook.addWorksheet('1.Скорая помощь')
        first.addRow(['Плановые объемы на 2026 год'])
        first.addRow([])
        first.addRow([
            '№ п/п',
            'Медицинская организация',
            'Расчет',
            'Всего, объемы скорой помощи',
        ])
        first.addRow(['', 'Итого', '', 50])
        first.addRow([1, 'ГБУ «Больница № 1»', '', 50])
        first.addRow([2, 'ГБУ "Больница №2"', '', 0])

        const second = workbook.addWorksheet('3.15 Телемедицина')
        second.addRow([])
        second.addRow([])
        second.addRow([
            '№ п/п',
            'Код МО',
            'Медицинская организация',
            'Всего, посещений',
        ])
        second.addRow([1, '450001', 'ГБУ «Больница № 1»', 12])

        workbook.addWorksheet('Оглавление').addRow(['Оглавление'])

        const parsed = parseTpggWorkbook(workbook)

        expect(parsed.reportingYear).toBe(2026)
        expect(parsed.entries).toEqual([
            expect.objectContaining({
                sheetCode: '1',
                rowNumber: 5,
                organizationName: 'ГБУ «Больница № 1»',
                normalizedOrganizationName: 'гбу больница 1',
                annualValue: 50,
            }),
            expect.objectContaining({
                sheetCode: '1',
                rowNumber: 6,
                organizationName: 'ГБУ "Больница №2"',
                normalizedOrganizationName: 'гбу больница 2',
                annualValue: 0,
            }),
            expect.objectContaining({
                sheetCode: '3.15',
                rowNumber: 4,
                annualValue: 12,
            }),
        ])
        expect(parsed.sheets).toEqual([
            expect.objectContaining({
                sheetName: '1.Скорая помощь',
                status: 'parsed',
                parsedRowCount: 2,
                positiveRowCount: 1,
                annualValueTotal: 50,
            }),
            expect.objectContaining({
                sheetName: '3.15 Телемедицина',
                status: 'parsed',
                parsedRowCount: 1,
            }),
            expect.objectContaining({
                sheetName: 'Оглавление',
                status: 'skipped',
                warning: '',
            }),
        ])
    })

    /**
     * Помесячная роспись нужна знаменателю долей: с 15.08.2026 он считается
     * нарастающим итогом, а не от годового плана.
     */
    it('reads the monthly breakdown from a row below the main header', () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('1.Скорая помощь')
        sheet.addRow(['Плановые объемы на 2026 год'])
        sheet.addRow([
            '№ п/п',
            'Медицинская организация',
            'Всего, вызовов',
            'в том числе поквартально',
        ])
        sheet.addRow(['№ п/п', 'Медицинская организация', 'Всего, вызовов', '1 квартал'])
        sheet.addRow([
            '№ п/п',
            'Медицинская организация',
            'Всего, вызовов',
            'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
            'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
        ])
        sheet.addRow([
            1, 'ГБУ «Больница № 1»', 4596,
            383, 383, 383, 383, 383, 383, 383, 383, 383, 383, 383, 383,
        ])

        const parsed = parseTpggWorkbook(workbook)

        expect(parsed.sheets[0]).toEqual(expect.objectContaining({
            monthHeaderRowNumber: 4,
            monthColumnCount: 12,
            parsedRowCount: 1,
        }))
        expect(parsed.entries[0].annualValue).toBe(4596)
        expect(parsed.entries[0].monthlyValues[1]).toBe(383)
        expect(parsed.entries[0].monthlyValues[12]).toBe(383)
    })

    /**
     * «сентябрь» — самое длинное название, и оно уже ломало разбор: роспись
     * читалась как одиннадцать месяцев из двенадцати молча. «авг.» и «сент.» —
     * форма из «Приложения 2».
     */
    it('matches both full month names and dotted abbreviations', () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('5. Круглосуточный ст.')
        sheet.addRow(['№ п/п', 'Медицинская организация', 'Всего, случаев'])
        sheet.addRow([
            '№ п/п', 'Медицинская организация', 'Всего, случаев',
            'янв.', 'фев.', 'март', 'апр.', 'май', 'июнь',
            'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.',
        ])
        sheet.addRow([1, 'ГБУ «Больница № 1»', 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])

        const parsed = parseTpggWorkbook(workbook)

        expect(parsed.sheets[0].monthColumnCount).toBe(12)
        expect(Object.keys(parsed.entries[0].monthlyValues)).toHaveLength(12)
        expect(parsed.entries[0].monthlyValues[9]).toBe(1)
    })

    it('does not mistake a service name starting with a month for a header', () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('2.7 ПАИ')
        sheet.addRow(['№ п/п', 'Медицинская организация', 'Всего, услуг', 'Майские осмотры'])
        sheet.addRow([1, 'ГБУ «Больница № 1»', 10, 4])

        const parsed = parseTpggWorkbook(workbook)

        expect(parsed.sheets[0].monthColumnCount).toBe(0)
        expect(parsed.sheets[0].monthHeaderRowNumber).toBeNull()
        expect(parsed.entries[0].monthlyValues).toEqual({})
    })

    /**
     * Лист без росписи — не мелочь: по нему знаменатель придётся откатывать
     * на годовой план, и это обязано быть видно, а не случиться молча.
     */
    it('warns about a sheet without a monthly breakdown', () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('6.ВМП')
        sheet.addRow(['№ п/п', 'Медицинская организация', 'Всего, случаев'])
        sheet.addRow([1, 'ГБУ «Больница № 1»', 10])

        const parsed = parseTpggWorkbook(workbook)

        expect(parsed.warnings).toEqual([
            expect.stringContaining('помесячная роспись не найдена'),
        ])
    })

    it('normalizes quotation marks, spaces, yo and organization number', () => {
        expect(
            normalizeTpggOrganizationName(
                '  ГБУ «Межрайонная   больница №  Ёлки»  ',
            ),
        ).toBe('гбу межрайонная больница елки')
    })
})
