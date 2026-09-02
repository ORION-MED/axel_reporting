export interface PublicationSummary {
    id: number
    title: string
    description: string
    tags: string[]
    createdAt: string
    ownerLogin: string
    isPublic: boolean
}

export interface PublicationMine extends PublicationSummary {
    // На будущее можно добавить workspaceState и др.
}

export interface CreatePublicationPayload {
    title: string
    description?: string
    tags?: string[]
    workspaceState: unknown
}
