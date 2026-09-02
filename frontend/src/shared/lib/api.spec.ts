import { describe, it, expect } from 'vitest'
import { parseCsvText } from './api'

describe('parseCsvText', () => {
    it('parses headers and assigns sequential ids to rows', async () => {
        const csv = 'name,age\nalice,30\nbob,25'
        const { columns, rows } = await parseCsvText(csv)
        expect(columns.map((c) => c.field)).toEqual(['name', 'age'])
        expect(rows).toHaveLength(2)
        expect(rows[0].id).toBe(0)
        expect(rows[1].id).toBe(1)
    })

    it('trims header whitespace', async () => {
        const csv = ' name , age \nalice,30'
        const { columns } = await parseCsvText(csv)
        expect(columns[0].field).toBe('name')
        expect(columns[1].field).toBe('age')
    })

    it('detects numeric columns', async () => {
        const csv = 'value\n1\n2\n3'
        const { columns } = await parseCsvText(csv)
        expect(columns[0].type).toBe('number')
    })

    it('detects string columns', async () => {
        const csv = 'label\nfoo\nbar\nbaz'
        const { columns } = await parseCsvText(csv)
        expect(columns[0].type).toBe('string')
    })

    it('skips empty lines', async () => {
        const csv = 'v\n1\n\n3'
        const { rows } = await parseCsvText(csv)
        expect(rows).toHaveLength(2)
    })

    it('parses numeric values as numbers', async () => {
        const csv = 'v\n42\n7'
        const { rows } = await parseCsvText(csv)
        expect(rows[0].v).toBe(42)
        expect(rows[1].v).toBe(7)
    })

    it('sets all columns visible with default width', async () => {
        const csv = 'a,b\n1,2'
        const { columns } = await parseCsvText(csv)
        expect(columns.every((c) => c.visible)).toBe(true)
        expect(columns.every((c) => c.width === 150)).toBe(true)
    })
})
