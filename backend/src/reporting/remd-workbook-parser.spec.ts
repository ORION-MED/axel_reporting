import * as ExcelJS from 'exceljs'
import {
    buildRemdWorkbookPreview,
    parseRemdWorkbook,
} from './remd-workbook-parser'

function addMetadata(sheet: ExcelJS.Worksheet, recordCount: number, title: string) {
    sheet.addRow([`${title} за период 01.01.2026 - 30.06.2026`])
    sheet.addRow(['Дата формирования: 01.07.2026 10:17'])
    sheet.addRow([`Общее количество записей: ${recordCount}`])
    sheet.addRow([])
}

function buildWorkbook(): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook()

    const region = workbook.addWorksheet('Отчет РЭМД')
    addMetadata(region, 1, 'Отчет РЭМД')
    region.addRow([
        'Наименование субъекта Российской Федерации',
        'Количество уникальных видов СЭМД',
        'Количество СЭМД',
        'Тип СЭМД А',
        null,
        'Тип СЭМД Б',
    ])
    region.addRow([null, null, null, 'CDA', 'PDF/A-1', 'CDA'])
    region.addRow(['Итого', 2, 20, 10, 2, 8])
    region.addRow(['Курганская область', 2, 20, 10, 2, 8])

    const institutions = workbook.addWorksheet('Отчет РЭМД по МО')
    addMetadata(institutions, 2, 'Отчет РЭМД по МО')
    institutions.addRow([
        'Наименование субъекта Российской Федерации',
        'Наименование медицинской организации',
        'OID медицинской организации',
        'Количество уникальных видов СЭМД',
        'Количество всего',
        'Тип СЭМД А',
        null,
        'Тип СЭМД Б',
    ])
    institutions.addRow([null, null, null, null, null, 'CDA', 'PDF/A-1', 'CDA'])
    institutions.addRow(['Итого', null, null, 2, 20, 10, 2, 8])
    institutions.addRow(['Курганская область', 'ГБУ "МО 1"', '1.2.3.1', 2, 10, 5, 1, 4])
    institutions.addRow(['Курганская область', 'ГБУ "МО 2"', '1.2.3.2', 2, 10, 5, 1, 4])

    const subdivisions = workbook.addWorksheet('Отчет РЭМД по подразделениям')
    addMetadata(subdivisions, 2, 'Отчет РЭМД по подразделениям')
    subdivisions.addRow([
        'Наименование субъекта Российской Федерации',
        'Наименование медицинской организации',
        'OID медицинской организации',
        'OID СП МО',
        'Название СП МО',
        'ID здания',
        'Название здания',
        'Адрес здания',
        'Количество всего',
        'Тип СЭМД А',
        null,
        'Тип СЭМД Б',
    ])
    subdivisions.addRow([
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'CDA',
        'PDF/A-1',
        'CDA',
    ])
    subdivisions.addRow(['Итого', null, null, null, null, null, null, null, 20, 10, 2, 8])
    subdivisions.addRow([
        'Курганская область',
        'ГБУ "МО 1"',
        '1.2.3.1',
        '1.2.3.1.1',
        'Подразделение 1',
        '10',
        'Корпус 1',
        'Адрес 1',
        10,
        5,
        1,
        4,
    ])
    subdivisions.addRow([
        'Курганская область',
        'ГБУ "МО 2"',
        '1.2.3.2',
        '1.2.3.2.1',
        'Подразделение 2',
        '20',
        'Корпус 2',
        'Адрес 2',
        10,
        5,
        1,
        4,
    ])

    return workbook
}

describe('parseRemdWorkbook', () => {
    it('parses all three levels and reconciles totals', () => {
        const result = parseRemdWorkbook(buildWorkbook())

        expect(result.metadata).toEqual({
            periodFrom: '2026-01-01',
            periodTo: '2026-06-30',
            generatedAt: '2026-07-01T10:17:00',
        })
        expect(result.region.rows).toHaveLength(1)
        expect(result.institutions.rows).toHaveLength(2)
        expect(result.subdivisions.rows).toHaveLength(2)
        expect(result.semdTypes).toHaveLength(2)
        expect(result.activeRegionSemdTypeCount).toBe(2)
        expect(result.checks.every((check) => check.status === 'passed')).toBe(true)
        expect(result.issues).toHaveLength(0)

        const preview = buildRemdWorkbookPreview(result)
        expect(preview.canConfirm).toBe(true)
        expect(preview.totals).toEqual(expect.objectContaining({
            institutionCount: 2,
            subdivisionRowCount: 2,
            unassignedSubdivisionRowCount: 0,
            activeRegionSemdTypeCount: 2,
            regionDocumentCount: 20,
        }))
    })

    it('reports a mismatch between the region and institution totals', () => {
        const workbook = buildWorkbook()
        workbook.getWorksheet('Отчет РЭМД по МО')!.getCell('E9').value = 9

        const result = parseRemdWorkbook(workbook)

        expect(result.checks).toContainEqual(expect.objectContaining({
            code: 'region_vs_institutions',
            status: 'failed',
            expected: 20,
            actual: 19,
        }))
        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'region_vs_institutions',
            severity: 'error',
        }))
    })

    /**
     * Сводный отчёт РЭМД от 15.08.2026: в колонке «количество уникальных видов»
     * стоит COUNTIF без сохранённого результата — 38 таких ячеек, одна на регион
     * и по одной на каждую из 37 МО. ExcelJS отдаёт объект формулы, и до правки
     * он приводился к «[object Object]»: файл не проходил подтверждение целиком,
     * хотя все семь сверок итогов сходились.
     */
    it('формула без сохранённого значения — это «не заявлено», а не ошибка', () => {
        const workbook = buildWorkbook()
        // Ровно то, что отдаёт ExcelJS для формулы без кэша.
        workbook.getWorksheet('Отчет РЭМД')!.getCell('B8').value = {
            formula: 'COUNTIF(D8:F8,">0")',
            result: undefined,
        } as unknown as ExcelJS.CellValue
        workbook.getWorksheet('Отчет РЭМД по МО')!.getCell('D8').value = {
            formula: 'COUNTIF(F8:H8,">0")',
            result: undefined,
        } as unknown as ExcelJS.CellValue

        const result = parseRemdWorkbook(workbook)

        expect(result.issues).not.toContainEqual(expect.objectContaining({
            code: 'invalid_document_count',
        }))
        // «Не заявлено» сверять не с чем — расхождения быть не должно.
        expect(result.issues).not.toContainEqual(expect.objectContaining({
            code: 'region_unique_type_count_mismatch',
        }))
        expect(result.issues).not.toContainEqual(expect.objectContaining({
            code: 'institution_unique_type_count_mismatch',
        }))
        expect(result.region.rows[0].uniqueSemdTypes).toBeNull()
    })

    it('заявленный ноль по-прежнему расходится с расчётом', () => {
        // Страховка на то, что правка не проглотила настоящее расхождение:
        // пустая ячейка и явный ноль — разные вещи.
        const workbook = buildWorkbook()
        workbook.getWorksheet('Отчет РЭМД')!.getCell('B8').value = 0

        const result = parseRemdWorkbook(workbook)

        expect(result.issues).toContainEqual(expect.objectContaining({
            code: 'region_unique_type_count_mismatch',
            severity: 'error',
        }))
    })

    it('rejects a workbook without the subdivision sheet', () => {
        const workbook = buildWorkbook()
        workbook.removeWorksheet(workbook.getWorksheet('Отчет РЭМД по подразделениям')!.id)

        expect(() => parseRemdWorkbook(workbook)).toThrow(
            'В Excel-файле не найден лист отчета по подразделениям',
        )
    })
})
