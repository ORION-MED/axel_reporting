import * as ExcelJS from 'exceljs'
import { parseRemdNumeratorXlsx } from './remd-numerator-xlsx'

async function buildWorkbook(
    rows: Array<[string, string, string, string, string?, string?]>,
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Отчет по МО')
    sheet.addRow(['Название отчета'])
    sheet.addRow(['Дата начала периода:'])
    sheet.addRow(['Дата окончания периода:'])
    sheet.addRow(['Дата формирования отчета:'])
    sheet.addRow([])
    sheet.addRow([
        'Наименование субъекта Российской Федерации',
        'OID МО',
        'Наименование МО',
        'OID СП МО',
        'Наименование СП МО',
        'Вид МД',
        'Вид ЭМД',
        'Количество ЭМД',
    ])
    for (const [oid, name, docType, count, subOid, subName] of rows) {
        sheet.addRow([
            'Курганская область',
            oid,
            name,
            subOid ?? '<Пусто>',
            subName ?? '<Пусто>',
            docType,
            `${docType} (CDA) Редакция 1`,
            Number(count),
        ])
    }
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

/**
 * Широкий отчёт РЭМД: те же три листа, что читает remd-workbook-parser.ts. Шапка занимает
 * две строки — наименования видов (объединённые по колонкам форматов) и форматы под ними.
 */
async function buildWideWorkbook(options: {
    withSubdivisionSheet?: boolean
    mergeTypeHeader?: boolean
} = {}): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()

    const region = workbook.addWorksheet('Отчет РЭМД')
    region.addRow(['Отчет РЭМД за период 01.01.2026 - 31.07.2026'])
    region.addRow(['Дата формирования: 04.08.2026 08:30'])
    region.addRow(['Общее количество записей: 1'])
    region.addRow([])
    region.addRow([
        'Наименование субъекта Российской Федерации',
        'Количество уникальных видов СЭМД',
        'Количество СЭМД',
    ])

    const institutions = workbook.addWorksheet('Отчет РЭМД по МО')
    institutions.addRow(['Отчет РЭМД по МО за период 01.01.2026 - 31.07.2026'])
    institutions.addRow(['Дата формирования: 04.08.2026 08:30'])
    institutions.addRow(['Общее количество записей: 2'])
    institutions.addRow([])
    institutions.addRow([
        'Наименование субъекта Российской Федерации',
        'Наименование медицинской организации',
        'OID медицинской организации',
        'Количество уникальных видов СЭМД\n(указывается количество)',
        'Количество всего\n(суммарное количество ЭМД)',
        'Протокол консультации',
        null,
        'Эпикриз в стационаре выписной',
    ])
    institutions.addRow([null, null, null, null, null, 'CDA', 'PDF/A-1', 'CDA'])
    institutions.addRow(['Итого', null, null, 2, 33, 20, 3, 10])
    institutions.addRow(['Курганская область', 'ГБУ "МО 1"', '1.2.3.1', 2, 23, 20, 3, null])
    institutions.addRow(['Курганская область', 'ГБУ "МО 2"', '1.2.3.2', 1, 10, null, null, 10])
    if (options.mergeTypeHeader) {
        institutions.mergeCells(5, 6, 5, 7)
    }

    if (options.withSubdivisionSheet !== false) {
        const subdivisions = workbook.addWorksheet('Отчет РЭМД по подразделениям')
        subdivisions.addRow(['Отчет РЭМД по подразделениям за период 01.01.2026 - 31.07.2026'])
        subdivisions.addRow(['Дата формирования: 04.08.2026 08:30'])
        subdivisions.addRow(['Общее количество записей: 3'])
        subdivisions.addRow([])
        subdivisions.addRow([
            'Наименование субъекта Российской Федерации',
            'Наименование медицинской организации',
            'OID медицинской организации',
            'OID СП МО',
            'Название СП МО',
            'ID здания',
            'Название здания',
            'Адрес здания',
            'Количество всего\n(суммарное количество ЭМД)',
            'Протокол консультации',
            null,
            'Эпикриз в стационаре выписной',
        ])
        subdivisions.addRow([
            null, null, null, null, null, null, null, null, null,
            'CDA', 'PDF/A-1', 'CDA',
        ])
        subdivisions.addRow([
            'Итого', null, null, null, null, null, null, null, 33, 20, 3, 10,
        ])
        subdivisions.addRow([
            'Курганская область', 'ГБУ "МО 1"', '1.2.3.1',
            '1.2.3.1.0.100', 'Поликлиника', '1', 'Главный корпус', 'г. Курган',
            18, 15, 3, null,
        ])
        subdivisions.addRow([
            'Курганская область', 'ГБУ "МО 1"', '1.2.3.1',
            '', '', '', '', '',
            5, 5, null, null,
        ])
        subdivisions.addRow([
            'Курганская область', 'ГБУ "МО 2"', '1.2.3.2',
            '1.2.3.2.0.200', 'Стационар', '2', 'Корпус 2', 'г. Шадринск',
            10, null, null, 10,
        ])
    }

    return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('parseRemdNumeratorXlsx', () => {
    it('reads organization-level (Вид МД, count) rows from the tidy sheet', async () => {
        const buffer = await buildWorkbook([
            ['1.2.643.5.1.13.13.12.2.45.10975', 'ФКУ ГБ МСЭ', 'Протокол консультации', '10'],
            ['1.2.643.5.1.13.13.12.2.45.10975', 'ФКУ ГБ МСЭ', 'Протокол консультации', '5'],
        ])

        const result = await parseRemdNumeratorXlsx(buffer)

        expect(result.sheetName).toBe('Отчет по МО')
        expect(result.rows).toHaveLength(2)
        expect(result.rows[0]).toEqual({
            organizationOid: '1.2.643.5.1.13.13.12.2.45.10975',
            organizationName: 'ФКУ ГБ МСЭ',
            subdivisionOid: '',
            subdivisionName: '',
            // В «тидy»-выгрузке колонок здания нет.
            buildingId: '',
            buildingName: '',
            buildingAddress: '',
            documentTypeName: 'Протокол консультации',
            documentCount: 10,
        })
    })

    it('reads OID СП МО and name when present, treats <Пусто> as empty', async () => {
        const buffer = await buildWorkbook([
            ['1.2.643....10975', 'ФКУ ГБ МСЭ', 'Протокол консультации', '10',
                '1.2.643....10975.0.481842', 'Бюро 6'],
            ['1.2.643....10975', 'ФКУ ГБ МСЭ', 'Протокол консультации', '4'],
        ])

        const result = await parseRemdNumeratorXlsx(buffer)

        expect(result.rows[0].subdivisionOid).toBe('1.2.643....10975.0.481842')
        expect(result.rows[0].subdivisionName).toBe('Бюро 6')
        expect(result.rows[1].subdivisionOid).toBe('')
        expect(result.rows[1].subdivisionName).toBe('')
    })

    it('skips rows with an empty OID МО and warns', async () => {
        const buffer = await buildWorkbook([
            ['', 'Без ОИД', 'Протокол консультации', '3'],
            ['1.2.643.5.1.13.13.12.2.45.10975', 'ФКУ ГБ МСЭ', 'Протокол консультации', '10'],
        ])

        const result = await parseRemdNumeratorXlsx(buffer)

        expect(result.rows).toHaveLength(1)
        expect(result.skippedRowCount).toBe(1)
        expect(result.warnings.some((warning) => warning.includes('1'))).toBe(true)
    })

    it('rejects a file missing the required headers', async () => {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Отчет по МО')
        sheet.addRow(['Колонка A', 'Колонка Б'])
        sheet.addRow(['x', 'y'])
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

        await expect(parseRemdNumeratorXlsx(buffer)).rejects.toThrow('OID МО')
    })

    describe('широкий отчёт РЭМД', () => {
        it('разворачивает лист по подразделениям в строки (МО, СП, вид, количество)', async () => {
            const result = await parseRemdNumeratorXlsx(await buildWideWorkbook())

            expect(result.layout).toBe('wide')
            expect(result.sheetName).toBe('Отчет РЭМД по подразделениям')
            // Пять непустых ячеек видов: 15 + 3 и 5 у МО 1, 10 у МО 2.
            expect(result.rows).toHaveLength(4)
            expect(result.rows[0]).toEqual({
                organizationOid: '1.2.3.1',
                organizationName: 'ГБУ "МО 1"',
                subdivisionOid: '1.2.3.1.0.100',
                subdivisionName: 'Поликлиника',
                // Здание читается из широкого листа: на нём стоит показатель 1.24,
                // где ТВСП определён как отдельный адрес.
                buildingId: '1',
                buildingName: 'Главный корпус',
                buildingAddress: 'г. Курган',
                documentTypeName: 'Протокол консультации',
                documentCount: 15,
            })
            // Вторая колонка формата несёт то же наименование вида — суммирование делает импортёр.
            expect(result.rows[1]).toMatchObject({
                documentTypeName: 'Протокол консультации',
                documentCount: 3,
            })
            expect(result.rows[3]).toMatchObject({
                organizationOid: '1.2.3.2',
                subdivisionOid: '1.2.3.2.0.200',
                documentTypeName: 'Эпикриз в стационаре выписной',
                documentCount: 10,
            })
        })

        it('не теряет сумму фактов при развороте и пропускает строку «Итого»', async () => {
            const result = await parseRemdNumeratorXlsx(await buildWideWorkbook())

            const total = result.rows.reduce((sum, row) => sum + row.documentCount, 0)
            expect(total).toBe(33)
            expect(result.rows.some((row) => row.organizationName === 'Итого')).toBe(false)
        })

        it('оставляет OID подразделения пустым, если документы к нему не привязаны', async () => {
            const result = await parseRemdNumeratorXlsx(await buildWideWorkbook())

            const unassigned = result.rows.filter((row) => row.subdivisionOid === '')
            expect(unassigned).toHaveLength(1)
            expect(unassigned[0].documentCount).toBe(5)
        })

        it('читает объединённую шапку вида, растянутую на колонки форматов', async () => {
            const result = await parseRemdNumeratorXlsx(
                await buildWideWorkbook({ withSubdivisionSheet: false, mergeTypeHeader: true }),
            )

            expect(result.sheetName).toBe('Отчет РЭМД по МО')
            expect(
                result.rows
                    .filter((row) => row.documentTypeName === 'Протокол консультации')
                    .reduce((sum, row) => sum + row.documentCount, 0),
            ).toBe(23)
        })

        it('берёт лист по МО, если листа по подразделениям в файле нет', async () => {
            const result = await parseRemdNumeratorXlsx(
                await buildWideWorkbook({ withSubdivisionSheet: false }),
            )

            expect(result.layout).toBe('wide')
            expect(result.sheetName).toBe('Отчет РЭМД по МО')
            expect(result.rows.every((row) => row.subdivisionOid === '')).toBe(true)
            expect(result.rows.reduce((sum, row) => sum + row.documentCount, 0)).toBe(33)
        })

        it('сообщает о развороте предупреждением', async () => {
            const result = await parseRemdNumeratorXlsx(await buildWideWorkbook())

            expect(result.warnings.join(' ')).toMatch(/широкий отчёт РЭМД/i)
        })

        it('не удваивает факт, если ячейки данных объединены по колонкам форматов', async () => {
            // Так выгружает сама РЭМД: значение лежит в первой колонке пары, вторая —
            // «ведомая» ячейка объединения, и ExcelJS отдаёт для неё то же значение.
            const workbook = new ExcelJS.Workbook()
            const sheet = workbook.addWorksheet('Отчет РЭМД по МО')
            sheet.addRow([
                'Наименование субъекта Российской Федерации',
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Количество уникальных видов СЭМД',
                'Количество всего',
                'Протокол консультации',
                null,
            ])
            sheet.addRow([null, null, null, null, null, 'CDA', 'PDF/A-1'])
            sheet.addRow(['Курганская область', 'ГБУ "МО 1"', '1.2.3.1', 1, 20, 20, null])
            sheet.mergeCells(1, 6, 1, 7)
            sheet.mergeCells(3, 6, 3, 7)
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

            const result = await parseRemdNumeratorXlsx(buffer)

            expect(result.rows).toHaveLength(1)
            expect(result.rows[0].documentCount).toBe(20)
            expect(result.warnings.join(' ')).not.toMatch(/не сошлась/i)
        })

        it('предупреждает, если сумма развёрнутых колонок не сошлась с «Количество всего»', async () => {
            const workbook = new ExcelJS.Workbook()
            const sheet = workbook.addWorksheet('Отчет РЭМД по МО')
            sheet.addRow([
                'Наименование субъекта Российской Федерации',
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Количество уникальных видов СЭМД',
                'Количество всего',
                'Протокол консультации',
            ])
            sheet.addRow([null, null, null, null, null, 'CDA'])
            sheet.addRow(['Курганская область', 'ГБУ "МО 1"', '1.2.3.1', 1, 99, 20])
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

            const result = await parseRemdNumeratorXlsx(buffer)

            expect(result.warnings.join(' ')).toMatch(/не сошлась/i)
            expect(result.warnings.join(' ')).toContain('-79')
        })

        it('отклоняет отрицательное количество ЭМД в колонке вида', async () => {
            const workbook = new ExcelJS.Workbook()
            const sheet = workbook.addWorksheet('Отчет РЭМД по МО')
            sheet.addRow([
                'Наименование субъекта Российской Федерации',
                'Наименование медицинской организации',
                'OID медицинской организации',
                'Количество уникальных видов СЭМД',
                'Количество всего',
                'Протокол консультации',
            ])
            sheet.addRow([null, null, null, null, null, 'CDA'])
            sheet.addRow(['Курганская область', 'ГБУ "МО 1"', '1.2.3.1', 1, -5, -5])
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

            await expect(parseRemdNumeratorXlsx(buffer)).rejects.toThrow(
                /некорректное значение/i,
            )
        })

        /**
         * Интервал из шапки — единственное, чем помесячная выгрузка отличается
         * от нарастающей: имена файлов у них начинаются одинаково.
         */
        it('читает интервал выгрузки из шапки отчёта', async () => {
            const result = await parseRemdNumeratorXlsx(await buildWideWorkbook())

            expect(result.interval).toEqual({
                from: { day: 1, month: 1, year: 2026 },
                to: { day: 31, month: 7, year: 2026 },
            })
        })
    })

    it('«тидy»-файл интервала не несёт', async () => {
        // Там первая строка — название отчёта без дат, и месяц придётся спросить.
        const result = await parseRemdNumeratorXlsx(
            await buildWorkbook([['1.2.3.1', 'ГБУ "МО 1"', 'Протокол консультации', '5']]),
        )

        expect(result.interval).toBeNull()
    })
})
