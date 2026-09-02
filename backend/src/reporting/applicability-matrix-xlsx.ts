import { BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'

export type ApplicabilityRequirementStatus =
    | 'required'
    | 'not_required'
    | 'unknown'

/**
 * Коды условий применимости. Перечень продублирован в CHECK таблицы
 * `reporting_semd_applicability_rules` — иначе и быть не может, база проверяет
 * значения сама. Правка одного места без другого роняет подтверждение матрицы
 * (случилось 14.08.2026 с `llo_program`), поэтому синхронность держит тест
 * `applicability-condition-codes.spec.ts`.
 *
 * Массив, а не только тип: из типа в рантайме перечень не достать, и сверять
 * с миграцией было бы нечего.
 */
export const APPLICABILITY_CONDITION_CODES = [
    'none',
    'attached_population',
    'attached_child_population',
    'license_1080_1',
    'license_1080_4',
    'license_1090_4',
    /**
     * Освидетельствование на противопоказания к управлению транспортным
     * средством. Добавлено 26.08.2026: код был в матрице с самого начала,
     * а ветки разбора для него не было.
     */
    'license_1090_5',
    'license_1090_6',
    'day_hospital_group',
    /**
     * «Оказание стационарной МП **или** в условиях дневного стационара».
     *
     * Отдельный код, потому что здесь два способа выполнить условие, а не один.
     * До 28.08.2026 такая строка уходила в `day_hospital_group`, и половина
     * с круглосуточным стационаром терялась: у вида 341 медорганизации
     * со стационарными отделениями, но без дневного стационара, оставались
     * необязанными. Замечание методолога от 28.08 — «в МО есть стационарные
     * отделения, это условие обязательности».
     */
    'inpatient_or_day_hospital',
    'specialized_organization',
    /** Участие МО в обеспечении граждан льготными лекарствами. */
    'llo_program',
    /**
     * Перечень МО, которым вид обязателен: «если МО - КООД», «если МО - Бюро СМЭ».
     * Зеркало `organization_list_except`: там членство снимает обязательность, здесь даёт.
     *
     * Читается только при `CONDITIONAL_STATUS_IS_REQUIRED`. Без флага такие условия,
     * как и раньше, уходят в `custom`, то есть «не определено» у всех МО.
     */
    'organization_list',
    /**
     * Перечень МО, которым вид **не** обязателен: «если МО НЕ КОПАБ, КОБСМЭ, …».
     * Появился в форме от 18.08.2026 — так методолог ответила на Н21 (протоколы
     * лабораторного и цитологического исследований не должны попадать в обязательные
     * патолого-анатомическому бюро и бюро СМЭ).
     *
     * Отдельный код нужен потому, что членство в перечне здесь снимает обязательность,
     * а у всех прежних условий («прикреплённое население», лицензии) — даёт её.
     * Без него условие уходило в `custom`, а `custom` — это «не определено» у всех МО:
     * вид 7 из обязательного у 32 МО стал бы неопределённым у всех 37.
     */
    'organization_list_except',
    'custom',
] as const

export type ApplicabilityConditionCode = typeof APPLICABILITY_CONDITION_CODES[number]

/**
 * Что означает решение «условно» в форме условий — открытый вопрос с 15.08.2026,
 * самый дорогой из оставшихся.
 *
 * `false` (текущее поведение): «условно» читается как «не определено». Вид выпадает
 * и из знаменателя, и из числителя, а расчёт по МО помечается предварительным.
 * После формы от 18.08, где методолог перевела в «условно» виды 86 и 121, так стало
 * у 33 МО из 37 — было 18.
 *
 * `true`: «условно» читается как «обязателен при выполнении условия». Кому именно —
 * решает само условие правила, и если оно машинно не читается, МО всё равно получает
 * «не определено». Заодно начинает работать перечень-включение («если МО - КООД»):
 * без него у «условно» не было бы адресата, и правило стало бы обязательным всем.
 *
 * ОТКАТ: поставить `false`, пересобрать backend, переимпортировать матрицу
 * и пересчитать период. Миграцию 0052 откатывать не нужно — лишний код условия
 * в CHECK не мешает.
 */
export const CONDITIONAL_STATUS_IS_REQUIRED = false

/**
 * Р9 (дополнение формы_1 от 28.07): основание обязательности вида СЭМД. В форме это
 * колонки «Приоритет обязательности 1..4» — от первичного (условия входимости, утв. МЗ РФ)
 * к последующим (госзадание/региональные акты, лицензии, прочее). У строки бывает 1–2
 * заполненных основания; несколько оснований трактуются как ИЛИ.
 */
export interface ApplicabilityRequirementGround {
    /** 1 — входимость МЗ РФ, 2 — госзадание/регион, 3 — лицензии, 4 — прочее. */
    level: number
    /** Нормативная формулировка — только она показывается пользователю МИАЦ. */
    text: string
    /**
     * Рабочая заметка методолога, отделённая от нормативной формулировки: личные
     * рассуждения, сомнения и временные решения («я не нашла приказ», «пока что
     * включаем …»). Хранится для аудита, но на экран расшифровки не выводится —
     * по ТЗ 24.07 экспертность системы строится на нормах, а не на комментариях
     * живого эксперта.
     */
    workingNote?: string
}

/**
 * Маркеры рабочей заметки: речь от первого лица, сомнение, временное решение.
 * Достаточно одного совпадения в предложении, чтобы вынести его из нормативной части.
 */
const GROUND_WORKING_NOTE_MARKERS: readonly RegExp[] = [
    /\bя\b/iu,
    /\bмне\b/iu,
    /\bмы\b/iu,
    /не наш(ла|ёл|ел)/iu,
    /не удалось найти/iu,
    /в идеале/iu,
    /пока что/iu,
    /пока не/iu,
    /нужно уточнить/iu,
    /надо уточнить/iu,
    /требует уточнени/iu,
    /под вопросом/iu,
    /предположительно/iu,
    /возможно,/iu,
    /думаю/iu,
    /\?/u,
]

/**
 * Р9 + замечание от 29.07: разделяет текст основания на нормативную формулировку и
 * рабочую заметку методолога. Разбор идёт по предложениям — методолог пишет норму
 * первой фразой, а рассуждения добавляет следом.
 *
 * Если маркеры нашлись во всех предложениях, нормативной частью считается первое
 * предложение: пустое основание хуже, чем короткое.
 */
export function splitGroundText(raw: string): {
    text: string
    workingNote: string
} {
    const value = raw.trim()
    if (!value) return { text: '', workingNote: '' }

    const sentences = value
        .split(/(?<=[.!?])\s+/u)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0)
    if (sentences.length <= 1) {
        return { text: value, workingNote: '' }
    }

    const normative: string[] = []
    const notes: string[] = []
    for (const sentence of sentences) {
        const isNote = GROUND_WORKING_NOTE_MARKERS.some(
            (marker) => marker.test(sentence),
        )
        if (isNote) notes.push(sentence)
        else normative.push(sentence)
    }
    if (normative.length === 0) {
        return {
            text: sentences[0],
            workingNote: sentences.slice(1).join(' '),
        }
    }
    return {
        text: normative.join(' '),
        workingNote: notes.join(' '),
    }
}

export interface ApplicabilityMatrixRule {
    sourceRowNumber: number
    semdTypeCode: string
    documentName: string
    requirementStatus: ApplicabilityRequirementStatus
    subdivisionType: string
    subdivisionKind: string
    conditionCode: ApplicabilityConditionCode
    conditionText: string
    comment: string
    organizationNames: string[]
    /**
     * Перечень `organizationNames` — это исключения, а не адресаты правила.
     * Смысл ровно обратный: МО из перечня под правило **не** попадает.
     */
    conditionExcludesOrganizations: boolean
    grounds: ApplicabilityRequirementGround[]
    normalizationNotes: string[]
}

export interface ApplicabilityMatrixParseResult {
    sheetName: string
    headerRowNumber: number
    sourceRuleCount: number
    rules: ApplicabilityMatrixRule[]
    uniqueSemdTypeCodes: string[]
    ignoredRedundantRows: number[]
    overriddenRows: number[]
    warnings: string[]
    /**
     * Строки, где условие требует перечня МО, а в комментарии методолога наименований нет.
     * Само по себе это не проблема: перечень может закрыть справочник признаков МО.
     * Поэтому предупреждение собирает импортёр — только по строкам, которые справочник
     * не покрыл. Парсер справочника не видит и решать за него не может.
     */
    rowsWithoutOrganizationList: number[]
}

interface HeaderColumns {
    code: number
    document: number
    decision: number
    subdivisionType: number
    subdivisionKind: number
    condition: number
    comment: number
}

/**
 * Колонки перечней МО, добавленные в форму 24.08.2026 по решению ВКС (вопрос В-04).
 * Необязательные: формы прежних редакций их не содержат и должны читаться по-старому.
 *
 * Заголовки без слова «обязателен» — это не описка. Перечень применяется к строке
 * целиком, а решение строки бывает и «не обязателен»: у вида 85 стоит «не обязателен»
 * с перечнем из шести узкоспециализированных МО, и «Обязателен только этим МО»
 * прочиталось бы ровно наоборот.
 */
interface OrganizationListColumns {
    /** «Только эти МО» — строка действует исключительно на перечисленные. */
    only: number
    /** «Все МО, кроме этих» — строка действует на всех, кроме перечисленных. */
    except: number
}

interface ApplicabilityGroundColumn {
    level: number
    column: number
}

const EXPECTED_SHEET_NAME = 'Форма условий'

function cleanText(value: unknown, maxLength = 10_000): string {
    return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
}

function cellText(cell: ExcelJS.Cell): string {
    const value = cell.value
    if (value === null || typeof value === 'undefined') return ''
    if (typeof value === 'object') {
        if ('richText' in value) {
            return cleanText(value.richText.map((part) => part.text).join(''))
        }
        if ('result' in value) {
            return cleanText(value.result)
        }
        if ('text' in value && typeof value.text === 'string') {
            return cleanText(value.text)
        }
    }
    return cleanText(value)
}

function normalizeHeader(value: string): string {
    return cleanText(value)
        .toLocaleLowerCase('ru-RU')
        .replace(/ё/g, 'е')
        .replace(/[^a-zа-я0-9]+/giu, '')
}

/**
 * Р9: колонки «Приоритет обязательности N» опциональны — форма без них (редакции до 28.07)
 * должна грузиться по-прежнему, просто без оснований.
 */
const GROUND_HEADER_PATTERN = /^приоритетобязательности(\d)/u

function findGroundColumns(
    worksheet: ExcelJS.Worksheet,
    headerRowNumber: number,
    maxColumns: number,
): ApplicabilityGroundColumn[] {
    const columns: ApplicabilityGroundColumn[] = []
    for (let columnNumber = 1; columnNumber <= maxColumns; columnNumber += 1) {
        const normalized = normalizeHeader(
            cellText(worksheet.getCell(headerRowNumber, columnNumber)),
        )
        const match = GROUND_HEADER_PATTERN.exec(normalized)
        if (match) {
            columns.push({ level: Number(match[1]), column: columnNumber })
        }
    }
    return columns.sort((left, right) => left.level - right.level)
}

function findHeader(worksheet: ExcelJS.Worksheet): {
    rowNumber: number
    columns: HeaderColumns
    organizationListColumns: OrganizationListColumns
    groundColumns: ApplicabilityGroundColumn[]
} | null {
    const aliases: Record<keyof HeaderColumns, string[]> = {
        code: ['кодвидмд', 'кодмд'],
        document: ['документ', 'видсэмд', 'видсемд'],
        decision: ['решение', 'статус'],
        subdivisionType: ['типподразделения'],
        subdivisionKind: ['видподразделения'],
        condition: ['дополнительноеусловие', 'условие'],
        comment: ['комментарийметодолога', 'комментарий'],
    }

    const maxRows = Math.min(worksheet.actualRowCount || worksheet.rowCount, 50)
    const maxColumns = Math.min(worksheet.actualColumnCount || worksheet.columnCount, 30)
    for (let rowNumber = 1; rowNumber <= maxRows; rowNumber += 1) {
        const found = new Map<keyof HeaderColumns, number>()
        for (let columnNumber = 1; columnNumber <= maxColumns; columnNumber += 1) {
            const normalized = normalizeHeader(cellText(worksheet.getCell(rowNumber, columnNumber)))
            if (!normalized) continue
            for (const [key, variants] of Object.entries(aliases) as Array<[
                keyof HeaderColumns,
                string[],
            ]>) {
                if (!found.has(key) && variants.includes(normalized)) {
                    found.set(key, columnNumber)
                }
            }
        }
        if (found.size === Object.keys(aliases).length) {
            return {
                rowNumber,
                columns: Object.fromEntries(found) as unknown as HeaderColumns,
                organizationListColumns: findOrganizationListColumns(
                    worksheet,
                    rowNumber,
                    maxColumns,
                ),
                groundColumns: findGroundColumns(worksheet, rowNumber, maxColumns),
            }
        }
    }
    return null
}

/**
 * Колонки перечней МО. Отсутствие обеих — не ошибка: так выглядят формы
 * до 24.08.2026, и читаться они должны по-прежнему, через текст «если МО — …».
 */
function findOrganizationListColumns(
    worksheet: ExcelJS.Worksheet,
    headerRowNumber: number,
    maxColumns: number,
): OrganizationListColumns {
    const onlyAliases = ['толькоэтимо', 'толькоэтимед', 'обязателентолькоэтиммо']
    const exceptAliases = ['всемокромеэтих', 'всекромеэтих', 'обязателенвсемкромеэтих']
    const columns: OrganizationListColumns = { only: 0, except: 0 }
    for (let columnNumber = 1; columnNumber <= maxColumns; columnNumber += 1) {
        const normalized = normalizeHeader(
            cellText(worksheet.getCell(headerRowNumber, columnNumber)),
        )
        if (!normalized) continue
        if (!columns.only && onlyAliases.includes(normalized)) columns.only = columnNumber
        if (!columns.except && exceptAliases.includes(normalized)) columns.except = columnNumber
    }
    return columns
}

function parseStatus(value: string): ApplicabilityRequirementStatus {
    const normalized = cleanText(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    if (normalized === 'обязателен' || normalized === 'обязательно') return 'required'
    if (normalized === 'не обязателен' || normalized === 'не обязательно') return 'not_required'
    if (normalized === 'условно') {
        return CONDITIONAL_STATUS_IS_REQUIRED ? 'required' : 'unknown'
    }
    if (normalized === 'не определено') return 'unknown'
    throw new BadRequestException(`Неизвестное решение в матрице применимости: «${value || 'пусто'}»`)
}

function classifyCondition(value: string): ApplicabilityConditionCode {
    const normalized = cleanText(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
    if (!normalized) return 'none'
    // Падеж зависит от колонки: в «Дополнительном условии» методолог писала
    // «Обязателен для МО с прикрепленным населением», в колонке приоритета —
    // «наличие прикрепленного населения». Понимаем оба.
    if (
        normalized.includes('прикрепленным детским населением')
        || normalized.includes('прикрепленного детского населения')
    ) {
        return 'attached_child_population'
    }
    if (
        normalized.includes('прикрепленным населением')
        || normalized.includes('прикрепленного населения')
        // «взрослое» прикреплённое население — тот же перечень МО: в справочнике
        // признаков МО взрослое население и есть основной признак.
        || normalized.includes('прикрепленного взрослого населения')
        || normalized.includes('прикрепленным взрослым населением')
    ) {
        return 'attached_population'
    }
    if (normalized.includes('1090.4')) return 'license_1090_4'
    // 1090.5 разбирался бы и раньше — ветки просто не было, и виды 8 и 475
    // («…к управлению транспортным средством») уходили в «условия нет»,
    // то есть становились обязательными всем 33 МО вместо 17 с лицензией.
    if (normalized.includes('1090.5')) return 'license_1090_5'
    if (normalized.includes('1090.6')) return 'license_1090_6'
    if (normalized.includes('1080.1')) return 'license_1080_1'
    if (normalized.includes('1080.4')) return 'license_1080_4'
    // «реализация государственных и региональных программ по обеспечению населения ЛЛО»
    // и её краткий вариант «реализация гос.программ по обеспечению населения ЛЛО».
    // Отдельным словом, а не подстрокой: «лло» встречается внутри обычных слов.
    if (/(^|[^а-я])лло([^а-я]|$)/u.test(normalized)) return 'llo_program'
    if (normalized.includes('узкоспециализирован')) return 'specialized_organization'
    // «Стационарной МП или в условиях дневного стационара» — два способа
    // выполнить условие. Проверяется раньше `day_hospital_group`: иначе строка
    // попадает в него и вторая половина, про круглосуточный стационар, пропадает.
    if (
        normalized.includes('дневн')
        && normalized.includes('стационар')
        && / или /u.test(normalized)
        && /стационарн(ой|ая|ую)/u.test(normalized)
    ) {
        return 'inpatient_or_day_hospital'
    }
    if (normalized.includes('дневн') && normalized.includes('стационар')) {
        return 'day_hospital_group'
    }
    return 'custom'
}

/**
 * Условие правила по колонкам «Приоритет обязательности 1..4».
 *
 * До 13.08.2026 условие читалось только из колонки «Дополнительное условие», и это
 * работало, потому что методолог писала его дважды: и туда, и в колонку приоритета.
 * В заполненной форме на 145 видов дублирования больше нет — 81 правило из 227 несёт
 * условие только в приоритетах. Без этого разбора они стали бы безусловными:
 * виды с прикреплённым населением обязательны для всех МО с амбулаторным
 * подразделением, лицензионные условия исчезают.
 *
 * Возвращается только **типовое** условие — то, для которого есть перечень МО
 * (прикреплённое население, лицензии). Основания вроде «оказание гражданам
 * медицинской помощи» перечень не сужают, и превращать их в `custom` нельзя:
 * правило ушло бы в «не определено» на пустом месте.
 */
function classifyConditionFromGrounds(
    grounds: readonly ApplicabilityRequirementGround[],
): ApplicabilityConditionCode {
    for (const ground of grounds) {
        const code = classifyCondition(ground.text)
        if (code !== 'none' && code !== 'custom') return code
    }
    return 'none'
}

export interface ConditionOrganizationList {
    names: string[]
    /** Перечень записан через отрицание: «если МО НЕ …» — это исключения. */
    excluded: boolean
}

/**
 * Перечень МО из «Дополнительного условия» вида «если МО - ГБУ КООД, ГКУ КОПБ»,
 * «если МО - Бюро СМЭ» или — с формы от 18.08.2026 — «если МО НЕ КОПАБ, КОБСМЭ, …».
 *
 * Отдельный разбор от `extractApplicabilityOrganizationNames`: тот ищет наименования
 * по правовым префиксам (ГБУ, ГКУ, АО…), а в заполненной форме на 145 видов методолог
 * пишет короткие имена без них — «Курганфармация», «Санаторий», «Диспансер», «КООД».
 * Здесь перечень задан явно, разделителями, и угадывать границы не нужно.
 *
 * Отрицание распознаётся отдельным флагом, а не выбрасывается вместе с «НЕ»: перечень
 * в обеих формах выглядит одинаково, и без флага «всем, кроме пяти» прочиталось бы как
 * «только этим пяти» — ровно противоположный состав обязательных видов.
 *
 * Наименования, которые не сопоставятся со справочником МО, попадут в предупреждения
 * предпросмотра — так же, как несопоставленные имена из комментариев. Молча пропустить
 * их нельзя: правило с нераспознанным перечнем меняет состав обязательных видов.
 */
export function parseConditionOrganizationList(
    conditionText: string,
): ConditionOrganizationList {
    const normalized = cleanText(conditionText, 5_000)
    // Границу слова даёт явный просмотр вперёд, а не `\b`: у кириллицы `\b` работает
    // не так, как ожидается — между «о» и пробелом границы для движка нет.
    const prefix = /^\s*если\s+мо(?=\s|[-–—:]|$)\s*/iu
    if (!prefix.test(normalized)) return { names: [], excluded: false }

    let rest = normalized.replace(prefix, '')
    // Тире перед «НЕ» методолог ставит не всегда: и «если МО НЕ ГСП», и «если МО - НЕ ГСП».
    const negation = /^(?:[-–—:]\s*)?не\s+/iu
    const excluded = negation.test(rest)
    if (excluded) rest = rest.replace(negation, '')
    rest = rest.replace(/^[-–—:]\s*/u, '')

    const names = rest
        .split(/[,;/]|\sи\s/u)
        .map((part) => cleanText(part, 500).replace(/^[-–—\s]+|[.\s]+$/gu, '').trim())
        .filter(Boolean)
    return { names: [...new Set(names)], excluded }
}

export function extractConditionOrganizationNames(conditionText: string): string[] {
    return parseConditionOrganizationList(conditionText).names
}

/**
 * Перечень МО из колонок «Только эти МО» и «Все МО, кроме этих» (форма с 24.08.2026).
 *
 * `null` — колонок в форме нет или обе пусты; тогда перечень ищется по-старому,
 * в тексте «Дополнительного условия». Отличать «нет колонок» от «колонки пусты»
 * не нужно: и то и другое означает «в колонках ничего не сказано».
 *
 * Заполненные обе сразу — ошибка формы, о которой предупреждает её собственный
 * лист контроля. Здесь побеждает «Только эти МО»: сузить состав безопаснее,
 * чем расширить, и расхождение видно в предпросмотре по числу обязательных пар.
 */
export function parseOrganizationListColumns(
    worksheet: ExcelJS.Worksheet,
    rowNumber: number,
    columns: OrganizationListColumns,
): ConditionOrganizationList | null {
    const only = columns.only
        ? splitOrganizationNames(cellText(worksheet.getCell(rowNumber, columns.only)))
        : []
    if (only.length > 0) return { names: only, excluded: false }
    const except = columns.except
        ? splitOrganizationNames(cellText(worksheet.getCell(rowNumber, columns.except)))
        : []
    if (except.length > 0) return { names: except, excluded: true }
    return null
}

/**
 * Разбор перечня через запятую. Пробелы по краям срезаются: методолог набирает
 * наименования руками, и ведущий пробел встречается — в форме от 25.08.2026
 * так пришли виды 353 и 354 («" КОПАБ, КОБСМЭ"»).
 */
function splitOrganizationNames(value: string): string[] {
    const names = cleanText(value, 5_000)
        .split(/[,;/]|\sи\s/u)
        .map((part) => part.replace(/^[-–—\s]+|[.\s]+$/gu, '').trim())
        .filter(Boolean)
    return [...new Set(names)]
}

export function extractApplicabilityOrganizationNames(comment: string): string[] {
    const normalizedComment = cleanText(comment, 50_000)
        .replace(/\(под вопросом\)/giu, '')
    const organizationPrefix = '(?:ФГБУ|ГАУЗ|ОБУЗ|ГБУ|ГКУ|БУ|АО)'
    const organizationPattern = new RegExp(
        `(?:^|\\s)(${organizationPrefix}\\s+.*?)(?=\\s+${organizationPrefix}(?:\\s|$)|$)`,
        'giu',
    )
    const candidates = [...normalizedComment.matchAll(organizationPattern)]
        .map((match) => cleanText(match[1], 500))
        .map((part) => part.replace(/^[\/;,\s]+|[.\/;,\s]+$/gu, '').trim())
        .filter(Boolean)
    return [...new Set(candidates)]
}

/**
 * Рабочее решение от 21.07.2026: у видов 34 и 85 строка «не обязателен» переводится
 * в «обязателен». Принималось, когда в форме стояло расплывчатое «Возможен для
 * узкоспециализированных МО» — перечня МО не было, и правило читалось как оговорка.
 *
 * С формой на 145 видов методолог пишет перечень явно: «не обязателен, если МО —
 * ГБУ КООД, ГКУ КОПБ, ГКУ КОПТД, ГКУ ШОПТД, ГКУ ШОПНД, ГБУ КОКВД». Переворачивать
 * такое указание нельзя — это ровно противоположный смысл: вместо «этим шести
 * не обязателен» получилось бы «этим шести обязателен».
 *
 * Различаем по тому, **где** записан перечень. В прежней форме условие звучало как
 * «Возможен для узкоспециализированных МО», а перечень лежал в комментарии методолога —
 * это оговорка, подмена применяется. В новой перечень стоит в самом условии
 * («если МО — …») — это указание, и трогать его нельзя.
 */
function isDemoMandatoryOverride(rule: ApplicabilityMatrixRule): boolean {
    // Перечень в колонках — такое же явное указание, как перечень в условии,
    // просто записанное иначе (форма с 24.08.2026). Переворачивать решение строки
    // нельзя и в этом случае: у вида 85 стоит «не обязателен» с перечнем шести
    // узкоспециализированных МО, и подмена сделала бы его им обязательным.
    if (
        rule.conditionCode === 'organization_list'
        || rule.conditionCode === 'organization_list_except'
    ) return false
    return (
        (rule.semdTypeCode === '34' || rule.semdTypeCode === '85')
        && rule.requirementStatus === 'not_required'
        && extractConditionOrganizationNames(rule.conditionText).length === 0
    )
}

function isSubsumedByGeneralStationaryRule(
    rule: ApplicabilityMatrixRule,
    rules: ApplicabilityMatrixRule[],
): boolean {
    if (rule.subdivisionType !== 'Стационарный') return false
    if (!rule.subdivisionKind && rule.conditionCode === 'none') return false
    return rules.some((candidate) => (
        candidate.sourceRowNumber !== rule.sourceRowNumber
        && candidate.semdTypeCode === rule.semdTypeCode
        && candidate.requirementStatus === 'required'
        && candidate.subdivisionType === 'Стационарный'
        && !candidate.subdivisionKind
        && candidate.conditionCode === 'none'
    ))
}

export async function loadApplicabilityMatrixWorkbook(
    fileBuffer: Buffer,
): Promise<ApplicabilityMatrixParseResult> {
    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(fileBuffer as any)
    } catch {
        throw new BadRequestException('Не удалось прочитать Excel-файл матрицы применимости')
    }

    const worksheet = workbook.getWorksheet(EXPECTED_SHEET_NAME)
        ?? workbook.worksheets.find((sheet) => findHeader(sheet) !== null)
    if (!worksheet) {
        throw new BadRequestException(
            'В файле не найден лист «Форма условий» со столбцами Код Вид МД, Документ, Решение, Тип и Вид подразделения',
        )
    }
    const header = findHeader(worksheet)
    if (!header) {
        throw new BadRequestException('Не найдена строка заголовков формы условий обязательности')
    }

    const sourceRules: ApplicabilityMatrixRule[] = []
    const warnings: string[] = []
    const rowsWithoutOrganizationList: number[] = []
    const lastRowNumber = Math.min(worksheet.rowCount, 10_000)
    for (let rowNumber = header.rowNumber + 1; rowNumber <= lastRowNumber; rowNumber += 1) {
        const code = cellText(worksheet.getCell(rowNumber, header.columns.code))
        if (!code) continue
        if (!/^\d+$/u.test(code)) {
            warnings.push(`Строка ${rowNumber}: пропущен некорректный код Вид МД «${code}».`)
            continue
        }
        const documentName = cellText(worksheet.getCell(rowNumber, header.columns.document))
        const decision = cellText(worksheet.getCell(rowNumber, header.columns.decision))
        const conditionText = cellText(worksheet.getCell(rowNumber, header.columns.condition))
        const comment = cellText(worksheet.getCell(rowNumber, header.columns.comment))
        // Р9: основания обязательности из колонок «Приоритет обязательности 1..4».
        const grounds = header.groundColumns
            .map((ground) => {
                const split = splitGroundText(
                    cellText(worksheet.getCell(rowNumber, ground.column)),
                )
                return {
                    level: ground.level,
                    text: split.text,
                    ...(split.workingNote ? { workingNote: split.workingNote } : {}),
                }
            })
            .filter((ground) => ground.text.length > 0)

        // Условие ищем сначала в «Дополнительном условии», потом в колонках приоритетов.
        // Порядок именно такой: если методолог заполнила оба места, побеждает то, что
        // работало до 13.08.2026, — прежние формы не должны читаться по-новому.
        const conditionFromColumn = classifyCondition(conditionText)
        const conditionCode = conditionFromColumn === 'none'
            ? classifyConditionFromGrounds(grounds)
            : conditionFromColumn
        // Подпись условия должна называть ту ячейку, из которой оно взято: иначе
        // в предпросмотре расхождений видно «условие: пусто» у сработавшего правила.
        const effectiveConditionText = conditionFromColumn === 'none' && conditionCode !== 'none'
            ? (grounds.find(
                (ground) => classifyCondition(ground.text) === conditionCode,
            )?.text ?? conditionText)
            : conditionText

        // Перечень МО приходил из трёх мест по мере развития формы: сначала из
        // комментария методолога, с формы на 145 видов — из условия («если МО -
        // Бюро СМЭ»), а с 24.08.2026 — из отдельных колонок. Колонки читаются
        // первыми и побеждают: они явные, а текст условия рядом остаётся следом
        // для сверки и в новых редакциях уже не обновляется.
        const columnOrganizations = parseOrganizationListColumns(
            worksheet,
            rowNumber,
            header.organizationListColumns,
        )
        const conditionOrganizations = columnOrganizations
            ?? parseConditionOrganizationList(conditionText)
        const conditionOrganizationNames = conditionOrganizations.names
        // Перечень-исключение получает собственный код условия: `custom` означает
        // «не определено» у всех МО, а здесь состав известен точно — все, кроме перечня.
        const excludesOrganizations = conditionOrganizations.excluded
            && conditionOrganizationNames.length > 0
        // Перечень-включение из колонки читается всегда. Из текста условия — только
        // под флагом: там он неотделим от вопроса про «условно», и включать его
        // задним числом для прежних редакций формы значило бы поменять им расчёт.
        const listsOrganizations = (columnOrganizations !== null || CONDITIONAL_STATUS_IS_REQUIRED)
            && !conditionOrganizations.excluded
            && conditionOrganizationNames.length > 0
        const rule: ApplicabilityMatrixRule = {
            sourceRowNumber: rowNumber,
            semdTypeCode: String(Number(code)),
            documentName,
            requirementStatus: parseStatus(decision),
            subdivisionType: cellText(worksheet.getCell(rowNumber, header.columns.subdivisionType)),
            subdivisionKind: cellText(worksheet.getCell(rowNumber, header.columns.subdivisionKind)),
            conditionCode: excludesOrganizations
                ? 'organization_list_except'
                : listsOrganizations
                    ? 'organization_list'
                    : conditionCode,
            conditionText: effectiveConditionText,
            comment,
            conditionExcludesOrganizations: excludesOrganizations,
            organizationNames: conditionOrganizationNames.length > 0
                ? conditionOrganizationNames
                : conditionCode === 'none' || conditionCode === 'day_hospital_group'
                    ? []
                    : extractApplicabilityOrganizationNames(comment),
            grounds,
            normalizationNotes: [],
        }

        if (isDemoMandatoryOverride(rule)) {
            rule.requirementStatus = 'required'
            rule.normalizationNotes.push(
                'Статус изменён на «обязателен» по рабочему решению от 21.07.2026',
            )
        }
        if (rule.semdTypeCode === '340' && conditionCode === 'license_1080_4') {
            rule.subdivisionType = ''
            rule.subdivisionKind = ''
            rule.normalizationNotes.push(
                'Применяется только признак лицензии 1080.4 без ограничения по подразделению',
            )
        }
        if (
            conditionCode !== 'none'
            && conditionCode !== 'day_hospital_group'
            && conditionCode !== 'custom'
            && rule.organizationNames.length === 0
        ) {
            // Не предупреждение, а факт: перечня МО нет в комментарии. Закрыт он или нет,
            // решает импортёр — справочник признаков МО может дать перечень сам.
            rowsWithoutOrganizationList.push(rowNumber)
        }
        sourceRules.push(rule)
    }

    if (sourceRules.length === 0) {
        throw new BadRequestException('В форме не найдено ни одного заполненного правила')
    }

    const ignoredRedundantRows: number[] = []
    const normalizedRules = sourceRules.filter((rule) => {
        const redundant = isSubsumedByGeneralStationaryRule(rule, sourceRules)
        if (redundant) ignoredRedundantRows.push(rule.sourceRowNumber)
        return !redundant
    })
    if (ignoredRedundantRows.length > 0) {
        warnings.push(
            `Удалено поглощённых правил для отдельных стационарных отделений: ${ignoredRedundantRows.join(', ')}.`,
        )
    }

    const uniqueSemdTypeCodes = [...new Set(
        normalizedRules.map((rule) => rule.semdTypeCode),
    )].sort((left, right) => Number(left) - Number(right))
    const overriddenRows = normalizedRules
        .filter((rule) => rule.normalizationNotes.some((note) => note.includes('Статус изменён')))
        .map((rule) => rule.sourceRowNumber)

    return {
        sheetName: worksheet.name,
        headerRowNumber: header.rowNumber,
        sourceRuleCount: sourceRules.length,
        rules: normalizedRules,
        uniqueSemdTypeCodes,
        ignoredRedundantRows,
        overriddenRows,
        warnings,
        rowsWithoutOrganizationList,
    }
}
