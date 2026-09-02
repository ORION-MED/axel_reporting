import {
    buildMatrixOrganizationAliasIndex,
    resolveMatrixOrganizations,
    type MatrixAliasOrganization,
} from './matrix-organization-alias-index'

function organization(
    oid: string,
    shortName: string,
    options: { aliases?: string[]; groupAliases?: string[] } = {},
): MatrixAliasOrganization {
    return {
        oid,
        officialFullName: `ГОСУДАРСТВЕННОЕ БЮДЖЕТНОЕ УЧРЕЖДЕНИЕ "${shortName}"`,
        officialShortName: `ГБУ "${shortName}"`,
        commonName: shortName,
        aliases: options.aliases ?? [],
        groupAliases: options.groupAliases ?? [],
    }
}

const GORKOE = organization('oid-4298', 'САНАТОРИЙ "ОЗЕРО ГОРЬКОЕ"', {
    groupAliases: ['Санаторий'],
})
const KOSMOS = organization('oid-4293', 'ДЕТСКИЙ САНАТОРИЙ "КОСМОС"', {
    groupAliases: ['Санаторий'],
})
const KOND = organization('oid-4271', 'КОНД', { aliases: ['Диспансер'] })
const KOKD = organization('oid-4309', 'КОКД', { aliases: ['Диспансер'] })

const INDEX = buildMatrixOrganizationAliasIndex([GORKOE, KOSMOS, KOND, KOKD])

describe('сопоставление наименований МО из перечней матрицы', () => {
    it('одно совпадение — обычный случай', () => {
        const match = resolveMatrixOrganizations(INDEX, 'КОНД')
        expect(match.status).toBe('single')
        expect(match.organizations.map((row) => row.oid)).toEqual(['oid-4271'])
    })

    it('правовая форма не мешает: «ГБУ "КОКД"» и «КОКД» — одна МО', () => {
        expect(resolveMatrixOrganizations(INDEX, 'ГБУ "КОКД"').organizations)
            .toEqual(resolveMatrixOrganizations(INDEX, 'КОКД').organizations)
    })

    it('«Санаторий» раскрывается в обе МО группы', () => {
        // Ответ методолога от 28.08.2026: санаториев в перечне видов 48, 50 и 357
        // подразумевается два, «Озеро Горькое» и «Космос».
        const match = resolveMatrixOrganizations(INDEX, 'Санаторий')
        expect(match.status).toBe('group')
        expect(match.organizations.map((row) => row.oid).sort())
            .toEqual(['oid-4293', 'oid-4298'])
    })

    it('совпадение с несколькими МО без группового синонима остаётся неоднозначным', () => {
        // «Диспансер» подходит четырём организациям области. Выбирать за методолога
        // нельзя: молчаливый выбор двух из четырёх дороже видимого пропуска.
        const match = resolveMatrixOrganizations(INDEX, 'Диспансер')
        expect(match.status).toBe('ambiguous')
        expect(match.organizations).toEqual([])
    })

    it('группой считается только полное совпадение состава', () => {
        // Если под тем же именем нашлась посторонняя МО, группа больше не описывает
        // перечень целиком — и это снова неоднозначность.
        const index = buildMatrixOrganizationAliasIndex([
            GORKOE,
            KOSMOS,
            organization('oid-zhemchuzhina', 'ЖЕМЧУЖИНА ЗАУРАЛЬЯ', { aliases: ['Санаторий'] }),
        ])
        expect(resolveMatrixOrganizations(index, 'Санаторий').status).toBe('ambiguous')
    })

    it('незнакомое имя не находится', () => {
        expect(resolveMatrixOrganizations(INDEX, 'ГБУ "МРБ №9"').status).toBe('none')
    })
})
