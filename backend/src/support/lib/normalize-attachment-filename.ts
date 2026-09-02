/**
 * Декодирует имя файла, если оно пришло в неправильной кодировке (например, UTF-8 байты как Latin-1).
 * @param filename - Имя файла из Multer
 * @returns Декодированное имя файла
 */
export function decodeFilename(filename: string): string {
    try {
        // Если имя содержит UTF-8 байты, интерпретированные как Latin-1, декодируем обратно
        return Buffer.from(filename, 'latin1').toString('utf8')
    } catch {
        // Если декодирование не удалось, возвращаем как есть
        return filename
    }
}

/**
 * Нормализует имя файла для безопасного использования в email attachments.
 * Транслитерирует кириллицу в латиницу, приводит к lower-case,
 * заменяет пробелы и недопустимые символы на "-", сохраняет расширение.
 *
 * @param originalName - Оригинальное имя файла
 * @returns Нормализованное имя файла
 */
export function normalizeAttachmentFilename(originalName: string): string {
    // Сначала декодируем имя файла
    const decodedName = decodeFilename(originalName)

    if (!decodedName) {
        return 'attachment'
    }

    // Разделяем на имя и расширение
    const lastDotIndex = decodedName.lastIndexOf('.')
    let name: string
    let extension: string

    if (lastDotIndex > 0) {
        name = decodedName.substring(0, lastDotIndex)
        extension = decodedName.substring(lastDotIndex + 1).toLowerCase()
    } else {
        name = decodedName
        extension = ''
    }

    // Транслитерация кириллицы в латиницу
    const translitMap: Record<string, string> = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
        'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
        'А': 'a', 'Б': 'b', 'В': 'v', 'Г': 'g', 'Д': 'd', 'Е': 'e', 'Ё': 'yo',
        'Ж': 'zh', 'З': 'z', 'И': 'i', 'Й': 'y', 'К': 'k', 'Л': 'l', 'М': 'm',
        'Н': 'n', 'О': 'o', 'П': 'p', 'Р': 'r', 'С': 's', 'Т': 't', 'У': 'u',
        'Ф': 'f', 'Х': 'kh', 'Ц': 'ts', 'Ч': 'ch', 'Ш': 'sh', 'Щ': 'shch',
        'Ъ': '', 'Ы': 'y', 'Ь': '', 'Э': 'e', 'Ю': 'yu', 'Я': 'ya'
    }

    let normalized = ''
    for (const char of name) {
        normalized += translitMap[char] || char
    }

    // Приводим к lower-case
    normalized = normalized.toLowerCase()

    // Заменяем пробелы и недопустимые символы на "-"
    normalized = normalized.replace(/[^a-z0-9\-_]/g, '-')

    // Убираем множественные "-"
    normalized = normalized.replace(/-+/g, '-')

    // Trim "-" с концов
    normalized = normalized.replace(/^-+|-+$/g, '')

    // Если пустое, fallback
    if (!normalized) {
        normalized = 'attachment'
    }

    // Добавляем расширение
    return extension ? `${normalized}.${extension}` : normalized
}
