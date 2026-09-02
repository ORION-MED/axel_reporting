import {
    SEMD_TYPES_HANDLED_IN_EXTERNAL_SYSTEM,
    SHOW_EXTERNAL_SYSTEM_CAUSE,
    calculateOrganization,
    externalSystemNote,
    requirementKey,
} from './pilot-calculation.pure'
import {
    type FindingToSave,
    type OrganizationRow,
    type RequirementRow,
    type SemdTypeRow,
} from './pilot-calculation.types'

/**
 * В12 (ВКС 31.07.2026): вид ведётся в другой информационной системе региона.
 *
 * Методолог про Курганскую поликлинику №2: «В Курганской области льготные рецепты
 * лекарственного обеспечения здесь выписываются в другой программе… Поэтому льготный
 * рецепт от большинства медорганизаций в РЭМД не регистрируется».
 *
 * Признак живёт на уровне вида, а не пары «МО × вид»: участники пилота определяются
 * наличием регистраций, и находка до них не доходит. Тесты фиксируют это устройство,
 * потому что соблазн завести перечень МО возникнет при первом же похожем случае.
 */
describe('externalSystemNote (В12)', () => {
    it('узнаёт льготный рецепт по коду «Вид МД»', () => {
        const note = externalSystemNote('37')
        expect(note).not.toBeNull()
        expect(note).toContain('другой программе')
    })

    it('не трогает остальные виды', () => {
        for (const code of ['5', '86', '121', '350']) {
            expect(externalSystemNote(code)).toBeNull()
        }
    })

    it('терпит пробелы в коде — коды приходят из разных выгрузок', () => {
        expect(externalSystemNote(' 37 ')).not.toBeNull()
    })

    it('не падает, если код вида не заполнен', () => {
        expect(externalSystemNote(null)).toBeNull()
        expect(externalSystemNote('')).toBeNull()
    })

    it('перечень не пуст и объясняет каждый вид словами', () => {
        const entries = Object.entries(SEMD_TYPES_HANDLED_IN_EXTERNAL_SYSTEM)
        expect(entries.length).toBeGreaterThan(0)
        for (const [code, note] of entries) {
            expect(code).toMatch(/^\d+$/)
            expect(note.length).toBeGreaterThan(30)
        }
    })

    it('флаг включён — при откате в false перечень перестаёт действовать целиком', () => {
        expect(SHOW_EXTERNAL_SYSTEM_CAUSE).toBe(true)
    })

    it('рецепт на лекарственный препарат (86) под правило НЕ подпадает', () => {
        // Код 37 — льготный рецепт, код 86 — обычный рецепт. Методолог говорила
        // только о льготном лекарственном обеспечении, расширять правило нельзя.
        expect(externalSystemNote('86')).toBeNull()
        expect(externalSystemNote('37')).not.toBeNull()
    })
})

/**
 * Текст причины № 17 после согласования 20.08.2026 (решение «Изменить», вопрос В-09).
 *
 * Проверяется именно собранная находка, а не константа: правило живёт внутри ветки
 * `gisAvailable === true` и легко потерять — достаточно, чтобы ветка «МО не
 * зарегистрировала» встала перед ней, и текст методолога перестанет показываться,
 * а тест на константу этого не заметит.
 */
describe('находка semd_handled_in_external_system', () => {
    const LGOTA: SemdTypeRow = {
        id: 'type-37',
        code: '37',
        nsiOid: '37',
        name: 'Льготный рецепт',
        epguAvailable: true,
        officialOid: null,
        epguVisibleRegistry: true,
        officialName5pr: null,
    }

    const ORGANIZATION: OrganizationRow = {
        oid: 'oid-1',
        officialFullName: 'ГБУ «Курганская поликлиника № 2»',
        officialShortName: 'КП2',
        commonName: 'КП2',
        address: '',
        latitude: null,
        longitude: null,
        locationSource: '',
        locationPrecision: '',
    }

    const REQUIREMENT: RequirementRow = {
        organizationOid: 'oid-1',
        semdTypeId: 'type-37',
        requirementStatus: 'required',
        gisAvailable: true,
        reason: 'ЛЛО',
        sourceName: 'матрица применимости',
        isManualOverride: false,
    }

    function findingForLgota(): FindingToSave {
        const findings: FindingToSave[] = []
        calculateOrganization({
            organization: ORGANIZATION,
            epguTypes: [LGOTA],
            epguTypeIds: new Set(['type-37']),
            referenceReady: true,
            referenceReadiness: 'ready',
            // Регистраций по виду нет — участники пилота до находки не доходят.
            factTypeIds: new Set<string>(),
            requirementByKey: new Map([
                [requirementKey('oid-1', 'type-37'), REQUIREMENT],
            ]),
            findings,
        })
        const finding = findings.find(
            (item) => item.findingCode === 'semd_handled_in_external_system',
        )
        expect(finding).toBeDefined()
        return finding!
    }

    it('причина называет факт, а не оправдание', () => {
        // До 20.08.2026 текст утверждал, что вид «ведётся в другой информационной
        // системе региона». Методолог эту трактовку сняла: для сервиса не важно,
        // из какой ИС зарегистрирован СЭМД.
        const finding = findingForLgota()

        expect(finding.cause).toBe(
            'Обязательный вид СЭМД доступен в региональной ГИС, регистраций в РЭМД нет.',
        )
        expect(finding.cause).not.toContain('другой информационной системе')
    })

    it('действие — дословная формулировка методолога', () => {
        expect(findingForLgota().recommendation).toBe(
            'При ведении льготных рецептов в ГИС региона или в одной из компонент '
            + 'ГИС региона обеспечить выполнение действий, необходимых для регистрации '
            + 'СЭМД в РЭМД ЕГИСЗ.',
        )
    })

    it('серьёзность — ошибка, а не «Информация»', () => {
        // Решение от 25.08.2026, наше, не методолога. Пока причина оправдывала
        // отсутствие регистраций, «Информация» была уместна. С 20.08 она называет
        // факт — то же самое, что причина № 8 «возможность в ГИС есть, регистраций
        // нет», а та `error`. Держать одно и то же разными типами нельзя: в разборе
        // они стоят рядом и читаются как разная тяжесть.
        expect(findingForLgota().severity).toBe('error')
    })

    it('зона ответственности называет обоих виновных', () => {
        // По ответу В-09: либо МИАЦ не закупил функционал, либо в МО не выполняются
        // все действия по оформлению. Прежняя зона «МИАЦ / аналитик предметной
        // области» ждала объяснения, а объяснение уже получено.
        expect(findingForLgota().responsibilityArea).toBe('МО / МИАЦ')
    })

    it('ведение в другой программе осталось основанием находки', () => {
        // Из текста для читателя оно ушло, но объясняет, почему вид выделен
        // в отдельную находку, — и должно оставаться видимым в разборе.
        expect(findingForLgota().evidence).toMatchObject({
            externalSystemNote: SEMD_TYPES_HANDLED_IN_EXTERNAL_SYSTEM['37'],
        })
    })

    it('регистрация по виду есть — находки нет вовсе', () => {
        // МО — участник пилота: правило про неё молчит, иначе система обвиняла бы
        // тех, кто как раз всё делает.
        const findings: FindingToSave[] = []
        calculateOrganization({
            organization: ORGANIZATION,
            epguTypes: [LGOTA],
            epguTypeIds: new Set(['type-37']),
            referenceReady: true,
            referenceReadiness: 'ready',
            factTypeIds: new Set(['type-37']),
            requirementByKey: new Map([
                [requirementKey('oid-1', 'type-37'), REQUIREMENT],
            ]),
            findings,
        })

        expect(findings.map((item) => item.findingCode))
            .not.toContain('semd_handled_in_external_system')
    })
})
