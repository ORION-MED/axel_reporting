import type { Migration } from '../migration.types'
import { decodeMultipartFilename } from '../../common/decode-multipart-filename'

/**
 * Починка имён файлов-источников, записанных до 25.08.2026.
 *
 * Разбор multipart-заголовка научился понимать CP1251 только 25.08 — до этого
 * имя, присланное не браузером, оседало в базе как «8_Ìàòðèöà_ïðèìåíèìîñòè…».
 * Само исправление на старые записи не действует: они уже лежат испорченными
 * и всплывают в графе «Основание» карточки медорганизации.
 *
 * **Порча обратима.** Это байты CP1251, прочитанные как latin1, символ
 * в символ — ни одного `U+FFFD`, в отличие от случая с названием периода,
 * который пришлось править руками. Обратное преобразование восстанавливает
 * имя точно.
 *
 * **Почему кодом, а не SQL.** В SQL это `convert_from(convert_to(…))`, и там
 * негде поставить защиту от ложных срабатываний: французское `Café.xlsx`
 * превратилось бы в `Cafй.xlsx`. Та защита уже написана и покрыта тестами
 * в `decodeMultipartFilename` — она требует, чтобы в результате нашлось слово
 * из трёх кириллических букв подряд. Проще позвать её, чем повторять условие
 * на другом языке.
 *
 * Отсюда единственная оговорка: миграция зависит от прикладной функции.
 * На чистой базе это безвредно — портить там нечего, и миграция ничего
 * не меняет независимо от того, как функция себя ведёт.
 *
 * Таблицы не перечислены поимённо, а находятся по колонке `source_name`:
 * на стенде их шесть, но на сервере набор загруженного другой, и список
 * разошёлся бы молча.
 */
export const migration: Migration = {
    id: 61,
    name: 'repair_mojibake_source_names',
    async up(client: any): Promise<void> {
        const tables = await client.query(`
            SELECT table_name AS name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_name = 'source_name'
              AND data_type IN ('text', 'character varying')
              AND table_name LIKE 'reporting%'
            ORDER BY table_name;
        `)

        let repairedRows = 0
        const repairedNames: string[] = []

        for (const row of tables.rows) {
            const table = String(row.name)
            // Имя пришло из information_schema и отобрано по префиксу, но
            // подставлять его в запрос без проверки всё равно нельзя.
            if (!/^[a-z0-9_]+$/.test(table)) continue

            const names = await client.query(
                `SELECT DISTINCT source_name AS value
                   FROM "${table}"
                  WHERE source_name IS NOT NULL AND source_name <> '';`,
            )

            for (const nameRow of names.rows) {
                const stored = String(nameRow.value)
                const decoded = decodeMultipartFilename(stored)
                if (decoded === stored) continue

                const updated = await client.query(
                    `UPDATE "${table}" SET source_name = $1 WHERE source_name = $2;`,
                    [decoded, stored],
                )
                repairedRows += updated.rowCount ?? 0
                if (!repairedNames.includes(decoded)) repairedNames.push(decoded)
            }
        }

        if (repairedRows > 0) {
            // eslint-disable-next-line no-console
            console.log(
                `  Восстановлено имён файлов: ${repairedNames.length}, `
                + `строк: ${repairedRows}`,
            )
            for (const name of repairedNames) {
                // eslint-disable-next-line no-console
                console.log(`    ${name}`)
            }
        }
    },
}
