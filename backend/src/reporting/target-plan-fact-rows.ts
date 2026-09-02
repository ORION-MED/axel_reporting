import type { TargetPlanFactRow } from './target-plan-export'
import { MONTH_COLUMNS } from './target-plan-parser'

/**
 * Строки выгрузки «Приложение 2, но с рассчитанными показателями» — просьба
 * методолога на ВКС 15.08.2026: «у нас сейчас уже шесть показателей есть, мы можем
 * их выгрузить в один Excel… чтобы получилась выгрузка по типу приложения 2,
 * но уже с рассчитанными показателями».
 *
 * Чистая функция: на вход — уже посчитанные значения, на выход — строки книги.
 * Пересчёт и запись файла остаются снаружи, поэтому раскладку можно проверить
 * тестами, не поднимая базу.
 */

/** Месяцы, для которых в шаблоне «Приложения 2» есть колонки (июнь–ноябрь). */
const EXPORTABLE_MONTHS = new Set(MONTH_COLUMNS.map(({ month }) => month))

export interface TargetPlanFactIndicator {
    id: string
    code: string
    title: string
    unit: string
    /** Номер в «Приложении 2». Пусто у показателей, которых там нет. */
    appendix2Number: string
}

export interface TargetPlanFactValue {
    indicatorId: string
    factValue: number | null
    targetYearEndValue: number | null
    /** Пояснение от калькулятора: почему значение такое или почему его нет. */
    note: string
    status: string
}

export interface BuildTargetPlanFactRowsInput {
    indicators: readonly TargetPlanFactIndicator[]
    values: readonly TargetPlanFactValue[]
    /** Отчётная дата периода в формате `YYYY-MM-DD`. */
    reportingDate: string | null
}

export function buildTargetPlanFactRows(
    input: BuildTargetPlanFactRowsInput,
): TargetPlanFactRow[] {
    const factMonth = resolveFactMonth(input.reportingDate)
    const valueByIndicator = new Map(
        input.values.map((value) => [value.indicatorId, value]),
    )

    return input.indicators.map((indicator) => {
        const value = valueByIndicator.get(indicator.id) ?? null
        const factValue = value?.factValue ?? null

        return {
            // Показатель без номера в «Приложении 2» («Виды СЭМД в РЭМД») из выгрузки
            // не выбрасывается: методолог просила все шесть. Номер остаётся пустым —
            // выдумывать несуществующий нельзя, а № 27 там занят маммографией с ИИ.
            itemNumber: indicator.appendix2Number,
            name: indicator.title,
            indicatorCode: indicator.code,
            unit: toAppendixUnit(indicator.unit),
            // Базовое значение 2025 года у нас не считается — колонка остаётся
            // пустой, чтобы методолог не приняла её за наш расчёт.
            baseline2025: null,
            factMonth,
            factValue,
            // Месяц периода вне июня–ноября: колонки под факт в шаблоне нет,
            // и он уходит в «конец года». Тогда целевое туда не пишем — две
            // разные величины в одной клетке не различить.
            yearEndValue: factMonth === null
                ? factValue
                : value?.targetYearEndValue ?? null,
            notes: buildNotes(input.reportingDate, factMonth, value),
        }
    })
}

function resolveFactMonth(reportingDate: string | null): number | null {
    if (!reportingDate) return null
    // Месяц берётся из текста, а не через `new Date`: конструктор снова завёл бы
    // разговор про часовой пояс. Сам `toDateString` сдвиг больше не делает —
    // исправлено 20.08.2026, — но разбирать строку здесь всё равно дешевле.
    const month = Number(reportingDate.slice(5, 7))
    return EXPORTABLE_MONTHS.has(month) ? month : null
}

/** «%» и «типов СЭМД» — наши единицы; в «Приложении 2» они записаны по ОКЕИ. */
function toAppendixUnit(unit: string): string {
    return String(unit ?? '').trim() === '%' ? 'Процент' : 'Единица'
}

function buildNotes(
    reportingDate: string | null,
    factMonth: number | null,
    value: TargetPlanFactValue | null,
): string {
    return [
        `Отчетная дата: ${reportingDate ?? 'не задана'}.`,
        value === null || value.status !== 'calculated'
            ? 'Значение не рассчитано.'
            : '',
        value?.note?.trim() ?? '',
        factMonth === null
            ? 'Месяц периода вне помесячного плана (июнь-ноябрь) — '
                + 'факт указан в столбце «На конец 2026 года».'
            : '',
        // Пустая клетка целевого иначе читается как «забыли заполнить».
        // У 6.1.3.2.7 целевое ведёт сам расчёт (PILOT_TARGET_TYPES), а не импорт
        // «Приложения 2», — но с 20.08.2026 он заполняет и целевое на конец года,
        // так что оговорка остаётся ради «Видов СЭМД в РЭМД»: этого показателя
        // в «Приложении 2» нет вовсе.
        factMonth !== null && (value?.targetYearEndValue ?? null) === null
            ? 'Целевое значение на конец года в «Приложении 2» для этого показателя '
                + 'не задано.'
            : '',
    ].filter(Boolean).join(' ')
}
