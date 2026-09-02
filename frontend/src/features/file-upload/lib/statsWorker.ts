import { computeUnivariateTests, computeNormalityTests, computePairwisePValues } from './pValueAnalysis'
import type { ColumnConfig, ParsedRow } from '@shared/types'

type WorkerMsg = {
    type: 'univariate'
    rows: ParsedRow[]
    columns: ColumnConfig[]
    target: string
    parametric?: boolean
} | {
    type: 'normality'
    rows: ParsedRow[]
    columns: ColumnConfig[]
} | {
    type: 'pairwise'
    rows: ParsedRow[]
    columns: ColumnConfig[]
    pairwiseMethod?: 'spearman' | 'kendall'
}

self.onmessage = (e: MessageEvent<WorkerMsg>) => {
    try {
        const msg = e.data
        if (msg.type === 'univariate') {
            const result = computeUnivariateTests(msg.rows, msg.columns, msg.target, { parametric: msg.parametric })
            self.postMessage({ ok: true, type: 'univariate', result })
        } else if (msg.type === 'normality') {
            const result = computeNormalityTests(msg.rows, msg.columns)
            self.postMessage({ ok: true, type: 'normality', result })
        } else if (msg.type === 'pairwise') {
            const result = computePairwisePValues(msg.rows, msg.columns, { pairwiseMethod: msg.pairwiseMethod })
            self.postMessage({ ok: true, type: 'pairwise', result })
        } else {
            self.postMessage({ ok: false, error: 'Unknown worker message type' })
        }
    } catch (err) {
        self.postMessage({ ok: false, error: String(err) })
    }
}
