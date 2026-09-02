import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import * as Papa from 'papaparse'

export const EMD_NSI_DIRECTORY_OID = '1.2.643.5.1.13.13.11.1520'

const REQUIRED_HEADERS = [
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
] as const

export interface EmdNsiVersion {
    id: string
    oid: string
    typeCode: string
    name: string
    baseName: string
    formatCode: string
    documentFormat: string
    effectiveFrom: string | null
    effectiveTo: string | null
    epguAvailable: boolean
    isOnline: boolean
    raw: Record<string, string>
}

export interface EmdNsiType {
    typeCode: string
    canonicalName: string
    aliases: string[]
    documentFormats: string[]
    effectiveFrom: string | null
    effectiveTo: string | null
    epguAvailable: boolean | null
    activeAtReportingDate: boolean
    versions: EmdNsiVersion[]
}

export interface EmdNsiParseResult {
    directoryOid: string
    sourceVersion: string | null
    reportingDate: string
    rows: EmdNsiVersion[]
    types: EmdNsiType[]
    activeTypeCount: number
    epguAvailableTypeCount: number
    warnings: string[]
}

const REMD_NAME_ALIASES_BY_TYPE: Record<string, string[]> = {
    '8': [
        'Медицинское заключение о наличии (об отсутствии) у водителей транспортных средств (кандидатов в водители транспортных средств) медицинских противопоказаний, медицинских показаний или медицинских ограничений к управлению транспортными средствами',
    ],
    '46': [
        'Медицинское заключение об отсутствии в организме наркотических средств, психотропных веществ и их метаболитов',
    ],
    '49': [
        'Медицинская справка о состоянии здоровья ребенка, направленного в организацию отдыха детей и их оздоровления',
    ],
    '52': [
        'Справка об оплате медицинских услуг для представления в налоговые органы Российской Федерации',
    ],
    '68': [
        'Заключение о результатах медицинского освидетельствования лиц, желающих усыновить (удочерить), взять под опеку (попечительство), в приемную или патронатную семью детей, оставшихся без попечения родителей',
    ],
    '77': [
        'Справка о количестве кроводач, плазмодач',
    ],
    '79': [
        'Медицинская справка (заключение)',
    ],
    // Форма 6.1.3.2.7: в выгрузке РЭМД («Вид МД») вид TYPE=86 приходит под номером
    // учётной формы бланка «Рецепт 107-1/у», а в справочнике 1520 и матрице форма_1 —
    // как «Рецепт на лекарственный препарат». Без этого алиаса факт по рецепту не
    // сопоставлялся и расчёт давал 34 из 35 видов (см. remd-numerator-import.service.ts).
    '86': [
        'Рецепт 107-1/у',
    ],
    '365': [
        'Направление тела умершего в патолого-анатомическое бюро (отделение)',
    ],
    '367': [
        'Заключение о нуждаемости престарелого гражданина в постороннем уходе',
    ],
    '368': [
        'Заключение об установлении поствакцинального осложнения',
    ],
    '376': [
        'Направление для забора образцов крови и последующего проведения неонатального скрининга и (или) расширенного неонатального скрининга',
    ],
    '396': [
        'Извещение о поступлении (обращении) пациента с признаками причинения вреда здоровью или с неустановленной личностью',
    ],
    '498': [
        'Заключение межведомственного экспертного совета об установлении причинной связи развившихся заболеваний ребенка с последствиями радиоактивного облучения одного из родителей вследствие чернобыльской катастрофы',
    ],
    '534': [
        'План противоопухолевого лекарственного лечения',
    ],
    '535': [
        'Протокол противоопухолевого лекарственного лечения',
    ],
}

export function normalizeSemdName(value: string): string {
    return String(value || '')
        .replace(/№/giu, ' ')
        .normalize('NFKC')
        .replace(/ё/giu, 'е')
        .replace(/[«»„“”"]/g, '')
        .replace(/[^a-zа-я0-9]+/giu, ' ')
        .trim()
        .replace(/\s+/g, '_')
        .toLocaleLowerCase('ru-RU')
}

export function stripEmdVersionSuffix(value: string): string {
    return String(value || '')
        .replace(
            /\s*\((?:CDA|PDF\/A-1)\)(?:\s+Редакция\s+\d+)?\s*$/iu,
            '',
        )
        .trim()
}

export function parseEmdNsiCsv(
    fileBuffer: Buffer,
    options: {
        reportingDate: string
        originalFilename?: string
    },
): EmdNsiParseResult {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл справочника ЭМД пуст')
    }
    const text = decodeUtf8(fileBuffer)
    const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        delimiter: ';',
        skipEmptyLines: 'greedy',
        transformHeader: (header) => String(header || '').replace(/^\uFEFF/, '').trim(),
    })
    if (parsed.errors.length > 0) {
        const first = parsed.errors[0]
        throw new BadRequestException(
            `Не удалось прочитать CSV справочника ЭМД: ${first.message}`,
        )
    }

    return parseEmdNsiRows(parsed.data, parsed.meta.fields ?? [], {
        reportingDate: options.reportingDate,
        originalFilename: options.originalFilename,
        sourceLabel: 'CSV',
    })
}

/**
 * Roadmap Пакет A, задача 10 — та же выгрузка справочника ЭМД 1520, но в формате XLSX
 * (лист «Справочник»: строка 1 — технические заголовки как в CSV, строка 2 — человекочитаемые
 * описания колонок, данные начинаются со строки 3). Переиспользует ту же группировку по TYPE,
 * что и CSV-версия — см. parseEmdNsiRows.
 */
export async function parseEmdNsiXlsx(
    fileBuffer: Buffer,
    options: {
        reportingDate: string
        originalFilename?: string
    },
): Promise<EmdNsiParseResult> {
    if (!fileBuffer.length) {
        throw new BadRequestException('Файл справочника ЭМД пуст')
    }
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as unknown as ExcelJS.Buffer)
    } catch {
        throw new BadRequestException('Не удалось прочитать XLSX справочника ЭМД')
    }
    const sheet = workbook.getWorksheet('Справочник') ?? workbook.worksheets[0]
    if (!sheet) {
        throw new BadRequestException('В XLSX справочника ЭМД не найден лист «Справочник»')
    }

    const headerRow = sheet.getRow(1)
    const actualHeaders: string[] = []
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
        actualHeaders.push(String(cell.value ?? '').trim())
    })

    const rawRows: Record<string, string>[] = []
    for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber)
        if (row.cellCount === 0) continue
        const raw: Record<string, string> = {}
        let hasValue = false
        actualHeaders.forEach((header, index) => {
            const cellValue = row.getCell(index + 1).value
            const text = cellValueToText(cellValue)
            if (text) hasValue = true
            raw[header] = text
        })
        if (hasValue) rawRows.push(raw)
    }

    return parseEmdNsiRows(rawRows, actualHeaders, {
        reportingDate: options.reportingDate,
        originalFilename: options.originalFilename,
        sourceLabel: 'XLSX',
    })
}

function cellValueToText(value: ExcelJS.CellValue): string {
    if (value === null || typeof value === 'undefined') return ''
    if (value instanceof Date) {
        return `${String(value.getUTCDate()).padStart(2, '0')}.`
            + `${String(value.getUTCMonth() + 1).padStart(2, '0')}.`
            + `${value.getUTCFullYear()}`
    }
    if (typeof value === 'object' && 'text' in value) {
        return String((value as { text: unknown }).text ?? '').trim()
    }
    if (typeof value === 'object' && 'result' in value) {
        return String((value as { result: unknown }).result ?? '').trim()
    }
    return String(value).trim()
}

function parseEmdNsiRows(
    rawRows: Record<string, string>[],
    actualHeaders: string[],
    options: {
        reportingDate: string
        originalFilename?: string
        sourceLabel: 'CSV' | 'XLSX'
    },
): EmdNsiParseResult {
    const reportingDate = parseIsoDate(
        options.reportingDate,
        'Дата окончания отчетного периода',
    )
    const missingHeaders = REQUIRED_HEADERS.filter(
        (header) => !actualHeaders.includes(header),
    )
    if (missingHeaders.length > 0) {
        throw new BadRequestException(
            `В ${options.sourceLabel} справочника ЭМД отсутствуют обязательные колонки: ${missingHeaders.join(', ')}`,
        )
    }

    const ids = new Set<string>()
    const rows = rawRows.map((raw, index) => {
        const rowNumber = index + 2
        const id = requiredText(raw.ID, 'ID', rowNumber)
        if (ids.has(id)) {
            throw new BadRequestException(
                `В ${options.sourceLabel} справочника ЭМД повторяется ID ${id}`,
            )
        }
        ids.add(id)

        const typeCode = requiredText(raw.TYPE, 'TYPE', rowNumber)
        const name = requiredText(raw.NAME, 'NAME', rowNumber)
        const showPatient = parseYesNo(
            raw.SHOW_PATIENT,
            'SHOW_PATIENT',
            rowNumber,
        )
        const isOnline = parseYesNo(raw.IS_ONLINE, 'IS_ONLINE', rowNumber)
        const effectiveFrom = parseRussianDate(
            raw.START_DATE,
            'START_DATE',
            rowNumber,
        )
        const effectiveTo = parseRussianDate(
            raw.END_DATE,
            'END_DATE',
            rowNumber,
        )
        if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
            throw new BadRequestException(
                `В строке ${rowNumber} START_DATE позже END_DATE`,
            )
        }

        const formatCode = String(raw.FORMAT || '').trim()
        return {
            id,
            oid: requiredText(raw.OID, 'OID', rowNumber),
            typeCode,
            name,
            baseName: stripEmdVersionSuffix(name),
            formatCode,
            documentFormat: formatCode === '1'
                ? 'PDF/A-1'
                : formatCode === '2'
                    ? 'CDA'
                    : formatCode || 'Не указан',
            effectiveFrom,
            effectiveTo,
            epguAvailable: showPatient,
            isOnline,
            raw: Object.fromEntries(
                actualHeaders.map((header) => [
                    header,
                    String(raw[header] ?? '').trim(),
                ]),
            ),
        } satisfies EmdNsiVersion
    })
    if (rows.length === 0) {
        throw new BadRequestException(
            `${options.sourceLabel} справочника ЭМД не содержит записей`,
        )
    }

    const grouped = new Map<string, EmdNsiVersion[]>()
    for (const row of rows) {
        const versions = grouped.get(row.typeCode) ?? []
        versions.push(row)
        grouped.set(row.typeCode, versions)
    }

    const warnings: string[] = []
    const types = Array.from(grouped.entries())
        .map(([typeCode, versions]) => {
            const sortedVersions = [...versions].sort(compareVersionsNewestFirst)
            const activeVersions = sortedVersions.filter((version) => (
                isEffectiveAt(
                    version.effectiveFrom,
                    version.effectiveTo,
                    reportingDate,
                )
            ))
            const canonicalVersion = activeVersions[0] ?? sortedVersions[0]
            const aliases = new Set<string>(
                versions.map((version) => version.baseName),
            )
            for (const alias of REMD_NAME_ALIASES_BY_TYPE[typeCode] ?? []) {
                aliases.add(alias)
            }
            const epguValues = new Set(
                activeVersions.map((version) => version.epguAvailable),
            )
            if (epguValues.size > 1) {
                warnings.push(
                    `Для вида TYPE=${typeCode} активные версии содержат разные значения SHOW_PATIENT; применено правило «Да, если доступна хотя бы одна версия».`,
                )
            }
            const effectiveFrom = minDate(
                versions.map((version) => version.effectiveFrom),
            )
            const effectiveTo = versions.some((version) => !version.effectiveTo)
                ? null
                : maxDate(versions.map((version) => version.effectiveTo))
            return {
                typeCode,
                canonicalName: canonicalVersion.baseName,
                aliases: Array.from(aliases).sort((left, right) => (
                    left.localeCompare(right, 'ru')
                )),
                documentFormats: Array.from(
                    new Set(versions.map((version) => version.documentFormat)),
                ).sort(),
                effectiveFrom,
                effectiveTo,
                epguAvailable: activeVersions.length === 0
                    ? null
                    : activeVersions.some((version) => version.epguAvailable),
                activeAtReportingDate: activeVersions.length > 0,
                versions: sortedVersions,
            } satisfies EmdNsiType
        })
        .sort((left, right) => (
            numericCode(left.typeCode) - numericCode(right.typeCode)
            || left.typeCode.localeCompare(right.typeCode)
        ))

    return {
        directoryOid: EMD_NSI_DIRECTORY_OID,
        sourceVersion: extractSourceVersion(options.originalFilename),
        reportingDate,
        rows,
        types,
        activeTypeCount: types.filter((type) => type.activeAtReportingDate).length,
        epguAvailableTypeCount: types.filter(
            (type) => type.epguAvailable === true,
        ).length,
        warnings,
    }
}

function decodeUtf8(fileBuffer: Buffer): string {
    const text = fileBuffer.toString('utf8')
    if (text.includes('\uFFFD')) {
        throw new BadRequestException(
            'CSV справочника ЭМД должен быть сохранен в кодировке UTF-8',
        )
    }
    return text
}

function requiredText(
    value: unknown,
    field: string,
    rowNumber: number,
): string {
    const text = String(value ?? '').trim()
    if (!text) {
        throw new BadRequestException(
            `В строке ${rowNumber} не заполнено поле ${field}`,
        )
    }
    return text
}

function parseYesNo(
    value: unknown,
    field: string,
    rowNumber: number,
): boolean {
    const normalized = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
    if (normalized === 'да') return true
    if (normalized === 'нет') return false
    throw new BadRequestException(
        `В строке ${rowNumber} поле ${field} должно содержать «Да» или «Нет»`,
    )
}

function parseRussianDate(
    value: unknown,
    field: string,
    rowNumber: number,
): string | null {
    const text = String(value ?? '').trim()
    if (!text) return null
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text)
    if (!match) {
        throw new BadRequestException(
            `В строке ${rowNumber} поле ${field} должно иметь формат ДД.ММ.ГГГГ`,
        )
    }
    return parseIsoDate(
        `${match[3]}-${match[2]}-${match[1]}`,
        `${field} в строке ${rowNumber}`,
    )
}

function parseIsoDate(value: string, field: string): string {
    const text = String(value || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new BadRequestException(`${field} должна иметь формат ГГГГ-ММ-ДД`)
    }
    const date = new Date(`${text}T00:00:00.000Z`)
    if (
        Number.isNaN(date.getTime())
        || date.toISOString().slice(0, 10) !== text
    ) {
        throw new BadRequestException(`${field} содержит некорректную дату`)
    }
    return text
}

function isEffectiveAt(
    effectiveFrom: string | null,
    effectiveTo: string | null,
    date: string,
): boolean {
    return (!effectiveFrom || effectiveFrom <= date)
        && (!effectiveTo || effectiveTo >= date)
}

function compareVersionsNewestFirst(
    left: EmdNsiVersion,
    right: EmdNsiVersion,
): number {
    return String(right.effectiveFrom ?? '').localeCompare(
        String(left.effectiveFrom ?? ''),
    ) || numericCode(right.id) - numericCode(left.id)
}

function minDate(values: Array<string | null>): string | null {
    const dates = values.filter((value): value is string => Boolean(value))
    return dates.length > 0 ? dates.sort()[0] : null
}

function maxDate(values: Array<string | null>): string | null {
    const dates = values.filter((value): value is string => Boolean(value))
    return dates.length > 0 ? dates.sort()[dates.length - 1] : null
}

function numericCode(value: string): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

function extractSourceVersion(filename?: string): string | null {
    const match = /_([0-9]+(?:\.[0-9]+)*)\.(?:csv|xlsx)$/iu.exec(
        String(filename || '').trim(),
    )
    return match?.[1] ?? null
}
