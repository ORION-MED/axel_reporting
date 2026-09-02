import {
    calculateSemdTypeRegistry,
    type SemdTypeRegistryFact,
    type SemdTypeRegistryInput,
} from './semd-type-registry.calculator'

/**
 * Показатель 27 «Виды СЭМД, регистрируемые в РЭМД ЕГИСЗ» (задача Н7.4).
 * Считаются уникальные виды, а не документы, — отсюда все особенности.
 */

function fact(
    organizationOid: string,
    semdTypeId: string,
    overrides: Partial<SemdTypeRegistryFact> = {},
): SemdTypeRegistryFact {
    return {
        organizationOid,
        semdTypeId,
        inRegistry: true,
        documentCount: 10,
        ...overrides,
    }
}

/** Перечень № 5пр из `count` видов: «type-1»…«type-N». */
function registry(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `type-${index + 1}`)
}

function input(overrides: Partial<SemdTypeRegistryInput> = {}): SemdTypeRegistryInput {
    return {
        organizationOids: ['mo-1'],
        registryTypeIds: registry(145),
        facts: [],
        ...overrides,
    }
}

describe('виды СЭМД, регистрируемые в РЭМД', () => {
    it('считает долю зарегистрированных видов от Перечня № 5пр', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(4),
            facts: [fact('mo-1', 'type-1'), fact('mo-1', 'type-2')],
        }))

        expect(result.region).toMatchObject({
            registeredTypeCount: 2,
            registryTypeCount: 4,
            percent: 50,
        })
    })

    it('один вид у нескольких МО считается в регионе один раз', () => {
        // Главное отличие от долей к объёмам ТПГГ: регион — объединение видов,
        // а не сумма значений МО. Сложение сот карты дало бы 4 вместо 2.
        const result = calculateSemdTypeRegistry(input({
            organizationOids: ['mo-1', 'mo-2'],
            registryTypeIds: registry(4),
            facts: [
                fact('mo-1', 'type-1'), fact('mo-1', 'type-2'),
                fact('mo-2', 'type-1'), fact('mo-2', 'type-2'),
            ],
        }))

        expect(result.region.registeredTypeCount).toBe(2)
        expect(result.organizations[0].registeredTypeCount).toBe(2)
        expect(result.organizations[1].registeredTypeCount).toBe(2)
    })

    it('несколько строк по одному виду не раздувают счётчик', () => {
        // Один вид приходит несколькими строками — например, в разных форматах документа.
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(10),
            facts: [fact('mo-1', 'type-1'), fact('mo-1', 'type-1')],
        }))

        expect(result.organizations[0].registeredTypeCount).toBe(1)
    })
})

describe('что не считается регистрацией', () => {
    it('строка факта с нулём документов', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(10),
            facts: [fact('mo-1', 'type-1', { documentCount: 0 })],
        }))

        expect(result.region.registeredTypeCount).toBe(0)
        expect(result.region.percent).toBe(0)
    })

    it('вид вне Перечня № 5пр идёт в числитель, но остаётся помеченным', () => {
        // Ответ методолога на В-07 от 21.08.2026: «МЗ РФ считает все виды
        // зарегистрированных СЭМД, не учитывая вхождение в 5-пр. Нам нужно считать
        // также. Пусть справочно останется фактор невхождения». На данных 08.2026
        // таких видов четыре, числитель региона 69 → 73.
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(4),
            facts: [
                fact('mo-1', 'type-1'),
                fact('mo-1', 'type-99', { inRegistry: false }),
            ],
        }))

        expect(result.region.registeredTypeCount).toBe(2)
        // Признак невхождения не потерян — методолог просила оставить его справочно.
        expect(result.region.typesOutsideRegistryCount).toBe(1)
        expect(result.organizations[0].registeredTypeCount).toBe(2)
        expect(result.organizations[0].typesOutsideRegistryCount).toBe(1)
        // И в разборе по видам такой вид по-прежнему отдельного статуса.
        expect(result.region.types.find((t) => t.semdTypeId === 'type-99')?.status)
            .toBe('outside_registry')
    })

    it('вид вне Перечня в план не попадает', () => {
        // Обязательной может быть только строка матрицы, а матрица описывает
        // Перечень. Иначе план вырос бы на вид, которого в нём нет.
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(4),
            facts: [
                fact('mo-1', 'type-1'),
                fact('mo-1', 'type-99', { inRegistry: false }),
            ],
            requirements: [
                { organizationOid: 'mo-1', semdTypeId: 'type-1', status: 'required' },
                { organizationOid: 'mo-1', semdTypeId: 'type-99', status: 'required' },
            ],
        }))

        expect(result.region.plan?.requiredTypeCount).toBe(1)
        expect(result.region.plan?.registeredRequiredTypeCount).toBe(1)
    })

    it('МО с одним лишь внешним видом считается не зарегистрировавшей ничего', () => {
        // Показателя такая МО не даёт: в Перечне у неё пусто. Если бы её посчитали
        // «зарегистрировавшей», региональная сводка врала бы о покрытии.
        const result = calculateSemdTypeRegistry(input({
            organizationOids: ['mo-1', 'mo-2'],
            registryTypeIds: registry(4),
            facts: [
                fact('mo-1', 'type-1'),
                fact('mo-2', 'type-99', { inRegistry: false }),
            ],
        }))

        expect(result.region.organizationsWithoutRegistrationCount).toBe(1)
    })

    it('факты МО вне целевого контура', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(4),
            facts: [fact('mo-1', 'type-1'), fact('чужая-мо', 'type-2')],
        }))

        expect(result.region.registeredTypeCount).toBe(1)
    })
})

describe('краевые случаи', () => {
    it('без загруженного Перечня процент не считается', () => {
        // Ноль в знаменателе — это «справочник ещё не загружен», а не «ноль видов».
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(0),
            facts: [fact('mo-1', 'type-1')],
        }))

        expect(result.region.percent).toBeNull()
        expect(result.organizations[0].percent).toBeNull()
    })

    it('МО без единой регистрации попадает в счётчик и показывает ноль', () => {
        const result = calculateSemdTypeRegistry(input({
            organizationOids: ['mo-1', 'mo-2'],
            registryTypeIds: registry(10),
            facts: [fact('mo-1', 'type-1')],
        }))

        expect(result.region.organizationsWithoutRegistrationCount).toBe(1)
        expect(result.organizations[1]).toMatchObject({
            registeredTypeCount: 0,
            percent: 0,
        })
    })

    it('процент округляется до сотых', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(145),
            facts: [fact('mo-1', 'type-1')],
        }))

        expect(result.organizations[0].percent).toBe(0.69)
    })
})

/**
 * Разбор по видам для окна показателя (Н18.1, ВКС 15.08.2026). Методолог насчитала
 * 74 зарегистрированных вида против наших 70 и просила показать, что именно
 * не попадает в расчёт.
 */
describe('разбор по видам', () => {
    it('перечисляет весь Перечень, помечая незарегистрированные виды', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(3),
            facts: [fact('mo-1', 'type-2')],
        }))

        expect(result.region.types).toEqual([
            expect.objectContaining({ semdTypeId: 'type-1', status: 'not_registered' }),
            expect.objectContaining({ semdTypeId: 'type-2', status: 'registered' }),
            expect.objectContaining({ semdTypeId: 'type-3', status: 'not_registered' }),
        ])
    })

    it('виды вне Перечня идут отдельным состоянием после видов Перечня', () => {
        // Ровно они и объясняют расхождение с ручным подсчётом методолога.
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(1),
            facts: [
                fact('mo-1', 'type-1'),
                fact('mo-1', 'type-99', { inRegistry: false }),
            ],
        }))

        expect(result.region.types).toHaveLength(2)
        expect(result.region.types[1]).toMatchObject({
            semdTypeId: 'type-99',
            status: 'outside_registry',
        })
    })

    it('считает МО и документы по каждому виду', () => {
        const result = calculateSemdTypeRegistry(input({
            organizationOids: ['mo-1', 'mo-2'],
            registryTypeIds: registry(1),
            facts: [
                fact('mo-1', 'type-1', { documentCount: 7 }),
                // Та же МО, тот же вид, другой формат документа: организация одна.
                fact('mo-1', 'type-1', { documentCount: 3 }),
                fact('mo-2', 'type-1', { documentCount: 5 }),
            ],
        }))

        expect(result.region.types[0]).toMatchObject({
            organizationCount: 2,
            documentCount: 15,
        })
    })

    it('незарегистрированный вид показывает нули, а не пустоту', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(1),
            facts: [],
        }))

        expect(result.region.types[0]).toMatchObject({
            status: 'not_registered',
            organizationCount: 0,
            documentCount: 0,
        })
    })

    it('нулевые строки факта не превращают вид в зарегистрированный', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(1),
            facts: [fact('mo-1', 'type-1', { documentCount: 0 })],
        }))

        expect(result.region.types[0]).toMatchObject({
            status: 'not_registered',
            documentCount: 0,
        })
    })

    it('факты чужих МО в разбор не попадают', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(1),
            facts: [fact('чужая-мо', 'type-1', { documentCount: 99 })],
        }))

        expect(result.region.types[0]).toMatchObject({
            status: 'not_registered',
            organizationCount: 0,
            documentCount: 0,
        })
    })
})

/**
 * Плановое значение (Н18.2, ВКС 15.08.2026): план — не константа из «Приложения 2»,
 * а число видов, обязательных по матрице применимости, своё у региона и у каждой МО.
 */
describe('плановое значение по матрице применимости', () => {
    function requirement(
        organizationOid: string,
        semdTypeId: string,
        status: 'required' | 'not_required' | 'unknown' = 'required',
    ) {
        return { organizationOid, semdTypeId, status }
    }

    it('план — число обязательных видов, исполнение — сколько из них зарегистрировано', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(10),
            facts: [fact('mo-1', 'type-1'), fact('mo-1', 'type-2')],
            requirements: [
                requirement('mo-1', 'type-1'),
                requirement('mo-1', 'type-2'),
                requirement('mo-1', 'type-3'),
                requirement('mo-1', 'type-4', 'not_required'),
            ],
        }))

        expect(result.organizations[0].plan).toEqual({
            requiredTypeCount: 3,
            registeredRequiredTypeCount: 2,
            percent: 66.67,
            undefinedTypeCount: 0,
        })
    })

    /**
     * Главный случай: МО регистрирует больше видов, чем обязана, и часть обязательных
     * при этом не сдаёт. Сравнение двух чисел («5 больше 2») показало бы перевыполнение,
     * пересечение показывает правду — половину.
     */
    it('регистрации сверх плана не закрывают пропущенные обязательные виды', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(10),
            facts: [
                fact('mo-1', 'type-1'),
                fact('mo-1', 'type-5'),
                fact('mo-1', 'type-6'),
                fact('mo-1', 'type-7'),
                fact('mo-1', 'type-8'),
            ],
            requirements: [
                requirement('mo-1', 'type-1'),
                requirement('mo-1', 'type-2'),
            ],
        }))

        expect(result.organizations[0].registeredTypeCount).toBe(5)
        expect(result.organizations[0].plan).toMatchObject({
            requiredTypeCount: 2,
            registeredRequiredTypeCount: 1,
            percent: 50,
        })
    })

    it('виды «не определено» в план не входят и считаются отдельно', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(10),
            facts: [fact('mo-1', 'type-1')],
            requirements: [
                requirement('mo-1', 'type-1'),
                requirement('mo-1', 'type-2', 'unknown'),
                requirement('mo-1', 'type-3', 'unknown'),
            ],
        }))

        expect(result.organizations[0].plan).toMatchObject({
            requiredTypeCount: 1,
            percent: 100,
            undefinedTypeCount: 2,
        })
    })

    it('план региона — виды, обязательные хотя бы одной МО, без удвоения', () => {
        const result = calculateSemdTypeRegistry(input({
            organizationOids: ['mo-1', 'mo-2'],
            registryTypeIds: registry(10),
            facts: [fact('mo-1', 'type-1')],
            requirements: [
                requirement('mo-1', 'type-1'),
                requirement('mo-2', 'type-1'),
                requirement('mo-2', 'type-2'),
            ],
        }))

        expect(result.region.plan).toMatchObject({
            requiredTypeCount: 2,
            registeredRequiredTypeCount: 1,
            percent: 50,
        })
    })

    /**
     * Вид, обязательный по матрице, но не входящий в Перечень № 5пр, раздул бы план,
     * не имея шанса попасть в факт: знаменатель показателя — Перечень.
     */
    it('обязательный вид вне Перечня в план не идёт', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(2),
            facts: [],
            requirements: [
                requirement('mo-1', 'type-1'),
                requirement('mo-1', 'вид-вне-перечня'),
            ],
        }))

        expect(result.organizations[0].plan).toMatchObject({ requiredTypeCount: 1 })
    })

    it('требования чужих МО план не меняют', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(3),
            facts: [],
            requirements: [
                requirement('mo-1', 'type-1'),
                requirement('чужая-мо', 'type-2'),
            ],
        }))

        expect(result.region.plan).toMatchObject({ requiredTypeCount: 1 })
    })

    /** До загрузки матрицы плана нет — соты остаются без оценки, как и были. */
    it('без матрицы применимости плана нет', () => {
        const result = calculateSemdTypeRegistry(input({
            registryTypeIds: registry(3),
            facts: [fact('mo-1', 'type-1')],
        }))

        expect(result.region.plan).toBeNull()
        expect(result.organizations[0].plan).toBeNull()
    })

    it('МО без единого обязательного вида показывает план без процента', () => {
        const result = calculateSemdTypeRegistry(input({
            organizationOids: ['mo-1', 'mo-2'],
            registryTypeIds: registry(3),
            facts: [],
            requirements: [requirement('mo-1', 'type-1')],
        }))

        expect(result.organizations[1].plan).toEqual({
            requiredTypeCount: 0,
            registeredRequiredTypeCount: 0,
            percent: null,
            undefinedTypeCount: 0,
        })
    })
})
