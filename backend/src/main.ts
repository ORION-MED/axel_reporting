import './config/load-env'
import { NestFactory } from '@nestjs/core'
import { Logger, LogLevel } from '@nestjs/common'
import * as cookieParser from 'cookie-parser'
import * as express from 'express'
import { AppModule } from './app.module'
import { GlobalExceptionFilter } from './common/global-exception.filter'

function resolveLogLevels(): LogLevel[] {
    const level = (process.env.LOG_LEVEL || 'info').toLowerCase()
    const levels: Record<string, LogLevel[]> = {
        debug:   ['log', 'error', 'warn', 'debug', 'verbose'],
        verbose: ['log', 'error', 'warn', 'verbose'],
        info:    ['log', 'error', 'warn'],
        warn:    ['error', 'warn'],
        error:   ['error'],
    }
    return levels[level] ?? levels['info']
}

function makeRateLimiter(maxRequests: number, windowMs: number) {
    const hits = new Map<string, { count: number; resetAt: number }>()
    setInterval(() => {
        const now = Date.now()
        for (const [key, entry] of hits) {
            if (now > entry.resetAt) hits.delete(key)
        }
    }, windowMs).unref()
    return function rateLimiter(req: any, res: any, next: any) {
        const ip: string = req.ip || req.socket?.remoteAddress || 'unknown'
        const now = Date.now()
        const entry = hits.get(ip)
        if (!entry || now > entry.resetAt) {
            hits.set(ip, { count: 1, resetAt: now + windowMs })
            return next()
        }
        entry.count++
        if (entry.count > maxRequests) {
            res.status(429).json({ message: 'Too many requests. Please try again later.' })
            return
        }
        next()
    }
}

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        bodyParser: false,
        logger: resolveLogLevels(),
    })
    app.enableShutdownHooks()
    const log = new Logger('Bootstrap')

    const jwtSecret = process.env.JWT_SECRET
    if (!jwtSecret) {
        log.error('JWT_SECRET environment variable is not set — refusing to start')
        process.exit(1)
    }
    if (jwtSecret === 'change_me_in_production') {
        if (process.env.NODE_ENV === 'production') {
            log.error('JWT_SECRET is the default placeholder — refusing to start in production')
            process.exit(1)
        } else {
            log.warn('JWT_SECRET is the default placeholder value — do NOT use in production')
        }
    }

    const bodyLimit = process.env.JSON_BODY_LIMIT || '5mb'

    app.useGlobalFilters(new GlobalExceptionFilter())
    app.use(cookieParser())

    const apiPrefix = process.env.API_PREFIX || 'api'
    app.use(`/${apiPrefix}/auth/login`, makeRateLimiter(20, 15 * 60 * 1000))
    app.use(`/${apiPrefix}/auth/register`, makeRateLimiter(5, 60 * 60 * 1000))

    // Увеличиваем лимит размера JSON-тела, чтобы можно было сохранять крупные публикации.
    // Используем собственный parser (bodyParser: false), чтобы лимит применялся гарантированно.
    app.use(express.json({ limit: bodyLimit }))
    app.use(
        express.urlencoded({
            limit: bodyLimit,
            extended: true,
            parameterLimit: 100_000,
        }),
    )

    // Устанавливает глобальный префикс для всех маршрутов API.
    app.setGlobalPrefix(process.env.API_PREFIX || 'api')

    // Читает разрешённые источники CORS из переменной окружения.
    const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
        .split(',')
        .map((o) => o.trim())

    // Включает CORS с базовыми настройками.
    app.enableCors({
        origin: origins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
        credentials: true,
    })

    const port = Number(process.env.PORT) || 3001
    const host = process.env.HOST || '127.0.0.1'

    try {
        await app.listen(port, host)
        log.log(`Backend running on http://${host}:${port}`)
    } catch (err) {
        log.error(`Failed to start server: ${err}`)
        process.exit(1)
    }
}

bootstrap()
