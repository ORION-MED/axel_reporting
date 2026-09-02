import type { AchievabilityForecast, Anomaly, AnomalyCode } from './monthly-conclusion'

/**
 * Справочник управленческих выводов — четвёртая строка резюме (Д-35).
 *
 * Николай на ВКС 28.08.2026 продиктовал состав резюме и про эту строку сказал
 * прямо: «Ворг-метод отдел расформировать, главного врача снять — это я утрировал,
 * но управленческий вывод пока можно просто двоеточие поставить. Поработаем
 * с экспертизой и подумаем, какой управленческий вывод».
 *
 * Поэтому здесь **заготовка**, а не готовые формулировки. Два текста — его
 * собственные слова с того же созвона, остальные наши черновики. Всё, что помечено
 * `draft`, в интерфейсе идёт с пометкой «черновик»: пока методолог не подтвердила,
 * выдавать это за вывод системы нельзя.
 *
 * **Марине править здесь.** Одна ситуация — один текст, ниже по файлу, больше
 * трогать нечего.
 */

export type ManagementSituation =
    | 'unreachable'
    | 'tight'
    | 'uneven'
    | 'no_execution_data'
    | 'on_track'

export interface ManagementVerdict {
    situation: ManagementSituation
    text: string
    /** `false` — формулировка подтверждена; `true` — ждёт методолога. */
    draft: boolean
    /** Откуда взят текст: цитата с созвона или наш черновик. */
    source: string
}

const VERDICTS: Record<ManagementSituation, Omit<ManagementVerdict, 'situation'>> = {
    /**
     * Слова Николая и Марины дословно. Он: «уважаемые коллеги, в рамках закрытых
     * случаев уже СЭМД не сформировать. Всё, у вас тут вся ёмкость потеряна…
     * можно сушить вёсла, возвращать деньги в бюджет». Она: «готовить денежки
     * к возврату».
     *
     * Формулировка держится на утверждении о закрытых случаях, а оно спорит
     * с январским хвостом: декабрьские документы регистрируются в январе, то есть
     * по закрытым случаям СЭМД всё-таки уходят. Пока методолог не разведёт эти
     * два утверждения, текст остаётся черновиком — см. вопрос № 1 в ТЗ от 28.08.
     */
    unreachable: {
        text: 'Год не закрыть: по закрытым случаям СЭМД уже не сформировать, '
            + 'ёмкость потеряна. Готовить возврат средств в бюджет.',
        draft: true,
        source: 'слова Н. Ермакова и методолога на ВКС 28.08.2026',
    },
    tight: {
        text: 'План ещё достижим, но только темпом выше среднего за год. '
            + 'Нужен помесячный график догона по каждой МО.',
        draft: true,
        source: 'черновик',
    },
    uneven: {
        text: 'Работу ведут рывками: догоняют после нагоняя и снова бросают. '
            + 'Контроль нужен ежемесячный, а не по итогам квартала.',
        draft: true,
        source: 'черновик',
    },
    no_execution_data: {
        text: 'По части МО реестров исполнения нет. Сначала запросить данные фонда, '
            + 'потом требовать с медорганизаций.',
        draft: true,
        source: 'черновик',
    },
    on_track: {
        text: 'Темп удерживать, отдельных мер не требуется.',
        draft: true,
        source: 'черновик',
    },
}

/**
 * Порядок разбора — от того, что уже нельзя исправить, к тому, что можно.
 * Невыполнимый год перекрывает всё остальное: обсуждать ритм работы, когда
 * ёмкость потеряна, поздно.
 */
export function buildManagementVerdict(
    forecast: AchievabilityForecast | null,
    anomalies: readonly Anomaly[],
): ManagementVerdict | null {
    const has = (code: AnomalyCode) => anomalies.some((item) => item.code === code)

    if (forecast && !forecast.achievable) return verdict('unreachable')
    if (has('spike_and_drop')) return verdict('uneven')
    if (forecast && forecast.achievable && forecast.monthsLeft > 0) {
        // Достижим, но без запаса: требуемый темп выше среднего за прошедшие месяцы.
        const average = forecast.factToDate / Math.max(1, forecast.monthsWithFact)
        if (forecast.requiredPerMonth > average) return verdict('tight')
    }
    if (has('missing_execution')) return verdict('no_execution_data')
    if (forecast) return verdict('on_track')
    // Без прогноза и без находок сказать нечего — и придумывать не надо.
    return null
}

function verdict(situation: ManagementSituation): ManagementVerdict {
    return { situation, ...VERDICTS[situation] }
}
