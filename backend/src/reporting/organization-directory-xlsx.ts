import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

/**
 * Справочник МО региона от методолога («МО Курганской области.xlsx», получен 04.08.2026).
 *
 * Закрывает два из трёх справочников, о которых шла речь на ВКС 31.07: прикреплённое
 * население (приоритет обязательности 4) и лицензии на отдельные виды медпомощи
 * (приоритет 3). Третий — региональные акты, приоритет 2 — сюда не входит.
 *
 * До него перечни МО по этим признакам вытаскивались разбором текста в колонке
 * «Комментарий методолога» матрицы применимости (extractApplicabilityOrganizationNames).
 * Разбор работает, но ломается от любой правки формулировки и не виден при проверке,
 * поэтому справочник становится источником истины, а комментарий остаётся для аудита.
 *
 * Формат исходника: один лист с 37 организациями, ключ — OID по ФРМО.
 * Прикреплённое население закодировано одним числом (1 взрослое, 2 детское, 3 оба),
 * лицензии — колонками с «1» в отмеченных строках.
 *
 * Перечень лицензий НЕ зашит: коды вида «1090.4» вычитываются из заголовков колонок.
 * Методолог на втором листе прямо предложила дополнять перечень («при отсутствии
 * в перечне укажите виды лицензий, влияющие на показатели»), и новая лицензия должна
 * подхватываться без правки кода и без миграции.
 */

export interface OrganizationDirectoryEntry {
    rowNumber: number
    oid: string
    officialFullName: string
    officialShortName: string
    /** Краткое наименование «для отображения в сервисе» — задано самой методологом. */
    displayShortName: string
    attachedPopulation: boolean
    attachedChildPopulation: boolean
    /**
     * Участие МО в обеспечении граждан льготными лекарствами (ЛЛО). Колонка добавлена
     * методологом 13.08.2026 — под условие «реализация государственных и региональных
     * программ по обеспечению населения ЛЛО» из формы на 145 видов.
     */
    lloProgram: boolean
    /** Код лицензии → отмечена ли она у этой МО. Ключи — как в файле: «1090.4». */
    licenses: Record<string, boolean>
}

export interface OrganizationDirectoryColumn {
    columnNumber: number
    licenseCode: string
    title: string
}

export interface OrganizationDirectoryParseResult {
    sheetName: string
    headerRowNumber: number
    entries: OrganizationDirectoryEntry[]
    licenseColumns: OrganizationDirectoryColumn[]
    attachedPopulationCount: number
    attachedChildPopulationCount: number
    lloProgramCount: number
    licenseCounts: Record<string, number>
    warnings: string[]
}

interface HeaderLayout {
    rowNumber: number
    oidColumn: number
    fullNameColumn: number
    shortNameColumn: number
    displayNameColumn: number
    attachedPopulationColumn: number
    lloProgramColumn: number
    licenseColumns: OrganizationDirectoryColumn[]
}

const HEADER_SCAN_ROWS = 10
const MAX_SCAN_COLUMNS = 40

/** Коды прикреплённого населения, как они описаны в заголовке колонки файла. */
const ATTACHED_ADULT_CODES = new Set(['1', '3'])
const ATTACHED_CHILD_CODES = new Set(['2', '3'])
const ATTACHED_ALLOWED_CODES = new Set(['1', '2', '3'])

/** Отметка лицензии: в исходнике «1», но живые файлы приходят и с «да», и с галочкой. */
const LICENSE_TRUE_VALUES = new Set(['1', 'да', 'v', 'x', 'х', '+', 'есть', 'true'])

export async function loadOrganizationDirectoryWorkbook(
    fileBuffer: Buffer,
): Promise<OrganizationDirectoryParseResult> {
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as any)
    } catch {
        throw new BadRequestException('Не удалось прочитать Excel-файл справочника МО')
    }
    return parseOrganizationDirectoryWorkbook(workbook)
}

export function parseOrganizationDirectoryWorkbook(
    workbook: ExcelJS.Workbook,
): OrganizationDirectoryParseResult {
    for (const worksheet of workbook.worksheets) {
        const header = findHeaderLayout(worksheet)
        if (header) return parseSheet(worksheet, header)
    }
    throw new BadRequestException(
        'В файле справочника МО не найден лист с колонками «OID» и «прикрепленное население»',
    )
}

function parseSheet(
    worksheet: ExcelJS.Worksheet,
    header: HeaderLayout,
): OrganizationDirectoryParseResult {
    const entries: OrganizationDirectoryEntry[] = []
    const warnings: string[] = []
    const seenOids = new Map<string, number>()
    const seenFullNames = new Map<string, number>()

    const lastRow = worksheet.rowCount
    for (let rowNumber = header.rowNumber + 1; rowNumber <= lastRow; rowNumber += 1) {
        const oid = cellText(worksheet.getCell(rowNumber, header.oidColumn))
        if (!oid) {
            // Строк без OID в файле две: пустые разделители и строка с контрольной
            // суммой под колонкой лицензий. Обе не данные — пропускаем молча.
            continue
        }
        if (!isOid(oid)) {
            warnings.push(`Строка ${rowNumber}: значение «${oid}» не похоже на OID, строка пропущена.`)
            continue
        }
        const duplicateRow = seenOids.get(oid)
        if (duplicateRow) {
            warnings.push(`Строка ${rowNumber}: OID ${oid} уже встречался в строке ${duplicateRow}, строка пропущена.`)
            continue
        }
        seenOids.set(oid, rowNumber)

        const officialFullName = cellText(worksheet.getCell(rowNumber, header.fullNameColumn))
        const officialShortName = cellText(worksheet.getCell(rowNumber, header.shortNameColumn))
        const displayShortName = header.displayNameColumn
            ? cellText(worksheet.getCell(rowNumber, header.displayNameColumn))
            : ''

        if (officialFullName) {
            const twinRow = seenFullNames.get(officialFullName.toLocaleLowerCase('ru-RU'))
            if (twinRow) {
                // Диагностика, а не ошибка: связка идёт по OID, но в полученном файле
                // у ГБУ «ШГБ» продублировано полное наименование наркодиспансера —
                // методологу это стоит показать.
                warnings.push(
                    `Строка ${rowNumber}: полное наименование совпадает со строкой ${twinRow} `
                    + `(«${officialFullName.slice(0, 80)}»). Связка идёт по OID, но стоит проверить файл.`,
                )
            } else {
                seenFullNames.set(officialFullName.toLocaleLowerCase('ru-RU'), rowNumber)
            }
        }

        const attachedRaw = cellText(worksheet.getCell(rowNumber, header.attachedPopulationColumn))
        if (attachedRaw && !ATTACHED_ALLOWED_CODES.has(attachedRaw)) {
            throw new BadRequestException(
                `Строка ${rowNumber}: непонятный код прикреплённого населения «${attachedRaw}». `
                + 'Ожидается 1 (взрослое), 2 (детское), 3 (взрослое и детское) или пусто.',
            )
        }

        const licenses: Record<string, boolean> = {}
        for (const column of header.licenseColumns) {
            licenses[column.licenseCode] = isLicenseMarked(
                cellText(worksheet.getCell(rowNumber, column.columnNumber)),
            )
        }

        entries.push({
            rowNumber,
            oid,
            officialFullName,
            officialShortName,
            displayShortName,
            attachedPopulation: ATTACHED_ADULT_CODES.has(attachedRaw),
            attachedChildPopulation: ATTACHED_CHILD_CODES.has(attachedRaw),
            lloProgram: header.lloProgramColumn
                ? isLicenseMarked(cellText(worksheet.getCell(rowNumber, header.lloProgramColumn)))
                : false,
            licenses,
        })
    }

    if (entries.length === 0) {
        throw new BadRequestException('В справочнике МО не найдено ни одной строки с OID')
    }

    const licenseCounts: Record<string, number> = {}
    for (const column of header.licenseColumns) {
        licenseCounts[column.licenseCode] = entries.filter(
            (entry) => entry.licenses[column.licenseCode],
        ).length
    }

    return {
        sheetName: worksheet.name,
        headerRowNumber: header.rowNumber,
        entries,
        licenseColumns: header.licenseColumns,
        attachedPopulationCount: entries.filter((entry) => entry.attachedPopulation).length,
        attachedChildPopulationCount: entries.filter((entry) => entry.attachedChildPopulation).length,
        lloProgramCount: entries.filter((entry) => entry.lloProgram).length,
        licenseCounts,
        warnings,
    }
}

function findHeaderLayout(worksheet: ExcelJS.Worksheet): HeaderLayout | null {
    const scanRows = Math.min(HEADER_SCAN_ROWS, Math.max(worksheet.rowCount, 1))
    for (let rowNumber = 1; rowNumber <= scanRows; rowNumber += 1) {
        let oidColumn = 0
        let fullNameColumn = 0
        let shortNameColumn = 0
        let displayNameColumn = 0
        let attachedPopulationColumn = 0
        let lloProgramColumn = 0
        const licenseColumns: OrganizationDirectoryColumn[] = []

        for (let columnNumber = 1; columnNumber <= MAX_SCAN_COLUMNS; columnNumber += 1) {
            const title = cellText(worksheet.getCell(rowNumber, columnNumber))
            if (!title) continue
            const normalized = normalizeHeader(title)

            const licenseCode = extractLicenseCode(normalized)
            if (licenseCode) {
                licenseColumns.push({ columnNumber, licenseCode, title })
                continue
            }
            if (!oidColumn && normalized.includes('oid')) {
                oidColumn = columnNumber
                continue
            }
            if (!attachedPopulationColumn && normalized.includes('прикрепленное население')) {
                attachedPopulationColumn = columnNumber
                continue
            }
            // Колонка без кода лицензии, поэтому по шаблону кодов не ловится.
            if (!lloProgramColumn && normalized.includes('лло')) {
                lloProgramColumn = columnNumber
                continue
            }
            // Порядок важен: «краткое наименование … для отображения в сервисе» тоже
            // содержит «краткое наименование», поэтому сначала проверяем отображение.
            if (!displayNameColumn && normalized.includes('для отображения')) {
                displayNameColumn = columnNumber
                continue
            }
            if (!shortNameColumn && normalized.includes('краткое наименование')) {
                shortNameColumn = columnNumber
                continue
            }
            if (!fullNameColumn && normalized.includes('наименование')) {
                fullNameColumn = columnNumber
            }
        }

        if (oidColumn && attachedPopulationColumn) {
            return {
                rowNumber,
                oidColumn,
                fullNameColumn,
                shortNameColumn,
                displayNameColumn,
                attachedPopulationColumn,
                lloProgramColumn,
                licenseColumns,
            }
        }
    }
    return null
}

/**
 * Код лицензии из заголовка: «лицензии на отдельные виды мед.помощи 1090.4. медицинскому
 * освидетельствованию…» → «1090.4». Точка после кода — часть нумерации, в код не входит.
 */
export function extractLicenseCode(normalizedHeader: string): string {
    if (!normalizedHeader.includes('лиценз')) return ''
    const match = normalizedHeader.match(/\b(\d{3,4}\.\d{1,2})\b/u)
    return match ? match[1] : ''
}

function isLicenseMarked(value: string): boolean {
    if (!value) return false
    return LICENSE_TRUE_VALUES.has(value.toLocaleLowerCase('ru-RU'))
}

function isOid(value: string): boolean {
    return /^\d+(\.\d+){3,}$/u.test(value)
}

function normalizeHeader(value: string): string {
    return value
        .toLocaleLowerCase('ru-RU')
        .replace(/ё/g, 'е')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function cellText(cell: ExcelJS.Cell): string {
    const value = cell.value
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'object') {
        if ('richText' in value) {
            return cleanText(value.richText.map((part) => part.text).join(''))
        }
        if ('result' in value) return cleanText(value.result)
        if ('text' in value && typeof value.text === 'string') return cleanText(value.text)
    }
    return cleanText(value)
}

function cleanText(value: unknown, maxLength = 1_000): string {
    return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
}
