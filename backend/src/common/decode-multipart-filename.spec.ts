import { decodeMultipartFilename } from './decode-multipart-filename'

/**
 * Восстановление русского имени файла из multipart-заголовка.
 *
 * Заголовки разбираются как latin1, поэтому имя от клиента, приславшего его
 * не в latin1, доезжает кракозябрами. Тестов на это не было; появились вместе
 * с разбором CP1251 — второго варианта, который до 25.08.2026 не чинился.
 *
 * Байты в фикстурах записаны явно, а не получены `Buffer.from(name, 'utf8')`:
 * тест должен ломаться, если изменится разбор, а не подстраиваться под него.
 */

/** Байты заголовка, как их видит разбор multipart: байт → символ latin1. */
function asHeader(bytes: number[]): string {
    return Buffer.from(bytes).toString('latin1')
}

describe('decodeMultipartFilename', () => {
    it('имя в UTF-8 восстанавливается', () => {
        // «Отчет.xlsx» в UTF-8: по два байта на букву.
        const header = asHeader([
            0xd0, 0x9e, 0xd1, 0x82, 0xd1, 0x87, 0xd0, 0xb5, 0xd1, 0x82,
            0x2e, 0x78, 0x6c, 0x73, 0x78,
        ])

        // Как выглядит эта строка, тест не утверждает: среди байтов UTF-8
        // попадаются управляющие символы, и литерал с ними в исходнике
        // не переживает ни одного копирования.
        expect(decodeMultipartFilename(header)).toBe('Отчет.xlsx')
    })

    it('имя в CP1251 восстанавливается', () => {
        // «Отчет.xlsx» в CP1251: по одному байту на букву. Именно так пришёл
        // файл, попавший в журнал импортов как «7.Îò÷åò ÑÝÌÄ_ÐÝÌÄ…».
        const header = asHeader([
            0xce, 0xf2, 0xf7, 0xe5, 0xf2, 0x2e, 0x78, 0x6c, 0x73, 0x78,
        ])

        expect(header).toBe('Îò÷åò.xlsx')
        expect(decodeMultipartFilename(header)).toBe('Отчет.xlsx')
    })

    it('уже правильное имя не трогается', () => {
        expect(decodeMultipartFilename('Отчет РЭМД.xlsx')).toBe('Отчет РЭМД.xlsx')
    })

    it('латинское имя не трогается', () => {
        expect(decodeMultipartFilename('report-2026.xlsx')).toBe('report-2026.xlsx')
    })

    /**
     * Главная опасность разбора CP1251: любой байт верхней половины что-нибудь
     * да означает в кириллице. Французское имя не должно превратиться
     * в «Cafй.xlsx» — от этого защищает требование целого слова из кириллицы.
     */
    it('латинское имя с диакритикой не принимают за кириллицу', () => {
        const header = asHeader([0x43, 0x61, 0x66, 0xe9, 0x2e, 0x78, 0x6c, 0x73, 0x78])

        expect(header).toBe('Café.xlsx')
        expect(decodeMultipartFilename(header)).toBe('Café.xlsx')
    })

    it('немецкое имя тоже остаётся собой', () => {
        // «Größe.xlsx»: два неASCII-символа, но слова из кириллицы не выходит.
        const header = asHeader([
            0x47, 0x72, 0xf6, 0xdf, 0x65, 0x2e, 0x78, 0x6c, 0x73, 0x78,
        ])

        expect(decodeMultipartFilename(header)).toBe('Größe.xlsx')
    })

    it('пустое имя остаётся пустым', () => {
        expect(decodeMultipartFilename('')).toBe('')
    })

    it('реальное имя выгрузки восстанавливается целиком', () => {
        // «7.Отчет СЭМД_РЭМД янв-июль.xlsx» в CP1251 — то самое имя из журнала.
        const header = asHeader([
            0x37, 0x2e, 0xce, 0xf2, 0xf7, 0xe5, 0xf2, 0x20,
            0xd1, 0xdd, 0xcc, 0xc4, 0x5f, 0xd0, 0xdd, 0xcc, 0xc4, 0x20,
            0xff, 0xed, 0xe2, 0x2d, 0xe8, 0xfe, 0xeb, 0xfc,
            0x2e, 0x78, 0x6c, 0x73, 0x78,
        ])

        expect(header).toBe('7.Îò÷åò ÑÝÌÄ_ÐÝÌÄ ÿíâ-èþëü.xlsx')
        expect(decodeMultipartFilename(header))
            .toBe('7.Отчет СЭМД_РЭМД янв-июль.xlsx')
    })
})
