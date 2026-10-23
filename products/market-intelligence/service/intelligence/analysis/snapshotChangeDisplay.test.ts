import { describe, expect, it } from 'vitest'

import { computeSnapshotChange, describeSnapshotChange } from './snapshotChange'

const asOf = '2026-10-07T09:06:14.792Z'

function fact(overrides: Record<string, unknown>) {
  return {
    factId: 'mi-fact-1', domain: 'capital' as const, subject: 'BTC', metric: 'etf-net-flow-usd',
    value: 0, unit: 'USD', sourceId: '0xrouter', sourceLabel: '0xrouter', observedAt: asOf, asOf,
    freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-1',
    ...overrides
  }
}

const snapshot = (facts: readonly unknown[]) => ({
  snapshotHash: 'hash', facts: facts as never, missingDomains: [] as const, caveats: [] as const, evidenceRefs: [] as const
})

describe('snapshot change display fields', () => {
  it('keeps the fields a reader needs to describe a change', () => {
    const change = computeSnapshotChange({
      current: snapshot([fact({ value: 314_300_000 })]),
      previous: snapshot([fact({ value: 232_200_000 })])
    })

    expect(change.facts).toEqual([{
      factId: 'mi-fact-1', domain: 'capital', subject: 'BTC', metric: 'etf-net-flow-usd', unit: 'USD', sourceLabel: '0xrouter',
      kind: 'changed', previousValue: 232_200_000, value: 314_300_000
    }])
  })

  it('still carries the display fields for a removed fact, which is not in this snapshot', () => {
    const change = computeSnapshotChange({
      current: snapshot([]),
      previous: snapshot([fact({ value: 232_200_000 })])
    })

    expect(change.facts[0]).toEqual(expect.objectContaining({ kind: 'removed', subject: 'BTC', unit: 'USD', previousValue: 232_200_000 }))
  })

  it('describes the movement to the model in readable words instead of a machine encoding', () => {
    const change = computeSnapshotChange({
      current: snapshot([fact({ value: 314_300_000 })]),
      previous: snapshot([fact({ value: 232_200_000 })])
    })

    // `change-1d-usd` is what the model used to copy into the published conclusion.
    expect(describeSnapshotChange(change)).toBe('资金面 · BTC · ETF 净流入：+2.32 亿美元 → +3.14 亿美元')
  })

  it('formats the movement in the prose language, so an English prompt carries no Chinese units', () => {
    const change = computeSnapshotChange({
      current: snapshot([fact({ value: 314_300_000 })]),
      previous: snapshot([fact({ value: 232_200_000 })])
    })

    const described = describeSnapshotChange(change, undefined, 'en-US')
    expect(described).toContain('+$232.2M → +$314.3M')
    expect(described).not.toContain('亿美元')
  })

  it('names the domains, caveats and value movements a model must quote', () => {
    const change = {
      sequence: 2, previousSnapshotHash: 'hash',
      facts: [{ factId: 'mi-fact-1', domain: 'capital' as const, subject: 'stablecoins', metric: 'current-usd', unit: 'USD', kind: 'changed' as const, previousValue: 257_970_817_433.68, value: 257_938_932_953.47 }],
      missingDomainsAdded: ['cross-asset' as const], missingDomainsRemoved: [],
      caveatsAdded: ['macro-calendar-consensus-unavailable'], caveatsRemoved: [],
      evidenceRefsAdded: ['evidence-1', 'evidence-2'], evidenceRefsRemoved: []
    }

    const described = describeSnapshotChange(change)
    expect(described).toContain('资金面 · 稳定币 · 当前值：2579.71 亿美元 → 2579.39 亿美元')
    expect(described).toContain('新增缺失域：跨资产')
    expect(described).toContain('新增数据限制：缺少市场预期值')
    expect(described).toContain('新增证据 2 条')
    expect(described).not.toMatch(/current-usd|cross-asset|macro-calendar-consensus-unavailable|evidence-1/)
  })

  it('describes a calendar fact by its own name instead of its kind', () => {
    // The provider route's subject is the event *kind*, so without the fact's own name the model was
    // handed 「宏观 · 经济指标 · 生命周期」 for every release (design 141 §3.3).
    const change = {
      sequence: 3, previousSnapshotHash: 'hash',
      facts: [{
        factId: 'mi-fact-1', domain: 'macro' as const, subject: 'economic-indicator', subjectLabel: '9月零售销售(月率)',
        metric: 'lifecycle-state', kind: 'changed' as const, previousValue: 'scheduled', value: 'released'
      }],
      missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [], evidenceRefsAdded: [], evidenceRefsRemoved: []
    }
    const described = describeSnapshotChange(change)
    expect(described).toContain('宏观 · 9月零售销售(月率) · 生命周期：待公布 → 已公布')
    expect(described).not.toContain('经济指标')
  })

  it('does not call a fact changed when only the name it is said with changed', () => {
    // The label is display-only: it is not part of the identity and must not look like a movement —
    // otherwise the first collection after the naming change would report every calendar row as new.
    const change = computeSnapshotChange({
      current: snapshot([fact({ subject: 'economic-indicator', subjectLabel: '9月零售销售(月率)', metric: 'lifecycle-state', value: 'released' })]),
      previous: snapshot([fact({ subject: 'economic-indicator', metric: 'lifecycle-state', value: 'released' })])
    })
    expect(change.facts).toEqual([])
    expect(describeSnapshotChange(change)).toBe('no-change')
  })

  it('still reports an unchanged snapshot as no-change', () => {    const change = computeSnapshotChange({ current: snapshot([fact({ value: 1 })]), previous: snapshot([fact({ value: 1 })]) })
    expect(describeSnapshotChange(change)).toBe('no-change')
  })
})
