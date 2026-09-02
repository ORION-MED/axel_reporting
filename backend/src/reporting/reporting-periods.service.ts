import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Pool } from 'pg'
import { APP_DB_POOL } from '../database/database.tokens'
import { S3StorageService } from '../storage/s3.service'
import { cleanText, toDateString, toIsoString } from './reporting-format.util'

export interface ReportingPeriod {
    id: string
    code: string
    name: string
    dateFrom: string | null
    dateTo: string | null
    status: 'draft' | 'active' | 'closed'
    createdBy: number | null
    createdAt: string
    updatedAt: string
}

/** Сколько строк уйдёт каскадом вместе с периодом. */
export interface ReportingPeriodDeletionCounts {
    remdFacts: number
    remdSubdivisionFacts: number
    indicatorValues: number
    organizationValues: number
    diagnosticFindings: number
    qualityIssues: number
    tpggPlanValues: number
    importRuns: number
    /** Ручные уточнения применимости — данные, введённые пользователем. */
    requirementOverrides: number
}

export interface ReportingPeriodDeletionPreview {
    period: ReportingPeriod
    counts: ReportingPeriodDeletionCounts
    /** Последний период: после удаления в сервисе не останется ни одного. */
    isLastPeriod: boolean
}

export interface ReportingPeriodDeletionResult {
    deleted: true
    period: ReportingPeriod
    counts: ReportingPeriodDeletionCounts
    storageObjectKeys: string[]
}

export interface CreateReportingPeriodDto {
    name?: string
    code?: string
    dateFrom?: string | null
    dateTo?: string | null
    status?: 'draft' | 'active' | 'closed'
}

@Injectable()
export class ReportingPeriodsService {
    constructor(
        @Inject(APP_DB_POOL) private readonly pool: Pool,
        private readonly s3: S3StorageService,
    ) {}

    async listPeriods(): Promise<ReportingPeriod[]> {
        const res = await this.pool.query(`
            SELECT id::text,
                   code,
                   name,
                   date_from AS "dateFrom",
                   date_to AS "dateTo",
                   status,
                   created_by AS "createdBy",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"
            FROM reporting_periods
            ORDER BY COALESCE(date_to, date_from) DESC NULLS LAST,
                     created_at DESC;
        `)

        return res.rows.map((row) => this.mapPeriod(row))
    }

    async createPeriod(userId: number, body: CreateReportingPeriodDto): Promise<ReportingPeriod> {
        const name = cleanText(body.name, 160)
        if (!name) {
            throw new BadRequestException('Укажите название отчетного периода')
        }

        const dateFrom = this.parseDate(body.dateFrom, 'dateFrom')
        const dateTo = this.parseDate(body.dateTo, 'dateTo')
        if (dateFrom && dateTo && dateFrom > dateTo) {
            throw new BadRequestException('Дата начала периода не может быть позже даты окончания')
        }

        const status = body.status ?? 'draft'
        if (!['draft', 'active', 'closed'].includes(status)) {
            throw new BadRequestException('Некорректный статус отчетного периода')
        }

        // В4 (ВКС 31.07.2026): «нельзя два одинаковых создать».
        // Причина была не в названии, а в коде: он строится из дат (`dateFrom_dateTo`),
        // поэтому второй период на тот же интервал не создавался никогда — даже под
        // другим названием. А это ровно рабочий сценарий: перезалить тот же отчётный
        // период на свежих выгрузках, не затирая прежний расчёт.
        //
        // Теперь запрещаем только полный дубль (совпали и название, и обе даты) —
        // он почти наверняка означает случайное повторное нажатие. Во всех остальных
        // случаях код делаем уникальным сами.
        await this.assertNoExactDuplicate(name, dateFrom, dateTo)

        const explicitCode = this.cleanPeriodCode(body.code)
        const code = explicitCode
            ? await this.assertCodeIsFree(explicitCode)
            : await this.buildUniquePeriodCode(name, dateFrom, dateTo)

        try {
            const res = await this.pool.query(
                `
                INSERT INTO reporting_periods (code, name, date_from, date_to, status, created_by)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id::text,
                          code,
                          name,
                          date_from AS "dateFrom",
                          date_to AS "dateTo",
                          status,
                          created_by AS "createdBy",
                          created_at AS "createdAt",
                          updated_at AS "updatedAt";
                `,
                [code, name, dateFrom, dateTo, status, userId],
            )
            return this.mapPeriod(res.rows[0])
        } catch (err: any) {
            if (err?.code === '23505') {
                // Сюда попадаем только при гонке двух одновременных созданий:
                // проверки выше уже отработали.
                throw new BadRequestException(
                    'Не удалось создать период: такой код только что занял другой пользователь.'
                    + ' Повторите попытку.',
                )
            }
            throw err
        }
    }

    /**
     * Полный дубль — совпали название и обе даты. Единственный случай, который
     * действительно стоит запрещать: два периода, неотличимых для пользователя.
     */
    private async assertNoExactDuplicate(
        name: string,
        dateFrom: string | null,
        dateTo: string | null,
    ): Promise<void> {
        const res = await this.pool.query(
            `
            SELECT code
            FROM reporting_periods
            WHERE lower(btrim(name)) = lower(btrim($1))
              AND date_from IS NOT DISTINCT FROM $2::date
              AND date_to IS NOT DISTINCT FROM $3::date
            LIMIT 1;
            `,
            [name, dateFrom, dateTo],
        )

        if (res.rows[0]) {
            throw new BadRequestException(
                `Период «${name}» с такими же датами уже существует (код ${res.rows[0].code}).`
                + ' Измените название или даты — например, добавьте дату выгрузки.',
            )
        }
    }

    /** Явно заданный код обязан быть свободным: подменять выбор пользователя нельзя. */
    private async assertCodeIsFree(code: string): Promise<string> {
        const res = await this.pool.query(
            'SELECT name FROM reporting_periods WHERE code = $1 LIMIT 1;',
            [code],
        )

        if (res.rows[0]) {
            throw new BadRequestException(
                `Код периода «${code}» уже занят периодом «${res.rows[0].name}».`
                + ' Укажите другой код или оставьте поле пустым — код подставится автоматически.',
            )
        }
        return code
    }

    /**
     * Код по датам остаётся основным (он читаемый и предсказуемый), а при совпадении
     * получает порядковый суффикс: `2026-01-01_2026-06-30-2`, `-3` и так далее.
     */
    private async buildUniquePeriodCode(
        name: string,
        dateFrom: string | null,
        dateTo: string | null,
    ): Promise<string> {
        const base = this.buildPeriodCode(name, dateFrom, dateTo)

        const res = await this.pool.query(
            `SELECT code FROM reporting_periods WHERE code = $1 OR code LIKE $1 || '-%';`,
            [base],
        )
        const taken = new Set<string>(res.rows.map((row: { code: string }) => row.code))

        if (!taken.has(base)) return base

        for (let suffix = 2; suffix <= 200; suffix += 1) {
            const candidate = `${base}-${suffix}`
            if (!taken.has(candidate)) return candidate
        }

        return `${base}-${Date.now()}`
    }

    resolveSelectedPeriodId(periods: ReportingPeriod[], periodId?: string): string | null {
        if (periodId && periods.some((period) => period.id === periodId)) {
            return periodId
        }
        return periods[0]?.id ?? null
    }

    /**
     * Что исчезнет вместе с периодом. Все внешние ключи на `reporting_periods` стоят
     * с ON DELETE CASCADE, поэтому одно удаление уносит десять таблиц. Показываем это
     * заранее: среди них есть **ручные уточнения применимости**, которых больше нигде нет,
     * и журнал загрузок — то есть след того, какие файлы применялись.
     *
     * Обязательность пар «МО × вид СЭМД» не пропадает: она живёт вне периода.
     */
    async getDeletionPreview(id: string): Promise<ReportingPeriodDeletionPreview> {
        const period = await this.getPeriod(id)
        const res = await this.pool.query(
            `
            SELECT
                (SELECT count(*) FROM reporting_remd_facts WHERE period_id = $1)                       AS "remdFacts",
                (SELECT count(*) FROM reporting_remd_subdivision_facts WHERE period_id = $1)           AS "remdSubdivisionFacts",
                (SELECT count(*) FROM reporting_indicator_values WHERE period_id = $1)                 AS "indicatorValues",
                (SELECT count(*) FROM reporting_organization_indicator_values WHERE period_id = $1)    AS "organizationValues",
                (SELECT count(*) FROM reporting_diagnostic_findings WHERE period_id = $1)              AS "diagnosticFindings",
                (SELECT count(*) FROM reporting_quality_issues WHERE period_id = $1)                   AS "qualityIssues",
                (SELECT count(*) FROM reporting_tpgg_plan_values WHERE period_id = $1)                 AS "tpggPlanValues",
                (SELECT count(*) FROM reporting_import_runs WHERE period_id = $1)                      AS "importRuns",
                (SELECT count(*) FROM reporting_organization_semd_requirement_overrides
                  WHERE period_id = $1)                                                                AS "requirementOverrides";
            `,
            [id],
        )
        const row = res.rows[0] ?? {}
        const toCount = (value: unknown) => Number(value ?? 0)
        return {
            period,
            counts: {
                remdFacts: toCount(row.remdFacts),
                remdSubdivisionFacts: toCount(row.remdSubdivisionFacts),
                indicatorValues: toCount(row.indicatorValues),
                organizationValues: toCount(row.organizationValues),
                diagnosticFindings: toCount(row.diagnosticFindings),
                qualityIssues: toCount(row.qualityIssues),
                tpggPlanValues: toCount(row.tpggPlanValues),
                importRuns: toCount(row.importRuns),
                requirementOverrides: toCount(row.requirementOverrides),
            },
            isLastPeriod: (await this.listPeriods()).length <= 1,
        }
    }

    /**
     * Удаление периода. Необратимо: down-миграций и корзины в системе нет.
     *
     * `confirmCode` обязателен и должен совпасть с кодом периода. Это защита не от
     * пользователя — в интерфейсе он подтверждает удаление в диалоге, — а от ошибки
     * в идентификаторе при вызове напрямую: перепутанный `periodId` молча снесёт
     * не тот период.
     */
    async deletePeriod(
        id: string,
        confirmCode: string,
    ): Promise<ReportingPeriodDeletionResult> {
        const preview = await this.getDeletionPreview(id)
        const expected = preview.period.code
        if (cleanText(confirmCode, 120) !== expected) {
            throw new BadRequestException(
                `Для удаления периода подтвердите его код «${expected}».`,
            )
        }

        // Ключи объектов в хранилище собираем до удаления: строки журнала уйдут каскадом.
        const objectKeys = await this.pool.query(
            `SELECT object_key FROM reporting_import_runs WHERE period_id = $1 AND object_key <> '';`,
            [id],
        )

        const res = await this.pool.query(
            'DELETE FROM reporting_periods WHERE id = $1 RETURNING id::text;',
            [id],
        )
        if (res.rowCount === 0) {
            throw new NotFoundException('Отчетный период не найден')
        }

        // Файлы в хранилище чистим после удаления строк: если запрос упадёт, лучше
        // оставить осиротевшие объекты, чем удалить файлы у живого периода.
        const storageObjectKeys = objectKeys.rows.map(
            (row: { object_key: string }) => row.object_key,
        )
        for (const key of storageObjectKeys) {
            try {
                await this.s3.deleteObject(key)
            } catch {
                // Осиротевший объект в хранилище безвреден и не должен ронять удаление.
            }
        }

        return {
            deleted: true,
            period: preview.period,
            counts: preview.counts,
            storageObjectKeys,
        }
    }

    private async getPeriod(id: string): Promise<ReportingPeriod> {
        const res = await this.pool.query(
            `
            SELECT id::text, code, name,
                   date_from AS "dateFrom", date_to AS "dateTo", status,
                   created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
            FROM reporting_periods
            WHERE id = $1;
            `,
            [id],
        )
        if (!res.rows[0]) {
            throw new NotFoundException('Отчетный период не найден')
        }
        return this.mapPeriod(res.rows[0])
    }

    async ensurePeriodExists(id: string): Promise<void> {
        const res = await this.pool.query('SELECT 1 FROM reporting_periods WHERE id = $1', [id])
        if (res.rowCount === 0) {
            throw new NotFoundException('Отчетный период не найден')
        }
    }

    async getPeriodReportingDate(id: string): Promise<string | null> {
        const res = await this.pool.query(
            `
            SELECT date_from AS "dateFrom",
                   date_to AS "dateTo"
            FROM reporting_periods
            WHERE id = $1;
            `,
            [id],
        )
        const row = res.rows[0]
        if (!row) {
            throw new NotFoundException('Отчетный период не найден')
        }
        return toDateString(row.dateTo) ?? toDateString(row.dateFrom)
    }

    private parseDate(value: unknown, fieldName: string): string | null {
        if (value === null || typeof value === 'undefined' || value === '') {
            return null
        }
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new BadRequestException(`${fieldName}: дата должна быть в формате YYYY-MM-DD`)
        }
        const parsed = new Date(`${value}T00:00:00.000Z`)
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
            throw new BadRequestException(`${fieldName}: некорректная дата`)
        }
        return value
    }

    private buildPeriodCode(name: string, dateFrom: string | null, dateTo: string | null): string {
        if (dateFrom && dateTo) return `${dateFrom}_${dateTo}`
        if (dateFrom) return dateFrom

        const normalized = name
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^0-9a-zа-яё_.:-]/gi, '')
            .slice(0, 80)

        return normalized || `period-${Date.now()}`
    }

    private cleanPeriodCode(value: unknown): string {
        if (typeof value !== 'string') return ''
        return value
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^0-9a-zA-Zа-яА-ЯёЁ_.:-]/g, '')
            .slice(0, 80)
    }

    private mapPeriod(row: any): ReportingPeriod {
        return {
            id: row.id,
            code: row.code,
            name: row.name,
            dateFrom: toDateString(row.dateFrom),
            dateTo: toDateString(row.dateTo),
            status: row.status,
            createdBy: row.createdBy === null ? null : Number(row.createdBy),
            createdAt: toIsoString(row.createdAt),
            updatedAt: toIsoString(row.updatedAt),
        }
    }
}
