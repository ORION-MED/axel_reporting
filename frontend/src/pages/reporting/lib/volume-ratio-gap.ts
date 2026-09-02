import type { ReportingOrganizationIndicatorValue } from '@shared/lib/reporting-api'
import {
    semdVolumeRatioDetails,
    type SemdVolumeRatioOrganizationStatus,
} from './reporting-helpers'

/**
 * Разбор недостачи по показателям-долям (6.1.3.2.8–6.1.3.2.11).
 *
 * **Зачем отдельный разрез, если процент уже есть.** У показателей 6.1.3.2.7 и 27
 * знаменатель — перечень видов, и «чего не хватает» разворачивается списком.
 * У долей знаменатель — случаи оказания помощи из терпрограммы, разворачивать
 * нечего. Зато считается то, чего у перечней нет: сколько случаев прошло без СЭМД.
 *
 * Процент этого не показывает. На данных 08.2026 у детской поликлиники 64,91 % —
 * середина списка, а в документах это 127 968 случаев, второй по величине провал
 * области. Восемь МО дают 76,5 % всего разрыва по 6.1.3.2.8; по проценту такую
 * концентрацию не увидеть.
 *
 * Считается на готовых данных дашборда — ни одного дополнительного запроса.
 */
export interface VolumeRatioGapRow {
    organizationOid: string
    organizationName: string
    status: SemdVolumeRatioOrganizationStatus
    /** Зарегистрированные СЭМД. */
    fact: number
    /** Накопительный план по месяц отчётной даты; `null` — объём не утверждён. */
    plan: number | null
    /**
     * Сколько случаев прошло без СЭМД. `null` там, где делить не на что:
     * без утверждённого объёма недостачи не существует, а не «она нулевая».
     */
    gap: number | null
    percent: number | null
    /** Доля этой МО в общей недостаче по показателю, %. */
    shareOfGap: number | null
    /** Часть знаменателя взята за год: недостача завышена. */
    usedAnnualFallback: boolean
}

export interface VolumeRatioGapSummary {
    rows: VolumeRatioGapRow[]
    /** Суммарная недостача по МО с утверждённым объёмом. */
    totalGap: number
    totalFact: number
    totalPlan: number
    calculatedCount: number
    /** МО с фактом, но без утверждённого объёма в терпрограмме. */
    noApprovedVolumeCount: number
    /**
     * СЭМД, зарегистрированные МО без утверждённого объёма. В разбор они не входят,
     * поэтому `totalFact` здесь меньше числителя самого показателя — регион считает
     * факт по всем МО, а недостачу можно считать только там, где есть план.
     * Без этой цифры расхождение выглядело бы потерянными документами.
     */
    factWithoutPlan: number
    notParticipatingCount: number
    /**
     * Сколько МО набирают первые 80 % недостачи. Отвечает на «с кого начинать»:
     * если это три МО из двадцати семи, разговор нужен с тремя.
     */
    organizationsToCloseEightyPercent: number
}

export function buildVolumeRatioGapSummary(
    organizations: readonly ReportingOrganizationIndicatorValue[],
): VolumeRatioGapSummary {
    const rows: VolumeRatioGapRow[] = []
    let totalGap = 0
    let totalFact = 0
    let totalPlan = 0
    let calculatedCount = 0
    let noApprovedVolumeCount = 0
    let notParticipatingCount = 0
    let factWithoutPlan = 0

    for (const organization of organizations) {
        const details = semdVolumeRatioDetails(organization)
        if (!details) continue

        const fact = organization.numerator ?? 0
        const plan = details.status === 'calculated' ? organization.denominator : null
        // Перевыполнение — не отрицательная недостача. Отрицательные числа
        // в столбце «не хватает» сложились бы в сумму и занизили общий разрыв.
        const gap = plan === null ? null : Math.max(0, plan - fact)

        if (details.status === 'calculated') {
            calculatedCount += 1
            totalFact += fact
            totalPlan += plan ?? 0
            totalGap += gap ?? 0
        } else if (details.status === 'no_approved_volume') {
            noApprovedVolumeCount += 1
            factWithoutPlan += fact
        } else {
            notParticipatingCount += 1
        }

        rows.push({
            organizationOid: organization.organizationOid,
            organizationName: organization.organizationName,
            status: details.status,
            fact,
            plan,
            gap,
            percent: organization.factValue,
            shareOfGap: null,
            usedAnnualFallback: details.usedAnnualFallback,
        })
    }

    for (const row of rows) {
        row.shareOfGap = row.gap === null || totalGap <= 0
            ? null
            : round2((row.gap / totalGap) * 100)
    }

    // Сортировка по недостаче, а не по проценту: список отвечает на вопрос
    // «где больше всего потеряно документов», и первые строки — это адресаты.
    // МО без объёма и не участвующие уходят вниз: у них недостачи нет вовсе.
    rows.sort((left, right) => {
        if (left.gap === null && right.gap === null) {
            return left.organizationName.localeCompare(right.organizationName, 'ru')
        }
        if (left.gap === null) return 1
        if (right.gap === null) return -1
        if (right.gap !== left.gap) return right.gap - left.gap
        return left.organizationName.localeCompare(right.organizationName, 'ru')
    })

    return {
        rows,
        totalGap,
        totalFact,
        totalPlan,
        calculatedCount,
        noApprovedVolumeCount,
        factWithoutPlan,
        notParticipatingCount,
        organizationsToCloseEightyPercent: countForShare(rows, totalGap, 80),
    }
}

/**
 * Сколько первых МО в отсортированном списке набирают заданную долю недостачи.
 * Ноль, если считать не от чего.
 */
function countForShare(
    rows: readonly VolumeRatioGapRow[],
    totalGap: number,
    sharePercent: number,
): number {
    if (totalGap <= 0) return 0
    const threshold = (totalGap * sharePercent) / 100
    let accumulated = 0
    let count = 0
    for (const row of rows) {
        if (row.gap === null || row.gap <= 0) break
        accumulated += row.gap
        count += 1
        if (accumulated >= threshold) break
    }
    return count
}

function round2(value: number): number {
    return Math.round(value * 100) / 100
}
