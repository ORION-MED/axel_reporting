// Яндекс.Метрика подключается через статический тег в index.html.
// Этот файл оставлен пустым — весь код отслеживания перенесён в HTML.

type YM = ((...args: any[]) => void) & { q?: IArguments[]; l?: number }

let _initialized = false

/** Безопасно сериализует dataset элемента. */
function readDataset(el: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {}
    try {
        Object.entries(el.dataset).forEach(([k, v]) => {
            if (v !== undefined) out[k] = v
        })
    } catch { /* ignore */ }
    return out
}

/**
 * Инициализирует Яндекс.Метрику.
 * Скрипт загружается асинхронно; очередь вызовов сохраняется до загрузки.
 * Включены: clickmap, trackLinks, accurateTrackBounce, webvisor, trackHash.
 *
 * @param id — ID счётчика; по умолчанию `import.meta.env.VITE_YANDEX_METRIKA_ID`
 */
export function initYandexMetrika(id?: string | number): void {
    const rawId = id ?? import.meta.env.VITE_YANDEX_METRIKA_ID
    if (!rawId) return

    const metrikaId = Number(rawId)
    if (isNaN(metrikaId)) return
    if (_initialized) return
    _initialized = true

    // Скрипт и init уже выполнены через статический тег в index.html.
    // Здесь только навешиваем глобальный обработчик кликов.
    const w = window as (typeof window & { ym?: YM })

    // ------------------------------------------------------------------
    // Глобальный обработчик кликов (capture-фаза — срабатывает всегда,
    // даже если обработчик на дочернем элементе вызвал stopPropagation).
    // Данные полей ввода НЕ отправляются — только структурные метаданные.
    // ------------------------------------------------------------------
    document.addEventListener(
        'click',
        (ev: MouseEvent) => {
            try {
                const raw = ev.target as HTMLElement | null
                if (!raw) return

                // Поднимаемся до ближайшего «осмысленного» элемента
                const node =
                    raw.closest<HTMLElement>(
                        'a, button, [role="button"], input, textarea, select, [data-track]',
                    ) ?? raw

                const tag = node.tagName.toLowerCase()
                const isFormField =
                    tag === 'input' || tag === 'textarea' || tag === 'select'

                const params: Record<string, unknown> = {
                    tag,
                    id: node.id || undefined,
                    name: node.getAttribute('name') || undefined,
                    type: node.getAttribute('type') || undefined,
                    href: node.getAttribute('href') || undefined,
                    ariaLabel: node.getAttribute('aria-label') || undefined,
                    data: readDataset(node),
                    path: location.pathname,
                }

                // Текст кнопок/ссылок — полезен для анализа; значения полей не берём
                if (!isFormField) {
                    const txt = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
                    if (txt) params.text = txt.slice(0, 150)
                }

                w.ym!(metrikaId, 'reachGoal', 'click', params)
            } catch { /* ignore */ }
        },
        true, // capture = true
    )
}

/**
 * Отправляет виртуальный просмотр страницы — вызывайте при SPA-навигации.
 * @param path — путь; по умолчанию текущий `location.pathname + search`
 */
export function trackRoute(path?: string): void {
    const rawId = import.meta.env.VITE_YANDEX_METRIKA_ID
    if (!rawId) return

    const metrikaId = Number(rawId)
    if (isNaN(metrikaId)) return

    const w = window as typeof window & { ym?: YM }
    try {
        w.ym?.(metrikaId, 'hit', path ?? location.pathname + location.search)
    } catch { /* ignore */ }
}

/**
 * Привязывает сессию к конкретному пользователю БД.
 * Вызывать сразу после получения данных авторизованного пользователя.
 * В Яндекс.Метрике данные будут видны в отчёте "Пользователи" (UserID).
 *
 * @param userId  — числовой id из таблицы users
 * @param login   — логин (отправляется как параметр визита, НЕ как PII)
 */
export function setMetrikaUser(userId: number, login: string): void {
    const rawId = import.meta.env.VITE_YANDEX_METRIKA_ID
    if (!rawId) return

    const metrikaId = Number(rawId)
    if (isNaN(metrikaId)) return

    const w = window as typeof window & { ym?: YM }
    try {
        // setUserID связывает все хиты с конкретным пользователем
        w.ym?.(metrikaId, 'setUserID', String(userId))
        // params — дополнительные параметры визита (видны в отчётах)
        w.ym?.(metrikaId, 'params', { user_id: userId, login })
    } catch { /* ignore */ }
}

/**
 * Сбрасывает привязку к пользователю (вызывать при logout).
 */
export function clearMetrikaUser(): void {
    const rawId = import.meta.env.VITE_YANDEX_METRIKA_ID
    if (!rawId) return

    const metrikaId = Number(rawId)
    if (isNaN(metrikaId)) return

    const w = window as typeof window & { ym?: YM }
    try {
        w.ym?.(metrikaId, 'setUserID', '')
    } catch { /* ignore */ }
}

/**
 * Отправляет именованное событие (цель) с параметрами.
 * Используется для отслеживания конкретных действий пользователя:
 * загрузки файлов, применения фильтров, кодирования и т.д.
 *
 * @param goal   — имя цели, например 'file_upload', 'filter_add'
 * @param params — произвольные параметры (видны в отчёте "Параметры визита")
 */
export function track(goal: string, params?: Record<string, unknown>): void {
    const rawId = import.meta.env.VITE_YANDEX_METRIKA_ID
    if (!rawId) return

    const metrikaId = Number(rawId)
    if (isNaN(metrikaId)) return

    const w = window as typeof window & { ym?: YM }
    try {
        w.ym?.(metrikaId, 'reachGoal', goal, { path: location.pathname, ...params })
    } catch { /* ignore */ }
}
