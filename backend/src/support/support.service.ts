import {
    Injectable,
    InternalServerErrorException,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common'
import * as nodemailer from 'nodemailer'
import { AuthTokenPayload } from '../auth/auth.service'
import { CreateSupportTicketDto } from './dto/create-support-ticket.dto'
import { normalizeAttachmentFilename, decodeFilename } from './lib/normalize-attachment-filename'

@Injectable()
export class SupportService {
    private readonly logger = new Logger(SupportService.name)
    private transporter: nodemailer.Transporter | null = null

    async createTicket(dto: CreateSupportTicketDto, authUser?: AuthTokenPayload, files: Express.Multer.File[] = []) {
        const toEmail = this.getRequiredEnv('SUPPORT_TO_EMAIL')
        const fromEmail = this.getRequiredEnv('SUPPORT_FROM_EMAIL')
        const sentAt = new Date()
        const priorityCode = this.normalizePriorityCode(dto.priority)
        const subject = `[AXEL][${dto.category}][${priorityCode}] ${dto.subject}`

        try {
            await this.getTransporter().sendMail({
                from: fromEmail,
                to: toEmail,
                replyTo: dto.name ? `${dto.name} <${dto.email}>` : dto.email,
                subject,
                text: this.buildTextMail(dto, authUser, sentAt, files),
                html: this.buildHtmlMail(dto, authUser, sentAt, files),
                attachments: this.buildMailAttachments(files),
            })

            return {
                success: true,
                message: 'Обращение отправлено в поддержку. После обработки почты в HESK появится тикет.',
                subject,
                sentAt: sentAt.toISOString(),
            }
        } catch (error: any) {
            if (error instanceof ServiceUnavailableException) {
                throw error
            }

            const detail = error?.code || error?.message || 'unknown_error'
            this.logger.error('Failed to send support ticket email', error?.stack || String(error))
            throw new InternalServerErrorException(
                process.env.NODE_ENV === 'production'
                    ? 'Не удалось отправить обращение в поддержку'
                    : `Не удалось отправить обращение в поддержку: ${detail}`,
            )
        }
    }

    private buildTextMail(
        dto: CreateSupportTicketDto,
        authUser: AuthTokenPayload | undefined,
        sentAt: Date,
        files: Express.Multer.File[] = [],
    ): string {
        const priorityCode = this.normalizePriorityCode(dto.priority)
        const attachmentSummary = this.buildAttachmentSummary(files)
        const lines = [
            'Проект: Аксель',
            `Категория: ${dto.category}`,
            `Приоритет: ${this.formatPriority(dto.priority, priorityCode)}`,
            `Раздел приложения: ${this.normalizeOptional(dto.sectionName)}`,
            `Пользователь: ${this.formatUser(authUser, dto)}`,
            `E-mail для ответа: ${dto.email}`,
            `Браузер: ${this.normalizeOptional(dto.browserInfo)}`,
            `Дата: ${sentAt.toLocaleString('ru-RU')}`,
        ]

        if (this.shouldIncludePageUrl(dto.pageUrl)) {
            lines.splice(4, 0, `URL страницы: ${this.normalizeOptional(dto.pageUrl)}`)
        }

        if (attachmentSummary) {
            lines.push(`Вложения: ${attachmentSummary}`)
        }

        lines.push(
            '',
            'Описание проблемы:',
            this.normalizeMultiline(dto.description),
            '',
            'Шаги воспроизведения:',
            this.normalizeMultiline(dto.stepsToReproduce),
            '',
            'Ожидаемый результат:',
            this.normalizeMultiline(dto.expectedResult),
            '',
            'Фактический результат:',
            this.normalizeMultiline(dto.actualResult),
        )

        const identifiers = this.buildIdentifierLines(dto)
        if (identifiers.length > 0) {
            lines.push('', 'Дополнительные идентификаторы:', ...identifiers)
        }

        return lines.join('\n')
    }

    private buildHtmlMail(
        dto: CreateSupportTicketDto,
        authUser: AuthTokenPayload | undefined,
        sentAt: Date,
        files: Express.Multer.File[] = [],
    ): string {
        const priorityCode = this.normalizePriorityCode(dto.priority)
        const attachmentSummary = this.buildAttachmentSummary(files)
        const block = (title: string, value?: string, fallback = 'Не указано') => `
            <div style="margin-bottom:16px;">
                <div style="font-weight:700; margin-bottom:6px;">${this.escapeHtml(title)}</div>
                <pre style="margin:0; white-space:pre-wrap; font-family:Arial,sans-serif;">${this.escapeHtml(this.normalizeMultiline(value, fallback))}</pre>
            </div>
        `

        const pageUrlHtml = this.shouldIncludePageUrl(dto.pageUrl)
            ? `<p><strong>URL страницы:</strong> ${this.escapeHtml(this.normalizeOptional(dto.pageUrl))}</p>`
            : ''
        const attachmentsHtml = attachmentSummary
            ? `<div style="margin-bottom:16px;"><div style="font-weight:700; margin-bottom:6px;">Вложения</div><pre style="margin:0; white-space:pre-wrap; font-family:Arial,sans-serif;">${this.escapeHtml(attachmentSummary)}</pre></div>`
            : ''

        const identifierLines = this.buildIdentifierLines(dto)
        const identifiersHtml = identifierLines.length > 0
            ? block('Дополнительные идентификаторы', identifierLines.join('\n'), '-')
            : ''

        return `
            <div style="font-family:Arial,sans-serif; color:#1f2937; line-height:1.5;">
                <h2 style="margin:0 0 16px;">Новое обращение в поддержку — Аксель</h2>
                <p><strong>Проект:</strong> Аксель</p>
                <p><strong>Категория:</strong> ${this.escapeHtml(dto.category)}</p>
                <p><strong>Приоритет:</strong> ${this.escapeHtml(this.formatPriority(dto.priority, priorityCode))}</p>
                <p><strong>Раздел приложения:</strong> ${this.escapeHtml(this.normalizeOptional(dto.sectionName))}</p>
                ${pageUrlHtml}
                <p><strong>Пользователь:</strong> ${this.escapeHtml(this.formatUser(authUser, dto))}</p>
                <p><strong>E-mail для ответа:</strong> ${this.escapeHtml(dto.email)}</p>
                <p><strong>Браузер:</strong> ${this.escapeHtml(this.normalizeOptional(dto.browserInfo))}</p>
                <p><strong>Дата:</strong> ${this.escapeHtml(sentAt.toLocaleString('ru-RU'))}</p>
                ${attachmentsHtml}
                ${block('Описание проблемы', dto.description)}
                ${block('Шаги воспроизведения', dto.stepsToReproduce)}
                ${block('Ожидаемый результат', dto.expectedResult)}
                ${block('Фактический результат', dto.actualResult)}
                ${identifiersHtml}
            </div>
        `
    }

    private buildAttachmentSummary(files: Express.Multer.File[] = []): string {
        if (files.length === 0) {
            return ''
        }

        const summaries = files.map((file) => {
            const decodedOriginal = decodeFilename(file.originalname)
            const normalized = normalizeAttachmentFilename(file.originalname)
            return `- Оригинальное имя: ${decodedOriginal}\n- Имя в письме: ${normalized}`
        })

        return summaries.join('\n\n')
    }

    private buildMailAttachments(files: Express.Multer.File[] = []): nodemailer.SendMailOptions['attachments'] {
        return files.map((file) => ({
            filename: normalizeAttachmentFilename(file.originalname),
            content: file.buffer,
            contentType: file.mimetype || undefined,
        }))
    }

    private formatUser(authUser: AuthTokenPayload | undefined, dto: CreateSupportTicketDto): string {
        if (authUser?.login && authUser?.email) {
            return `${authUser.login} (${authUser.email})`
        }

        if (authUser?.login) {
            return authUser.login
        }

        if (dto.name?.trim() && dto.email?.trim()) {
            return `${dto.name.trim()} (${dto.email.trim()})`
        }

        if (dto.name?.trim()) {
            return dto.name.trim()
        }

        if (dto.email?.trim()) {
            return dto.email.trim()
        }

        return 'Не указано'
    }

    private normalizeOptional(value?: string, fallback = 'Не указано'): string {
        return value?.trim() ? value.trim() : fallback
    }

    private normalizeMultiline(value?: string, fallback = 'Не указано'): string {
        return value?.trim() ? value.trim() : fallback
    }

    private shouldIncludePageUrl(pageUrl?: string): boolean {
        const normalized = pageUrl?.trim()
        if (!normalized) {
            return false
        }

        return !/\/support\/new\/?$/i.test(normalized)
    }

    private buildIdentifierLines(dto: CreateSupportTicketDto): string[] {
        const lines: string[] = []

        if (dto.datasetId?.trim()) {
            lines.push(`datasetId: ${dto.datasetId.trim()}`)
        }

        if (dto.publicationId?.trim()) {
            lines.push(`publicationId: ${dto.publicationId.trim()}`)
        }

        return lines
    }

    private normalizePriorityCode(priority?: string): 'LOW' | 'MEDIUM' | 'HIGH' {
        const normalized = (priority || '').trim().toUpperCase()

        if (normalized === 'LOW' || normalized === 'НИЗКИЙ') {
            return 'LOW'
        }

        if (normalized === 'HIGH' || normalized === 'ВЫСОКИЙ' || normalized === 'КРИТИЧЕСКИЙ' || normalized === 'CRITICAL') {
            return 'HIGH'
        }

        return 'MEDIUM'
    }

    private formatPriority(priority: string | undefined, priorityCode: 'LOW' | 'MEDIUM' | 'HIGH'): string {
        const label = this.normalizeOptional(priority)
        return label === priorityCode ? priorityCode : `${label} (${priorityCode})`
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    }

    private getTransporter(): nodemailer.Transporter {
        if (this.transporter) {
            return this.transporter
        }

        const host = this.getRequiredEnv('SUPPORT_SMTP_HOST')
        const portRaw = this.getRequiredEnv('SUPPORT_SMTP_PORT')
        const user = this.getRequiredEnv('SUPPORT_SMTP_USER')
        const pass = this.getRequiredEnv('SUPPORT_SMTP_PASS')
        const port = Number(portRaw)

        if (!Number.isFinite(port) || port <= 0) {
            throw new ServiceUnavailableException('SUPPORT_SMTP_PORT должен быть корректным числом')
        }

        this.transporter = nodemailer.createTransport({
            host,
            port,
            secure: this.isSecureConnection(),
            connectionTimeout: Number(process.env.SUPPORT_SMTP_CONNECTION_TIMEOUT || 10000),
            greetingTimeout: Number(process.env.SUPPORT_SMTP_GREETING_TIMEOUT || 10000),
            socketTimeout: Number(process.env.SUPPORT_SMTP_SOCKET_TIMEOUT || 10000),
            dnsTimeout: Number(process.env.SUPPORT_SMTP_DNS_TIMEOUT || 10000),
            auth: {
                user,
                pass,
            },
            tls: process.env.SUPPORT_SMTP_TLS_SERVERNAME?.trim()
                ? { servername: process.env.SUPPORT_SMTP_TLS_SERVERNAME.trim() }
                : undefined,
        })

        return this.transporter
    }

    private isSecureConnection(): boolean {
        return (process.env.SUPPORT_SMTP_SECURE ?? 'false').toLowerCase() === 'true'
    }

    private getRequiredEnv(name: string): string {
        const value = process.env[name]?.trim()
        if (!value) {
            throw new ServiceUnavailableException(`Не настроена переменная окружения ${name} для поддержки`)
        }
        return value
    }
}
