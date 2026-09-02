import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Request } from 'express'
import { IS_PUBLIC_KEY } from './public.decorator'
import { UserService } from '../user/user.service'
import type { AuthTokenPayload } from './auth.service'

const TV_CACHE_TTL_MS = 60_000

@Injectable()
export class JwtAuthGuard implements CanActivate {
    private readonly _tvCache = new Map<number, { version: number; expiresAt: number }>()

    constructor(
        private readonly jwtService: JwtService,
        private readonly reflector: Reflector,
        private readonly users: UserService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ])
        if (isPublic) {
            return true
        }

        const request = context.switchToHttp().getRequest<Request>()
        const token = this.extractTokenFromRequest(request)
        if (!token) {
            throw new UnauthorizedException('Необходима авторизация')
        }

        let payload: AuthTokenPayload
        try {
            payload = this.jwtService.verify<AuthTokenPayload>(token)
        } catch {
            throw new UnauthorizedException('Неверный или просроченный токен')
        }

        if (!Number.isInteger(payload.sub)) {
            throw new UnauthorizedException('Неверный токен')
        }

        if (typeof payload.tv === 'number') {
            const currentVersion = await this.getTokenVersion(payload.sub)
            if (currentVersion !== payload.tv) {
                throw new UnauthorizedException('Токен отозван. Выполните вход повторно.')
            }
        }

        ; (request as any).user = payload
        return true
    }

    private async getTokenVersion(userId: number): Promise<number> {
        const now = Date.now()
        const cached = this._tvCache.get(userId)
        if (cached && now < cached.expiresAt) {
            return cached.version
        }
        const user = await this.users.findById(userId)
        if (!user) {
            throw new UnauthorizedException('Пользователь не найден')
        }
        const version = user.tokenVersion
        this._tvCache.set(userId, { version, expiresAt: now + TV_CACHE_TTL_MS })
        return version
    }

    invalidateCache(userId: number): void {
        this._tvCache.delete(userId)
    }

    private extractTokenFromRequest(req: Request): string | null {
        if (req.cookies && req.cookies.auth_token) {
            return req.cookies.auth_token as string
        }
        const auth = req.headers['authorization']
        if (!auth) return null
        const [type, token] = auth.split(' ')
        if (type !== 'Bearer' || !token) return null
        return token
    }
}
