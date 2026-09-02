import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { BadRequestException } from '@nestjs/common'
import type { WorkbookParseTask } from './workbook-parse.types'

interface WorkerResponse<T> {
    result?: T
    error?: { message: string; isBadRequest: boolean }
}

/**
 * Roadmap step 3.1 — ExcelJS parsing of REMD/TPGG workbooks (up to 25 MB, thousands of
 * rows across dozens of columns) is CPU-bound and, run inline in an HTTP handler, stalls
 * Node's single event loop for the whole request — including unrelated requests from other
 * users hitting the same backend process at the same time. This runs the same parsing
 * functions unchanged on a worker_thread instead: the caller still awaits one promise and
 * gets the parsed result back exactly as before, but the main thread stays responsive
 * while the worker does the CPU work.
 */
export function runWorkbookParseInWorker<T>(task: WorkbookParseTask): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const worker = new Worker(join(__dirname, 'workbook-parse.worker.js'), {
            workerData: task,
        })

        worker.once('message', (message: WorkerResponse<T>) => {
            void worker.terminate()
            if (message.error) {
                reject(
                    message.error.isBadRequest
                        ? new BadRequestException(message.error.message)
                        : new Error(message.error.message),
                )
                return
            }
            resolve(message.result as T)
        })
        worker.once('error', (err) => {
            void worker.terminate()
            reject(err)
        })
        worker.once('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Поток разбора файла завершился с ошибкой (код ${code})`))
            }
        })
    })
}
