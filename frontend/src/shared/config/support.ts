const DEFAULT_SUPPORT_PORTAL_URL = 'http://localhost:8081'
const DEFAULT_SUPPORT_KB_URL = 'http://localhost:8081/knowledgebase.php'

export const SUPPORT_PORTAL_URL = import.meta.env.VITE_SUPPORT_PORTAL_URL?.trim() || DEFAULT_SUPPORT_PORTAL_URL
export const SUPPORT_KB_URL = import.meta.env.VITE_SUPPORT_KB_URL?.trim() || DEFAULT_SUPPORT_KB_URL

export const SUPPORT_ATTACHMENT_MAX_FILES = 3
export const SUPPORT_ATTACHMENT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
export const SUPPORT_ATTACHMENT_MAX_FILE_SIZE_MB = 5
export const SUPPORT_ATTACHMENT_ACCEPT_ATTR = '.png,.jpg,.jpeg,.pdf,.txt,.csv,.zip,.xlsx'
export const SUPPORT_ATTACHMENT_ALLOWED_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const
