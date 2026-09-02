import { Controller, Get, InternalServerErrorException, Param, Req, Res } from '@nestjs/common'
import { Request, Response } from 'express'
import { ArtifactsService } from './artifacts.service'
import type { AuthTokenPayload } from '../auth/auth.service'

const FORMAT_CONTENT_TYPE: Record<string, string> = {
    csv: 'text/csv',
    parquet: 'application/octet-stream',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    json: 'application/json',
}

@Controller('artifacts')
export class ArtifactsController {
    constructor(private readonly artifactsService: ArtifactsService) {}

    @Get(':id')
    async getArtifact(@Param('id') id: string, @Req() req: Request) {
        const userId = this.extractUserId(req)
        return this.artifactsService.getArtifact(id, userId)
    }

    @Get(':id/download')
    async downloadArtifact(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
        const userId = this.extractUserId(req)
        const { stream, artifact } = await this.artifactsService.getArtifactStream(id, userId)
        const contentType = FORMAT_CONTENT_TYPE[artifact.format] ?? 'application/octet-stream'
        res.setHeader('Content-Type', contentType)
        res.setHeader('Content-Disposition', `attachment; filename="artifact-${artifact.id}.${artifact.format}"`)
        await new Promise<void>((resolve, reject) => {
            let settled = false
            const cleanup = () => {
                stream.off('error', onStreamError)
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
            const onStreamError = (err: Error) => {
                if (res.headersSent) {
                    res.destroy(err)
                    settle(resolve)
                    return
                }
                settle(() => reject(new InternalServerErrorException('Не удалось скачать артефакт')))
            }
            const onResponseError = (err: Error) => {
                stream.destroy(err)
                settle(() => reject(err))
            }
            const onFinish = () => settle(resolve)
            const onClose = () => {
                stream.destroy()
                settle(resolve)
            }

            stream.once('error', onStreamError)
            res.once('error', onResponseError)
            res.once('finish', onFinish)
            res.once('close', onClose)
            stream.pipe(res)
        })
    }

    private extractUserId(req: Request): number {
        return ((req as any).user as AuthTokenPayload).sub
    }
}
