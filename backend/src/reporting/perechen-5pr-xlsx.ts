import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import { Readable } from 'stream'

/**
 * ТЗ 6.1.3.2.7 (agent_2026-07-15), п.1.1 — официальный перечень видов СЭМД по протоколу
 * президиума Правительственной комиссии от 16.02.2026 №5пр. Даёт мост между «голым» кодом
 * «Вид МД» (тем же, что TYPE в справочнике 1520) и официальным наименованием вида СЭМД —
 * в отличие от 1520.NAME (которое несёт формат/редакцию конкретного документа), здесь одно
 * каноничное имя на весь «Вид МД». Join детерминирован (145 из 145 кодов совпадают с 1520).
 */
export const PERECHEN_5PR_TITLE = 'Перечень видов СЭМД (протокол №5пр от 16.02.2026)'

export interface Perechen5prRow {
    /** Вид МД* — тот же ключ, что TYPE в справочнике 1520. */
    typeCode: string
    format: string
    officialName: string
}

export interface Perechen5prParseResult {
    rows: Perechen5prRow[]
    warnings: string[]
}

/**
 * Реальный файл от Марины декларирует размер листа как полную сетку Excel (rowCount ~1.05M),
 * хотя данных в нём всего ~150 строк — вероятно, форматирование применено на весь столбец.
 * `Workbook.xlsx.load()` материализует объекты Row/Cell на весь заявленный диапазон и на таком
 * файле уходит в OOM; потоковый WorkbookReader читает строки по одной без этого раздувания.
 */
export async function parsePerechen5prXlsx(
    fileBuffer: Buffer,
): Promise<Perechen5prParseResult> {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл перечня видов СЭМД (№5пр) пуст')
    }

    const rows: Perechen5prRow[] = []
    const seenCodes = new Set<string>()
    const warnings: string[] = []
    let headerRowNumber: number | null = null
    let sawAnySheet = false

    try {
        const reader = new ExcelJS.stream.xlsx.WorkbookReader(
            Readable.from(fileBuffer),
            {},
        )
        for await (const worksheet of reader) {
            sawAnySheet = true
            for await (const row of worksheet) {
                if (headerRowNumber === null) {
                    const second = cellValueToText(row.getCell(2).value)
                    if (second.replace(/\s+/g, '').toLowerCase() === 'видмд*') {
                        headerRowNumber = row.number
                    }
                    continue
                }
                if (row.number <= headerRowNumber) continue

                const typeCode = cellValueToText(row.getCell(2).value)
                const format = cellValueToText(row.getCell(3).value)
                const officialName = cellValueToText(row.getCell(4).value)
                if (!typeCode && !officialName) continue
                if (!typeCode) {
                    throw new BadRequestException(
                        `В строке ${row.number} не заполнено поле «Вид МД*»`,
                    )
                }
                if (!officialName) {
                    throw new BadRequestException(
                        `В строке ${row.number} не заполнено поле «Наименование вида СЭМД»`,
                    )
                }
                if (seenCodes.has(typeCode)) {
                    warnings.push(
                        `Вид МД ${typeCode} встречается в перечне №5пр более одного раза; использована последняя строка.`,
                    )
                }
                seenCodes.add(typeCode)
                rows.push({ typeCode, format, officialName })
            }
            // Only the first sheet is relevant for this reference file.
            break
        }
    } catch (err) {
        if (err instanceof BadRequestException) throw err
        // Этап 5 плана 24.07: пользователю МИАЦ нужна причина отказа, а не только сам факт.
        // Без исходного текста ошибки «не удалось прочитать» неотличимо от «файл повреждён».
        const reason = err instanceof Error && err.message ? `: ${err.message}` : ''
        throw new BadRequestException(
            `Не удалось прочитать XLSX перечня видов СЭМД (№5пр)${reason}`,
        )
    }

    if (!sawAnySheet) {
        throw new BadRequestException(
            'В XLSX перечня видов СЭМД (№5пр) не найдено ни одного листа',
        )
    }
    if (headerRowNumber === null) {
        throw new BadRequestException(
            'В XLSX перечня видов СЭМД (№5пр) не найдена строка заголовков «Вид МД*»',
        )
    }
    if (rows.length === 0) {
        throw new BadRequestException(
            'XLSX перечня видов СЭМД (№5пр) не содержит записей',
        )
    }

    return { rows, warnings }
}

function cellValueToText(value: ExcelJS.CellValue): string {
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'object' && 'text' in value) {
        return String((value as { text: unknown }).text ?? '').trim()
    }
    if (typeof value === 'object' && 'result' in value) {
        return String((value as { result: unknown }).result ?? '').trim()
    }
    return String(value).trim()
}
