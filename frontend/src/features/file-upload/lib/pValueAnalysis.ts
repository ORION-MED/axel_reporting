import type { ParsedRow } from '@shared/types'



export interface UnivariateResult {
    field: string
    colType: string
    testName: string
    stat: number
    pValue: number
    pAdj: number
    n: number
    note?: string
}

export interface NormalityResult {
    field: string
    n: number
    skewness: number
    kurtosis: number
    stat: number
    pValue: number
    isNormal: boolean
    note?: string
}

export interface PairwisePValue {
    fields: string[]
    pMatrix: number[][]
    testMatrix: string[][]
    nMatrix: number[][]
}


function mean(xs: number[]): number {
    if (!xs.length) return NaN
    return xs.reduce((a, b) => a + b, 0) / xs.length
}

function variance(xs: number[]): number {
    if (xs.length < 2) return NaN
    const m = mean(xs)
    return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
}

function rankArray(arr: number[]): number[] {
    const n = arr.length
    const idx: number[] = Array.from({ length: n }, (_, i) => i)
    idx.sort((a, b) => arr[a] - arr[b])
    const ranks = new Array<number>(n)
    let i = 0
    while (i < n) {
        let j = i
        while (j < n - 1 && arr[idx[j + 1]] === arr[idx[i]]) j++
        const rank = (i + j) / 2 + 1
        for (let k = i; k <= j; k++) ranks[idx[k]] = rank
        i = j + 1
    }
    return ranks
}

function lgamma(x: number): number {
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ]
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
    x -= 1
    let a = c[0]
    const t = x + 7.5
    for (let i = 1; i < 9; i++) a += c[i] / (x + i)
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

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

function corrPValue(r: number, n: number): number {
    if (n < 3 || !isFinite(r) || isNaN(r)) return NaN
    if (Math.abs(r) >= 1) return 0
    const t = r * Math.sqrt(n - 2) / Math.sqrt(1 - r * r)
    const df = n - 2
    return betaIncI(df / (df + t * t), df / 2, 0.5)
}

function erfc(x: number): number {
    const t = 1 / (1 + 0.3275911 * Math.abs(x))
    const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
    const r = p * Math.exp(-x * x)
    return x >= 0 ? r : 2 - r
}

function normalSF(z: number) { return 0.5 * erfc(z / Math.SQRT2) }
function normalPV2(z: number) { return 2 * normalSF(Math.abs(z)) }

function chi2PValue(x: number, df: number): number {
    if (!isFinite(x) || x < 0 || df <= 0) return NaN
    if (x === 0) return 1
    const z = (Math.pow(x / df, 1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df))
    return normalSF(z)
}

function pearsonR(xs: number[], ys: number[]): number {
    const n = xs.length
    if (n < 2) return NaN
    const mx = mean(xs), my = mean(ys)
    let num = 0, dx2 = 0, dy2 = 0
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my
        num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
    }
    const den = Math.sqrt(dx2 * dy2)
    return den === 0 ? 0 : num / den
}

function spearmanR(xs: number[], ys: number[]): number {
    if (xs.length < 2) return NaN
    return pearsonR(rankArray(xs), rankArray(ys))
}

function kruskalWallis(groups: number[][]): { H: number; df: number; p: number } {
    const all = groups.flatMap((g) => g)
    const N = all.length
    const df = groups.length - 1
    if (N < 3 || df < 1) return { H: NaN, df, p: NaN }
    const ranks = rankArray(all)
    let pos = 0
    const H = (12 / (N * (N + 1))) *
        groups.reduce((s, g) => {
            let rs = 0
            for (let i = 0; i < g.length; i++) rs += ranks[pos++]
            return s + rs ** 2 / g.length
        }, 0) - 3 * (N + 1)
    return { H, df, p: chi2PValue(H, df) }
}

function mannWhitney(xs: number[], ys: number[]): { U: number; Z: number; p: number } {
    const n1 = xs.length, n2 = ys.length
    if (n1 < 1 || n2 < 1) return { U: NaN, Z: NaN, p: NaN }
    const all = [...xs, ...ys]
    const ranks = rankArray(all)
    let R1 = 0
    for (let i = 0; i < n1; i++) R1 += ranks[i]
    const U1 = R1 - n1 * (n1 + 1) / 2
    const U2 = n1 * n2 - U1
    const U = Math.min(U1, U2)
    const Z = (U - n1 * n2 / 2) / Math.sqrt(n1 * n2 * (n1 + n2 + 1) / 12)
    return { U, Z, p: normalPV2(Z) }
}

// Welch's t-test (two-tailed, unequal variances)
function welchT(xs: number[], ys: number[]): { t: number; df: number; p: number } {
    const n1 = xs.length, n2 = ys.length
    if (n1 < 2 || n2 < 2) return { t: NaN, df: NaN, p: NaN }
    const m1 = mean(xs), m2 = mean(ys)
    const v1 = variance(xs), v2 = variance(ys)
    const se2 = v1 / n1 + v2 / n2
    if (se2 < 1e-14) return { t: 0, df: n1 + n2 - 2, p: 1 }
    const t = (m1 - m2) / Math.sqrt(se2)
    const df = se2 ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
    const p = betaIncI(df / (df + t * t), df / 2, 0.5)
    return { t, df, p }
}

// One-way ANOVA (assumes equal variances)
function oneWayAnova(groups: number[][]): { F: number; p: number } {
    const k = groups.length
    const N = groups.reduce((s, g) => s + g.length, 0)
    if (k < 2 || N <= k) return { F: NaN, p: NaN }
    const grandMean = mean(groups.flatMap(g => g))
    const ssBetween = groups.reduce((s, g) => s + g.length * (mean(g) - grandMean) ** 2, 0)
    const ssWithin = groups.reduce((s, g) => {
        const gm = mean(g)
        return s + g.reduce((ss, x) => ss + (x - gm) ** 2, 0)
    }, 0)
    const df1 = k - 1, df2 = N - k
    if (ssWithin < 1e-10 || df2 < 1) return { F: NaN, p: NaN }
    const F = (ssBetween / df1) / (ssWithin / df2)
    // F-distribution upper tail: I(df2/(df2+df1*F); df2/2; df1/2)
    const p = betaIncI(df2 / (df2 + df1 * F), df2 / 2, df1 / 2)
    return { F, p }
}

// Fisher's exact test for 2×2 contingency tables (hypergeometric p-value, two-tailed)
function fisherExact2x2(a: number, b: number, c: number, d: number): number {
    const r1 = a + b, c1 = a + c, N = a + b + c + d
    if (N < 1) return NaN
    const kMin = Math.max(0, r1 + c1 - N), kMax = Math.min(c1, r1)
    // log C(N,r1) denominator
    const logDenom = lgamma(N + 1) - lgamma(r1 + 1) - lgamma(N - r1 + 1)
    function logHyper(k: number): number {
        return (lgamma(c1 + 1) - lgamma(k + 1) - lgamma(c1 - k + 1))
             + (lgamma(N - c1 + 1) - lgamma(r1 - k + 1) - lgamma(N - c1 - r1 + k + 1))
             - logDenom
    }
    const logPObs = logHyper(a)
    let p = 0
    for (let k = kMin; k <= kMax; k++) {
        const lp = logHyper(k)
        if (lp <= logPObs + 1e-10) p += Math.exp(lp)
    }
    return Math.min(1, p)
}

// Kendall's τ-b with ties correction (sampled to MAX_N points for performance)
function kendallTauB(xs: number[], ys: number[]): { tau: number; p: number } {
    const MAX_N = 3000
    const n = xs.length
    if (n < 4) return { tau: NaN, p: NaN }
    let sx = xs, sy = ys
    if (n > MAX_N) {
        const step = Math.ceil(n / MAX_N)
        sx = []; sy = []
        for (let i = 0; i < n; i += step) { sx.push(xs[i]); sy.push(ys[i]) }
    }
    const m = sx.length
    let con = 0, dis = 0, tx = 0, ty = 0
    for (let i = 0; i < m - 1; i++) {
        for (let j = i + 1; j < m; j++) {
            const dx = sx[i] - sx[j], dy = sy[i] - sy[j]
            if (dx === 0 && dy === 0) continue
            if (dx === 0) ty++
            else if (dy === 0) tx++
            else { if (dx * dy > 0) con++; else dis++ }
        }
    }
    const n0 = m * (m - 1) / 2
    const denom = Math.sqrt((n0 - tx) * (n0 - ty))
    const tau = denom < 1e-10 ? 0 : (con - dis) / denom
    const v0 = m * (m - 1) * (2 * m + 5)
    const z = Math.abs(con - dis) / Math.sqrt(v0 / 18)
    return { tau, p: normalPV2(z) }
}

// Jarque-Bera normality test (based on skewness and excess kurtosis, χ²(2) approximation)
function jarqueBera(xs: number[]): { stat: number; p: number; skewness: number; kurtosis: number } {
    const n = xs.length
    const m = mean(xs)
    let s2 = 0, s3 = 0, s4 = 0
    for (const x of xs) {
        const d = x - m
        s2 += d * d; s3 += d ** 3; s4 += d ** 4
    }
    const v = s2 / n
    if (v < 1e-10) return { stat: NaN, p: NaN, skewness: NaN, kurtosis: NaN }
    const skew = s3 / n / v ** 1.5
    const kurt = s4 / n / v ** 2 - 3
    const stat = n / 6 * (skew ** 2 + kurt ** 2 / 4)
    return { stat, p: chi2PValue(stat, 2), skewness: skew, kurtosis: kurt }
}

// χ² or Fisher's exact (auto-switches for 2×2 with small expected frequencies)
function chiSquareOrFisher(xs: string[], ys: string[]): { stat: number; df: number; p: number; note?: string; testName: string } {
    const n = xs.length
    const xMap = new Map<string, number>()
    const yMap = new Map<string, number>()
    for (const v of xs) if (!xMap.has(v)) xMap.set(v, xMap.size)
    for (const v of ys) if (!yMap.has(v)) yMap.set(v, yMap.size)
    const xLen = xMap.size, yLen = yMap.size
    const obs: number[][] = Array.from({ length: xLen }, () => new Array<number>(yLen).fill(0))
    for (let i = 0; i < n; i++) obs[xMap.get(xs[i])!][yMap.get(ys[i])!]++
    const rowSums = obs.map((r) => r.reduce((a, b) => a + b, 0))
    const colSums = Array.from({ length: yLen }, (_, j) => obs.reduce((s, r) => s + r[j], 0))
    let chi2 = 0, hasSmall = false
    for (let i = 0; i < xLen; i++) {
        for (let j = 0; j < yLen; j++) {
            const E = rowSums[i] * colSums[j] / n
            if (E < 5) hasSmall = true
            if (E > 0) chi2 += (obs[i][j] - E) ** 2 / E
        }
    }
    const df = (xLen - 1) * (yLen - 1)
    if (xLen === 2 && yLen === 2 && hasSmall) {
        const p = fisherExact2x2(obs[0][0], obs[0][1], obs[1][0], obs[1][1])
        return { stat: chi2, df: 1, p, testName: "Fisher's exact", note: 'малые частоты → Fisher' }
    }
    return { stat: chi2, df, p: df > 0 ? chi2PValue(chi2, df) : NaN, testName: 'χ²-тест', note: hasSmall ? 'малые ожидаемые частоты (<5)' : undefined }
}

function bhCorrect(pValues: number[]): number[] {
    const n = pValues.length
    const idx = pValues.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p)
    const adj = new Array<number>(n)
    let min = 1
    for (let k = 0; k < n; k++) {
        const v = Math.min(min, idx[k].p * n / (n - k))
        min = v
        adj[idx[k].i] = Math.min(1, v)
    }
    return adj
}


interface ColDef { field: string; type: string }
const isNum = (t: string) => t === 'number'
const isCat = (t: string) => !isNum(t)


export function computeNormalityTests(
    rows: ParsedRow[],
    columns: ColDef[],
): NormalityResult[] {
    const results: NormalityResult[] = []
    for (const col of columns) {
        if (!isNum(col.type)) continue
        const vals = rows.map(r => Number(r[col.field])).filter(v => isFinite(v) && !isNaN(v))
        const n = vals.length
        if (n < 8) {
            results.push({ field: col.field, n, skewness: NaN, kurtosis: NaN, stat: NaN, pValue: NaN, isNormal: false, note: 'мало наблюдений (< 8)' })
            continue
        }
        const { stat, p, skewness, kurtosis } = jarqueBera(vals)
        results.push({
            field: col.field, n,
            skewness: isNaN(skewness) ? NaN : +skewness.toFixed(4),
            kurtosis: isNaN(kurtosis) ? NaN : +kurtosis.toFixed(4),
            stat: isNaN(stat) ? NaN : +stat.toFixed(4),
            pValue: p,
            isNormal: isFinite(p) && p >= 0.05,
            note: n < 30 ? 'n < 30: JB менее надёжен' : undefined,
        })
    }
    return results
}


export function computeUnivariateTests(
    rows: ParsedRow[],
    columns: ColDef[],
    targetField: string,
    options?: { parametric?: boolean }
): UnivariateResult[] {
    const parametric = options?.parametric ?? false
    const targetCol = columns.find((c) => c.field === targetField)
    if (!targetCol) return []

    const targetIsNum = isNum(targetCol.type)
    const results: UnivariateResult[] = []
    const R = rows.length
    const targetVals = rows.map(r => r[targetField])

    for (const col of columns) {
        if (col.field === targetField) continue

        const xRaw: unknown[] = [], yRaw: unknown[] = []
        for (let k = 0; k < R; k++) {
            const x = rows[k][col.field], y = targetVals[k]
            if (x != null && x !== '' && y != null && y !== '') { xRaw.push(x); yRaw.push(y) }
        }
        const n = xRaw.length

        if (n < 5) {
            results.push({ field: col.field, colType: col.type, testName: '—', stat: NaN, pValue: NaN, pAdj: NaN, n, note: 'мало наблюдений (< 5)' })
            continue
        }

        if (targetIsNum) {
            const yNums = yRaw.map(y => Number(y))

            if (isNum(col.type)) {
                const xNums = xRaw.map(x => Number(x))
                if (parametric) {
                    const r = pearsonR(xNums, yNums)
                    results.push({ field: col.field, colType: col.type, testName: 'Pearson r', stat: r, pValue: corrPValue(r, n), pAdj: NaN, n })
                } else {
                    const r = spearmanR(xNums, yNums)
                    results.push({ field: col.field, colType: col.type, testName: 'Spearman ρ', stat: r, pValue: corrPValue(r, n), pAdj: NaN, n })
                }
            } else {
                const groups = new Map<string, number[]>()
                for (let k = 0; k < n; k++) {
                    const key = String(xRaw[k])
                    const arr = groups.get(key) ?? []; arr.push(Number(yRaw[k])); groups.set(key, arr)
                }
                const gs = [...groups.values()].filter((g) => g.length >= 1)
                if (gs.length < 2) {
                    results.push({ field: col.field, colType: col.type, testName: '—', stat: NaN, pValue: NaN, pAdj: NaN, n, note: '< 2 групп' })
                } else if (gs.length === 2) {
                    if (parametric) {
                        const { t, df, p } = welchT(gs[0], gs[1])
                        results.push({ field: col.field, colType: col.type, testName: "Welch's t", stat: t, pValue: p, pAdj: NaN, n, note: `df = ${isNaN(df) ? '—' : df.toFixed(1)}` })
                    } else {
                        const { U, Z, p } = mannWhitney(gs[0], gs[1])
                        results.push({ field: col.field, colType: col.type, testName: 'Mann-Whitney U', stat: U, pValue: p, pAdj: NaN, n, note: `Z = ${isNaN(Z) ? '—' : Z.toFixed(3)}` })
                    }
                } else {
                    if (parametric) {
                        const { F, p } = oneWayAnova(gs)
                        results.push({ field: col.field, colType: col.type, testName: `ANOVA F (${gs.length} гр.)`, stat: F, pValue: p, pAdj: NaN, n })
                    } else {
                        const { H, p } = kruskalWallis(gs)
                        results.push({ field: col.field, colType: col.type, testName: `Kruskal-Wallis H (${gs.length} гр.)`, stat: H, pValue: p, pAdj: NaN, n })
                    }
                }
            }
        } else {
            const yStrs = yRaw.map(y => String(y))
            const yClasses = [...new Set(yStrs)]

            if (isNum(col.type)) {
                if (yClasses.length === 2) {
                    const g0: number[] = [], g1: number[] = []
                    for (let k = 0; k < n; k++) {
                        const v = Number(xRaw[k])
                        if (yStrs[k] === yClasses[0]) g0.push(v); else g1.push(v)
                    }
                    if (parametric) {
                        const { t, df, p } = welchT(g0, g1)
                        results.push({ field: col.field, colType: col.type, testName: "Welch's t", stat: t, pValue: p, pAdj: NaN, n, note: `df = ${isNaN(df) ? '—' : df.toFixed(1)}` })
                    } else {
                        const { U, Z, p } = mannWhitney(g0, g1)
                        results.push({ field: col.field, colType: col.type, testName: 'Mann-Whitney U', stat: U, pValue: p, pAdj: NaN, n, note: `Z = ${isNaN(Z) ? '—' : Z.toFixed(3)}` })
                    }
                } else {
                    const groups = new Map<string, number[]>()
                    for (let k = 0; k < n; k++) {
                        const key = yStrs[k]
                        const arr = groups.get(key) ?? []; arr.push(Number(xRaw[k])); groups.set(key, arr)
                    }
                    const gs = [...groups.values()].filter((g) => g.length >= 1)
                    if (parametric) {
                        const { F, p } = oneWayAnova(gs)
                        results.push({ field: col.field, colType: col.type, testName: `ANOVA F (${yClasses.length} кл.)`, stat: F, pValue: p, pAdj: NaN, n })
                    } else {
                        const { H, p } = kruskalWallis(gs)
                        results.push({ field: col.field, colType: col.type, testName: `Kruskal-Wallis H (${yClasses.length} кл.)`, stat: H, pValue: p, pAdj: NaN, n })
                    }
                }
            } else {
                const xStrs = xRaw.map(x => String(x))
                const { stat, p, testName, note } = chiSquareOrFisher(xStrs, yStrs)
                results.push({ field: col.field, colType: col.type, testName, stat, pValue: p, pAdj: NaN, n, note })
            }
        }
    }

    const valid = results.filter((r) => !isNaN(r.pValue))
    const adjs = bhCorrect(valid.map((r) => r.pValue))
    let vi = 0
    for (const r of results) {
        if (!isNaN(r.pValue)) r.pAdj = adjs[vi++]
    }

    return results.sort((a, b) => {
        if (isNaN(a.pValue) && isNaN(b.pValue)) return 0
        if (isNaN(a.pValue)) return 1
        if (isNaN(b.pValue)) return -1
        return a.pValue - b.pValue
    })
}


export function computePairwisePValues(
    rows: ParsedRow[],
    columns: ColDef[],
    options?: { pairwiseMethod?: 'spearman' | 'kendall' }
): PairwisePValue {
    const pairwiseMethod = options?.pairwiseMethod ?? 'spearman'
    const n = columns.length
    const R = rows.length
    const fields = columns.map((c) => c.field)
    const pMatrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(NaN))
    const testMatrix: string[][] = Array.from({ length: n }, () => new Array<string>(n).fill(''))
    const nMatrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))

    // Pre-extract all column values once — avoids R × pairs row property lookups per pair
    const colVals = columns.map(col => { const f = col.field; return rows.map(r => r[f]) })

    for (let i = 0; i < n; i++) {
        pMatrix[i][i] = 1; testMatrix[i][i] = '—'
        for (let j = i + 1; j < n; j++) {
            const ca = columns[i], cb = columns[j]
            const av = colVals[i], bv = colVals[j]

            if (isNum(ca.type) && isNum(cb.type)) {
                const xs: number[] = [], ys: number[] = []
                for (let k = 0; k < R; k++) {
                    const a = av[k], b = bv[k]
                    if (a != null && a !== '' && b != null && b !== '') { xs.push(Number(a)); ys.push(Number(b)) }
                }
                const np = xs.length
                nMatrix[i][j] = nMatrix[j][i] = np
                if (np < 5) { pMatrix[i][j] = pMatrix[j][i] = NaN; testMatrix[i][j] = testMatrix[j][i] = '—'; continue }
                if (pairwiseMethod === 'kendall') {
                    const { p: kp } = kendallTauB(xs, ys)
                    pMatrix[i][j] = pMatrix[j][i] = kp
                    testMatrix[i][j] = testMatrix[j][i] = 'Kendall τ'
                } else {
                    const r = spearmanR(xs, ys)
                    pMatrix[i][j] = pMatrix[j][i] = corrPValue(r, np)
                    testMatrix[i][j] = testMatrix[j][i] = 'Spearman'
                }
            } else if (isCat(ca.type) && isCat(cb.type)) {
                const xs: string[] = [], ys: string[] = []
                for (let k = 0; k < R; k++) {
                    const a = av[k], b = bv[k]
                    if (a != null && a !== '' && b != null && b !== '') { xs.push(String(a)); ys.push(String(b)) }
                }
                const np = xs.length
                nMatrix[i][j] = nMatrix[j][i] = np
                if (np < 5) { pMatrix[i][j] = pMatrix[j][i] = NaN; testMatrix[i][j] = testMatrix[j][i] = '—'; continue }
                const { p, testName } = chiSquareOrFisher(xs, ys)
                pMatrix[i][j] = pMatrix[j][i] = p
                testMatrix[i][j] = testMatrix[j][i] = testName === "Fisher's exact" ? 'Fisher' : 'χ²'
            } else {
                const numIsA = isNum(ca.type)
                const groups = new Map<string, number[]>()
                let np = 0
                for (let k = 0; k < R; k++) {
                    const a = av[k], b = bv[k]
                    if (a != null && a !== '' && b != null && b !== '') {
                        np++
                        const key = String(numIsA ? b : a)
                        const arr = groups.get(key) ?? []; arr.push(Number(numIsA ? a : b)); groups.set(key, arr)
                    }
                }
                nMatrix[i][j] = nMatrix[j][i] = np
                if (np < 5) { pMatrix[i][j] = pMatrix[j][i] = NaN; testMatrix[i][j] = testMatrix[j][i] = '—'; continue }
                const gs = [...groups.values()].filter((g) => g.length >= 1)
                if (gs.length >= 2) {
                    const { p: kwp } = kruskalWallis(gs)
                    pMatrix[i][j] = pMatrix[j][i] = kwp
                    testMatrix[i][j] = testMatrix[j][i] = 'KW'
                } else {
                    pMatrix[i][j] = pMatrix[j][i] = NaN
                    testMatrix[i][j] = testMatrix[j][i] = '—'
                }
            }
        }
    }
    return { fields, pMatrix, testMatrix, nMatrix }
}
