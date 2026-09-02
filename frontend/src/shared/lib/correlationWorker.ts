import type { ColumnConfig, ParsedRow } from '@shared/types'

interface PreparedWorkerInput {
    numericData: Record<string, Float64Array>
    numericFields: string[]
    catData: Record<string, string[]>
    catFields: string[]
}

interface RawWorkerInput {
    rows: ParsedRow[]
    columns: Pick<ColumnConfig, 'field' | 'type'>[]
}

type WorkerInput = PreparedWorkerInput | RawWorkerInput

export interface CorrWorkerOutput {
    correlation: { fields: string[]; pearson: number[][]; spearman: number[][] } | null
    cramersV: { fields: string[]; matrix: number[][] } | null
    vif: { field: string; vif: number | null; tolerance?: number | null }[]
    multicollinearity: {
        conditionNumber: number | null
        eigenvalues: number[]
        conditionIndices: number[]
        fields: string[]
    } | null
}

// Pearson on Float64Arrays directly — zero intermediate arrays, O(1) extra memory
function pearsonFloat64(a: Float64Array, b: Float64Array): number {
    const n = Math.min(a.length, b.length)
    let count = 0, sa = 0, sb = 0
    for (let i = 0; i < n; i++) if (!isNaN(a[i]) && !isNaN(b[i])) { count++; sa += a[i]; sb += b[i] }
    if (count < 3) return NaN
    const ma = sa / count, mb = sb / count
    let num = 0, da2 = 0, db2 = 0
    for (let i = 0; i < n; i++) {
        if (!isNaN(a[i]) && !isNaN(b[i])) {
            const da = a[i] - ma, db = b[i] - mb
            num += da * db; da2 += da * da; db2 += db * db
        }
    }
    const d = Math.sqrt(da2 * db2)
    return d < 1e-12 ? 0 : num / d
}

// Rank a Float64Array once — NaN stays NaN, valid values get ranks with tie averaging
function rankFloat64(arr: Float64Array): Float64Array {
    const n = arr.length
    const validIdx: number[] = []
    for (let i = 0; i < n; i++) if (!isNaN(arr[i])) validIdx.push(i)
    validIdx.sort((a, b) => arr[a] - arr[b])
    const ranks = new Float64Array(n).fill(NaN)
    let i = 0
    while (i < validIdx.length) {
        let j = i
        while (j < validIdx.length - 1 && arr[validIdx[j + 1]] === arr[validIdx[i]]) j++
        const avg = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) ranks[validIdx[k]] = avg
        i = j + 1
    }
    return ranks
}

function cramersV(col1: string[], col2: string[]): number {
    const n = col1.length
    if (n === 0) return NaN
    const cats1 = [...new Set(col1)], cats2 = [...new Set(col2)]
    if (cats1.length < 2 || cats2.length < 2) return 0
    const ri: Record<string, number> = {}, ci: Record<string, number> = {}
    cats1.forEach((v, i) => { ri[v] = i })
    cats2.forEach((v, i) => { ci[v] = i })
    const nr = cats1.length, nc = cats2.length
    const tbl = Array.from({ length: nr }, () => new Array<number>(nc).fill(0))
    const rowT = new Array<number>(nr).fill(0), colT = new Array<number>(nc).fill(0)
    for (let k = 0; k < n; k++) {
        const r = ri[col1[k]], c = ci[col2[k]]
        if (r !== undefined && c !== undefined) { tbl[r][c]++; rowT[r]++; colT[c]++ }
    }
    let chi2 = 0
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
        const exp = rowT[r] * colT[c] / n
        if (exp > 0) { const d = tbl[r][c] - exp; chi2 += d * d / exp }
    }
    const k = Math.min(nr - 1, nc - 1)
    return k <= 0 ? 0 : Math.min(1, Math.sqrt(chi2 / (n * k)))
}

function invertMatrix(m: number[][]): number[][] | null {
    const n = m.length
    const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => +(i === j))])
    for (let col = 0; col < n; col++) {
        let p = col
        for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[p][col])) p = row
        if (Math.abs(a[p][col]) < 1e-10) return null
        ;[a[col], a[p]] = [a[p], a[col]]
        const sc = a[col][col]
        for (let j = col; j < 2 * n; j++) a[col][j] /= sc
        for (let row = 0; row < n; row++) {
            if (row === col) continue
            const f = a[row][col]
            for (let j = col; j < 2 * n; j++) a[row][j] -= f * a[col][j]
        }
    }
    return a.map(row => row.slice(n))
}

// Jacobi eigenvalue algorithm for symmetric matrices — returns eigenvalues descending
function symmetricEigenvalues(A: number[][]): number[] {
    const n = A.length
    const a = A.map(row => [...row])
    for (let iter = 0; iter < 100 * n * n; iter++) {
        let maxVal = 0, p = 0, q = 1
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
            if (Math.abs(a[i][j]) > maxVal) { maxVal = Math.abs(a[i][j]); p = i; q = j }
        }
        if (maxVal < 1e-10) break
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(1 + t * t), s = t * c
        const app = a[p][p], aqq = a[q][q], apq = a[p][q]
        a[p][p] = app - t * apq
        a[q][q] = aqq + t * apq
        a[p][q] = a[q][p] = 0
        for (let r = 0; r < n; r++) {
            if (r === p || r === q) continue
            const arp = a[r][p], arq = a[r][q]
            a[r][p] = a[p][r] = c * arp - s * arq
            a[r][q] = a[q][r] = s * arp + c * arq
        }
    }
    return Array.from({ length: n }, (_, i) => a[i][i]).sort((x, y) => y - x)
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
    let numericData: Record<string, Float64Array>
    let numericFields: string[]
    let catData: Record<string, string[]>
    let catFields: string[]

    if ('rows' in e.data) {
        const { rows, columns } = e.data
        numericFields = columns.filter((c) => c.type === 'number').map((c) => c.field)
        catFields = columns.filter((c) => c.type !== 'number').map((c) => c.field)

        numericData = {}
        for (const field of numericFields) {
            const arr = new Float64Array(rows.length)
            for (let i = 0; i < rows.length; i++) {
                const v = rows[i][field]
                arr[i] = (v != null && v !== '') ? Number(v) : NaN
            }
            numericData[field] = arr
        }

        catData = {}
        for (const field of catFields) {
            const arr = new Array<string>(rows.length)
            for (let i = 0; i < rows.length; i++) {
                arr[i] = String(rows[i][field] ?? '')
            }
            catData[field] = arr
        }
    } else {
        ;({ numericData, numericFields, catData, catFields } = e.data)
    }

    let correlation: CorrWorkerOutput['correlation'] = null
    if (numericFields.length >= 2) {
        const nf = numericFields.length

        // Pre-rank each column once — O(n log n) × nf instead of O(n log n) × pairs × 2
        const rankedData: Record<string, Float64Array> = {}
        for (const field of numericFields) rankedData[field] = rankFloat64(numericData[field])

        const pearson: number[][] = Array.from({ length: nf }, (_, i) => Array.from({ length: nf }, (_, j) => i === j ? 1 : 0))
        const spearman: number[][] = Array.from({ length: nf }, (_, i) => Array.from({ length: nf }, (_, j) => i === j ? 1 : 0))

        for (let i = 0; i < nf; i++) for (let j = i + 1; j < nf; j++) {
            const fi = numericFields[i], fj = numericFields[j]
            // Pearson: O(1) extra memory, two passes over Float64Arrays
            const p = pearsonFloat64(numericData[fi], numericData[fj])
            // Spearman: uses pre-computed ranks, same O(1) extra memory
            const s = pearsonFloat64(rankedData[fi], rankedData[fj])
            pearson[i][j] = pearson[j][i] = isNaN(p) ? 0 : +p.toFixed(8)
            spearman[i][j] = spearman[j][i] = isNaN(s) ? 0 : +s.toFixed(8)
        }
        correlation = { fields: numericFields, pearson, spearman }
    }

    let cramersVResult: CorrWorkerOutput['cramersV'] = null
    if (catFields.length >= 2) {
        const nc = catFields.length
        const matrix: number[][] = Array.from({ length: nc }, (_, i) => Array.from({ length: nc }, (_, j) => i === j ? 1 : 0))
        for (let i = 0; i < nc; i++) for (let j = i + 1; j < nc; j++) {
            const v = cramersV(catData[catFields[i]], catData[catFields[j]])
            matrix[i][j] = matrix[j][i] = isNaN(v) ? 0 : +v.toFixed(8)
        }
        cramersVResult = { fields: catFields, matrix }
    }

    let vif: CorrWorkerOutput['vif'] = []
    let multicollinearity: CorrWorkerOutput['multicollinearity'] = null
    if (correlation && correlation.fields.length >= 2) {
        const inv = invertMatrix(correlation.pearson.map(r => [...r]))
        vif = correlation.fields.map((f, i) => {
            const v = inv ? +Math.min(inv[i][i], 9999).toFixed(2) : null
            return { field: f, vif: v, tolerance: v != null && v > 0 ? +( 1 / v).toFixed(4) : null }
        })

        const eigs = symmetricEigenvalues(correlation.pearson.map(r => [...r]))
        const lambdaMax = eigs[0]
        const lambdaMin = eigs[eigs.length - 1]
        const condNum = lambdaMin > 1e-10 ? +(Math.sqrt(lambdaMax / lambdaMin)).toFixed(2) : null
        const condIndices = eigs.map(ev => ev > 1e-10 ? +(Math.sqrt(lambdaMax / ev)).toFixed(2) : null).filter((v): v is number => v !== null)
        multicollinearity = {
            conditionNumber: condNum,
            eigenvalues: eigs.map(v => +v.toFixed(4)),
            conditionIndices: condIndices,
            fields: correlation.fields,
        }
    }

    self.postMessage({ correlation, cramersV: cramersVResult, vif, multicollinearity } as CorrWorkerOutput)
}
