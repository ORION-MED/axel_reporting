import { TextDecoder } from 'util'

/**
 * Восстановление русского имени файла из multipart-заголовка.
 *
 * Заголовки multipart разбираются как latin1: каждый байт становится символом
 * с тем же кодом. Клиент, приславший имя в кодировке отличной от latin1,
 * приходит к нам «кракозябрами», и в истории загрузок остаётся мусор вместо
 * «Отчет СЭМД_РЭМД янв-июль.xlsx».
 *
 * Браузер такой проблемы не создаёт: он шлёт имя по RFC 5987
 * (`filename*=UTF-8''…`), и busboy разбирает его сам. Чинить приходится за всех
 * остальных — сторонние клиенты и интеграции, которые шлют обычный `filename=`.
 *
 * Вариантов ровно два, и они различимы:
 *
 * | Кодировка клиента | «Отчет» выглядит как |
 * |---|---|
 * | UTF-8 | `ÐÑÑÐµÑ` — пары `Ð`/`Ñ` |
 * | CP1251 | `Îò÷åò` — одиночные байты верхней половины |
 *
 * Первый случай разбирался с самого начала. Второй добавлен 25.08.2026, когда
 * файл, загруженный не из браузера, попал в журнал импортов как
 * «7.Îò÷åò ÑÝÌÄ_ÐÝÌÄ ÿíâ-èþëü.xlsx». На данные это не влияет — только
 * на подпись в истории, — но по такой подписи невозможно понять, что грузили.
 */
export function decodeMultipartFilename(filename: string): string {
    if (!filename) return ''
    if (hasCyrillic(filename)) return filename

    const fromUtf8 = decodeLatin1Utf8(filename)
    if (fromUtf8 !== filename) return fromUtf8

    return decodeLatin1Cp1251(filename)
}

export function decodeLatin1Utf8(value: string): string {
    if (!value) return ''
    if (hasCyrillic(value)) return value
    if (!hasUtf8Mojibake(value)) return value

    try {
        const bytes = Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0) & 0xff))
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (decoded && hasCyrillic(decoded)) {
            return decoded
        }
    } catch {
        return value
    }

    return value
}

/**
 * Второй заход — имя пришло в CP1251.
 *
 * **Опасность здесь в ложных срабатываниях, и от них защищает длина слова.**
 * Любой байт верхней половины что-нибудь да означает в CP1251: французское
 * `Café.xlsx` превратилось бы в `Cafй.xlsx` — тоже «кириллица», но мусорная.
 * Поэтому результат принимается, только если в нём есть подряд идущее слово
 * из кириллицы: у настоящего русского имени такие слова есть всегда,
 * а у латинского с одним диакритическим знаком — никогда.
 */
export function decodeLatin1Cp1251(value: string): string {
    if (!value) return ''
    if (hasCyrillic(value)) return value
    if (!hasHighBytes(value)) return value

    try {
        const bytes = Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0) & 0xff))
        const decoded = new TextDecoder('windows-1251').decode(bytes)
        if (decoded && hasCyrillicWord(decoded)) {
            return decoded
        }
    } catch {
        return value
    }

    return value
}

function hasCyrillic(value: string): boolean {
    for (const char of value) {
        const codePoint = char.codePointAt(0) ?? 0
        if (codePoint >= 0x0400 && codePoint <= 0x04ff) {
            return true
        }
    }
    return false
}

/** Слово из трёх и более кириллических букв подряд. */
const CYRILLIC_WORD = /[Ѐ-ӿ]{3,}/u

function hasCyrillicWord(value: string): boolean {
    return CYRILLIC_WORD.test(value)
}

/** Есть ли байты верхней половины — то есть вообще что-то не ASCII. */
function hasHighBytes(value: string): boolean {
    for (const char of value) {
        const codePoint = char.codePointAt(0) ?? 0
        if (codePoint >= 0x0080 && codePoint <= 0x00ff) {
            return true
        }
    }
    return false
}

function hasUtf8Mojibake(value: string): boolean {
    for (const char of value) {
        const codePoint = char.codePointAt(0) ?? 0
        if (
            codePoint === 0x00c2 ||
            codePoint === 0x00c3 ||
            codePoint === 0x00d0 ||
            codePoint === 0x00d1 ||
            (codePoint >= 0x0080 && codePoint <= 0x00bf)
        ) {
            return true
        }
    }
    return false
}
