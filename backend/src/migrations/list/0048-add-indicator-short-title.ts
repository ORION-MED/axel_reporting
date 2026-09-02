import type { Migration } from '../migration.types'

/**
 * Короткое имя показателя и его номер в «Приложении 2».
 *
 * Повод — ВКС 15.08.2026: в выпадающем списке над картой стоят только коды вида
 * «6.1.3.2.11», и между чем переключаешься — непонятно. Методолог просила уйти
 * от длинных числовых кодов к нумерации «Приложения 2»: «это длинное числовое
 * наименование пошло из самого первого приложения Минздрава, а потом они перешли
 * на приложение 2, прямо по номеру в таблице Excel».
 *
 * **Короткого имени в «Приложении 2» нет** — там четырнадцать колонок, и
 * «Наименование показателя» длиной в абзац. Поэтому имена заведены здесь; взяты
 * они не с потолка, а из самого наименования: у всех четырёх долей оно построено
 * как «Доля СЭМД «<вид>» (OID …) относительно количества …», и вид в кавычках
 * и есть естественное короткое имя.
 *
 * **Прежний код не удаляется.** `code` остаётся идентификатором показателя:
 * по нему идёт сверка с Соглашением о предоставлении МБТ, на него ссылаются
 * плановые значения и вся переписка с методологом. Номер «Приложения 2» —
 * дополнительная подпись, а не замена.
 *
 * Показатель «Виды СЭМД, регистрируемые в РЭМД» номера не получает: в «Приложении 2»
 * его нет вовсе, а № 27 там занят маммографией с ИИ. Решение пользователя
 * от 15.08.2026 — обозначение для него выбрать отдельно и в последнюю очередь.
 */
export const migration: Migration = {
    id: 48,
    name: 'add_indicator_short_title',
    upSql: `
    ALTER TABLE reporting_indicators
        ADD COLUMN IF NOT EXISTS short_title TEXT NOT NULL DEFAULT '';

    ALTER TABLE reporting_indicators
        ADD COLUMN IF NOT EXISTS appendix2_number TEXT NOT NULL DEFAULT '';

    UPDATE reporting_indicators SET short_title = 'Виды ЭМД на ЕПГУ', appendix2_number = '16'
        WHERE code = '6.1.3.2.7';
    UPDATE reporting_indicators SET short_title = 'Эпикриз амбулаторный', appendix2_number = '20'
        WHERE code = '6.1.3.2.8';
    UPDATE reporting_indicators SET short_title = 'Профосмотры и диспансеризация', appendix2_number = '21'
        WHERE code = '6.1.3.2.9';
    UPDATE reporting_indicators SET short_title = 'Эпикриз стационарный', appendix2_number = '22'
        WHERE code = '6.1.3.2.10';
    UPDATE reporting_indicators SET short_title = 'Карта вызова скорой', appendix2_number = '23'
        WHERE code = '6.1.3.2.11';
    UPDATE reporting_indicators SET short_title = 'Свидетельства о рождении', appendix2_number = '2'
        WHERE code = '6.1.3.2.12';
    UPDATE reporting_indicators SET short_title = 'Свидетельства о смерти', appendix2_number = '3'
        WHERE code = '6.1.3.2.13';

    -- Номер «Приложения 2» намеренно пуст: показателя там нет, см. комментарий выше.
    UPDATE reporting_indicators SET short_title = 'Виды СЭМД в РЭМД'
        WHERE code = '27';
    `,
}
