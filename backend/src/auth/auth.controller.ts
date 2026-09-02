import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    Get,
    Optional,
    Post,
    Req,
    Res,
    UnauthorizedException,
} from '@nestjs/common'
import { Response, Request } from 'express'
import { AuthService, AuthTokenPayload } from './auth.service'
import { Public } from './public.decorator'
import { JwtAuthGuard } from './jwt-auth.guard'

interface RegisterDto {
    login: string
    email: string
    password: string
}

interface LoginDto {
    login: string
    password: string
}

interface ChangePasswordDto {
    currentPassword: string
    newPassword: string
}

interface UpdateProfileDto {
    bio: string
}

@Controller('auth')
export class AuthController {
    constructor(
        private readonly auth: AuthService,
        @Optional() private readonly jwtGuard?: JwtAuthGuard,
    ) { }

    @Post('register')
    async register(@Body() body: RegisterDto, @Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new UnauthorizedException('Необходима авторизация')
        }
        const requester = await this.auth.getUserFromTokenPayload(payload)
        if (!requester || requester.role !== 'admin') {
            throw new ForbiddenException('Создавать пользователей может только администратор')
        }

        const login = (body.login || '').trim()
        const email = (body.email || '').trim()
        const password = body.password || ''

        if (!login || !email || !password) {
            throw new BadRequestException('Заполните логин, email и пароль')
        }

        if (login.length < 3 || login.length > 20) {
            throw new BadRequestException('Логин должен быть от 3 до 20 символов')
        }

        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(login)) {
            throw new BadRequestException(
                'Логин должен начинаться с буквы и содержать только латинские буквы, цифры и подчёркивание',
            )
        }

        if (password.length < 8 || password.length > 72) {
            throw new BadRequestException('Пароль должен быть от 8 до 72 символов')
        }

        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
            throw new BadRequestException('Пароль должен содержать буквы и цифры')
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new BadRequestException('Введите корректный email')
        }

        const user = await this.auth.register(login, email, password)
        return {
            id: user.id,
            login: user.login,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
        }
    }

    @Public()
    @Post('login')
    async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
        const { login, password } = body
        const { user, token } = await this.auth.login(login, password)
        this.setAuthCookie(res, token)
        return { id: user.id, login: user.login, email: user.email, role: user.role, createdAt: user.createdAt }
    }

    @Post('logout')
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (payload?.sub) {
            await this.auth.invalidateToken(payload.sub)
            this.jwtGuard?.invalidateCache(payload.sub)
        }
        res.clearCookie('auth_token', {
            sameSite: 'strict',
            secure: this.isCookieSecure(),
            path: '/',
        })
        return { success: true }
    }

    @Get('me')
    async me(@Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            return null
        }

        const user = await this.auth.getUserFromTokenPayload(payload)
        if (!user) {
            return null
        }
        return {
            id: user.id,
            login: user.login,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            bio: user.bio,
        }
    }

    @Post('change-password')
    async changePassword(@Body() body: ChangePasswordDto, @Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new UnauthorizedException('Необходима авторизация')
        }

        const { currentPassword, newPassword } = body

        if (!newPassword || newPassword.length < 8 || newPassword.length > 72) {
            throw new BadRequestException('Пароль должен быть от 8 до 72 символов')
        }
        if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
            throw new BadRequestException('Пароль должен содержать буквы и цифры')
        }

        await this.auth.changePassword(payload.sub, currentPassword, newPassword)
        this.jwtGuard?.invalidateCache(payload.sub)
        return { success: true }
    }

    @Post('profile')
    async updateProfile(@Body() body: UpdateProfileDto, @Req() req: Request) {
        const payload = (req as any).user as AuthTokenPayload | undefined
        if (!payload) {
            throw new UnauthorizedException('Необходима авторизация')
        }

        const bio = body.bio ?? ''
        if (bio.length > 2000) {
            throw new BadRequestException('Биография не может превышать 2000 символов')
        }
        const user = await this.auth.updateProfile(payload.sub, bio)
        return {
            id: user.id,
            login: user.login,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt,
            bio: user.bio,
        }
    }

    private setAuthCookie(res: Response, token: string) {
        res.cookie('auth_token', token, {
            httpOnly: true,
            sameSite: 'strict',
            secure: this.isCookieSecure(),
            maxAge: 24 * 60 * 60 * 1000,
            path: '/',
        })
    }

    private isCookieSecure(): boolean {
        return (process.env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true'
    }
}
