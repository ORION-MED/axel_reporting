import {
    BadRequestException,
    Body,
    Controller,
    Post,
    Req,
    UploadedFiles,
    UseInterceptors,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { Request } from 'express'
import { AuthTokenPayload } from '../auth/auth.service'
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto'
import { SupportService } from './support.service'

const MAX_SUPPORT_FILES = 3
const MAX_SUPPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_SUPPORT_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const ALLOWED_SUPPORT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.txt', '.csv', '.zip', '.xlsx']

function getFileExtension(fileName: string): string {
    const parts = fileName.split('.')
    const ext = parts[parts.length - 1]
    return ext ? `.${ext.toLowerCase()}` : ''
}

function isAllowedSupportFile(file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>): boolean {
    const ext = getFileExtension(file.originalname)
    const mimeType = (file.mimetype || '').toLowerCase()
    const extOk = ALLOWED_SUPPORT_EXTENSIONS.includes(ext)
    const mimeOk = mimeType === 'application/octet-stream' || ALLOWED_SUPPORT_MIME_TYPES.includes(mimeType)
    return extOk && mimeOk
}

@Controller('support')
export class SupportController {
    constructor(private readonly supportService: SupportService) { }

    @Post('tickets')
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    @UseInterceptors(
        FilesInterceptor('attachments', MAX_SUPPORT_FILES, {
            storage: memoryStorage(),
            limits: {
                files: MAX_SUPPORT_FILES,
                fileSize: MAX_SUPPORT_FILE_SIZE_BYTES,
            },
            fileFilter: (_req, file, cb) => {
                if (isAllowedSupportFile(file)) {
                    cb(null, true)
                    return
                }

                cb(new BadRequestException('Неподдерживаемый тип файла. Разрешены PNG, JPG/JPEG, PDF, TXT, CSV, ZIP и XLSX.'), false)
            },
        }),
    )
    async createTicket(
        @Body() body: CreateSupportTicketDto,
        @Req() req: Request,
        @UploadedFiles() files: Express.Multer.File[] = [],
    ) {
        if (files.length > MAX_SUPPORT_FILES) {
            throw new BadRequestException(`Можно прикрепить не более ${MAX_SUPPORT_FILES} файлов`)
        }

        for (const file of files) {
            if (file.size > MAX_SUPPORT_FILE_SIZE_BYTES) {
                throw new BadRequestException('Размер каждого файла не должен превышать 5 МБ')
            }

            if (!isAllowedSupportFile(file)) {
                throw new BadRequestException('Неподдерживаемый тип файла. Разрешены PNG, JPG/JPEG, PDF, TXT, CSV, ZIP и XLSX.')
            }
        }

        const user = (req as any).user as AuthTokenPayload | undefined
        return this.supportService.createTicket(body, user, files)
    }
}
