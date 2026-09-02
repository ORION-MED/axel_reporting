import { BadRequestException } from '@nestjs/common'
import { ReportingPeriodsService } from './reporting-periods.service'

/**
 * В4 (ВКС 31.07.2026): «нельзя два одинаковых создать».
 *
 * Корень был не в названии, а в коде периода: он строится из дат, поэтому второй
 * период на тот же интервал не создавался никогда. Тесты фиксируют новое поведение:
 * запрещён только полный дубль, всё остальное разрешено с уникальным кодом.
 *
 * Пул подменяем заглушкой — тесты юнит-уровня, БД здесь не поднимается.
 */

type QueryResult = { rows: any[]; rowCount: number }

class PoolStub {
    readonly calls: Array<{ sql: string; params: any[] }> = []

    constructor(private readonly handlers: Array<(sql: string, params: any[]) => QueryResult | null>) {}

    query(sql: string, params: any[] = []): Promise<QueryResult> {
        this.calls.push({ sql, params })
        for (const handler of this.handlers) {
            const result = handler(sql, params)
            if (result) return Promise.resolve(result)
        }
        return Promise.resolve({ rows: [], rowCount: 0 })
    }
}

function insertedRow(code: string, name: string) {
    return {
        rows: [{
            id: 'period-1',
            code,
            name,
            dateFrom: '2026-01-01',
            dateTo: '2026-06-30',
            status: 'draft',
            createdBy: 1,
            createdAt: '2026-07-31T00:00:00.000Z',
            updatedAt: '2026-07-31T00:00:00.000Z',
        }],
        rowCount: 1,
    }
}

function service(pool: PoolStub, s3: unknown = { deleteObject: async () => {} }): ReportingPeriodsService {
    return new ReportingPeriodsService(pool as any, s3 as any)
}

const BODY = {
    name: '2026 H1',
    dateFrom: '2026-01-01',
    dateTo: '2026-06-30',
}

describe('ReportingPeriodsService.createPeriod (В4)', () => {
    it('создаёт период на те же даты под другим названием — с уникальным кодом', async () => {
        const pool = new PoolStub([
            // дубля по названию + датам нет
            (sql) => (sql.includes('lower(btrim(name))') ? { rows: [], rowCount: 0 } : null),
            // базовый код по датам уже занят прежним периодом
            (sql) => (sql.includes("code LIKE")
                ? { rows: [{ code: '2026-01-01_2026-06-30' }], rowCount: 1 }
                : null),
            (sql) => (sql.includes('INSERT INTO reporting_periods')
                ? insertedRow('2026-01-01_2026-06-30-2', 'H1 по данным на 31.07')
                : null),
        ])

        const created = await service(pool).createPeriod(1, {
            ...BODY,
            name: 'H1 по данным на 31.07',
        })

        expect(created.code).toBe('2026-01-01_2026-06-30-2')
        const insert = pool.calls.find((call) => call.sql.includes('INSERT INTO reporting_periods'))
        expect(insert?.params[0]).toBe('2026-01-01_2026-06-30-2')
    })

    it('подбирает следующий свободный суффикс, а не первый попавшийся', async () => {
        const pool = new PoolStub([
            (sql) => (sql.includes('lower(btrim(name))') ? { rows: [], rowCount: 0 } : null),
            (sql) => (sql.includes("code LIKE")
                ? {
                    rows: [
                        { code: '2026-01-01_2026-06-30' },
                        { code: '2026-01-01_2026-06-30-2' },
                        { code: '2026-01-01_2026-06-30-3' },
                    ],
                    rowCount: 3,
                }
                : null),
            (sql) => (sql.includes('INSERT INTO reporting_periods')
                ? insertedRow('2026-01-01_2026-06-30-4', 'Контроль')
                : null),
        ])

        await service(pool).createPeriod(1, { ...BODY, name: 'Контроль' })

        const insert = pool.calls.find((call) => call.sql.includes('INSERT INTO reporting_periods'))
        expect(insert?.params[0]).toBe('2026-01-01_2026-06-30-4')
    })

    it('запрещает полный дубль — совпали и название, и даты', async () => {
        const pool = new PoolStub([
            (sql) => (sql.includes('lower(btrim(name))')
                ? { rows: [{ code: '2026-01-01_2026-06-30' }], rowCount: 1 }
                : null),
        ])

        await expect(service(pool).createPeriod(1, BODY))
            .rejects.toThrow(BadRequestException)
        await expect(service(pool).createPeriod(1, BODY))
            .rejects.toThrow(/уже существует/)
    })

    it('в сообщении о дубле называет код существующего периода', async () => {
        const pool = new PoolStub([
            (sql) => (sql.includes('lower(btrim(name))')
                ? { rows: [{ code: '2026-01-01_2026-06-30' }], rowCount: 1 }
                : null),
        ])

        await expect(service(pool).createPeriod(1, BODY))
            .rejects.toThrow(/2026-01-01_2026-06-30/)
    })

    it('не подменяет код, заданный пользователем, а сообщает о занятости', async () => {
        const pool = new PoolStub([
            (sql) => (sql.includes('lower(btrim(name))') ? { rows: [], rowCount: 0 } : null),
            (sql) => (sql.includes('WHERE code = $1 LIMIT 1')
                ? { rows: [{ name: '2026 H1' }], rowCount: 1 }
                : null),
        ])

        await expect(service(pool).createPeriod(1, { ...BODY, code: '2026-H1' }))
            .rejects.toThrow(/уже занят/)
    })

    it('свободный код пользователя принимает как есть', async () => {
        const pool = new PoolStub([
            (sql) => (sql.includes('lower(btrim(name))') ? { rows: [], rowCount: 0 } : null),
            (sql) => (sql.includes('WHERE code = $1 LIMIT 1') ? { rows: [], rowCount: 0 } : null),
            (sql) => (sql.includes('INSERT INTO reporting_periods')
                ? insertedRow('2026-H1-CHK', '2026 H1')
                : null),
        ])

        const created = await service(pool).createPeriod(1, { ...BODY, code: '2026-H1-CHK' })

        expect(created.code).toBe('2026-H1-CHK')
    })

    it('по-прежнему требует название и корректные даты', async () => {
        const pool = new PoolStub([])

        await expect(service(pool).createPeriod(1, { ...BODY, name: '   ' }))
            .rejects.toThrow(/название/i)
        await expect(service(pool).createPeriod(1, {
            ...BODY,
            dateFrom: '2026-07-01',
            dateTo: '2026-01-01',
        })).rejects.toThrow(/не может быть позже/)
    })
})
