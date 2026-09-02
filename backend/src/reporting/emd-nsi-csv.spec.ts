import * as ExcelJS from 'exceljs'
import { normalizeSemdName, parseEmdNsiCsv, parseEmdNsiXlsx } from './emd-nsi-csv'

const headers = [
    'ID',
    'OID',
    'TYPE',
    'NAME',
    'LEVEL',
    'PATIENT_INFO',
    'SHELF_LIFE',
    'STORAGE_TYPE',
    'EXTENDED_LIFE',
    'UNLIMITED_LIFE',
    'MO_SIGN',
    'FORMAT',
    'START_DATE',
    'END_DATE',
    'IMPLEMENTATION_GUIDE',
    'GIT_LINK',
    'SHOW_PATIENT',
    'IS_ONLINE',
    'DAYS_COUNT',
    'SERIES_REQUIRED',
]

function row(values: Partial<Record<(typeof headers)[number], string>>): string {
    return headers.map((header) => {
        const value = values[header] ?? ''
        return `"${value.replace(/"/g, '""')}"`
    }).join(';')
}

describe('parseEmdNsiCsv', () => {
    it('normalizes the number sign like the REMD workbook parser', () => {
        expect(normalizeSemdName('Талон № 2')).toBe('талон_2')
    })

    it('groups document versions by TYPE and uses SHOW_PATIENT for EPGU', () => {
        const csv = [
            headers.join(';'),
            row({
                ID: '1',
                OID: '1',
                TYPE: '5',
                NAME: 'Протокол консультации (CDA) Редакция 1',
                FORMAT: '2',
                START_DATE: '01.01.2024',
                SHOW_PATIENT: 'Да',
                IS_ONLINE: 'Нет',
            }),
            row({
                ID: '2',
                OID: '2',
                TYPE: '5',
                NAME: 'Протокол консультации (PDF/A-1)',
                FORMAT: '1',
                START_DATE: '01.01.2020',
                END_DATE: '01.01.2024',
                SHOW_PATIENT: 'Нет',
                IS_ONLINE: 'Нет',
            }),
            row({
                ID: '3',
                OID: '3',
                TYPE: '6',
                NAME: 'Протокол исследования (CDA) Редакция 1',
                FORMAT: '2',
                START_DATE: '01.01.2024',
                SHOW_PATIENT: 'Нет',
                IS_ONLINE: 'Да',
            }),
        ].join('\n')

        const result = parseEmdNsiCsv(Buffer.from(csv), {
            reportingDate: '2026-06-30',
            originalFilename: '1.2.643.5.1.13.13.11.1520_12.89.csv',
        })

        expect(result.sourceVersion).toBe('12.89')
        expect(result.rows).toHaveLength(3)
        expect(result.types).toHaveLength(2)
        expect(result.activeTypeCount).toBe(2)
        expect(result.epguAvailableTypeCount).toBe(1)
        expect(result.types[0]).toEqual(expect.objectContaining({
            typeCode: '5',
            canonicalName: 'Протокол консультации',
            documentFormats: ['CDA', 'PDF/A-1'],
            epguAvailable: true,
        }))
    })

    it('adds the verified REMD rename aliases', () => {
        const csv = [
            headers.join(';'),
            row({
                ID: '274',
                OID: '274',
                TYPE: '535',
                NAME: 'Протокол противоопухолевой лекарственной терапии (CDA) Редакция 1',
                FORMAT: '2',
                START_DATE: '10.05.2025',
                SHOW_PATIENT: 'Нет',
                IS_ONLINE: 'Нет',
            }),
        ].join('\n')

        const result = parseEmdNsiCsv(Buffer.from(csv), {
            reportingDate: '2026-06-30',
        })

        expect(result.types[0].aliases).toContain(
            'Протокол противоопухолевого лекарственного лечения',
        )
    })

    it('maps the REMD prescription form number to the prescription SEMD type', () => {
        const csv = [
            headers.join(';'),
            row({
                ID: '148',
                OID: '148',
                TYPE: '86',
                NAME: 'Рецепт на лекарственный препарат (CDA) Редакция 2',
                FORMAT: '2',
                START_DATE: '01.01.2024',
                SHOW_PATIENT: 'Да',
                IS_ONLINE: 'Нет',
            }),
        ].join('\n')

        const result = parseEmdNsiCsv(Buffer.from(csv), {
            reportingDate: '2026-06-30',
        })

        expect(result.types[0].typeCode).toBe('86')
        expect(result.types[0].aliases).toContain('Рецепт 107-1/у')
        // Именно это нормализованное имя приходит из колонки «Вид МД» выгрузки РЭМД.
        expect(normalizeSemdName('Рецепт 107-1/у')).toBe('рецепт_107_1_у')
    })

    it('rejects a file without the EPGU source field', () => {
        const csv = 'ID;OID;TYPE;NAME\n1;1;5;Документ'
        expect(() => parseEmdNsiCsv(Buffer.from(csv), {
            reportingDate: '2026-06-30',
        })).toThrow('SHOW_PATIENT')
    })
})

describe('parseEmdNsiXlsx', () => {
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

    it('groups document versions by TYPE the same way as the CSV parser', async () => {
        const buffer = await buildWorkbook([
            {
                ID: '1',
                OID: '1',
                TYPE: '5',
                NAME: 'Протокол консультации (CDA) Редакция 1',
                FORMAT: '2',
                START_DATE: '01.01.2024',
                SHOW_PATIENT: 'Да',
                IS_ONLINE: 'Нет',
            },
            {
                ID: '2',
                OID: '2',
                TYPE: '5',
                NAME: 'Протокол консультации (PDF/A-1)',
                FORMAT: '1',
                START_DATE: '01.01.2020',
                END_DATE: '01.01.2024',
                SHOW_PATIENT: 'Нет',
                IS_ONLINE: 'Нет',
            },
        ])

        const result = await parseEmdNsiXlsx(buffer, {
            reportingDate: '2026-06-30',
            originalFilename: '1.2.643.5.1.13.13.11.1520_12.90.xlsx',
        })

        expect(result.sourceVersion).toBe('12.90')
        expect(result.rows).toHaveLength(2)
        expect(result.types).toHaveLength(1)
        expect(result.types[0]).toEqual(expect.objectContaining({
            typeCode: '5',
            canonicalName: 'Протокол консультации',
            epguAvailable: true,
        }))
    })
})
