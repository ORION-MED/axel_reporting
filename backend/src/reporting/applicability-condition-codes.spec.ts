import * as fs from 'fs'
import * as path from 'path'
import { APPLICABILITY_CONDITION_CODES } from './applicability-matrix-xlsx'

/**
 * Страховка на дублированный перечень кодов условий применимости.
 *
 * Перечень живёт в двух местах: в `APPLICABILITY_CONDITION_CODES` и в CHECK таблицы
 * `reporting_semd_applicability_rules`. Убрать дублирование нельзя — база обязана
 * проверять значения сама, — но разъехаться они не должны.
 *
 * 14.08.2026 это уже случилось: код `llo_program` добавили в тип и в импортёр,
 * а CHECK остался прежним. Подтверждение матрицы падало на вставке,
 * загрузка оставалась в статусе «предпросмотр», и найти причину удалось
 * не сразу — ошибка приходила из базы, а не из кода.
 */

const CONSTRAINT_NAME = 'reporting_semd_applicability_rules_condition_chk'
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'list')

/**
 * Последняя по номеру миграция, задающая CHECK. Именно она описывает актуальное
 * состояние базы: следующая такая же миграция перекрывает предыдущую.
 */
function readLatestCheckConstraint(): { file: string; codes: string[] } {
    const candidates = fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.endsWith('.ts'))
        .filter((file) => {
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
            return sql.includes(CONSTRAINT_NAME) && sql.includes('condition_code IN (')
        })
        .sort()

    const file = candidates[candidates.length - 1]
    if (!file) {
        throw new Error(
            `Не найдена миграция, задающая ${CONSTRAINT_NAME}. `
            + 'Либо ограничение переименовали, либо тест смотрит не туда.',
        )
    }

    const source = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    const listStart = source.lastIndexOf('condition_code IN (')
    const listEnd = source.indexOf('))', listStart)
    const list = source.slice(listStart, listEnd)
    const codes = Array.from(list.matchAll(/'([a-z0-9_]+)'/g)).map((match) => match[1])
    return { file, codes }
}

describe('перечень кодов условий применимости', () => {
    it('в коде и в CHECK таблицы совпадает', () => {
        const { file, codes } = readLatestCheckConstraint()
        const inCode = [...APPLICABILITY_CONDITION_CODES].sort()
        const inDatabase = [...codes].sort()

        // Сообщение об ошибке важнее самой проверки: без него разработчик увидит
        // только «два массива не равны» и пойдёт искать причину в импортёре.
        expect({ source: file, codes: inDatabase }).toEqual({
            source: file,
            codes: inCode,
        })
    })

    it('в CHECK нет повторов', () => {
        const { codes } = readLatestCheckConstraint()
        expect(codes).toHaveLength(new Set(codes).size)
    })

    it('в коде нет повторов', () => {
        expect(APPLICABILITY_CONDITION_CODES)
            .toHaveLength(new Set(APPLICABILITY_CONDITION_CODES).size)
    })

    /**
     * Условие `none` — значение по умолчанию для безусловных правил, оно приходит
     * из парсера в каждой строке без условия. Пропасть из перечня оно не может.
     */
    it('безусловное правило остаётся допустимым', () => {
        expect(APPLICABILITY_CONDITION_CODES).toContain('none')
        expect(readLatestCheckConstraint().codes).toContain('none')
    })
})
