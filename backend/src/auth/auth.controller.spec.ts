import 'reflect-metadata'
import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

describe('AuthController', () => {
    let controller: AuthController
    let authService: Record<string, jest.Mock>

    const fakeUser = {
        id: 1,
        login: 'admin',
        email: 'u@u.com',
        createdAt: new Date(),
        bio: '',
        tokenVersion: 0,
        role: 'admin' as const,
    }
    const authedReq = () => ({
        user: { sub: 1, login: 'admin', email: 'u@u.com', role: 'admin', tv: 0 },
    } as any)

    beforeEach(async () => {
        authService = {
            register: jest.fn().mockResolvedValue(fakeUser),
            getUserFromTokenPayload: jest.fn().mockResolvedValue(fakeUser),
            changePassword: jest.fn().mockResolvedValue(undefined),
            updateProfile: jest.fn().mockResolvedValue(fakeUser),
        }
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuthController],
            providers: [{ provide: AuthService, useValue: authService }],
        }).compile()
        controller = module.get<AuthController>(AuthController)
    })

    describe('register', () => {
        it('throws for password shorter than 8 chars', async () => {
            await expect(
                controller.register({ login: 'user1', email: 'u@u.com', password: 'ab1' }, authedReq()),
            ).rejects.toBeInstanceOf(BadRequestException)
        })

        it('throws for password with no digits', async () => {
            await expect(
                controller.register({ login: 'user1', email: 'u@u.com', password: 'onlyletters' }, authedReq()),
            ).rejects.toBeInstanceOf(BadRequestException)
        })

        it('throws for password with no letters', async () => {
            await expect(
                controller.register({ login: 'user1', email: 'u@u.com', password: '12345678' }, authedReq()),
            ).rejects.toBeInstanceOf(BadRequestException)
        })

        it('throws for invalid email', async () => {
            await expect(
                controller.register({ login: 'user1', email: 'not-an-email', password: 'valid1pass' }, authedReq()),
            ).rejects.toBeInstanceOf(BadRequestException)
        })

        it('delegates to auth service for valid input', async () => {
            const result = await controller.register(
                { login: 'user1', email: 'u@u.com', password: 'valid1pass' },
                authedReq(),
            )
            expect(authService.register).toHaveBeenCalledWith('user1', 'u@u.com', 'valid1pass')
            expect(result).toHaveProperty('login')
        })

        it('rejects a non-admin user', async () => {
            authService.getUserFromTokenPayload.mockResolvedValue({
                ...fakeUser,
                login: 'user1',
                role: 'user',
            })
            await expect(
                controller.register(
                    { login: 'user2', email: 'u2@u.com', password: 'valid1pass' },
                    authedReq(),
                ),
            ).rejects.toBeInstanceOf(ForbiddenException)
            expect(authService.register).not.toHaveBeenCalled()
        })
    })

    describe('changePassword', () => {
        it('throws for new password shorter than 8 chars', async () => {
            await expect(
                controller.changePassword({ currentPassword: 'old1pass', newPassword: 'sh0rt' }, authedReq()),
            ).rejects.toBeInstanceOf(BadRequestException)
        })

        it('throws for new password with no digits', async () => {
            await expect(
                controller.changePassword({ currentPassword: 'old1pass', newPassword: 'noonedigits' }, authedReq()),
            ).rejects.toBeInstanceOf(BadRequestException)
        })

        it('calls auth service for valid new password', async () => {
            await controller.changePassword({ currentPassword: 'old1pass', newPassword: 'newPass1' }, authedReq())
            expect(authService.changePassword).toHaveBeenCalledWith(1, 'old1pass', 'newPass1')
        })
    })

    describe('updateProfile', () => {
        it('throws for bio longer than 2000 chars', async () => {
            await expect(
                controller.updateProfile({ bio: 'x'.repeat(2001) }, authedReq()),
            ).rejects.toBeInstanceOf(BadRequestException)
        })

        it('accepts bio at exactly 2000 chars', async () => {
            await controller.updateProfile({ bio: 'x'.repeat(2000) }, authedReq())
            expect(authService.updateProfile).toHaveBeenCalledWith(1, 'x'.repeat(2000))
        })
    })
})
