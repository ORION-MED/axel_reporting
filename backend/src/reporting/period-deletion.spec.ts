import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ReportingPeriodsService } from './reporting-periods.service'

/**
 * Удаление отчётного периода — необратимая операция: down-миграций и корзины
 * в системе нет, а все десять внешних ключей на `reporting_periods` стоят
 * с ON DELETE CASCADE.
 *
 * Тесты фиксируют защиту от случайного удаления и то, что состав удаляемого
 * показывается до подтверждения. БД здесь не поднимается — пул подменён заглушкой.
 */

type QueryResult = { rows: any[]; rowCount: number }

const PERIOD_ROW = {
    id: 'period-1',
    code: '2026-07',
    name: 'Период 07.2026',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
    status: 'active',
    createdBy: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
}

const COUNTS_ROW = {
    remdFacts: '840',
    remdSubdivisionFacts: '120',
    indicatorValues: '7',
    organizationValues: '37',
    diagnosticFindings: '285',
    qualityIssues: '3',
    tpggPlanValues: '2500',
    importRuns: '9',
    requirementOverrides: '4',
}

class PoolStub {
    readonly calls: Array<{ sql: string; params: any[] }> = []

    constructor(private readonly options: { deleted?: number; periodMissing?: boolean } = {}) {}

    query(sql: string, params: any[] = []): Promise<QueryResult> {
        this.calls.push({ sql, params })
        if (sql.includes('FROM reporting_periods') && sql.includes('WHERE id =')) {
            return Promise.resolve(this.options.periodMissing
                ? { rows: [], rowCount: 0 }
                : { rows: [PERIOD_ROW], rowCount: 1 })
        }
        if (sql.includes('reporting_remd_facts WHERE period_id')) {
            return Promise.resolve({ rows: [COUNTS_ROW], rowCount: 1 })
        }
        if (sql.includes('ORDER BY COALESCE(date_to, date_from)')) {
            return Promise.resolve({ rows: [PERIOD_ROW], rowCount: 1 })
        }
        if (sql.includes('SELECT object_key')) {
            return Promise.resolve({
                rows: [{ object_key: 'reporting/a.xlsx' }, { object_key: 'reporting/b.xlsx' }],
                rowCount: 2,
            })
        }
        if (sql.includes('DELETE FROM reporting_periods')) {
            const deleted = this.options.deleted ?? 1
            return Promise.resolve({ rows: deleted ? [{ id: 'period-1' }] : [], rowCount: deleted })
        }
        return Promise.resolve({ rows: [], rowCount: 0 })
    }

    get deleteCalls() {
        return this.calls.filter((c) => c.sql.includes('DELETE FROM reporting_periods'))
    }
}

function makeService(pool: PoolStub, removed: string[] = []) {
    const s3 = { deleteObject: async (key: string) => { removed.push(key) } }
    return new ReportingPeriodsService(pool as any, s3 as any)
}

describe('предпросмотр удаления периода', () => {
    it('показывает, сколько строк уйдёт по каждой таблице', async () => {
        const preview = await makeService(new PoolStub()).getDeletionPreview('period-1')

        expect(preview.period.code).toBe('2026-07')
        expect(preview.counts.remdFacts).toBe(840)
        expect(preview.counts.diagnosticFindings).toBe(285)
        expect(preview.counts.importRuns).toBe(9)
    })

    it('отдельно показывает ручные уточнения применимости', async () => {
        // Единственные данные из этого списка, которые вводит человек и которые
        // больше нигде не хранятся: их потеря необратима в полном смысле.
        const preview = await makeService(new PoolStub()).getDeletionPreview('period-1')

        expect(preview.counts.requirementOverrides).toBe(4)
    })

    it('предупреждает, что период последний', async () => {
        const preview = await makeService(new PoolStub()).getDeletionPreview('period-1')

        expect(preview.isLastPeriod).toBe(true)
    })

    it('несуществующий период — 404, а не пустой предпросмотр', async () => {
        await expect(makeService(new PoolStub({ periodMissing: true })).getDeletionPreview('nope'))
            .rejects.toBeInstanceOf(NotFoundException)
    })
})

describe('удаление периода', () => {
    it('без подтверждения кодом ничего не удаляет', async () => {
        const pool = new PoolStub()

        await expect(makeService(pool).deletePeriod('period-1', ''))
            .rejects.toBeInstanceOf(BadRequestException)
        expect(pool.deleteCalls).toHaveLength(0)
    })

    it('при неверном коде ничего не удаляет и называет ожидаемый код', async () => {
        const pool = new PoolStub()

        await expect(makeService(pool).deletePeriod('period-1', '2026-H1'))
            .rejects.toThrow(/2026-07/)
        expect(pool.deleteCalls).toHaveLength(0)
    })

    it('при верном коде удаляет и возвращает состав удалённого', async () => {
        const pool = new PoolStub()
        const result = await makeService(pool).deletePeriod('period-1', '2026-07')

        expect(result.deleted).toBe(true)
        expect(result.period.code).toBe('2026-07')
        expect(result.counts.organizationValues).toBe(37)
        expect(pool.deleteCalls).toHaveLength(1)
    })

    it('вычищает файлы импортов из хранилища', async () => {
        const removed: string[] = []
        await makeService(new PoolStub(), removed).deletePeriod('period-1', '2026-07')

        expect(removed).toEqual(['reporting/a.xlsx', 'reporting/b.xlsx'])
    })

    it('сбой хранилища не отменяет удаление периода', async () => {
        // Осиротевший объект безвреден, а откатывать уже выполненный DELETE нечем.
        const pool = new PoolStub()
        const s3 = { deleteObject: async () => { throw new Error('storage down') } }
        const service = new ReportingPeriodsService(pool as any, s3 as any)

        await expect(service.deletePeriod('period-1', '2026-07')).resolves.toMatchObject({
            deleted: true,
        })
    })

    it('код подтверждения сверяется без учёта лишних пробелов', async () => {
        const pool = new PoolStub()

        await expect(makeService(pool).deletePeriod('period-1', '  2026-07  '))
            .resolves.toMatchObject({ deleted: true })
    })
})
