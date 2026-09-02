export interface User {
    id: number
    login: string
    email: string
    passwordHash: string
    createdAt: Date
    bio: string
    tokenVersion: number
    role: 'admin' | 'user'
}
