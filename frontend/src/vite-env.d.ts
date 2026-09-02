/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_YANDEX_METRIKA_ID?: string
    readonly VITE_SUPPORT_PORTAL_URL?: string
    readonly VITE_SUPPORT_KB_URL?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare module '*.md?raw' {
    const content: string
    export default content
}
