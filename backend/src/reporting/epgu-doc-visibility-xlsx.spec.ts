import * as ExcelJS from 'exceljs'
import { parseEpguDocVisibilityXlsx } from './epgu-doc-visibility-xlsx'

const headers = [
    'doc_kind',
    'doc_title_full',
    'doc_title_short',
    'doc_category_title',
    'doc_class_id',
    'doc_visible',
    'doc_create_date',
]

async function buildWorkbook(
    dataRows: Array<Partial<Record<(typeof headers)[number], string>>>,
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Справочник')
    sheet.addRow(headers)
    sheet.addRow(headers.map(() => 'описание'))
    for (const values of dataRows) {
        sheet.addRow(headers.map((header) => values[header] ?? ''))
    }
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('parseEpguDocVisibilityXlsx', () => {
    it('groups rows by doc_class_id and keeps a representative doc_kind as the official OID', async () => {
        const buffer = await buildWorkbook([
            {
                doc_kind: '5',
                doc_title_full: 'Протокол инструментального исследования',
                doc_title_short: 'Протокол инструментального исследования',
                doc_category_title: 'Протоколы исследований',
                doc_class_id: '6',
                doc_visible: 'true',
                doc_create_date: '01.01.2024',
            },
            {
                doc_kind: '15',
                doc_title_full: 'Протокол инструментального исследования',
                doc_title_short: 'Протокол инструментального исследования',
                doc_category_title: 'Протоколы исследований',
                doc_class_id: '6',
                doc_visible: 'false',
                doc_create_date: '01.01.2024',
            },
        ])

        const result = await parseEpguDocVisibilityXlsx(buffer, {
            originalFilename: '1.2.643.5.1.13.13.99.2.1253_1.5.xlsx',
        })

        expect(result.sourceVersion).toBe('1.5')
        expect(result.rowCount).toBe(2)
        expect(result.types).toHaveLength(1)
        expect(result.types[0]).toEqual(expect.objectContaining({
            typeCode: '6',
            officialOid: '5',
            visible: true,
            rowCount: 2,
        }))
    })

    it('rejects a doc_visible value other than true/false', async () => {
        const buffer = await buildWorkbook([{
            doc_kind: '5',
            doc_title_full: 'Документ',
            doc_class_id: '6',
            doc_visible: 'Да',
        }])

        await expect(parseEpguDocVisibilityXlsx(buffer, {})).rejects.toThrow(
            'doc_visible',
        )
    })
})
