export type WorkbookParseTask =
    | { kind: 'remd'; fileBuffer: Buffer }
    | { kind: 'tpgg'; fileBuffer: Buffer }
    | { kind: 'legacy-remd'; fileBuffer: Buffer; reportingDate: string | null }
