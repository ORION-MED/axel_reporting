import * as Papa from 'papaparse'
import ExcelJS from 'exceljs'
import { PassThrough, Readable, Transform } from 'stream'
import type { Response } from 'express'

export interface ExportPayload {
    body: Readable
    contentType: string
    fileName: string
}

export class ExportTooLargeError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ExportTooLargeError'
    }
}

export class ExportBuildError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ExportBuildError'
    }
}

export type FetchPageFn = (
    limit: number,
    offset: number,
    includeTotal: boolean,
) => Promise<{ total: number; rows: any[] }>

export interface ExportOptions {
    batchSize: number
    csvChunkRows: number
    maxExportBytes: number
    maxXlsxRows: number
}

export function sanitizeFileBase(fileBase: string): string {
    return fileBase.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

function tooLargeMessage(maxBytes: number): string {
    const maxMb = Math.round(maxBytes / (1024 * 1024))
    return `Экспорт слишком большой. Максимальный размер файла - ${maxMb} MB. ` +
        'Сузьте фильтры или экспортируйте меньше данных.'
}

function createByteLimitStream(maxBytes: number): Transform {
    let totalBytes = 0
    return new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            totalBytes += chunk.byteLength
            if (totalBytes > maxBytes) {
                callback(new ExportTooLargeError(tooLargeMessage(maxBytes)))
                return
            }
            callback(null, chunk)
        },
    })
}

export async function buildCsvFromPagedData(
    fileBase: string,
    fetchPage: FetchPageFn,
    options: ExportOptions,
): Promise<ExportPayload> {
    const sanitizedBase = sanitizeFileBase(fileBase)

    async function* generateCsv(): AsyncGenerator<Buffer> {
        let totalBytes = 0
        let offset = 0
        let total = 0
        let wroteAnyRows = false
        let columns: string[] | undefined

        const emit = (text: string): Buffer => {
            const chunk = Buffer.from(text, 'utf8')
            totalBytes += chunk.byteLength
            if (totalBytes > options.maxExportBytes) {
                throw new ExportTooLargeError(tooLargeMessage(options.maxExportBytes))
            }
            return chunk
        }

        yield emit('\uFEFF')

        while (offset === 0 || offset < total) {
            const page = await fetchPage(options.batchSize, offset, offset === 0)
            if (offset === 0) {
                total = Math.max(page.total, 0)
            }

            const rows = (page.rows || []) as Record<string, unknown>[]
            if (!rows.length) break

            if (!columns && rows[0]) {
                columns = Object.keys(rows[0])
            }

            for (let i = 0; i < rows.length; i += options.csvChunkRows) {
                const partRows = rows.slice(i, i + options.csvChunkRows)
                if (!partRows.length) continue

                try {
                    const csvPart = Papa.unparse(partRows as any[], {
                        header: !wroteAnyRows,
                        columns,
                    })
                    yield emit(wroteAnyRows ? `\r\n${csvPart}` : csvPart)
                    wroteAnyRows = true
                } catch (err: any) {
                    if (err instanceof ExportTooLargeError) throw err
                    if (err instanceof RangeError || /Invalid string length/i.test(String(err?.message || ''))) {
                        throw new ExportTooLargeError(
                            'Экспорт слишком большой для формирования CSV. Сузьте фильтры или выберите меньше данных.',
                        )
                    }
                    throw new ExportBuildError('Не удалось сформировать CSV-файл')
                }
            }

            offset += rows.length
            if (rows.length < options.batchSize) break
            if (total > 0 && offset >= total) break
        }
    }

    return {
        body: Readable.from(generateCsv()),
        contentType: 'text/csv; charset=utf-8',
        fileName: `${sanitizedBase}.csv`,
    }
}

export async function buildXlsxFromPagedData(
    fileBase: string,
    fetchPage: FetchPageFn,
    options: ExportOptions,
    log: { warn: (msg: string) => void },
): Promise<ExportPayload> {
    const sanitizedBase = sanitizeFileBase(fileBase)
    const writerStream = new PassThrough()
    const limitedStream = createByteLimitStream(options.maxExportBytes)
    writerStream.pipe(limitedStream)

    ;(async () => {
        const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
            stream: writerStream,
            useStyles: false,
            useSharedStrings: false,
        })
        const ws = wb.addWorksheet('Data')
        let headersSet = false
        let offset = 0
        let total = 0
        let exportedRows = 0

        try {
            while (offset === 0 || offset < total) {
                const page = await fetchPage(options.batchSize, offset, offset === 0)
                if (offset === 0) {
                    total = Math.max(page.total, 0)
                }

                const rows = (page.rows || []) as Record<string, unknown>[]
                if (!rows.length) break

                exportedRows += rows.length
                if (exportedRows > options.maxXlsxRows) {
                    throw new ExportTooLargeError(
                        `Экспорт в Excel ограничен ${options.maxXlsxRows.toLocaleString()} строками. ` +
                        'Сузьте фильтры или экспортируйте в CSV.',
                    )
                }

                if (!headersSet && rows.length > 0) {
                    ws.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }))
                    headersSet = true
                }

                for (const row of rows) {
                    ws.addRow(row).commit()
                }

                offset += rows.length
                if (rows.length < options.batchSize) break
                if (total > 0 && offset >= total) break
            }

            ws.commit()
            await wb.commit()
        } catch (err: unknown) {
            if (err instanceof ExportTooLargeError) {
                writerStream.destroy(err)
                return
            }
            if (err instanceof RangeError || /Invalid string length|allocation failed|out of memory/i.test(String((err as Error)?.message || ''))) {
                writerStream.destroy(new ExportTooLargeError(
                    'Экспорт слишком большой для формирования Excel. Сузьте фильтры или экспортируйте в CSV.',
                ))
                return
            }
            log.warn('XLSX export failed')
            writerStream.destroy(new ExportBuildError('Не удалось сформировать XLSX-файл'))
        }
    })()

    return {
        body: limitedStream,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `${sanitizedBase}.xlsx`,
    }
}

export function pipeExportPayload(res: Response, exported: ExportPayload): Promise<void> {
    res.setHeader('Content-Type', exported.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`)

    return new Promise<void>((resolve, reject) => {
        let settled = false
        const cleanup = () => {
            exported.body.off('error', onBodyError)
            res.off('error', onResponseError)
            res.off('finish', onFinish)
            res.off('close', onClose)
        }
        const settle = (fn: () => void) => {
            if (settled) return
            settled = true
            cleanup()
            fn()
        }
        const onBodyError = (err: Error) => {
            if (res.headersSent) {
                res.destroy(err)
                settle(resolve)
                return
            }
            settle(() => reject(err))
        }
        const onResponseError = (err: Error) => {
            exported.body.destroy(err)
            settle(() => reject(err))
        }
        const onFinish = () => settle(resolve)
        const onClose = () => {
            exported.body.destroy()
            settle(resolve)
        }

        exported.body.once('error', onBodyError)
        res.once('error', onResponseError)
        res.once('finish', onFinish)
        res.once('close', onClose)
        exported.body.pipe(res)
    })
}
