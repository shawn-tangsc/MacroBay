import { describe, expect, it } from 'vitest'

import type { AgentFact, SnapshotChange } from '../../../contracts/marketAnalysisContracts'
import { changeValuesForPrompt } from './analysisChangeValues'
import { computeSnapshotChange } from './snapshotChange'

/**
 * 变更摘要里「印给模型看过的百分数」：正文出处规则的第二个集合。
 *
 * 三条边界各有一条用例：只从渲染文本取、天然尊重 200 条截断、没有变更记录时什么都不给。
 */
function fact(index: number): AgentFact {
  return {
    factId: `f-${String(index).padStart(3, '0')}`,
    domain: 'funding',
    subject: 'BTC',
    metric: 'open-interest-change-24h-pct',
    value: 100 + index / 100,
    unit: 'percent',
    sourceId: 'binance-futures-positioning',
    sourceLabel: 'binance',
    observedAt: '2026-11-11T05:00:00.000Z',
    asOf: '2026-11-11T05:00:00.000Z',
    freshness: 'fresh',
    confidence: 1,
    comparability: 'comparable',
    evidenceRefId: `e-${index}`
  }
}

/**
 * 变更比对只读这四格。这里刻意**不写**那三个契约类型的注解：同一个类型经不同重导出路径在场时，
 * `tsc` 会把它当成两个不相干的类型（TS2719），而这个测试要的只是形状。
 */
function snapshotOf(facts: readonly AgentFact[]) {
  return {
    facts,
    missingDomains: [],
    caveats: [],
    evidenceRefs: facts.map(item => ({ evidenceRefId: item.evidenceRefId as string }))
  }
}

describe('the numbers the change digest printed', () => {
  it('gives nothing for a snapshot with no change record', () => {
    expect(changeValuesForPrompt(undefined, 'zh-CN')).toBeUndefined()
  })

  it('reads the percentages out of the rendered sentence, per language', () => {
    const change = computeSnapshotChange({
      current: snapshotOf([fact(0)]) as never,
      previous: snapshotOf([{ ...fact(0), value: 99.24 }]) as never
    })
    const values = changeValuesForPrompt(change, 'zh-CN')
    // 变更前 99.24%、变更后 100% —— 两句里印出来的那两个数都在集合里。
    expect(values).toEqual(expect.arrayContaining([99.24]))
    expect(changeValuesForPrompt(change, 'en-US')).toEqual(expect.arrayContaining([99.24]))
  })

  it('stops where the digest stops: the 201st change was never printed, so its value is not a source', () => {
    // `maximumFactChanges` = 200。第 201 条按 factId 升序被截掉，模型根本没看见它 —— 它的数不许算出处。
    const current = Array.from({ length: 201 }, (_, index) => fact(index))
    const change = computeSnapshotChange({ current: snapshotOf(current) as never, previous: snapshotOf([]) as never })
    expect(change.facts).toHaveLength(200)
    const dropped = change.facts.some(entry => entry.factId === 'f-200')
    expect(dropped).toBe(false)

    const values = changeValuesForPrompt(change, 'zh-CN') ?? []
    expect(values.length).toBeGreaterThan(0)
    // f-200 的值是 102%，被截断后既不在摘要里，也不能被当成出处。
    expect(values).not.toContain(102)
    expect(values).toContain(100)
  })

  it('is undefined when the change record says nothing moved', () => {
    const unchanged: SnapshotChange = {
      sequence: 1, previousSnapshotHash: null, facts: [], missingDomainsAdded: [], missingDomainsRemoved: [],
      caveatsAdded: [], caveatsRemoved: [], evidenceRefsAdded: [], evidenceRefsRemoved: []
    }
    expect(changeValuesForPrompt(unchanged, 'zh-CN')).toBeUndefined()
  })
})
