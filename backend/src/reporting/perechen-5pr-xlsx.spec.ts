import * as ExcelJS from 'exceljs'
// fflate is already an installed transitive dependency of exceljs (not a new dependency) —
// reused here only to reorder test-fixture zip entries so they match what real Excel-produced
// files look like. ExcelJS's own writeBuffer() places xl/workbook.xml *after* the worksheet
// entries, which ExcelJS's *streaming* reader (used in perechen-5pr-xlsx.ts to survive the
// real reference file's ~1M-row bloated dimension) requires to appear first.
import * as fflate from 'fflate'
import { parsePerechen5prXlsx } from './perechen-5pr-xlsx'

function reorderForStreamingReader(buffer: Buffer): Buffer {
    const unzipped = fflate.unzipSync(buffer)
    const rank = (key: string): number => {
        if (key === 'xl/workbook.xml') return 0
        if (key.startsWith('xl/worksheets/')) return 2
        return 1
    }
    const orderedEntries = Object.keys(unzipped)
        .sort((a, b) => rank(a) - rank(b))
        .map((key): [string, Uint8Array] => [key, unzipped[key]])
    return Buffer.from(fflate.zipSync(Object.fromEntries(orderedEntries), { level: 0 }))
}

async function buildWorkbook(rows: Array<[string, string, string]>): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Лист1')
    sheet.addRow(['Заголовок отчёта'])
    sheet.addRow([])
    sheet.addRow(['№ п/п', 'Вид МД*', 'Формат', 'Наименование вида СЭМД'])
    rows.forEach(([typeCode, format, name], index) => {
        sheet.addRow([index + 1, typeCode, format, name])
    })
    return reorderForStreamingReader(Buffer.from(await workbook.xlsx.writeBuffer()))
}

describe('parsePerechen5prXlsx', () => {
    it('reads Вид МД + official name rows after the header', async () => {
        const buffer = await buildWorkbook([
            ['350', 'CDA', 'Выписка из истории болезни'],
            ['347', 'CDA', 'Выписка из протокола решения врачебной комиссии'],
        ])

        const result = await parsePerechen5prXlsx(buffer)

        expect(result.rows).toHaveLength(2)
        expect(result.rows[0]).toEqual({
            typeCode: '350',
            format: 'CDA',
            officialName: 'Выписка из истории болезни',
        })
        expect(result.warnings).toHaveLength(0)
    })

    it('warns on duplicate Вид МД codes', async () => {
        const buffer = await buildWorkbook([
            ['350', 'CDA', 'Выписка из истории болезни'],
            ['350', 'CDA', 'Выписка из истории болезни (дубликат)'],
        ])

        const result = await parsePerechen5prXlsx(buffer)

        expect(result.rows).toHaveLength(2)
        expect(result.warnings.some((warning) => warning.includes('350'))).toBe(true)
    })

    it('rejects a file without the Вид МД* header', async () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Лист1')
        sheet.addRow(['№ п/п', 'Код', 'Название'])
        sheet.addRow([1, '350', 'Выписка'])
        const buffer = reorderForStreamingReader(Buffer.from(await workbook.xlsx.writeBuffer()))

        await expect(parsePerechen5prXlsx(buffer)).rejects.toThrow('Вид МД*')
    })
})
