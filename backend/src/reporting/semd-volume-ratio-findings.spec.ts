import {
    VOLUME_RATIO_OVERACHIEVED_CODE,
    buildVolumeRatioFindings,
} from './semd-volume-ratio-findings'
import type {
    SemdVolumeRatioOrganizationValue,
    SemdVolumeRatioResult,
} from './semd-volume-ratio.calculator'

/**
 * Н20: находка о перевыполнении накопительного плана у показателей-долей.
 *
 * Главное, что проверяется, — границы. Перевыполнение существует не у всех: у МО
 * без утверждённого объёма процента нет вообще, и «перевыполнения нет» там означает
 * не ноль, а отсутствие предмета сравнения. Ошибиться здесь легко, а на экране это
 * выглядит как утверждение системы о работе конкретной больницы.
 */

function organization(
    overrides: Partial<SemdVolumeRatioOrganizationValue> = {},
): SemdVolumeRatioOrganizationValue {
    return {
        organizationOid: 'oid-1',
        status: 'calculated',
        numerator: 1_200,
        denominator: 1_000,
        annualDenominator: 1_500,
        usedAnnualFallback: false,
        percent: 120,
        numeratorByType: [],
        denominatorBySheet: [],
        ...overrides,
    }
}

function result(
    organizations: SemdVolumeRatioOrganizationValue[],
): SemdVolumeRatioResult {
    return {
        region: {
            numerator: 0,
            denominator: 0,
            annualDenominator: 0,
            annualFallbackOrganizationCount: 0,
            percent: null,
            organizationCount: organizations.length,
            calculatedOrganizationCount: 0,
            factWithoutPlanOrganizationCount: 0,
            notParticipatingOrganizationCount: 0,
            numeratorWithoutPlan: 0,
            numeratorByType: [],
            denominatorBySheet: [],
        },
        organizations,
    }
}

describe('находка о перевыполнении накопительного плана', () => {
    it('перевыполнение даёт находку с основанием', () => {
        const [finding] = buildVolumeRatioFindings(result([organization()]))

        expect(finding.findingCode).toBe(VOLUME_RATIO_OVERACHIEVED_CODE)
        // Не ошибка и не предупреждение: план перевыполнен, а не нарушен.
        expect(finding.severity).toBe('info')
        expect(finding.evidence).toMatchObject({
            numerator: 1_200,
            denominator: 1_000,
            percent: 120,
            excessDocuments: 200,
        })
    })

    it('текст причины — формулировка методолога, а не заглушка', () => {
        const [finding] = buildVolumeRatioFindings(result([organization()]))

        // Ответ на В-03 от 20.08.2026: причина общая для всех МО — декабрьский хвост
        // регистраций и некорректное оформление амбулаторных случаев.
        expect(finding.cause).toContain('в течение следующего года')
        expect(finding.cause).toContain('Превышение возможно у любой МО')
        expect(finding.cause).not.toContain('уточняется у методолога')
        // Пометка «текст временный» снята вместе с заглушкой: она помечала находку
        // как незаконченную, и оставить её значило бы врать о состоянии согласования.
        expect(finding.evidence).not.toHaveProperty('pendingMethodologistText')
    })

    it('рекомендация называет оба действия из ответа методолога', () => {
        const [finding] = buildVolumeRatioFindings(result([organization()]))

        // Дробление случаев и сроки отправки — две разные причины перевыполнения,
        // и потерять одну из них значит оставить МО половину работы.
        expect(finding.recommendation).toContain('дробления комплексных медицинских осмотров')
        expect(finding.recommendation).toContain('своевременность отправки')
    })

    it('действие адресовано МО — оно его и выполняет', () => {
        const [finding] = buildVolumeRatioFindings(result([organization()]))

        // Пока текста не было, находка висела на аналитике МИАЦ: ждали объяснения,
        // а не действия. Теперь оба шага рекомендации выполняются в самой больнице.
        expect(finding.responsibilityArea).toBe('МО')
    })

    it('текст причины одинаков у всех МО — иначе свод по региону не сгруппируется', () => {
        // Окно причин группирует по тексту (FR-11: «одна причина — один раз,
        // со списком затронутых МО»). Цифры внутри текста делают каждую находку
        // уникальной, и свод превращается в список одинаковых абзацев.
        const findings = buildVolumeRatioFindings(result([
            organization({ organizationOid: 'oid-1', numerator: 1_200, percent: 120 }),
            organization({ organizationOid: 'oid-2', numerator: 10_690, percent: 1_069 }),
        ]))

        expect(new Set(findings.map((finding) => finding.cause)).size).toBe(1)
        // Цифры при этом не теряются — они в основании находки.
        expect(findings.map((finding) => finding.evidence.excessDocuments))
            .toEqual([200, 9_690])
    })

    it('ровно 100 % перевыполнением не считается', () => {
        expect(buildVolumeRatioFindings(result([
            organization({ numerator: 1_000, percent: 100 }),
        ]))).toEqual([])
    })

    it('недовыполнение находки не даёт', () => {
        expect(buildVolumeRatioFindings(result([
            organization({ numerator: 700, percent: 70 }),
        ]))).toEqual([])
    })

    it('у МО без утверждённого объёма перевыполнения не существует', () => {
        // Числитель есть, знаменателя нет: сравнивать не с чем. Ноль здесь был бы
        // враньём — той же логики держится подпись на карточке МО.
        expect(buildVolumeRatioFindings(result([
            organization({
                status: 'no_approved_volume',
                denominator: null,
                annualDenominator: null,
                percent: null,
            }),
        ]))).toEqual([])
    })

    it('объём утверждён, но не расписан по месяцам — тоже не находка', () => {
        // Знаменателя на отчётный месяц нет, процент прочерк — см. калькулятор.
        expect(buildVolumeRatioFindings(result([
            organization({ denominator: null, percent: null }),
        ]))).toEqual([])
    })

    it('находка своя у каждой перевыполнившей МО', () => {
        const findings = buildVolumeRatioFindings(result([
            organization({ organizationOid: 'oid-1' }),
            organization({ organizationOid: 'oid-2', numerator: 500, percent: 50 }),
            organization({ organizationOid: 'oid-3', numerator: 10_690, percent: 1_069 }),
        ]))

        expect(findings.map((finding) => finding.organizationOid))
            .toEqual(['oid-1', 'oid-3'])
    })
})
