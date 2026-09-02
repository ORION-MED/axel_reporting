import { ApplicabilityMatrixImportService } from './applicability-matrix-import.service'

/**
 * Коды формы_1 вне перечня видов, доступных гражданам на ЕПГУ.
 *
 * До 07.08.2026 форма описывала ровно те виды, из которых состоит показатель 6.1.3.2.7,
 * и любой посторонний код означал опечатку — импорт блокировался. С 07.08 форма покрывает
 * все виды Перечня № 5пр: методолог описывает применимость впрок, для показателей,
 * взятых в работу на ВКС. Такие коды больше не должны мешать применить матрицу.
 *
 * Опечатка при этом обязана остаться блокирующей: код, которого нет в справочнике
 * видов СЭМД, пропустить молча нельзя.
 */

const EPGU_CODES = ['1', '2', '68']
const KNOWN_CODES = new Set([...EPGU_CODES, '8', '11', '551'])

function split(formCodes: string[]) {
    const epgu = new Set(EPGU_CODES)
    return {
        notOnEpgu: formCodes.filter((code) => !epgu.has(code) && KNOWN_CODES.has(code)),
        unknown: formCodes.filter((code) => !epgu.has(code) && !KNOWN_CODES.has(code)),
    }
}

describe('коды формы вне перечня ЕПГУ', () => {
    it('вид известен справочнику, но не доступен на ЕПГУ — не опечатка', () => {
        const { notOnEpgu, unknown } = split(['1', '2', '68', '8', '551'])

        expect(notOnEpgu).toEqual(['8', '551'])
        expect(unknown).toEqual([])
    })

    it('код, которого нет в справочнике видов, остаётся опечаткой', () => {
        const { notOnEpgu, unknown } = split(['1', '999'])

        expect(notOnEpgu).toEqual([])
        expect(unknown).toEqual(['999'])
    })

    it('форма только из ЕПГУ-видов не даёт ни того, ни другого', () => {
        expect(split(['1', '2', '68'])).toEqual({ notOnEpgu: [], unknown: [] })
    })

    it('сервис умеет читать коды всех видов, а не только ЕПГУ-видов', () => {
        // Разделение опирается на отдельную загрузку полного перечня кодов:
        // без неё вид «впрок» неотличим от опечатки.
        const service = new ApplicabilityMatrixImportService(
            null as never, null as never, null as never, null as never, null as never,
        )

        expect(typeof (service as unknown as Record<string, unknown>).loadKnownTypeCodes)
            .toBe('function')
    })
})
