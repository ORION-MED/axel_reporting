export type ProgressStage =
    | 'queued'
    | 'upload'
    | 'backend'
    | 'download'
    | 'parse'
    | 'project'
    | 'worker'
    | 'save'
    | 'export'
    | 'done'

export interface ProgressUpdate {
    stage: ProgressStage
    percent: number
    label?: string
}

export type ProgressCallback = (progress: ProgressUpdate) => void

export function clampProgress(percent: number): number {
    if (!Number.isFinite(percent)) return 0
    return Math.max(0, Math.min(100, Math.round(percent)))
}

export function progressLabel(progress: ProgressUpdate | null | undefined): string {
    if (!progress) return ''
    if (progress.label) return progress.label
    switch (progress.stage) {
        case 'queued': return 'Подготовка задачи'
        case 'upload': return 'Загрузка файла'
        case 'backend': return 'Обработка на сервере'
        case 'download': return 'Скачивание результата'
        case 'parse': return 'Разбор данных'
        case 'project': return 'Подготовка колонок'
        case 'worker': return 'Вычисление'
        case 'save': return 'Сохранение данных'
        case 'export': return 'Экспорт'
        case 'done': return 'Готово'
        default: return 'Обработка'
    }
}
