import * as ExcelJS from 'exceljs'
import {
    extractLicenseCode,
    parseOrganizationDirectoryWorkbook,
} from './organization-directory-xlsx'

/**
 * Тесты на разбор справочника МО региона (файл методолога от 04.08.2026).
 *
 * Проверяются ровно те места, где живой файл отличается от того, что мы предполагали:
 * население закодировано числом, а не «Да/Нет»; перечень лицензий открытый; в файле
 * встречаются служебная строка с итогом и продублированное полное наименование.
 */

const HEADER = [
    'OID МО по ФРМО',
    'Наименование МО по ФРМО',
    'Краткое наименование МО по ФРМО',
    'краткое наименование для отображения в сервисе',
    'прикрепленное население: взрослое  -1, детское -2, взрослое и детское -3',
    'лицензии на отдельные виды мед.помощи 1090.4. медицинскому освидетельствованию на наличие медицинских противопоказаний к владению оружием',
    'лицензии на отдельные виды мед.помощи 1090.5. медицинскому освидетельствованию на наличие медицинских противопоказаний к управлению транспортным средством',
    'лицензии на отдельные виды мед.помощи 1080.1. медицинским осмотрам (предварительным, периодическим)',
]

function buildWorkbook(rows: unknown[][]): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Лист1')
    worksheet.addRow(HEADER)
    for (const row of rows) worksheet.addRow(row)
    return workbook
}

const OID_1 = '1.2.643.5.1.13.13.12.2.45.4263'
const OID_2 = '1.2.643.5.1.13.13.12.2.45.4282'
const OID_3 = '1.2.643.5.1.13.13.12.2.45.4266'

describe('парсер справочника МО региона', () => {
    it('раскладывает код прикреплённого населения на два признака', () => {
        const result = parseOrganizationDirectoryWorkbook(buildWorkbook([
            [OID_1, 'ПОЛИКЛИНИКА №2', 'ГБУ "КП2"', 'КП2', '1'],
            [OID_2, 'ДЕТСКАЯ ПОЛИКЛИНИКА', 'ГБУ "КДП"', 'КДП', '2'],
            [OID_3, 'КАТАЙСКАЯ ЦРБ', 'ГБУ "КАТ ЦРБ"', 'Кат ЦРБ', '3'],
        ]))

        expect(result.entries.map((entry) => [
            entry.displayShortName,
            entry.attachedPopulation,
            entry.attachedChildPopulation,
        ])).toEqual([
            ['КП2', true, false],
            ['КДП', false, true],
            ['Кат ЦРБ', true, true],
        ])
        expect(result.attachedPopulationCount).toBe(2)
        expect(result.attachedChildPopulationCount).toBe(2)
    })

    it('пустой код населения означает «нет прикреплённого», а не «не определено»', () => {
        const result = parseOrganizationDirectoryWorkbook(buildWorkbook([
            [OID_1, 'ПЕРИНАТАЛЬНЫЙ ЦЕНТР', 'ГБУ "КОПЦ"', 'КОПЦ', ''],
        ]))

        expect(result.entries[0].attachedPopulation).toBe(false)
        expect(result.entries[0].attachedChildPopulation).toBe(false)
    })

    it('отвергает непонятный код населения, а не молча считает его пустым', () => {
        expect(() => parseOrganizationDirectoryWorkbook(buildWorkbook([
            [OID_1, 'ПОЛИКЛИНИКА №2', 'ГБУ "КП2"', 'КП2', '4'],
        ]))).toThrow(/непонятный код прикрепл/iu)
    })

    it('перечень лицензий берётся из заголовков, а не зашит в код', () => {
        const result = parseOrganizationDirectoryWorkbook(buildWorkbook([
            [OID_1, 'ПОЛИКЛИНИКА №2', 'ГБУ "КП2"', 'КП2', '1', '1', '1', ''],
            [OID_2, 'ДЕТСКАЯ ПОЛИКЛИНИКА', 'ГБУ "КДП"', 'КДП', '2', '', '', '1'],
        ]))

        expect(result.licenseColumns.map((column) => column.licenseCode))
            .toEqual(['1090.4', '1090.5', '1080.1'])
        expect(result.licenseCounts).toEqual({ '1090.4': 1, '1090.5': 1, '1080.1': 1 })
        expect(result.entries[0].licenses).toEqual({
            '1090.4': true,
            '1090.5': true,
            '1080.1': false,
        })
    })

    it('служебная строка с итогом под колонкой лицензий не попадает в данные', () => {
        const result = parseOrganizationDirectoryWorkbook(buildWorkbook([
            [OID_1, 'ПОЛИКЛИНИКА №2', 'ГБУ "КП2"', 'КП2', '1', '1'],
            ['', '', '', '', '', 18],
        ]))

        expect(result.entries).toHaveLength(1)
        expect(result.warnings).toEqual([])
    })

    it('дубль полного наименования — предупреждение, связка всё равно идёт по OID', () => {
        const result = parseOrganizationDirectoryWorkbook(buildWorkbook([
            [OID_1, 'НАРКОЛОГИЧЕСКИЙ ДИСПАНСЕР', 'ГБУ "КОНД"', 'КОНД', ''],
            [OID_2, 'НАРКОЛОГИЧЕСКИЙ ДИСПАНСЕР', 'ГБУ "ШГБ"', 'ШГБ', '3'],
        ]))

        expect(result.entries).toHaveLength(2)
        expect(result.entries[1].displayShortName).toBe('ШГБ')
        expect(result.warnings.join(' ')).toMatch(/полное наименование совпадает/iu)
    })

    it('повторный OID отбрасывается с предупреждением', () => {
        const result = parseOrganizationDirectoryWorkbook(buildWorkbook([
            [OID_1, 'ПОЛИКЛИНИКА №2', 'ГБУ "КП2"', 'КП2', '1'],
            [OID_1, 'ПОЛИКЛИНИКА №2 (дубль)', 'ГБУ "КП2"', 'КП2', '3'],
        ]))

        expect(result.entries).toHaveLength(1)
        expect(result.entries[0].attachedChildPopulation).toBe(false)
        expect(result.warnings.join(' ')).toMatch(/уже встречался/iu)
    })

    it('файл без колонки населения к разбору не принимается', () => {
        const workbook = new ExcelJS.Workbook()
        const worksheet = workbook.addWorksheet('Лист1')
        worksheet.addRow(['OID МО по ФРМО', 'Наименование МО по ФРМО'])
        worksheet.addRow([OID_1, 'ПОЛИКЛИНИКА №2'])

        expect(() => parseOrganizationDirectoryWorkbook(workbook))
            .toThrow(/не найден лист/iu)
    })
})

describe('код лицензии из заголовка колонки', () => {
    it('берёт номер вида работ и не тащит точку нумерации', () => {
        expect(extractLicenseCode('лицензии на отдельные виды мед.помощи 1090.4. медицинскому освидетельствованию'))
            .toBe('1090.4')
        expect(extractLicenseCode('лицензии на отдельные виды мед.помощи 1080.1. медицинским осмотрам'))
            .toBe('1080.1')
    })

    it('колонка без слова «лицензии» кодом лицензии не считается', () => {
        // Иначе «прикрепленное население: взрослое -1, детское -2» дало бы ложный код.
        expect(extractLicenseCode('прикрепленное население: взрослое -1, детское -2, взрослое и детское -3'))
            .toBe('')
        expect(extractLicenseCode('oid мо по фрмо')).toBe('')
    })
})
