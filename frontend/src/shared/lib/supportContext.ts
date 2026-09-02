export interface SupportUserInfo {
    login?: string | null
    email?: string | null
    name?: string | null
}

export interface SupportContextOptions {
    sectionName?: string
    pathname?: string
    href?: string
    search?: string
    userAgent?: string
    now?: Date
    user?: SupportUserInfo | null
    datasetId?: string | null
    publicationId?: string | null
}

export interface SupportContext {
    sectionName: string
    pathname: string
    href: string
    userLabel: string
    browser: string
    formattedDate: string
    isoDate: string
}

export interface SupportPrefill extends SupportContext {
    pageUrl: string
    browserInfo: string
    reportedAt: string
    name: string
    email: string
    datasetId: string
    publicationId: string
}

const SECTION_LABELS: Array<{ prefix: string; label: string }> = [
    { prefix: '/support', label: 'Поддержка' },
    { prefix: '/work', label: 'Рабочее место' },
    { prefix: '/stats', label: 'Статистика' },
    { prefix: '/dashboard', label: 'Визуализация' },
    { prefix: '/database', label: 'Базы данных' },
    { prefix: '/profile', label: 'Профиль' },
    { prefix: '/settings', label: 'Настройки' },
    { prefix: '/', label: 'Публикации' },
]

function getCurrentPathname(): string {
    if (typeof window === 'undefined') return '/'
    return window.location.pathname || '/'
}

function getCurrentHref(pathname: string): string {
    if (typeof window === 'undefined') return pathname
    return window.location.href || pathname
}

export function inferSectionNameFromPath(pathname = getCurrentPathname()): string {
    const matched = SECTION_LABELS.find((item) => item.prefix === '/'
        ? pathname === '/'
        : pathname.startsWith(item.prefix))

    if (matched) {
        return matched.label
    }

    const segments = pathname.split('/').filter(Boolean)
    const lastSegment = segments[segments.length - 1]
    return lastSegment ? decodeURIComponent(lastSegment) : 'Неизвестный раздел'
}

export function formatSupportUser(user?: SupportUserInfo | null): string {
    if (!user) return 'не определён'

    const login = user.login?.trim() || user.name?.trim() || ''
    const email = user.email?.trim() || ''

    if (login && email) return `${login} (${email})`
    if (login) return login
    if (email) return email
    return 'не определён'
}

export function getSupportContext(options: SupportContextOptions = {}): SupportContext {
    const pathname = options.pathname || getCurrentPathname()
    const href = options.href || getCurrentHref(pathname)
    const now = options.now || new Date()

    return {
        sectionName: options.sectionName || inferSectionNameFromPath(pathname),
        pathname,
        href,
        userLabel: formatSupportUser(options.user),
        browser: options.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'),
        formattedDate: now.toLocaleString('ru-RU'),
        isoDate: now.toISOString(),
    }
}

export function buildSupportPrefill(options: SupportContextOptions = {}): SupportPrefill {
    const context = getSupportContext(options)
    const search = options.search ?? (typeof window !== 'undefined' ? window.location.search : '')
    const params = new URLSearchParams(search)

    return {
        ...context,
        pageUrl: context.href,
        browserInfo: context.browser,
        reportedAt: context.formattedDate,
        name: options.user?.name?.trim() || options.user?.login?.trim() || '',
        email: options.user?.email?.trim() || '',
        datasetId: options.datasetId ?? params.get('datasetId') ?? params.get('tableId') ?? '',
        publicationId: options.publicationId ?? params.get('publicationId') ?? '',
    }
}

export function buildSupportMessage(context: SupportContext): string {
    return [
        `Раздел: ${context.sectionName}`,
        `URL: ${context.href}`,
        `Маршрут: ${context.pathname}`,
        `Пользователь: ${context.userLabel}`,
        `Браузер: ${context.browser}`,
        `Дата: ${context.formattedDate}`,
        `ISO дата: ${context.isoDate}`,
        '',
        'Что делал:',
        '[заполняется пользователем]',
        '',
        'Ожидаемый результат:',
        '[заполняется пользователем]',
        '',
        'Фактический результат:',
        '[заполняется пользователем]',
        '',
        'Дополнительно:',
        '[если возможно, приложите скриншот, файл или шаги для повторения]',
    ].join('\n')
}
