import * as ExcelJS from 'exceljs'
import { parseFrmrXlsx } from './frmr-xlsx'

async function buildWorkbook(
    rows: Array<[string, string, string]>,
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('frmr_depart')
    sheet.addRow(['Отчет'])
    sheet.addRow(['Ведомственная принадлежность'])
    sheet.addRow(['Дата'])
    sheet.addRow(['Субъект РФ'])
    sheet.addRow([])
    sheet.addRow(['Количество записей'])
    sheet.addRow([
        'СНИЛС', 'Фамилия', 'Имя', 'Отчество', 'Пол', 'Дата рождения',
        'Субъект РФ', 'OID организации', 'Вид деятельности организации',
        'Профиль деятельности организации', 'Краткое наименование организации',
    ])
    for (const [oid, activityType, name] of rows) {
        sheet.addRow([
            '00000000000', null, null, null, null, null,
            'Курганская область', oid, activityType, null, name,
        ])
    }
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('parseFrmrXlsx', () => {
    it('collapses per-employee rows into unique organizations', async () => {
        const buffer = await buildWorkbook([
            ['1.2.643.5.1.13.13.12.2.45.4260', 'Госпиталь', 'ГБУ "КОГВВ"'],
            ['1.2.643.5.1.13.13.12.2.45.4260', 'Госпиталь', 'ГБУ "КОГВВ"'],
            ['1.2.643.5.1.13.13.12.2.45.4270', 'Поликлиника', 'ГБУ "МРБ5"'],
        ])

        const result = await parseFrmrXlsx(buffer)

        expect(result.recordCount).toBe(3)
        expect(result.organizations).toHaveLength(2)
        expect(result.organizations).toEqual(expect.arrayContaining([
            {
                organizationOid: '1.2.643.5.1.13.13.12.2.45.4260',
                organizationName: 'ГБУ "КОГВВ"',
                activityType: 'Госпиталь',
            },
            {
                organizationOid: '1.2.643.5.1.13.13.12.2.45.4270',
                organizationName: 'ГБУ "МРБ5"',
                activityType: 'Поликлиника',
            },
        ]))
        expect(result.warnings).toHaveLength(0)
    })

    it('warns when the same OID has conflicting activity types', async () => {
        const buffer = await buildWorkbook([
            ['1.2.643.5.1.13.13.12.2.45.4260', 'Госпиталь', 'ГБУ "КОГВВ"'],
            ['1.2.643.5.1.13.13.12.2.45.4260', 'Диспансер', 'ГБУ "КОГВВ"'],
        ])

        const result = await parseFrmrXlsx(buffer)

        expect(result.organizations).toHaveLength(1)
        expect(result.organizations[0].activityType).toBe('Госпиталь')
        expect(result.warnings).toHaveLength(1)
    })

    it('rejects a file missing the required headers', async () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('frmr_depart')
        sheet.addRow(['Колонка A', 'Колонка Б'])
        sheet.addRow(['x', 'y'])
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

        await expect(parseFrmrXlsx(buffer)).rejects.toThrow('OID организации')
    })

    it('collapses per-employee rows into unique subdivisions with type and kind', async () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('frmr_depart')
        for (let i = 0; i < 7; i += 1) sheet.addRow([`шапка ${i}`])
        sheet.addRow([
            'СНИЛС', 'Фамилия', 'Имя', 'Отчество', 'Пол', 'Дата рождения',
            'Субъект РФ', 'OID организации', 'Вид деятельности организации',
            'Профиль деятельности организации', 'Краткое наименование организации',
            'OID структурного подразделения', 'Тип структурного подразделения',
            'Вид структурного подразделения', 'Наименование структурного подразделения',
        ])
        const dataRow = (subOid: string, type: string, kind: string, name: string) => ([
            '00000000000', null, null, null, null, null,
            'Курганская область', '1.2.643.5.1.13.13.12.2.45.4260', 'Госпиталь',
            null, 'ГБУ "КОГВВ"', subOid, type, kind, name,
        ])
        sheet.addRow(dataRow('1.2.643....83350', 'Амбулаторный', 'Офтальмологические', 'Офтальм. кабинет'))
        // Same subdivision OID again (different employee) — collapses to one.
        sheet.addRow(dataRow('1.2.643....83350', 'Амбулаторный', 'Офтальмологические', 'Офтальм. кабинет'))
        sheet.addRow(dataRow('1.2.643....83351', 'Стационарный', 'Терапевтические', 'Терап. отделение'))
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

        const result = await parseFrmrXlsx(buffer)

        expect(result.subdivisions).toHaveLength(2)
        expect(result.subdivisionTypeCount).toBe(2)
        expect(result.subdivisionKindCount).toBe(2)
        expect(result.subdivisions[0]).toEqual({
            organizationOid: '1.2.643.5.1.13.13.12.2.45.4260',
            subdivisionOid: '1.2.643....83350',
            subdivisionType: 'Амбулаторный',
            subdivisionKind: 'Офтальмологические',
            subdivisionName: 'Офтальм. кабинет',
        })
    })
})
