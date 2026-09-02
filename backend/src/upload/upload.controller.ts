import {
    Controller,
    Post,
    Req,
    Res,
    HttpCode,
    HttpStatus,
    BadRequestException,
    InternalServerErrorException,
} from '@nestjs/common'
import { Request, Response } from 'express'
import * as busboy from 'busboy'
import { UploadService } from './upload.service'
import type { AuthTokenPayload } from '../auth/auth.service'
import { decodeMultipartFilename } from '../common/decode-multipart-filename'

const ALLOWED_MIMES = new Set([
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
])
const ALLOWED_EXTS = new Set(['.csv', '.xls', '.xlsx', '.ods'])

@Controller('upload')
export class UploadController {
    constructor(private readonly uploadService: UploadService) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    uploadFile(@Req() req: Request, @Res() res: Response) {
        const payload = (req as any).user as AuthTokenPayload
        const maxFileSize = Number(process.env.UPLOAD_MAX_FILE_SIZE) || 300 * 1024 * 1024

        return new Promise<void>((resolve, reject) => {
            const bb = busboy({ headers: req.headers, limits: { fileSize: maxFileSize } })
            let handled = false
            let settled = false
            let fileTooLarge = false

            const fail = (err: unknown) => {
                if (settled) return
                settled = true
                reject(err)
            }

            const succeed = () => {
                if (settled) return
                settled = true
                resolve()
            }

            bb.on('file', (_fieldname, stream, info) => {
                if (handled) {
                    stream.resume()
                    return
                }
                const { filename, mimeType } = info
                const decodedFilename = decodeMultipartFilename(filename)
                const ext = '.' + (decodedFilename.split('.').pop() ?? '').toLowerCase()

                if (!ALLOWED_MIMES.has(mimeType) && !ALLOWED_EXTS.has(ext)) {
                    stream.resume()
                    const err = new BadRequestException(`Неподдерживаемый тип файла: ${mimeType}`)
                    fail(err)
                    return
                }

                handled = true

                stream.on('limit', () => {
                    fileTooLarge = true
                    stream.destroy(new Error('Upload file size limit exceeded'))
                    req.resume()
                    fail(new BadRequestException('Файл превышает максимально допустимый размер'))
                })
                stream.on('error', (err) => {
                    if (fileTooLarge) return
                    fail(new InternalServerErrorException(String(err)))
                })

                this.uploadService
                    .registerUploadStream(stream, decodedFilename, mimeType, payload.sub)
                    .then((result) => {
                        if (fileTooLarge || settled) return
                        res.json(result)
                        succeed()
                    })
                    .catch((err) => {
                        if (fileTooLarge || settled) return
                        fail(err)
                    })
            })

            bb.on('finish', () => {
                if (!handled && !settled) {
                    fail(new BadRequestException('Файл не предоставлен'))
                }
            })

            bb.on('error', (err) => {
                if (fileTooLarge) return
                fail(new InternalServerErrorException(String(err)))
            })

            req.pipe(bb)
        })
    }
}
