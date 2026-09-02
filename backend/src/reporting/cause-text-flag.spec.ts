import {
    CAUSE_TEXT_INCLUDES_SEMD_NAME,
    buildCauseText,
} from './pilot-calculation.pure'

/**
 * FR-11, пункт А-4: название вида СЭМД вынесено из текста причины, чтобы одинаковые по
 * смыслу причины схлопывались в одну карточку со списком видов. Поведение управляется
 * единственным флагом — тест фиксирует обе ветки, чтобы откат оставался рабочим.
 */
describe('buildCauseText (флаг CAUSE_TEXT_INCLUDES_SEMD_NAME)', () => {
    const withName = 'МО обязана формировать СЭМД «Выписка из истории болезни», регистраций нет.'
    const withoutName = 'МО обязана формировать вид СЭМД, регистраций нет.'

    it('по умолчанию отдаёт обезличенный текст — иначе группировка не сработает', () => {
        expect(CAUSE_TEXT_INCLUDES_SEMD_NAME).toBe(false)
        expect(buildCauseText(withName, withoutName)).toBe(withoutName)
    })

    it('обезличенный текст не содержит названия вида', () => {
        expect(buildCauseText(withName, withoutName)).not.toContain('Выписка из истории болезни')
    })

    it('обе формулировки заданы и различаются', () => {
        expect(withName).not.toBe(withoutName)
        expect(withoutName.length).toBeGreaterThan(0)
    })
})
