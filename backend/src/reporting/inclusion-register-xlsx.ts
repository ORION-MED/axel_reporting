import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

/**
 * Перечни входимости ТВСП от Минздрава (письмо № ВХ.04-08186_26 от 20.07.2026).
 *
 * По каждому виду СЭМД Минздрав называет поимённо подразделения, обязанные его
 * передавать, и ставит по каждому план и факт. Это готовый знаменатель
 * показателя — и одновременно основание приоритета 1 «условия входимости,
 * утверждённые МЗ РФ», которое до сих пор воспроизводилось по слайдам методики.
 *
 * **Семь файлов, один разбор.** Колонки называются по-разному — «OID МО»
 * и «OID_МО», «ID здания», «Id здания» и «id здания», — но набор один и тот же,
 * поэтому шапка ищется по нормализованным именам, а не по номерам колонок.
 *
 * **Уровень строки разный.** У видов 6, 10, 12, 343 и 381 строка — здание,
 * у 141 — подразделение внутри здания, у 371 — медорганизация целиком, без
 * зданий. Разбор это допускает: пустые идентификаторы не ошибка.
 *
 * **Вид СЭМД в файле не кодом, а названием** — в заголовке первой строки,
 * в кавычках: «…передачу СЭМД "Справка о постановке на учет по беременности"
 * в РЭМД ЕГИСЗ…». Имя оттуда возвращается вызывающему, сопоставление
 * со справочником делает импортёр.
 */

export interface InclusionRegisterRow {
    subjectName: string
    organizationOid: string
    organizationName: string
    buildingId: string
    buildingName: string
    buildingAddress: string
    subdivisionOid: string
    planValue: number
    factValue: number
}

export interface InclusionRegisterParseResult {
    sheetName: string
    /** Заголовок перечня целиком — он объясняет, кого включили в знаменатель. */
    title: string
    /** Наименования СЭМД из кавычек заголовка; бывает больше одного. */
    semdTypeNames: string[]
    /** Месяц и год среза из «по итогам июня 2026 года». */
    month: number | null
    year: number | null
    rows: InclusionRegisterRow[]
    warnings: string[]
}

const MONTHS = [
    'январ', 'феврал', 'март', 'апрел', 'мая|май', 'июн',
    'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр',
]

/** Кавычки в заголовках Минздрава встречаются и «ёлочкой», и обычные. */
const QUOTED = /[«"]([^«»"]{6,200})[»"]/gu

export async function parseInclusionRegisterXlsx(
    fileBuffer: Buffer,
): Promise<InclusionRegisterParseResult> {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл перечня входимости пуст')
    }
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer)
    } catch {
        throw new BadRequestException('Не удалось прочитать XLSX перечня входимости')
    }
    const sheet = workbook.worksheets[0]
    if (!sheet) {
        throw new BadRequestException('В файле перечня входимости нет ни одного листа')
    }

    const header = findHeader(sheet)
    if (!header) {
        throw new BadRequestException(
            'Не удалось найти шапку перечня: ожидались колонки «OID МО», «План» '
            + 'и «Факт». Проверьте, что загружается перечень входимости, '
            + 'а не другой файл.',
        )
    }

    const title = readTitle(sheet, header.rowNumber)
    const rows: InclusionRegisterRow[] = []
    let skipped = 0

    for (let rowNumber = header.rowNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const organizationOid = cellText(row.getCell(header.columns.organizationOid))
        if (!organizationOid) {
            skipped += 1
            continue
        }
        rows.push({
            subjectName: pick(row, header.columns.subject),
            organizationOid,
            organizationName: pick(row, header.columns.organizationName),
            buildingId: pick(row, header.columns.buildingId),
            buildingName: pick(row, header.columns.buildingName),
            buildingAddress: pick(row, header.columns.buildingAddress),
            subdivisionOid: pick(row, header.columns.subdivisionOid),
            planValue: readNumber(row, header.columns.plan),
            factValue: readNumber(row, header.columns.fact),
        })
    }

    if (rows.length === 0) {
        throw new BadRequestException(
            `На листе «${sheet.name}» не найдено ни одной строки перечня`,
        )
    }

    const warnings = [
        `Перечень распознан: ${rows.length} строк, `
        + `${new Set(rows.map((row) => row.organizationOid)).size} медорганизаций.`,
    ]
    const subjects = new Set(rows.map((row) => row.subjectName).filter(Boolean))
    if (subjects.size > 1) {
        warnings.push(
            `В перечне несколько субъектов РФ: ${[...subjects].join(', ')}. `
            + 'Строки чужих регионов в расчёт не войдут.',
        )
    }

    return {
        sheetName: sheet.name,
        title,
        semdTypeNames: extractSemdNames(title),
        ...readSnapshot(title),
        rows,
        warnings,
    }
}

interface HeaderColumns {
    subject: number
    organizationOid: number
    organizationName: number
    buildingId: number
    buildingName: number
    buildingAddress: number
    subdivisionOid: number
    plan: number
    fact: number
}

/**
 * Шапка ищется по содержимому, а не по номеру строки: у вида 10 заголовок
 * занимает две строки, у остальных одну.
 */
function findHeader(
    sheet: ExcelJS.Worksheet,
): { rowNumber: number; columns: HeaderColumns } | null {
    const lastRow = Math.min(sheet.rowCount, 12)
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        const names: Array<{ key: string; column: number }> = []
        for (let column = 1; column <= 40; column += 1) {
            const key = normalize(cellText(row.getCell(column)))
            if (key) names.push({ key, column })
        }
        const find = (test: (key: string) => boolean): number =>
            names.find((item) => test(item.key))?.column ?? 0

        // «План» и «Факт» ищутся точным совпадением намеренно: в перечне
        // по виду 381 рядом стоят «Плановый список СП» и «Фактический список СП»,
        // и поиск по началу строки утащил бы список подразделений вместо числа.
        const plan = find((key) => key === 'план')
        const fact = find((key) => key === 'факт')
        // «OID МО» набрано латинским OID и кириллическими МО, поэтому сравнение
        // с латинским «oidmo» не срабатывает никогда — ищем по вхождению.
        // Оговорка «не СП» нужна из-за перечней 141 и 371: там рядом стоит
        // OID подразделения.
        const organizationOid = find(
            (key) => key.includes('oid') && key.includes('мо') && !key.includes('сп'),
        )
        if (!organizationOid || !plan || !fact) continue

        return {
            rowNumber,
            columns: {
                subject: find((key) => key.includes('субъект')),
                organizationOid,
                organizationName: find(
                    (key) => key.startsWith('наименование')
                        && !key.includes('здани') && !key.includes('сп'),
                ),
                buildingId: find((key) => key.includes('id') && key.includes('здани')),
                buildingName: find(
                    (key) => key.includes('наименование') && key.includes('здани'),
                ),
                buildingAddress: find((key) => key.startsWith('адрес')),
                subdivisionOid: find((key) => key.includes('oid') && key.includes('сп')),
                plan,
                fact,
            },
        }
    }
    return null
}

/** Заголовок — всё, что стоит в первой колонке до шапки, склеенное в строку. */
function readTitle(sheet: ExcelJS.Worksheet, headerRow: number): string {
    const parts: string[] = []
    for (let rowNumber = 1; rowNumber < headerRow; rowNumber += 1) {
        const text = cellText(sheet.getRow(rowNumber).getCell(1))
        if (text && !parts.includes(text)) parts.push(text)
    }
    return parts.join(' ').replace(/\s+/gu, ' ').trim()
}

/**
 * Наименования СЭМД из кавычек заголовка. Их бывает несколько: у перечня
 * по диспансеризации названы сразу два вида — «Эпикриз по результатам…»
 * и «Сведения о результатах…».
 *
 * Отбрасываются кавычки, в которых стоит не вид, а профиль помощи
 * («Акушерство и гинекология») — они не содержат ни «эпикриз», ни «протокол»,
 * ни «справк», ни «сведени», ни «осмотр».
 */
export function extractSemdNames(title: string): string[] {
    const names: string[] = []
    for (const match of title.matchAll(QUOTED)) {
        const value = match[1].trim()
        if (!/эпикриз|протокол|справк|сведени|осмотр|карт|консилиум/iu.test(value)) continue
        if (!names.includes(value)) names.push(value)
    }
    return names
}

/** «по итогам июня 2026 года» → месяц 6, год 2026. */
export function readSnapshot(title: string): { month: number | null; year: number | null } {
    const lower = title.toLocaleLowerCase('ru-RU')
    let month: number | null = null
    for (let index = 0; index < MONTHS.length; index += 1) {
        if (new RegExp(MONTHS[index], 'u').test(lower)) {
            month = index + 1
            break
        }
    }
    const yearMatch = /\b(20\d{2})\s*год/u.exec(lower)
    return { month, year: yearMatch ? Number(yearMatch[1]) : null }
}

function pick(row: ExcelJS.Row, column: number): string {
    return column ? cellText(row.getCell(column)) : ''
}

function readNumber(row: ExcelJS.Row, column: number): number {
    if (!column) return 0
    const value = row.getCell(column).value
    if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
    const parsed = Number(cellText(row.getCell(column)).replace(/\s/gu, '').replace(',', '.'))
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

/** Нормализация имени колонки: регистр, подчёркивания и пробелы не значат ничего. */
function normalize(value: string): string {
    return value
        .toLocaleLowerCase('ru-RU')
        .replace(/ё/gu, 'е')
        .replace(/[^a-zа-я0-9]+/giu, '')
}

function cellText(cell: ExcelJS.Cell): string {
    const value = cell.value
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number') return String(value)
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'object') {
        if ('richText' in value && Array.isArray((value as ExcelJS.CellRichTextValue).richText)) {
            return (value as ExcelJS.CellRichTextValue).richText
                .map((part) => part.text)
                .join('')
                .trim()
        }
        if ('text' in value) return String((value as { text: unknown }).text ?? '').trim()
        if ('result' in value) return String((value as { result: unknown }).result ?? '').trim()
    }
    return String(value).trim()
}
