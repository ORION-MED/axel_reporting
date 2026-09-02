import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    BadRequestException,
    Res,
    PayloadTooLargeException,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common'
import { PicdbService } from './picdb.service'
import type { Response } from 'express'
import { pipeExportPayload } from './export-utils'

@Controller('picdb')
export class PicdbController {
    private readonly logger = new Logger(PicdbController.name)

    constructor(private readonly eicuService: PicdbService) { }

    private handleExportError(err: any): never {
        const message = err?.message || 'Не удалось сформировать экспорт'

        if (err?.name === 'ExportTooLargeError' || /слишком большой|too large|Invalid string length/i.test(message)) {
            throw new PayloadTooLargeException(message)
        }

        if (/not found|Invalid filters JSON|tables array is required|format must be csv or xlsx/i.test(message)) {
            throw new BadRequestException(message)
        }

        this.logger.error('Export failed', err?.stack || message)
        throw new InternalServerErrorException('Не удалось сформировать экспорт. Попробуйте сузить фильтры.')
    }

    // GET /api/eicu/ping — проверка подключения к БД
    @Get('ping')
    async ping() {
        const ok = await this.eicuService.ping()
        return { connected: ok }
    }

    // GET /api/eicu/tables — возвращает список таблиц
    @Get('tables')
    async getTables() {
        return this.eicuService.getTables()
    }

    // GET /api/eicu/tables/:name/columns — возвращает колонки таблицы
    @Get('tables/:name/columns')
    async getTableColumns(@Param('name') name: string) {
        return this.eicuService.getTableColumns(name)
    }

    // GET /api/eicu/tables/:name/columns/:col/distinct — уникальные значения колонки
    @Get('tables/:name/columns/:col/distinct')
    async getDistinctValues(
        @Param('name') name: string,
        @Param('col') col: string,
        @Query('limit') limit?: string,
    ) {
        // Колонки с составными значениями (разделители | / ,) требуют большего лимита
        const parsedCols = new Set([
            'diagnosisstring', 'icd9code', 'treatmentstring',
            'pasthistorypath', 'admitdxpath', 'cellpath', 'notepath',
            'cellattributepath', 'celllabel', 'cellattribute',
            'physicalexampath', 'culturesite', 'apacheadmissiondx',
        ])
        const isParsed = parsedCols.has(col)
        const maxLimit = isParsed ? 2000 : 500
        const defaultLimit = isParsed ? 1000 : 200
        const l = Math.min(Number(limit) || defaultLimit, maxLimit)
        try {
            return await this.eicuService.getDistinctValues(name, col, l)
        } catch (err: any) {
            throw new BadRequestException(err.message)
        }
    }

    // GET /api/eicu/tables/:name/data — получает данные таблицы с фильтрами/сортировкой/пагинацией
    @Get('tables/:name/data')
    async getTableData(
        @Param('name') name: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
        @Query('sortField') sortField?: string,
        @Query('sortDir') sortDir?: string,
        @Query('filters') filtersJson?: string,
        @Query('firstStayOnly') firstStayOnlyStr?: string,
        @Query('includeTotal') includeTotalStr?: string,
    ) {
        const l = Math.min(Number(limit) || 100, 2000)
        const o = Math.max(Number(offset) || 0, 0)
        const firstStayOnly = firstStayOnlyStr === 'true'
        const includeTotal = includeTotalStr !== 'false'
        let filters: { column: string; operator: string; value: string }[] | undefined
        if (filtersJson) {
            try {
                filters = JSON.parse(filtersJson)
            } catch {
                throw new BadRequestException('Invalid filters JSON')
            }
        }
        try {
            return await this.eicuService.getTableData(
                name,
                l,
                o,
                sortField,
                sortDir,
                filters,
                firstStayOnly,
                includeTotal,
            )
        } catch (err: any) {
            throw new BadRequestException(err.message)
        }
    }

    @Get('tables/:name/export')
    async exportTable(
        @Param('name') name: string,
        @Query('format') formatQ?: string,
        @Query('sortField') sortField?: string,
        @Query('sortDir') sortDir?: string,
        @Query('filters') filtersJson?: string,
        @Query('firstStayOnly') firstStayOnlyStr?: string,
        @Res() res?: Response,
    ) {
        const format = (formatQ || 'csv').toLowerCase()
        if (format !== 'csv' && format !== 'xlsx') {
            throw new BadRequestException('format must be csv or xlsx')
        }

        const firstStayOnly = firstStayOnlyStr === 'true'
        let filters: { column: string; operator: string; value: string }[] | undefined
        if (filtersJson) {
            try {
                filters = JSON.parse(filtersJson)
            } catch {
                throw new BadRequestException('Invalid filters JSON')
            }
        }

        try {
            const exported = await this.eicuService.exportTableData(
                name,
                format,
                sortField,
                sortDir,
                filters,
                firstStayOnly,
            )

            if (res) {
                await pipeExportPayload(res, exported)
            }
        } catch (err: any) {
            this.handleExportError(err)
        }
    }

    // POST /api/eicu/join — объединяет несколько таблиц по patientunitstayid
    @Post('join')
    async getJoinedData(
        @Body() body: {
            tables: { name: string; columns: string[] }[]
            limit?: number
            offset?: number
            sortField?: string
            sortDir?: string
            filters?: { column: string; operator: string; value?: string; valueFrom?: string; valueTo?: string; colType?: string }[]
            firstStayOnly?: boolean
            includeTotal?: boolean
        },
    ) {
        if (!body.tables || !Array.isArray(body.tables) || body.tables.length === 0) {
            throw new BadRequestException('tables array is required')
        }
        const limit = Math.min(body.limit || 100, 2000)
        const offset = Math.max(body.offset || 0, 0)
        const includeTotal = body.includeTotal !== false
        try {
            return await this.eicuService.getJoinedData(
                body.tables,
                limit,
                offset,
                body.sortField,
                body.sortDir,
                body.filters,
                body.firstStayOnly ?? false,
                includeTotal,
            )
        } catch (err: any) {
            throw new BadRequestException(err.message)
        }
    }

    @Post('join/export')
    async exportJoinedData(
        @Body() body: {
            tables: { name: string; columns: string[] }[]
            sortField?: string
            sortDir?: string
            filters?: { column: string; operator: string; value?: string; valueFrom?: string; valueTo?: string; colType?: string }[]
            firstStayOnly?: boolean
            format?: 'csv' | 'xlsx'
        },
        @Res() res?: Response,
    ) {
        if (!body.tables || !Array.isArray(body.tables) || body.tables.length === 0) {
            throw new BadRequestException('tables array is required')
        }

        const format = (body.format || 'csv').toLowerCase()
        if (format !== 'csv' && format !== 'xlsx') {
            throw new BadRequestException('format must be csv or xlsx')
        }

        try {
            const exported = await this.eicuService.exportJoinedData(
                body.tables,
                format,
                body.sortField,
                body.sortDir,
                body.filters,
                body.firstStayOnly ?? false,
            )

            if (res) {
                await pipeExportPayload(res, exported)
            }
        } catch (err: any) {
            this.handleExportError(err)
        }
    }
}
