import * as ExcelJS from 'exceljs'
import { parseRemdNumeratorXlsx } from './remd-numerator-xlsx'
import { parseEpguDocVisibilityXlsx } from './epgu-doc-visibility-xlsx'
import { parsePerechen5prXlsx } from './perechen-5pr-xlsx'
import { loadApplicabilityMatrixWorkbook } from './applicability-matrix-xlsx'
import { parseFrmrXlsx } from './frmr-xlsx'

/**
 * Этап 5 плана 24.07 — негативные сценарии загрузки. Проверяем, что повреждённый или
 * посторонний файл отклоняется явной ошибкой, а не проходит молча и не превращается
 * в бизнес-результат «0 %». Разделяем: пустой файл, отсутствие нужного листа,
 * изменённый заголовок, нулевое сопоставление строк.
 */

const EMPTY_BUFFER = Buffer.alloc(0)
const GARBAGE_BUFFER = Buffer.from('это не xlsx, а обычный текст', 'utf8')

async function workbookWith(
    sheetName: string,
    rows: Array<Array<string | number>>,
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(sheetName)
    for (const row of rows) sheet.addRow(row)
    return Buffer.from(await workbook.xlsx.writeBuffer())
}

describe('негативные сценарии импорта источников', () => {
    describe('числитель РЭМД', () => {
        it('отклоняет пустой файл', async () => {
            await expect(parseRemdNumeratorXlsx(EMPTY_BUFFER)).rejects.toThrow(
                /пуст/i,
            )
        })

        it('отклоняет файл, который не является XLSX', async () => {
            await expect(parseRemdNumeratorXlsx(GARBAGE_BUFFER)).rejects.toThrow(
                /не удалось прочитать/i,
            )
        })

        it('отклоняет файл с изменёнными заголовками колонок', async () => {
            const buffer = await workbookWith('Отчет по МО', [
                ['ОИД организации', 'Тип документа', 'Штук'],
                ['1.2.643.5.1.13.13.12.2.45.10975', 'Протокол консультации', 10],
            ])
            await expect(parseRemdNumeratorXlsx(buffer)).rejects.toThrow(
                /не найдены обязательные колонки/i,
            )
        })

        it('отклоняет файл с заголовками, но без единой строки фактов', async () => {
            const buffer = await workbookWith('Отчет по МО', [
                ['OID МО', 'Наименование МО', 'Вид МД', 'Количество ЭМД'],
            ])
            await expect(parseRemdNumeratorXlsx(buffer)).rejects.toThrow(
                /не найдено ни одной строки с фактами/i,
            )
        })

        it('отклоняет отрицательное количество ЭМД, а не молча обнуляет факт', async () => {
            const buffer = await workbookWith('Отчет по МО', [
                ['OID МО', 'Наименование МО', 'Вид МД', 'Количество ЭМД'],
                ['1.2.643.5.1.13.13.12.2.45.10975', 'ФКУ ГБ МСЭ', 'Протокол консультации', -5],
            ])
            await expect(parseRemdNumeratorXlsx(buffer)).rejects.toThrow(
                /некорректное значение/i,
            )
        })

        it('считает строки без OID МО пропущенными и сообщает об этом предупреждением', async () => {
            const buffer = await workbookWith('Отчет по МО', [
                ['OID МО', 'Наименование МО', 'Вид МД', 'Количество ЭМД'],
                ['', 'ФКУ ГБ МСЭ', 'Протокол консультации', 10],
                ['1.2.643.5.1.13.13.12.2.45.10975', 'ФКУ ГБ МСЭ', 'Протокол консультации', 7],
            ])
            const parsed = await parseRemdNumeratorXlsx(buffer)
            expect(parsed.rows).toHaveLength(1)
            expect(parsed.skippedRowCount).toBe(1)
            expect(parsed.warnings.join(' ')).toMatch(/пропущено строк/i)
        })
    })

    describe('справочник видимости на ЕПГУ (1253)', () => {
        it('отклоняет пустой файл', async () => {
            await expect(parseEpguDocVisibilityXlsx(EMPTY_BUFFER, {})).rejects.toThrow(
                /пуст/i,
            )
        })

        it('отклоняет файл с посторонним листом и чужими колонками', async () => {
            const buffer = await workbookWith('Лист1', [['что-то']])
            await expect(parseEpguDocVisibilityXlsx(buffer, {})).rejects.toThrow(
                /отсутствуют обязательные колонки/i,
            )
        })
    })

    describe('перечень видов СЭМД (№5пр)', () => {
        it('отклоняет пустой файл', async () => {
            await expect(parsePerechen5prXlsx(EMPTY_BUFFER)).rejects.toThrow(/пуст/i)
        })

        it('отклоняет файл без строки заголовков «Вид МД*»', async () => {
            const buffer = await workbookWith('Лист1', [
                ['произвольный текст'],
                ['ещё строка'],
            ])
            await expect(parsePerechen5prXlsx(buffer)).rejects.toThrow(
                /строка заголовков|не содержит записей|не удалось прочитать/i,
            )
        })
    })

    describe('матрица применимости (форма_1)', () => {
        it('отклоняет пустой файл', async () => {
            await expect(loadApplicabilityMatrixWorkbook(EMPTY_BUFFER)).rejects.toThrow()
        })

        it('отклоняет файл без листа «Форма условий»', async () => {
            const buffer = await workbookWith('Другой лист', [
                ['Код Вид МД', 'Документ'],
                ['74', 'Карта вызова СМП'],
            ])
            await expect(loadApplicabilityMatrixWorkbook(buffer)).rejects.toThrow(
                /не найден лист|заголовков/i,
            )
        })
    })

    describe('ФРМР', () => {
        it('отклоняет пустой файл', async () => {
            await expect(parseFrmrXlsx(EMPTY_BUFFER)).rejects.toThrow(/пуст/i)
        })

        it('отклоняет файл, который не является XLSX', async () => {
            await expect(parseFrmrXlsx(GARBAGE_BUFFER)).rejects.toThrow(
                /не удалось прочитать/i,
            )
        })
    })
})
