import { parentPort, workerData } from 'node:worker_threads'
import * as ExcelJS from 'exceljs'
import { BadRequestException } from '@nestjs/common'
import { loadRemdWorkbook } from '../remd-workbook-parser'
import { loadTpggWorkbook } from '../tpgg-workbook-parser'
import { extractRemdNumerators } from '../remd-import'
import type { WorkbookParseTask } from './workbook-parse.types'

/**
 * Runs inside a worker_thread (see run-in-worker.ts) — this file has no NestJS request
 * context, DB pool or S3 client available, only the pure parsing functions it imports.
 */
async function run(task: WorkbookParseTask): Promise<unknown> {
    if (task.kind === 'remd') {
        return loadRemdWorkbook(Buffer.from(task.fileBuffer))
    }
    if (task.kind === 'tpgg') {
        return loadTpggWorkbook(Buffer.from(task.fileBuffer))
    }

    const workbook = new ExcelJS.Workbook()
    try {
        await workbook.xlsx.load(Buffer.from(task.fileBuffer) as any)
    } catch {
        throw new BadRequestException('Не удалось прочитать Excel-файл')
    }
    const worksheet = workbook.worksheets[0]
    if (!worksheet) {
        throw new BadRequestException('В Excel-файле не найден лист с данными')
    }
    return extractRemdNumerators(worksheet, task.reportingDate)
}

void run(workerData as WorkbookParseTask).then(
    (result) => {
        parentPort!.postMessage({ result })
    },
    (err: unknown) => {
        parentPort!.postMessage({
            error: {
                message: err instanceof Error ? err.message : String(err),
                isBadRequest: err instanceof BadRequestException,
            },
        })
    },
)
