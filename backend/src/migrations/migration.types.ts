export interface Migration {
    id: number
    name: string
    upSql?: string
    up?: (client: any) => Promise<void | boolean>
}
