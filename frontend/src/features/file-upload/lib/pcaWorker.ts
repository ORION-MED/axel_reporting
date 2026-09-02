type PCAInput = {
    rows: Record<string, unknown>[]
    fields: string[]
}

type PCAOutput = {
    points: { pc1: number; pc2: number; rowIdx: number }[]
    varExplained: [number, number]
}

function computePCAProjection(rows: PCAInput['rows'], fields: string[]): PCAOutput {
    if (rows.length < 2 || fields.length < 2) {
        return { points: [], varExplained: [0, 0] }
    }
    const matWithIdx = rows
        .map((r, origIdx) => ({ vals: fields.map((f) => Number(r[f])), origIdx }))
        .filter(({ vals }) => vals.every(isFinite))
    const mat = matWithIdx.map(m => m.vals)
    const n = mat.length
    const p = fields.length
    if (n < 2) return { points: [], varExplained: [0, 0] }

    const means = fields.map((_, j) => mat.reduce((s, r) => s + r[j], 0) / n)
    const centered = mat.map((r) => r.map((v, j) => v - means[j]))

    const cov: number[][] = Array.from({ length: p }, () => Array(p).fill(0))
    centered.forEach((r) => {
        for (let i = 0; i < p; i++)
            for (let j = 0; j < p; j++)
                cov[i][j] += r[i] * r[j]
    })
    for (let i = 0; i < p; i++)
        for (let j = 0; j < p; j++)
            cov[i][j] /= n - 1

    const powerIter = (deflate?: number[]): [number[], number] => {
        let v = Array(p).fill(0)
        v[0] = 1
        let eigenval = 0
        for (let iter = 0; iter < 200; iter++) {
            if (deflate) {
                const dot = v.reduce((s, vi, i) => s + vi * deflate[i], 0)
                v = v.map((vi, i) => vi - dot * deflate[i])
            }
            const mv = Array(p).fill(0)
            for (let i = 0; i < p; i++)
                for (let j = 0; j < p; j++)
                    mv[i] += cov[i][j] * v[j]
            const norm = Math.sqrt(mv.reduce((s, x) => s + x * x, 0)) || 1
            eigenval = norm
            v = mv.map((x) => x / norm)
        }
        return [v, eigenval]
    }

    const [ev1, lambda1] = powerIter()
    const [ev2, lambda2] = powerIter(ev1)
    const totalVar = cov.reduce((s, row, i) => s + row[i], 0) || 1

    const points = centered.map((r, i) => ({
        pc1: r.reduce((s, v, j) => s + v * ev1[j], 0),
        pc2: r.reduce((s, v, j) => s + v * ev2[j], 0),
        rowIdx: matWithIdx[i].origIdx,
    }))

    return { points, varExplained: [lambda1 / totalVar, lambda2 / totalVar] }
}

self.onmessage = (e: MessageEvent<PCAInput>) => {
    try {
        const result = computePCAProjection(e.data.rows, e.data.fields)
        self.postMessage({ ok: true, result })
    } catch (err) {
        self.postMessage({ ok: false, error: String(err) })
    }
}
