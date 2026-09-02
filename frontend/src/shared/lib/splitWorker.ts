import Papa from 'papaparse'
import { zipSync } from 'fflate'
import type { ParsedRow } from '@shared/types'

interface VisibleCol { field: string; headerName: string }

interface SplitMsg {
    rows: ParsedRow[]
    splitMethod: 'random' | 'stratified' | 'timebased' | 'group' | 'kfold'
    splitMode: '2' | '3'
    trainPct: number
    testPct: number
    shuffleSplit: boolean
    randomSeed: number
    splitTargetCol: string
    splitDateCol: string
    splitGroupCol: string
    splitK: number
    visibleCols: VisibleCol[]
    fileName: string
}

function makeRng(seed: number) {
    let s = seed >>> 0
    return () => {
        s = (s + 0x6D2B79F5) >>> 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function shuffleArr<T>(arr: T[], rng: () => number): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

self.onmessage = (e: MessageEvent<SplitMsg>) => {
    try {
        const {
            rows, splitMethod, splitMode, trainPct, testPct, shuffleSplit,
            randomSeed, splitTargetCol, splitDateCol, splitGroupCol, splitK,
            visibleCols, fileName,
        } = e.data

        const rng = makeRng(randomSeed)
        const fields = visibleCols.map((c) => c.headerName)

        const toCsv = (csvRows: ParsedRow[]) => {
            const data = csvRows.map((row) =>
                visibleCols.map((col) => {
                    const v = row[col.field]
                    return v === null || v === undefined ? '' : v
                }),
            )
            return '﻿' + Papa.unparse({ fields, data })
        }

        const trainFrac = trainPct / 100
        const testFrac = (splitMode === '2' ? 100 - trainPct : testPct) / 100
        let splits: { name: string; rows: ParsedRow[] }[]

        if (splitMethod === 'random') {
            const source = shuffleSplit ? shuffleArr(rows, rng) : [...rows]
            const trainN = Math.round(source.length * trainFrac)
            if (splitMode === '2') {
                splits = [
                    { name: 'train', rows: source.slice(0, trainN) },
                    { name: 'test', rows: source.slice(trainN) },
                ]
            } else {
                const testN = Math.round(source.length * testFrac)
                splits = [
                    { name: 'train', rows: source.slice(0, trainN) },
                    { name: 'test', rows: source.slice(trainN, trainN + testN) },
                    { name: 'valid', rows: source.slice(trainN + testN) },
                ]
            }
        } else if (splitMethod === 'stratified') {
            const groups = new Map<unknown, ParsedRow[]>()
            for (const row of rows) {
                const key = row[splitTargetCol]
                if (!groups.has(key)) groups.set(key, [])
                groups.get(key)!.push(row)
            }
            const trainRows: ParsedRow[] = []
            const testRows: ParsedRow[] = []
            const validRows: ParsedRow[] = []
            for (const grp of groups.values()) {
                const g = shuffleArr(grp, rng)
                const tN = Math.round(g.length * trainFrac)
                trainRows.push(...g.slice(0, tN))
                if (splitMode === '2') {
                    testRows.push(...g.slice(tN))
                } else {
                    const xN = Math.round(g.length * testFrac)
                    testRows.push(...g.slice(tN, tN + xN))
                    validRows.push(...g.slice(tN + xN))
                }
            }
            splits = splitMode === '2'
                ? [{ name: 'train', rows: trainRows }, { name: 'test', rows: testRows }]
                : [{ name: 'train', rows: trainRows }, { name: 'test', rows: testRows }, { name: 'valid', rows: validRows }]
        } else if (splitMethod === 'timebased') {
            const sorted = [...rows].sort((a, b) => {
                const av = a[splitDateCol], bv = b[splitDateCol]
                if (av == null) return 1
                if (bv == null) return -1
                return av < bv ? -1 : av > bv ? 1 : 0
            })
            const trainN = Math.round(sorted.length * trainFrac)
            if (splitMode === '2') {
                splits = [
                    { name: 'train', rows: sorted.slice(0, trainN) },
                    { name: 'test', rows: sorted.slice(trainN) },
                ]
            } else {
                const testN = Math.round(sorted.length * testFrac)
                splits = [
                    { name: 'train', rows: sorted.slice(0, trainN) },
                    { name: 'test', rows: sorted.slice(trainN, trainN + testN) },
                    { name: 'valid', rows: sorted.slice(trainN + testN) },
                ]
            }
        } else if (splitMethod === 'group') {
            const groupIds = shuffleArr(Array.from(new Set(rows.map((r) => r[splitGroupCol]))), rng)
            const trainN = Math.round(groupIds.length * trainFrac)
            const trainIds = new Set(groupIds.slice(0, trainN))
            if (splitMode === '2') {
                splits = [
                    { name: 'train', rows: rows.filter((r) => trainIds.has(r[splitGroupCol])) },
                    { name: 'test', rows: rows.filter((r) => !trainIds.has(r[splitGroupCol])) },
                ]
            } else {
                const testN = Math.round(groupIds.length * testFrac)
                const testIds = new Set(groupIds.slice(trainN, trainN + testN))
                splits = [
                    { name: 'train', rows: rows.filter((r) => trainIds.has(r[splitGroupCol])) },
                    { name: 'test', rows: rows.filter((r) => testIds.has(r[splitGroupCol])) },
                    { name: 'valid', rows: rows.filter((r) => !trainIds.has(r[splitGroupCol]) && !testIds.has(r[splitGroupCol])) },
                ]
            }
        } else {
            // k-fold
            const source = shuffleArr(rows, rng)
            const foldSize = Math.floor(source.length / splitK)
            splits = Array.from({ length: splitK }, (_, i) => ({
                name: `fold_${i + 1}`,
                rows: i < splitK - 1
                    ? source.slice(i * foldSize, (i + 1) * foldSize)
                    : source.slice(i * foldSize),
            }))
        }

        const base = fileName.replace(/\.[^/.]+$/, '')
        const files: Record<string, Uint8Array> = {}
        for (const { name, rows: splitRows } of splits) {
            files[`${base}_${name}.csv`] = new TextEncoder().encode(toCsv(splitRows))
        }
        const zipBytes = zipSync(files)
        self.postMessage({ type: 'done', zipBytes }, { transfer: [zipBytes.buffer as ArrayBuffer] })
    } catch (err) {
        self.postMessage({ type: 'error', error: String(err) })
    }
}
