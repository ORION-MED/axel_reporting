import { Inject, Injectable, Logger } from '@nestjs/common'
import { Pool } from 'pg'
import { PICDB_DB_POOL } from './database.tokens'
import { assertSupportedJoinKey } from './join-rules'
import {
    ExportPayload,
    buildCsvFromPagedData,
    buildXlsxFromPagedData,
} from './export-utils'

type ExportFormat = 'csv' | 'xlsx'

@Injectable()
export class PicdbService {
    private readonly logger = new Logger(PicdbService.name)
    private static readonly JOIN_KEY_PRIORITY = ['icustay_id', 'hadm_id', 'subject_id'] as const
    private static readonly EXPORT_BATCH_SIZE = Number(process.env.EXPORT_BATCH_SIZE) || 5000
    private static readonly CSV_CHUNK_ROWS = Number(process.env.EXPORT_CSV_CHUNK_ROWS) || 2000
    private static readonly MAX_EXPORT_BYTES = Number(process.env.EXPORT_MAX_BYTES) || 150 * 1024 * 1024
    private static readonly MAX_XLSX_ROWS = Number(process.env.EXPORT_MAX_XLSX_ROWS) || 1_000_000

    constructor(@Inject(PICDB_DB_POOL) private readonly pool: Pool) {}

    // Проверяет доступность базы данных простым SELECT 1.
    async ping(): Promise<boolean> {
        try {
            await this.pool.query('SELECT 1')
            return true
        } catch {
            return false
        }
    }

    // Возвращает список таблиц в схеме public с комментариями и оценкой числа строк.
    async getTables() {
        const result = await this.pool.query(`
            SELECT
                t.tablename AS name,
                obj_description(c.oid) AS comment,
                c.reltuples::bigint AS estimated_rows
            FROM pg_tables t
            JOIN pg_class c ON c.relname = t.tablename
            WHERE t.schemaname = 'public'
            ORDER BY t.tablename
        `)
        return result.rows
    }

    // Возвращает список колонок и их типов для указанной таблицы.
    async getTableColumns(tableName: string) {
        const result = await this.pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
        `, [tableName])
        return result.rows as { column_name: string; data_type: string; is_nullable: string }[]
    }

    // Возвращает уникальные значения указанной колонки (для категориальных фильтров).
    async getDistinctValues(tableName: string, columnName: string, limit = 200) {
        const tables = await this.getTables()
        const allowed = tables.map((t: any) => t.name)
        if (!allowed.includes(tableName)) {
            throw new Error(`Table "${tableName}" not found`)
        }
        const cols = await this.getTableColumns(tableName)
        const allowedCols = (cols as any[]).map((c) => c.column_name)
        if (!allowedCols.includes(columnName)) {
            throw new Error(`Column "${columnName}" not found`)
        }

        // По умолчанию — обычный DISTINCT
        const result = await this.pool.query(
            `SELECT DISTINCT "${columnName}"::text AS val FROM "${tableName}" WHERE "${columnName}" IS NOT NULL ORDER BY val LIMIT $1`,
            [limit],
        )
        return result.rows.map((r: any) => r.val)
    }

    // Возвращает данные из таблицы с поддержкой пагинации, сортировки и фильтров.
    async getTableData(
        tableName: string,
        limit = 100,
        offset = 0,
        sortField?: string,
        sortDir?: string,
        filters?: {
            column: string
            operator: string
            value?: string
            valueFrom?: string
            valueTo?: string
            colType?: string
        }[],
        firstStayOnly = false,
        includeTotal = true,
    ) {
        // Проверяем, что таблица присутствует в списке доступных таблиц
        const tables = await this.getTables()
        const allowed = tables.map((t: any) => t.name)
        if (!allowed.includes(tableName)) {
            throw new Error(`Table "${tableName}" not found`)
        }

        // Получаем список колонок и строим карту типов
        const cols = await this.getTableColumns(tableName)
        const colMap = new Map<string, string>()
        for (const c of cols as any[]) {
            colMap.set(c.column_name, c.data_type)
        }
        // Построение условий WHERE и параметров запроса
        const whereClauses: string[] = []
        const params: any[] = []
        let paramIdx = 1

        if (filters && filters.length > 0) {
            const processedCategoryEqColumns = new Set<string>()
            for (const f of filters) {
                if (!colMap.has(f.column)) continue
                const col = `"${f.column}"`
                const colType = f.colType || 'string'
                const isNumeric = colType === 'number'

                switch (f.operator) {
                    // Comparison operators
                    case '>':
                        if (isNumeric) {
                            whereClauses.push(`${col}::numeric > $${paramIdx}::numeric`)
                        } else {
                            whereClauses.push(`${col} > $${paramIdx}`)
                        }
                        params.push(f.value)
                        paramIdx++
                        break
                    case '<':
                        if (isNumeric) {
                            whereClauses.push(`${col}::numeric < $${paramIdx}::numeric`)
                        } else {
                            whereClauses.push(`${col} < $${paramIdx}`)
                        }
                        params.push(f.value)
                        paramIdx++
                        break
                    case '==':
                        if (isNumeric) {
                            whereClauses.push(`${col}::numeric = $${paramIdx}::numeric`)
                        } else {
                            whereClauses.push(`${col}::text = $${paramIdx}`)
                        }
                        params.push(f.value)
                        paramIdx++
                        break
                    case '<=':
                        if (isNumeric) {
                            whereClauses.push(`${col}::numeric <= $${paramIdx}::numeric`)
                        } else {
                            whereClauses.push(`${col} <= $${paramIdx}`)
                        }
                        params.push(f.value)
                        paramIdx++
                        break
                    case '>=':
                        if (isNumeric) {
                            whereClauses.push(`${col}::numeric >= $${paramIdx}::numeric`)
                        } else {
                            whereClauses.push(`${col} >= $${paramIdx}`)
                        }
                        params.push(f.value)
                        paramIdx++
                        break
                    case 'between':
                        if (isNumeric) {
                            whereClauses.push(`${col}::numeric BETWEEN $${paramIdx}::numeric AND $${paramIdx + 1}::numeric`)
                        } else {
                            whereClauses.push(`${col} BETWEEN $${paramIdx} AND $${paramIdx + 1}`)
                        }
                        params.push(f.valueFrom, f.valueTo)
                        paramIdx += 2
                        break
                    case 'ilike':
                        whereClauses.push(`${col}::text ILIKE $${paramIdx}`)
                        params.push(`%${f.value}%`)
                        paramIdx++
                        break
                    case 'categoryEquals': {
                        if (processedCategoryEqColumns.has(f.column)) {
                            break
                        }
                        processedCategoryEqColumns.add(f.column)

                        const sameColumnEquals = filters.filter(
                            (x) => x.operator === 'categoryEquals' && x.column === f.column,
                        )
                        const orClauses: string[] = []
                        for (const eq of sameColumnEquals) {
                            orClauses.push(`${col}::text = $${paramIdx}`)
                            params.push(eq.value)
                            paramIdx++
                        }
                        if (orClauses.length > 0) {
                            whereClauses.push(`(${orClauses.join(' OR ')})`)
                        }
                        break
                    }
                    case 'categoryNotEquals': {
                        whereClauses.push(`${col}::text <> $${paramIdx}`)
                        params.push(f.value)
                        paramIdx++
                        break
                    }
                    case 'isNull':
                        whereClauses.push(`${col} IS NULL`)
                        break
                    case 'isNotNull':
                        whereClauses.push(`${col} IS NOT NULL`)
                        break
                    // Legacy operators (backward compat)
                    case 'eq':
                        whereClauses.push(`${col}::text = $${paramIdx}`)
                        params.push(f.value)
                        paramIdx++
                        break
                    case 'neq':
                        whereClauses.push(`${col}::text != $${paramIdx}`)
                        params.push(f.value)
                        paramIdx++
                        break
                    case 'gt':
                        whereClauses.push(`${col}::text > $${paramIdx}`)
                        params.push(f.value)
                        paramIdx++
                        break
                    case 'lt':
                        whereClauses.push(`${col}::text < $${paramIdx}`)
                        params.push(f.value)
                        paramIdx++
                        break
                    case 'like':
                        whereClauses.push(`${col}::text ILIKE $${paramIdx}`)
                        params.push(`%${f.value}%`)
                        paramIdx++
                        break
                    case 'null':
                        whereClauses.push(`${col} IS NULL`)
                        break
                    case 'notnull':
                        whereClauses.push(`${col} IS NOT NULL`)
                        break
                }
            }
        }

        if (firstStayOnly && colMap.has('icustay_id')) {
            whereClauses.push(`"icustay_id" IN (
                SELECT icustay_id FROM (
                    SELECT icustay_id,
                           ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY intime ASC NULLS LAST) AS rn
                    FROM icustays
                ) AS _first_stays WHERE rn = 1
            )`)
        }

        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

        // Получаем общее число записей для пагинации (опционально)
        let total = -1
        if (includeTotal) {
            const countResult = await this.pool.query(
                `SELECT COUNT(*)::int AS total FROM (SELECT 1 FROM "${tableName}" ${whereSQL} LIMIT 100001) _cnt`,
                params,
            )
            total = countResult.rows[0].total
        }

        // Формируем ORDER BY при необходимости
        let orderSQL = ''
        if (sortField) {
            if (colMap.has(sortField)) {
                const dir = sortDir === 'desc' ? 'DESC' : 'ASC'
                orderSQL = `ORDER BY "${sortField}" ${dir}`
            }
        }

        const selectSQL = '*'

        const dataParams = [...params, limit, offset]
        const dataResult = await this.pool.query(
            `SELECT ${selectSQL} FROM "${tableName}" ${whereSQL} ${orderSQL} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            dataParams,
        )

        return { total, rows: dataResult.rows }
    }

    private get exportOptions() {
        return {
            batchSize: PicdbService.EXPORT_BATCH_SIZE,
            csvChunkRows: PicdbService.CSV_CHUNK_ROWS,
            maxExportBytes: PicdbService.MAX_EXPORT_BYTES,
            maxXlsxRows: PicdbService.MAX_XLSX_ROWS,
        }
    }

    private async buildCsvFromPagedData(
        fileBase: string,
        fetchPage: (limit: number, offset: number, includeTotal: boolean) => Promise<{ total: number; rows: any[] }>,
    ): Promise<ExportPayload> {
        return buildCsvFromPagedData(fileBase, fetchPage, this.exportOptions)
    }

    private async buildXlsxFromPagedData(
        fileBase: string,
        fetchPage: (limit: number, offset: number, includeTotal: boolean) => Promise<{ total: number; rows: any[] }>,
    ): Promise<ExportPayload> {
        return buildXlsxFromPagedData(fileBase, fetchPage, this.exportOptions, this.logger)
    }

    async exportTableData(
        tableName: string,
        format: ExportFormat,
        sortField?: string,
        sortDir?: string,
        filters?: {
            column: string
            operator: string
            value?: string
            valueFrom?: string
            valueTo?: string
            colType?: string
        }[],
        firstStayOnly = false,
    ): Promise<ExportPayload> {
        const fetchPage = (limit: number, offset: number, includeTotal: boolean) =>
            this.getTableData(
                tableName,
                limit,
                offset,
                sortField,
                sortDir,
                filters,
                firstStayOnly,
                includeTotal,
            )

        if (format === 'csv') {
            return this.buildCsvFromPagedData(tableName, fetchPage)
        }

        return this.buildXlsxFromPagedData(tableName, fetchPage)
    }

    // Выполняет JOIN для нескольких таблиц PICDB по поддерживаемым ключам (icustay_id/hadm_id/subject_id).
    async getJoinedData(
        tablesDef: { name: string; columns: string[] }[],
        limit = 100,
        offset = 0,
        sortField?: string,
        sortDir?: string,
        filters?: {
            column: string
            operator: string
            value?: string
            valueFrom?: string
            valueTo?: string
            colType?: string
        }[],
        firstStayOnly = false,
        includeTotal = true,
    ) {
        if (!tablesDef.length) throw new Error('No tables specified')

        // Валидируем наличие таблиц
        const allTables = await this.getTables()
        const allowedNames = allTables.map((t: any) => t.name)
        for (const td of tablesDef) {
            if (!allowedNames.includes(td.name)) {
                throw new Error(`Table "${td.name}" not found`)
            }
        }

        // Валидируем колонки и подготавливаем SELECT части
        const tableAliases: string[] = []
        const selectParts: string[] = []
        // Карта типов колонок: tableName -> colName -> data_type
        const colMaps = new Map<string, Map<string, string>>()
        const tableColumnSets = new Map<string, Set<string>>()

        for (let i = 0; i < tablesDef.length; i++) {
            const td = tablesDef[i]
            const alias = `t${i}`
            tableAliases.push(alias)

            const cols = await this.getTableColumns(td.name)
            const colNames = (cols as any[]).map((c) => c.column_name)

            // Строим colMap для этой таблицы
            const cm = new Map<string, string>()
            for (const c of cols as any[]) cm.set(c.column_name, c.data_type)
            colMaps.set(td.name, cm)
            tableColumnSets.set(td.name, new Set(colNames))

            // Если колонки не указаны — берём все
            const selectedCols = td.columns.length > 0 ? td.columns : colNames
            for (const col of selectedCols) {
                if (!colNames.includes(col)) {
                    throw new Error(`Column "${col}" not found in table "${td.name}"`)
                }
                // Алиасим как "tablename.column" чтобы избежать конфликтов имён
                selectParts.push(`${alias}."${col}" AS "${td.name}.${col}"`)
            }
        }

        // Построение FROM + JOIN
        const firstAlias = tableAliases[0]
        const firstName = tablesDef[0].name
        let fromSQL = `"${firstName}" AS ${firstAlias}`

        const firstColumns = tableColumnSets.get(firstName) ?? new Set<string>()
        for (let i = 1; i < tablesDef.length; i++) {
            const alias = tableAliases[i]
            const name = tablesDef[i].name
            const rightColumns = tableColumnSets.get(name) ?? new Set<string>()
            const joinKey = assertSupportedJoinKey(
                firstName,
                name,
                firstColumns,
                rightColumns,
                [...PicdbService.JOIN_KEY_PRIORITY],
            )
            fromSQL += ` INNER JOIN "${name}" AS ${alias} ON ${alias}."${joinKey}" = ${firstAlias}."${joinKey}"`
        }

        // Фильтр по первому пребыванию в ICU
        const joinWhereClauses: string[] = []
        const joinParams: any[] = []
        let joinParamIdx = 1

        if (filters && filters.length > 0) {
            const processedJoinCategoryEqColumns = new Set<string>()
            for (const f of filters) {
                const dotIdx = f.column.indexOf('.')
                if (dotIdx < 0) continue
                const tName = f.column.substring(0, dotIdx)
                const cName = f.column.substring(dotIdx + 1)
                const tIdx = tablesDef.findIndex((t) => t.name === tName)
                if (tIdx < 0) continue
                if (!colMaps.get(tName)?.has(cName)) continue
                const alias = tableAliases[tIdx]
                const col = `${alias}."${cName}"`
                const isNumeric = (f.colType || 'string') === 'number'

                switch (f.operator) {
                    case '>':
                        joinWhereClauses.push(isNumeric ? `${col}::numeric > $${joinParamIdx}::numeric` : `${col} > $${joinParamIdx}`)
                        joinParams.push(f.value); joinParamIdx++; break
                    case '<':
                        joinWhereClauses.push(isNumeric ? `${col}::numeric < $${joinParamIdx}::numeric` : `${col} < $${joinParamIdx}`)
                        joinParams.push(f.value); joinParamIdx++; break
                    case '==':
                        joinWhereClauses.push(isNumeric ? `${col}::numeric = $${joinParamIdx}::numeric` : `${col}::text = $${joinParamIdx}`)
                        joinParams.push(f.value); joinParamIdx++; break
                    case '<=':
                        joinWhereClauses.push(isNumeric ? `${col}::numeric <= $${joinParamIdx}::numeric` : `${col} <= $${joinParamIdx}`)
                        joinParams.push(f.value); joinParamIdx++; break
                    case '>=':
                        joinWhereClauses.push(isNumeric ? `${col}::numeric >= $${joinParamIdx}::numeric` : `${col} >= $${joinParamIdx}`)
                        joinParams.push(f.value); joinParamIdx++; break
                    case 'between':
                        joinWhereClauses.push(isNumeric
                            ? `${col}::numeric BETWEEN $${joinParamIdx}::numeric AND $${joinParamIdx + 1}::numeric`
                            : `${col} BETWEEN $${joinParamIdx} AND $${joinParamIdx + 1}`)
                        joinParams.push(f.valueFrom, f.valueTo); joinParamIdx += 2; break
                    case 'ilike':
                        joinWhereClauses.push(`${col}::text ILIKE $${joinParamIdx}`)
                        joinParams.push(`%${f.value}%`); joinParamIdx++; break
                    case 'categoryEquals': {
                        if (processedJoinCategoryEqColumns.has(f.column)) {
                            break
                        }
                        processedJoinCategoryEqColumns.add(f.column)

                        const sameColumnEquals = filters.filter(
                            (x) => x.operator === 'categoryEquals' && x.column === f.column,
                        )
                        const orClauses: string[] = []
                        for (const eq of sameColumnEquals) {
                            orClauses.push(`${col}::text = $${joinParamIdx}`)
                            joinParams.push(eq.value)
                            joinParamIdx++
                        }
                        if (orClauses.length > 0) {
                            joinWhereClauses.push(`(${orClauses.join(' OR ')})`)
                        }
                        break
                    }
                    case 'categoryNotEquals': {
                        joinWhereClauses.push(`${col}::text <> $${joinParamIdx}`)
                        joinParams.push(f.value); joinParamIdx++; break
                    }
                    case 'isNull': joinWhereClauses.push(`${col} IS NULL`); break
                    case 'isNotNull': joinWhereClauses.push(`${col} IS NOT NULL`); break
                }
            }
        }

        if (firstStayOnly && firstColumns.has('icustay_id')) {
            joinWhereClauses.push(`${firstAlias}."icustay_id" IN (
                SELECT icustay_id FROM (
                    SELECT icustay_id,
                           ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY intime ASC NULLS LAST) AS rn
                    FROM icustays
                ) AS _first_stays WHERE rn = 1
            )`)
        }

        const joinWhereSQL = joinWhereClauses.length > 0 ? `WHERE ${joinWhereClauses.join(' AND ')}` : ''

        // COUNT (опционально)
        let total = -1
        if (includeTotal) {
            const countResult = await this.pool.query(
                `SELECT COUNT(*)::int AS total FROM (SELECT 1 FROM ${fromSQL} ${joinWhereSQL} LIMIT 100001) _cnt`,
                joinParams,
            )
            total = countResult.rows[0].total
        }

        // ORDER BY
        let orderSQL = ''
        if (sortField) {
            // sortField приходит как "tablename.column"
            const parts = sortField.split('.')
            if (parts.length === 2) {
                const tIdx = tablesDef.findIndex((t) => t.name === parts[0])
                if (tIdx >= 0) {
                    const dir = sortDir === 'desc' ? 'DESC' : 'ASC'
                    orderSQL = `ORDER BY ${tableAliases[tIdx]}."${parts[1]}" ${dir}`
                }
            }
        }

        // SELECT
        const dataResult = await this.pool.query(
            `SELECT ${selectParts.join(', ')} FROM ${fromSQL} ${joinWhereSQL} ${orderSQL} LIMIT $${joinParamIdx} OFFSET $${joinParamIdx + 1}`,
            [...joinParams, limit, offset],
        )

        return { total, rows: dataResult.rows }
    }

    async exportJoinedData(
        tablesDef: { name: string; columns: string[] }[],
        format: ExportFormat,
        sortField?: string,
        sortDir?: string,
        filters?: {
            column: string
            operator: string
            value?: string
            valueFrom?: string
            valueTo?: string
            colType?: string
        }[],
        firstStayOnly = false,
    ): Promise<ExportPayload> {
        const joinName = `join_${tablesDef.map((t) => t.name).join('_')}`
        const fetchPage = (limit: number, offset: number, includeTotal: boolean) =>
            this.getJoinedData(
                tablesDef,
                limit,
                offset,
                sortField,
                sortDir,
                filters,
                firstStayOnly,
                includeTotal,
            )

        if (format === 'csv') {
            return this.buildCsvFromPagedData(joinName, fetchPage)
        }

        return this.buildXlsxFromPagedData(joinName, fetchPage)
    }
}

