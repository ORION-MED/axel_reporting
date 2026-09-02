import {
    ORGANIZATION_ALIAS_SEED,
    normalizeOrganizationAlias,
} from './organization-alias-seed'

describe('рабочие синонимы МО', () => {
    it('групповой синоним один — «Санаторий» на две МО', () => {
        const groups = ORGANIZATION_ALIAS_SEED.filter((entry) => entry.kind === 'group')
        expect(groups.map((entry) => entry.alias)).toEqual(['Санаторий', 'Санаторий'])
        expect(groups.map((entry) => entry.oid).sort()).toEqual([
            '1.2.643.5.1.13.13.12.2.45.4293',
            '1.2.643.5.1.13.13.12.2.45.4298',
        ])
    })

    it('пара «OID + нормализованный синоним» уникальна', () => {
        // Ключ уникальности в таблице именно такой. Дубль не упадёт (ON CONFLICT
        // DO NOTHING), но означал бы опечатку в списке.
        const keys = ORGANIZATION_ALIAS_SEED.map(
            (entry) => `${entry.oid}|${normalizeOrganizationAlias(entry.alias)}`,
        )
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('у КОЦМП два написания на один OID — старое и новое', () => {
        // Справочник от 28.08.2026 переименовал МО в «КОЦМП ЛФ и СМ», а матрица того же
        // числа исключает вид 7 по прежнему «КОЦОЗМП».
        const kocmp = ORGANIZATION_ALIAS_SEED.filter(
            (entry) => entry.oid === '1.2.643.5.1.13.13.12.2.45.4324',
        )
        expect(kocmp.map((entry) => entry.alias).sort()).toEqual(['КОЦМП', 'КОЦОЗМП'])
    })

    it('нормализация повторяет SQL: регистр и «ё»', () => {
        expect(normalizeOrganizationAlias(' Озеро Горькое ')).toBe('озеро горькое')
    })
})
