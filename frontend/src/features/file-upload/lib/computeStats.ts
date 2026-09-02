import type { ColumnConfig, ParsedRow, ColumnType } from '@shared/types'



export interface HistogramBin {
    range: string
    count: number
    from: number
    to: number
}

export interface FrequencyEntry {
    value: string
    count: number
    pct: number
}

export interface BoxplotData {
    min: number
    q1: number
    median: number
    q3: number
    max: number
    wLow: number
    wHigh: number
    outliers: number[]
}

export interface NumericColStats {
    kind: 'numeric'
    field: string
    colType: ColumnType
    n: number
    missing: number
    missingPct: number
    mean: number
    median: number
    std: number
    variance: number
    iqr: number
    min: number
    max: number
    p5: number
    p25: number
    p75: number
    p95: number
    skewness: number
    kurtosis: number
    outliersCount: number
    histogram: HistogramBin[]
    boxplot: BoxplotData
}

export interface CategoricalColStats {
    kind: 'categorical'
    field: string
    colType: ColumnType
    n: number
    missing: number
    missingPct: number
    unique: number
    topValues: FrequencyEntry[]
    rareCount: number
    mode: string
    modePct: number
    histogram: FrequencyEntry[]
}

export type ColStats = NumericColStats | CategoricalColStats

export interface DataQuality {
    totalRows: number
    totalCols: number
    duplicateRows: number
    duplicateRowsPct: number
    missingCells: number
    missingCellsPct: number
    
    missingByCol: Record<string, number>
    
    highMissingCols: string[]
    
    constantOrIdCols: string[]
}

export interface CorrelationMatrix {
    fields: string[]
    pearson: number[][]
    spearman: number[][]
    pearsonP: number[][]
    spearmanP: number[][]
    nPairs: number[][]
}

export interface CramersVMatrix {
    fields: string[]
    matrix: number[][]
}

export interface VIFResult {
    field: string
    vif: number | null
    tolerance?: number | null
}

export interface MulticollinearityStats {
    conditionNumber: number | null
    eigenvalues: number[]
    conditionIndices: number[]
    fields: string[]
}

export interface DatasetStats {
    quality: DataQuality
    columns: ColStats[]
    correlation: CorrelationMatrix | null
    cramersV: CramersVMatrix | null
    vif: VIFResult[]
    multicollinearity?: MulticollinearityStats | null
}

export interface OverviewColStats {
    kind: 'numeric' | 'categorical'
    field: string
    colType: ColumnType
    n: number
    missing: number
    missingPct: number
    unique?: number
}

export interface DatasetOverview {
    quality: DataQuality
    columns: OverviewColStats[]
}


// Функция sortedNums


function sortedNums(arr: number[]): number[] {
    return arr.slice().sort((a, b) => a - b)
}


// Функция quantile


function quantile(sorted: number[], q: number): number {
    if (sorted.length === 0) return NaN
    // Функция pos
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}


// Функция mean


function mean(nums: number[]): number {
    if (!nums.length) return NaN
    return nums.reduce((a, b) => a + b, 0) / nums.length
}


// Функция variance


function variance(nums: number[], m?: number): number {
    if (nums.length < 2) return NaN
    const mu = m ?? mean(nums)
    return nums.reduce((s, x) => s + (x - mu) ** 2, 0) / nums.length
}


// Функция std


function std(nums: number[]): number {
    return Math.sqrt(variance(nums))
}


// Функция skewness


function skewness(nums: number[]): number {
    const n = nums.length
    if (n < 3) return NaN
    const mu = mean(nums)
    const s = std(nums)
    if (s === 0) return NaN
    // Функция m3
    const m3 = nums.reduce((a, x) => a + ((x - mu) / s) ** 3, 0) / n
    return m3
}


// Функция kurtosis


function kurtosis(nums: number[]): number {
    const n = nums.length
    if (n < 4) return NaN
    const mu = mean(nums)
    const s = std(nums)
    if (s === 0) return NaN
    // Функция m4
    const m4 = nums.reduce((a, x) => a + ((x - mu) / s) ** 4, 0) / n
    return m4 - 3
}


// Функция lgamma


function lgamma(x: number): number {
    const g = 7
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ]
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
    x -= 1
    let a = c[0]
    const t = x + g + 0.5
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i)
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}


// Функция betaIncI


function betaIncI(x: number, a: number, b: number): number {
    if (x <= 0) return 0
    if (x >= 1) return 1
    if (x > (a + 1) / (a + b + 2)) return 1 - betaIncI(1 - x, b, a)
    const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - (lgamma(a) + lgamma(b) - lgamma(a + b))) / a
    let f = 1, c = 1
    let d = 1 - (a + b) * x / (a + 1)
    d = Math.abs(d) < 1e-30 ? 1e-30 : d
    d = 1 / d; f = d
    for (let m = 1; m < 400; m++) {
        const m2 = 2 * m
        let num = m * (b - m) * x / ((a + m2 - 1) * (a + m2))
        d = 1 + num * d; d = Math.abs(d) < 1e-30 ? 1e-30 : d
        c = 1 + num / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c
        d = 1 / d; f *= c * d
        num = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1))
        d = 1 + num * d; d = Math.abs(d) < 1e-30 ? 1e-30 : d
        c = 1 + num / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c
        d = 1 / d
        const del = c * d
        f *= del
        if (Math.abs(del - 1) < 3e-10) break
    }
    return front * f
}


// Функция corrPValue


function corrPValue(r: number, n: number): number {
    if (n < 3 || !isFinite(r) || isNaN(r)) return NaN
    if (Math.abs(r) >= 1) return 0
    const t = r * Math.sqrt(n - 2) / Math.sqrt(1 - r * r)
    const df = n - 2
    return betaIncI(df / (df + t * t), df / 2, 0.5)
}


// Функция pearson


function pearson(xs: number[], ys: number[]): number {
    const n = xs.length
    if (n < 2) return NaN
    const mx = mean(xs)
    const my = mean(ys)
    let num = 0, dx2 = 0, dy2 = 0
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx
        const dy = ys[i] - my
        num += dx * dy
        dx2 += dx * dx
        dy2 += dy * dy
    }
    const den = Math.sqrt(dx2 * dy2)
    return den === 0 ? 0 : num / den
}


// Функция rankArray


function rankArray(arr: number[]): number[] {
    // Функция indexed
    const indexed = arr.map((v, i) => ({ v, i }))
    indexed.sort((a, b) => a.v - b.v)
    const ranks = new Array<number>(arr.length)
    let i = 0
    while (i < indexed.length) {
        let j = i
        while (j < indexed.length - 1 && indexed[j + 1].v === indexed[i].v) j++
        // Функция rank
        const rank = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) ranks[indexed[k].i] = rank
        i = j + 1
    }
    return ranks
}


// Функция spearman


function spearman(xs: number[], ys: number[]): number {
    if (xs.length < 2) return NaN
    return pearson(rankArray(xs), rankArray(ys))
}


// Функция histogram


function histogram(nums: number[], bins = 20): HistogramBin[] {
    if (!nums.length) return []
    const sorted = sortedNums(nums)
    const mn = sorted[0]
    const mx = sorted[sorted.length - 1]
    if (mn === mx) {
        return [{ range: String(mn), count: nums.length, from: mn, to: mn }]
    }
    // Функция step
    const step = (mx - mn) / bins
    const result: HistogramBin[] = []
    for (let b = 0; b < bins; b++) {
        const from = mn + b * step
        const to = b === bins - 1 ? mx + Number.EPSILON : mn + (b + 1) * step
        // Функция count
        const count = nums.filter((v) => v >= from && v < to).length
        // Функция fmt
        const fmt = (n: number) =>
            Math.abs(n) >= 1000 || (Math.abs(n) < 0.01 && n !== 0)
                ? n.toExponential(2)
                : +n.toFixed(2) + ''
        result.push({ range: `${fmt(from)}–${fmt(to)}`, count, from, to })
    }
    return result
}

// Функция boxplot

function boxplot(nums: number[]): BoxplotData {
    const sorted = sortedNums(nums)
    const q1 = quantile(sorted, 0.25)
    const med = quantile(sorted, 0.5)
    const q3 = quantile(sorted, 0.75)
    const iqr = q3 - q1
    const wLow = q1 - 1.5 * iqr
    const wHigh = q3 + 1.5 * iqr
    // Функция outliers
    const outliers = sorted.filter((v) => v < wLow || v > wHigh)
    return {
        min: sorted[0],
        q1,
        median: med,
        q3,
        max: sorted[sorted.length - 1],
        wLow,
        wHigh,
        outliers,
    }
}



// Функция cramersV



function cramersV(a: string[], b: string[]): number {
    const n = a.length
    if (n === 0) return NaN
    const rowSet = new Set(a)
    const colSet = new Set(b)
    const r = rowSet.size
    const c = colSet.size
    if (r <= 1 || c <= 1) return NaN

    const rows = [...rowSet]
    const cols = [...colSet]
    const table: number[][] = rows.map(() => new Array<number>(cols.length).fill(0))
    // Функция rIdx
    const rIdx = new Map(rows.map((v, i) => [v, i]))
    // Функция cIdx
    const cIdx = new Map(cols.map((v, i) => [v, i]))
    for (let i = 0; i < n; i++) {
        const ri = rIdx.get(a[i])!
        const ci = cIdx.get(b[i])!
        table[ri][ci]++
    }

    // Функция rowTotals

    const rowTotals = rows.map((_, i) => table[i].reduce((s, v) => s + v, 0))
    // Функция colTotals
    const colTotals = cols.map((_, j) => table.reduce((s, row) => s + row[j], 0))

    let chi2 = 0
    for (let i = 0; i < r; i++) {
        for (let j = 0; j < c; j++) {
            // Функция expected
            const expected = (rowTotals[i] * colTotals[j]) / n
            if (expected > 0) {
                chi2 += (table[i][j] - expected) ** 2 / expected
            }
        }
    }

    const phi2 = chi2 / n
    const minDim = Math.min(r, c) - 1
    return minDim <= 0 ? NaN : Math.sqrt(phi2 / minDim)
}




// Функция olsR2




function olsR2(y: number[], xs: number[][]): number {
    const n = xs[0]?.length ?? 0
    if (n === 0 || xs.length === 0) return 0

    const X: number[][] = Array.from({ length: n }, (_, i) => [1, ...xs.map((col) => col[i])])
    const XT = transposeMatrix(X)
    const XTX = matMul(XT, X)
    // Функция XTy
    const XTy = XT.map((row) => row.reduce((s, v, i) => s + v * y[i], 0))
    const XTXinv = invertMatrix(XTX)
    if (!XTXinv) return 0
    // Функция beta
    const beta = XTXinv.map((row) => row.reduce((s, v, i) => s + v * XTy[i], 0))

    const yMean = mean(y)
    let ssTot = 0, ssRes = 0
    for (let i = 0; i < n; i++) {
        // Функция yHat
        const yHat = X[i].reduce((s, v, j) => s + v * beta[j], 0)
        ssRes += (y[i] - yHat) ** 2
        ssTot += (y[i] - yMean) ** 2
    }
    if (ssTot === 0) return 0
    return Math.max(0, 1 - ssRes / ssTot)
}

// Функция transposeMatrix

function transposeMatrix(m: number[][]): number[][] {
    return m[0].map((_, j) => m.map((row) => row[j]))
}

// Функция matMul

function matMul(a: number[][], b: number[][]): number[][] {
    const rows = a.length
    const cols = b[0].length
    const inner = b.length
    return Array.from({ length: rows }, (_, i) =>
        Array.from({ length: cols }, (_, j) =>
            Array.from({ length: inner }, (_, k) => a[i][k] * b[k][j]).reduce((s, v) => s + v, 0)
        )
    )
}

// Функция invertMatrix

function invertMatrix(m: number[][]): number[][] | null {
    const n = m.length

    // Функция aug

    const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
    for (let col = 0; col < n; col++) {
        let pivot = col
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(aug[row][col]) > Math.abs(aug[pivot][col])) pivot = row
        }
        ;[aug[col], aug[pivot]] = [aug[pivot], aug[col]]
        const d = aug[col][col]
        if (Math.abs(d) < 1e-12) return null
        for (let k = 0; k < 2 * n; k++) aug[col][k] /= d
        for (let row = 0; row < n; row++) {
            if (row === col) continue
            const f = aug[row][col]
            for (let k = 0; k < 2 * n; k++) aug[row][k] -= f * aug[col][k]
        }
    }
    return aug.map((row) => row.slice(n))
}



// Проверяет numeric type



function isNumericType(t: ColumnType): boolean {
    return t === 'number'
}

// Проверяет categorical type

function isCategoricalType(t: ColumnType): boolean {
    return t === 'string'
}

export type BasicStats = { quality: DataQuality; columns: ColStats[] }
export type CorrStats = {
    correlation: CorrelationMatrix | null
    cramersV: CramersVMatrix | null
    vif: VIFResult[]
}

export function computeBasicStats(rows: ParsedRow[], columns: ColumnConfig[]): BasicStats {
    const totalRows = rows.length
    const totalCols = columns.length

    if (totalRows === 0) {
        return {
            quality: {
                totalRows: 0, totalCols, duplicateRows: 0, duplicateRowsPct: 0,
                missingCells: 0, missingCellsPct: 0, missingByCol: {}, highMissingCols: [], constantOrIdCols: [],
            },
            columns: [],
        }
    }

    const missingByCol: Record<string, number> = {}
    let totalMissing = 0
    for (const col of columns) {
        const miss = rows.filter((r) => r[col.field] == null || r[col.field] === '').length
        missingByCol[col.field] = miss
        totalMissing += miss
    }

    const rowKeys = rows.map((r) => columns.map((c) => String(r[c.field] ?? '')).join('\x00'))
    const seenKeys = new Set<string>()
    let duplicateRows = 0
    for (const key of rowKeys) {
        if (seenKeys.has(key)) duplicateRows++
        else seenKeys.add(key)
    }

    const highMissingCols = columns.filter((c) => (missingByCol[c.field] ?? 0) / totalRows > 0.5).map((c) => c.field)
    const constantOrIdCols = columns.filter((c) => {
        const uniq = new Set(rows.map((r) => String(r[c.field] ?? ''))).size
        return uniq === 1 || uniq === totalRows
    }).map((c) => c.field)

    const quality: DataQuality = {
        totalRows, totalCols, duplicateRows,
        duplicateRowsPct: duplicateRows / totalRows,
        missingCells: totalMissing,
        missingCellsPct: totalMissing / (totalRows * totalCols),
        missingByCol, highMissingCols, constantOrIdCols,
    }

    const colStats: ColStats[] = columns.map((col) => {
        const missing = missingByCol[col.field] ?? 0
        const missingPct = missing / totalRows
        const rawValues = rows.map((r) => r[col.field])

        if (isNumericType(col.type)) {
            const nums: number[] = rawValues
                .filter((v) => v != null && v !== '' && !Number.isNaN(Number(v)))
                .map(Number)
            const n = nums.length
            if (n === 0) {
                return {
                    kind: 'numeric', field: col.field, colType: col.type,
                    n: 0, missing, missingPct,
                    mean: NaN, median: NaN, std: NaN, variance: NaN, iqr: NaN,
                    min: NaN, max: NaN, p5: NaN, p25: NaN, p75: NaN, p95: NaN,
                    skewness: NaN, kurtosis: NaN, outliersCount: 0,
                    histogram: [], boxplot: { min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, wLow: NaN, wHigh: NaN, outliers: [] },
                } as NumericColStats
            }
            const sorted = sortedNums(nums)
            const mu = mean(nums)
            const s = std(nums)
            const q1 = quantile(sorted, 0.25)
            const q3 = quantile(sorted, 0.75)
            const iqr = q3 - q1
            const wLow = q1 - 1.5 * iqr
            const wHigh = q3 + 1.5 * iqr
            const outliersCount = nums.filter((v) => v < wLow || v > wHigh).length
            return {
                kind: 'numeric', field: col.field, colType: col.type, n, missing, missingPct,
                mean: mu, median: quantile(sorted, 0.5), std: s, variance: variance(nums, mu),
                iqr, min: sorted[0], max: sorted[sorted.length - 1],
                p5: quantile(sorted, 0.05), p25: q1, p75: q3, p95: quantile(sorted, 0.95),
                skewness: skewness(nums), kurtosis: kurtosis(nums), outliersCount,
                histogram: histogram(nums), boxplot: boxplot(nums),
            } as NumericColStats
        } else {
            const strs: string[] = rawValues.filter((v) => v != null && v !== '').map((v) => String(v))
            const n = strs.length
            const freq = new Map<string, number>()
            for (const v of strs) freq.set(v, (freq.get(v) ?? 0) + 1)
            const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
            const topValues: FrequencyEntry[] = sorted.slice(0, 10).map(([value, count]) => ({ value, count, pct: n > 0 ? count / n : 0 }))
            const rareThreshold = Math.max(1, n * 0.01)
            const rareCount = [...freq.values()].filter((c) => c < rareThreshold).length
            const mode = sorted[0]?.[0] ?? ''
            const modePct = n > 0 ? (sorted[0]?.[1] ?? 0) / n : 0
            return {
                kind: 'categorical', field: col.field, colType: col.type, n, missing, missingPct,
                unique: freq.size, topValues, rareCount, mode, modePct,
                histogram: sorted.slice(0, 20).map(([value, count]) => ({ value, count, pct: n > 0 ? count / n : 0 })),
            } as CategoricalColStats
        }
    })

    return { quality, columns: colStats }
}

export function computeCorrelationStats(rows: ParsedRow[], columns: ColumnConfig[]): CorrStats {
    if (rows.length === 0) return { correlation: null, cramersV: null, vif: [] }

    const numericCols = columns.filter((c) => isNumericType(c.type))
    let correlation: CorrelationMatrix | null = null
    if (numericCols.length >= 2) {
        const fields = numericCols.map((c) => c.field)
        const n = fields.length
        const pearsonMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
        const spearmanMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
        const pearsonPMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(NaN))
        const spearmanPMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(NaN))
        const nPairsMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
        for (let i = 0; i < n; i++) {
            pearsonMat[i][i] = 1; spearmanMat[i][i] = 1
            for (let j = i + 1; j < n; j++) {
                const rawI = rows.map((r) => r[numericCols[i].field])
                const rawJ = rows.map((r) => r[numericCols[j].field])
                const paired: [number, number][] = []
                for (let k = 0; k < rows.length; k++) {
                    const a = rawI[k], b = rawJ[k]
                    if (a != null && a !== '' && b != null && b !== '') {
                        const na = Number(a), nb = Number(b)
                        if (!Number.isNaN(na) && !Number.isNaN(nb)) paired.push([na, nb])
                    }
                }
                const xs = paired.map((p) => p[0])
                const ys = paired.map((p) => p[1])
                const pv = pearson(xs, ys), sv = spearman(xs, ys), np = paired.length
                pearsonMat[i][j] = pearsonMat[j][i] = pv
                spearmanMat[i][j] = spearmanMat[j][i] = sv
                pearsonPMat[i][j] = pearsonPMat[j][i] = corrPValue(pv, np)
                spearmanPMat[i][j] = spearmanPMat[j][i] = corrPValue(sv, np)
                nPairsMat[i][j] = nPairsMat[j][i] = np
            }
        }
        correlation = { fields, pearson: pearsonMat, spearman: spearmanMat, pearsonP: pearsonPMat, spearmanP: spearmanPMat, nPairs: nPairsMat }
    }

    const catCols = columns.filter((c) => isCategoricalType(c.type))
    let cramersVMatrix: CramersVMatrix | null = null
    if (catCols.length >= 2) {
        const fields = catCols.map((c) => c.field)
        const n = fields.length
        const mat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(1))
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = rows.map((r) => String(r[catCols[i].field] ?? ''))
                const b = rows.map((r) => String(r[catCols[j].field] ?? ''))
                const v = cramersV(a, b)
                mat[i][j] = mat[j][i] = v
            }
        }
        cramersVMatrix = { fields, matrix: mat }
    }

    let vifResults: VIFResult[] = []
    if (numericCols.length >= 2) {
        const validRows = rows.filter((r) => numericCols.every((c) => {
            const v = r[c.field]; return v != null && v !== '' && !Number.isNaN(Number(v))
        }))
        const colVectors = numericCols.map((c) => validRows.map((r) => Number(r[c.field])))
        vifResults = numericCols.map((col, idx) => {
            const y = colVectors[idx]
            const xs = colVectors.filter((_, i) => i !== idx)
            if (xs.length === 0) return { field: col.field, vif: 1 }
            const r2 = olsR2(y, xs)
            return { field: col.field, vif: Math.min(r2 >= 1 ? Infinity : 1 / (1 - r2), 9999) }
        })
    }

    return { correlation, cramersV: cramersVMatrix, vif: vifResults }
}

// Вычисляет stats

export function computeStats(
    rows: ParsedRow[],
    columns: ColumnConfig[],
): DatasetStats {
    const totalRows = rows.length
    const totalCols = columns.length

    if (totalRows === 0) {
        return {
            quality: {
                totalRows: 0, totalCols, duplicateRows: 0, duplicateRowsPct: 0,
                missingCells: 0, missingCellsPct: 0, missingByCol: {}, highMissingCols: [], constantOrIdCols: [],
            },
            columns: [],
            correlation: null,
            cramersV: null,
            vif: [],
        }
    }


    const missingByCol: Record<string, number> = {}
    let totalMissing = 0
    for (const col of columns) {
        // Функция miss
        const miss = rows.filter((r) => r[col.field] == null || r[col.field] === '').length
        missingByCol[col.field] = miss
        totalMissing += miss
    }


    // Функция rowKeys


    const rowKeys = rows.map((r) =>
        columns.map((c) => String(r[c.field] ?? '')).join('\x00')
    )
    const seenKeys = new Set<string>()
    let duplicateRows = 0
    for (const key of rowKeys) {
        if (seenKeys.has(key)) duplicateRows++
        else seenKeys.add(key)
    }

    const highMissingCols = columns
        .filter((c) => (missingByCol[c.field] ?? 0) / totalRows > 0.5)
        .map((c) => c.field)

    // Функция constantOrIdCols

    const constantOrIdCols = columns.filter((c) => {
        // Функция uniq
        const uniq = new Set(rows.map((r) => String(r[c.field] ?? ''))).size
        return uniq === 1 || uniq === totalRows
    }).map((c) => c.field)

    const quality: DataQuality = {
        totalRows,
        totalCols,
        duplicateRows,
        duplicateRowsPct: duplicateRows / totalRows,
        missingCells: totalMissing,
        missingCellsPct: totalMissing / (totalRows * totalCols),
        missingByCol,
        highMissingCols,
        constantOrIdCols,
    }


    const colStats: ColStats[] = columns.map((col) => {
        const missing = missingByCol[col.field] ?? 0
        const missingPct = missing / totalRows
        // Функция rawValues
        const rawValues = rows.map((r) => r[col.field])

        if (isNumericType(col.type)) {
            const nums: number[] = rawValues
                .filter((v) => v != null && v !== '' && !Number.isNaN(Number(v)))
                .map(Number)
            const n = nums.length
            if (n === 0) {
                return {
                    kind: 'numeric', field: col.field, colType: col.type,
                    n: 0, missing, missingPct,
                    mean: NaN, median: NaN, std: NaN, variance: NaN, iqr: NaN,
                    min: NaN, max: NaN, p5: NaN, p25: NaN, p75: NaN, p95: NaN,
                    skewness: NaN, kurtosis: NaN, outliersCount: 0,
                    histogram: [], boxplot: { min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, wLow: NaN, wHigh: NaN, outliers: [] },
                } as NumericColStats
            }
            const sorted = sortedNums(nums)
            const mu = mean(nums)
            const s = std(nums)
            const q1 = quantile(sorted, 0.25)
            const q3 = quantile(sorted, 0.75)
            const iqr = q3 - q1
            const wLow = q1 - 1.5 * iqr
            const wHigh = q3 + 1.5 * iqr
            // Функция outliersCount
            const outliersCount = nums.filter((v) => v < wLow || v > wHigh).length

            return {
                kind: 'numeric',
                field: col.field,
                colType: col.type,
                n,
                missing,
                missingPct,
                mean: mu,
                median: quantile(sorted, 0.5),
                std: s,
                variance: variance(nums, mu),
                iqr,
                min: sorted[0],
                max: sorted[sorted.length - 1],
                p5: quantile(sorted, 0.05),
                p25: q1,
                p75: q3,
                p95: quantile(sorted, 0.95),
                skewness: skewness(nums),
                kurtosis: kurtosis(nums),
                outliersCount,
                histogram: histogram(nums),
                boxplot: boxplot(nums),
            } as NumericColStats
        } else {

            const strs: string[] = rawValues
                .filter((v) => v != null && v !== '')
                .map((v) => String(v))
            const n = strs.length

            const freq = new Map<string, number>()
            for (const v of strs) freq.set(v, (freq.get(v) ?? 0) + 1)
            // Функция sorted
            const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
            const topValues: FrequencyEntry[] = sorted.slice(0, 10).map(([value, count]) => ({
                value,
                count,
                pct: n > 0 ? count / n : 0,
            }))
            const rareThreshold = Math.max(1, n * 0.01)
            // Функция rareCount
            const rareCount = [...freq.values()].filter((c) => c < rareThreshold).length
            const mode = sorted[0]?.[0] ?? ''
            const modePct = n > 0 ? (sorted[0]?.[1] ?? 0) / n : 0

            return {
                kind: 'categorical',
                field: col.field,
                colType: col.type,
                n,
                missing,
                missingPct,
                unique: freq.size,
                topValues,
                rareCount,
                mode,
                modePct,
                histogram: sorted.slice(0, 20).map(([value, count]) => ({
                    value,
                    count,
                    pct: n > 0 ? count / n : 0,
                })),
            } as CategoricalColStats
        }
    })


    // Функция numericCols


    const numericCols = columns.filter((c) => isNumericType(c.type))
    let correlation: CorrelationMatrix | null = null

    if (numericCols.length >= 2) {
        // Функция fields

        const fields = numericCols.map((c) => c.field)
        const n = fields.length
        const pearsonMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
        const spearmanMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
        const pearsonPMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(NaN))
        const spearmanPMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(NaN))
        const nPairsMat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))

        for (let i = 0; i < n; i++) {
            pearsonMat[i][i] = 1
            spearmanMat[i][i] = 1
            for (let j = i + 1; j < n; j++) {

                // Функция rawI

                const rawI = rows.map((r) => r[numericCols[i].field])
                // Функция rawJ
                const rawJ = rows.map((r) => r[numericCols[j].field])
                const paired: [number, number][] = []
                for (let k = 0; k < rows.length; k++) {
                    const a = rawI[k], b = rawJ[k]
                    if (a != null && a !== '' && b != null && b !== '') {
                        const na = Number(a), nb = Number(b)
                        if (!Number.isNaN(na) && !Number.isNaN(nb)) paired.push([na, nb])
                    }
                }
                // Функция xs
                const xs = paired.map((p) => p[0])
                // Функция ys
                const ys = paired.map((p) => p[1])
                const pv = pearson(xs, ys)
                const sv = spearman(xs, ys)
                const np = paired.length
                pearsonMat[i][j] = pearsonMat[j][i] = pv
                spearmanMat[i][j] = spearmanMat[j][i] = sv
                pearsonPMat[i][j] = pearsonPMat[j][i] = corrPValue(pv, np)
                spearmanPMat[i][j] = spearmanPMat[j][i] = corrPValue(sv, np)
                nPairsMat[i][j] = nPairsMat[j][i] = np
            }
        }
        correlation = {
            fields,
            pearson: pearsonMat,
            spearman: spearmanMat,
            pearsonP: pearsonPMat,
            spearmanP: spearmanPMat,
            nPairs: nPairsMat,
        }
    }


    // Функция catCols


    const catCols = columns.filter((c) => isCategoricalType(c.type))
    let cramersVMatrix: CramersVMatrix | null = null

    if (catCols.length >= 2) {
        // Функция fields
        const fields = catCols.map((c) => c.field)
        const n = fields.length
        const mat: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(1))
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                // Функция a
                const a = rows.map((r) => String(r[catCols[i].field] ?? ''))
                // Функция b
                const b = rows.map((r) => String(r[catCols[j].field] ?? ''))
                const v = cramersV(a, b)
                mat[i][j] = mat[j][i] = v
            }
        }
        cramersVMatrix = { fields, matrix: mat }
    }


    let vifResults: VIFResult[] = []
    if (numericCols.length >= 2) {

        // Функция validRows

        const validRows = rows.filter((r) =>
            numericCols.every((c) => {
                const v = r[c.field]
                return v != null && v !== '' && !Number.isNaN(Number(v))
            })
        )
        // Функция colVectors
        const colVectors = numericCols.map((c) => validRows.map((r) => Number(r[c.field])))

        vifResults = numericCols.map((col, idx) => {
            const y = colVectors[idx]
            // Функция xs
            const xs = colVectors.filter((_, i) => i !== idx)
            if (xs.length === 0) return { field: col.field, vif: 1 }
            const r2 = olsR2(y, xs)
            const vif = r2 >= 1 ? Infinity : 1 / (1 - r2)
            return { field: col.field, vif: Math.min(vif, 9999) }
        })
    }

    return {
        quality,
        columns: colStats,
        correlation,
        cramersV: cramersVMatrix,
        vif: vifResults,
    }
}
