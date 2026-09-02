import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly log = new Logger(GlobalExceptionFilter.name)

    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp()
        const res = ctx.getResponse<Response>()
        const req = ctx.getRequest<Request>()

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR

        if (!(exception instanceof HttpException)) {
            this.log.error(
                `Unhandled exception on ${req.method} ${req.url}`,
                exception instanceof Error ? exception.stack : String(exception),
            )
        }

        const body =
            exception instanceof HttpException
                ? exception.getResponse()
                : { statusCode: status, message: 'Внутренняя ошибка сервера' }

        res.status(status).json(
            typeof body === 'object' && body !== null
                ? body
                : { statusCode: status, message: body },
        )
    }
}
