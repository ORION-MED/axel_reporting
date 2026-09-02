import {
    APPLICABILITY_USES_ORGANIZATION_DIRECTORY,
    buildDirectoryOverride,
    directoryOidsForCondition,
    isEmptyOverride,
    licenseCodeFromCondition,
} from './applicability-directory-override'
import type { OrganizationAttributesRow } from './organization-directory-import.service'

function row(
    oid: string,
    attached: boolean,
    child: boolean,
    licenses: Record<string, boolean>,
    lloProgram = false,
): [string, OrganizationAttributesRow] {
    return [oid, {
        organizationOid: oid,
        displayShortName: oid,
        attachedPopulation: attached,
        attachedChildPopulation: child,
        lloProgram,
        licenses,
    }]
}

const DIRECTORY = new Map<string, OrganizationAttributesRow>([
    row('oid-kp2', true, false, { '1080.1': true, '1090.6': false }, true),
    row('oid-kdp', false, true, { '1080.1': false, '1090.6': false }),
    row('oid-shgb', true, true, { '1080.1': true, '1090.6': true }, true),
])

describe('участие в ЛЛО (справочник от 13.08.2026)', () => {
    it('перечень МО берётся из признака ЛЛО', () => {
        expect(directoryOidsForCondition('llo_program', DIRECTORY))
            .toEqual(new Set(['oid-kp2', 'oid-shgb']))
    })

    it('справочник без признака условие не покрывает', () => {
        // Колонка появилась только 13.08. На справочниках, загруженных раньше, признак
        // стоит `false` у всех — и пустой перечень снял бы обязательность у всех МО.
        const legacy = new Map<string, OrganizationAttributesRow>([
            row('oid-kp2', true, false, { '1080.1': true }),
        ])

        expect(directoryOidsForCondition('llo_program', legacy)).toBeNull()
    })
})

describe('перечень МО по условию — справочник против комментария', () => {
    it('прикреплённое взрослое и детское население разводятся', () => {
        expect([...directoryOidsForCondition('attached_population', DIRECTORY)!].sort())
            .toEqual(['oid-kp2', 'oid-shgb'])
        expect([...directoryOidsForCondition('attached_child_population', DIRECTORY)!].sort())
            .toEqual(['oid-kdp', 'oid-shgb'])
    })

    it('условие лицензии сопоставляется с колонкой файла по коду', () => {
        expect([...directoryOidsForCondition('license_1080_1', DIRECTORY)!].sort())
            .toEqual(['oid-kp2', 'oid-shgb'])
        expect([...directoryOidsForCondition('license_1090_6', DIRECTORY)!])
            .toEqual(['oid-shgb'])
    })

    it('пустой справочник ничего не переопределяет', () => {
        expect(directoryOidsForCondition('attached_population', new Map())).toBeNull()
    })

    it('лицензия, которой нет в файле, оставляет перечень из комментария', () => {
        // Иначе загрузка справочника без колонки 1090.4 молча сняла бы обязательность
        // со всех МО по виду 45 — то есть изменила бы знаменатель в никуда.
        expect(directoryOidsForCondition('license_1090_4', DIRECTORY)).toBeNull()
    })

    it('лицензия есть в файле, но не отмечена ни у кого — это пустой перечень, а не «нет данных»', () => {
        const directory = new Map([row('oid-kp2', false, false, { '1090.4': false })])
        const oids = directoryOidsForCondition('license_1090_4', directory)
        expect(oids).not.toBeNull()
        expect(oids!.size).toBe(0)
    })

    it('условия, которых справочник не касается, не трогаются', () => {
        for (const condition of ['none', 'custom', 'day_hospital_group', 'specialized_organization'] as const) {
            expect(directoryOidsForCondition(condition, DIRECTORY)).toBeNull()
        }
    })
})

describe('код лицензии из кода условия', () => {
    it('разворачивает подчёркивание обратно в точку', () => {
        expect(licenseCodeFromCondition('license_1080_1')).toBe('1080.1')
        expect(licenseCodeFromCondition('license_1090_6')).toBe('1090.6')
    })

    it('не-лицензионные условия кода не дают', () => {
        expect(licenseCodeFromCondition('attached_population')).toBe('')
        expect(licenseCodeFromCondition('custom')).toBe('')
    })
})

describe('расхождение справочника и комментария', () => {
    it('показывает обе стороны: и добавленных, и снятых', () => {
        const override = buildDirectoryOverride(
            new Set(['oid-kp2', 'oid-kdp']),
            new Set(['oid-kp2', 'oid-shgb']),
        )
        expect(override).toEqual({ added: ['oid-shgb'], removed: ['oid-kdp'] })
        expect(isEmptyOverride(override)).toBe(false)
    })

    it('совпадающие перечни расхождением не считаются', () => {
        const override = buildDirectoryOverride(new Set(['a', 'b']), new Set(['b', 'a']))
        expect(isEmptyOverride(override)).toBe(true)
    })
})

describe('точка отката', () => {
    it('флаг включён — иначе справочник не подключён к расчёту', () => {
        // Тест держит флаг на виду: если его выключили ради отката, это осознанное действие,
        // а не забытая правка.
        expect(APPLICABILITY_USES_ORGANIZATION_DIRECTORY).toBe(true)
    })
})
