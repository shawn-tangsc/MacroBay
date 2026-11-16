import { describe, expect, it } from 'vitest'

import { buildAnalysisSnapshotHash, buildEvidenceFingerprint } from './analysisHash'

/**
 * 两个指纹回答两个问题（R37 §9.2）：
 * - `snapshotHash`：是不是同一份冻结记录——含 `asOf` / `dataCutoff`，两次冻结必然不同；
 * - `evidenceFingerprint`：模型读到的还是不是那一批事实与证据——不含时刻，两次「同样的数据」相同。
 *
 * 复用判定与界面「查看 / 再次解读」只能看后者：拿前者判，两次点击的 `asOf` 一定不同，
 * 「已有解读」永远不命中、菜单永远显示「再次解读」。
 */
const fact = (factId: string, value: number) => ({ factId, domain: 'capital', subject: 'BTC', metric: 'etf-net-flow', value })
const ref = (evidenceRefId: string) => ({ evidenceRefId, sourceId: 'cryptoetf-etf-flows' })

describe('evidence fingerprint', () => {
  it('ignores when the evidence was read, unlike the snapshot hash', () => {
    const facts = [fact('f1', 1), fact('f2', 2)]
    const evidenceRefs = [ref('e1'), ref('e2')]
    const earlier = { profileId: 'p', asOf: '2026-11-16T09:00:00.000Z', dataCutoff: '2026-11-16T09:00:00.000Z', facts, missingDomains: [], caveats: [], evidenceRefs }
    const later = { ...earlier, asOf: '2026-11-16T09:07:42.000Z', dataCutoff: '2026-11-16T09:07:42.000Z' }

    // 记录指纹不同——它们是两份不同的冻结记录。
    expect(buildAnalysisSnapshotHash(earlier)).not.toBe(buildAnalysisSnapshotHash(later))
    // 证据指纹相同——模型读到的是同一批事实与证据。
    expect(buildEvidenceFingerprint({ facts: earlier.facts, evidenceRefs: earlier.evidenceRefs }))
      .toBe(buildEvidenceFingerprint({ facts: later.facts, evidenceRefs: later.evidenceRefs }))
  })

  it('is order-insensitive and changes when the evidence changes', () => {
    const a = buildEvidenceFingerprint({ facts: [fact('f1', 1), fact('f2', 2)], evidenceRefs: [ref('e1'), ref('e2')] })
    const b = buildEvidenceFingerprint({ facts: [fact('f2', 2), fact('f1', 1)], evidenceRefs: [ref('e2'), ref('e1')] })
    const changed = buildEvidenceFingerprint({ facts: [fact('f1', 9), fact('f2', 2)], evidenceRefs: [ref('e1'), ref('e2')] })

    expect(a).toBe(b)
    expect(a).not.toBe(changed)
  })
})
