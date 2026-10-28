import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { MarketAnalysisChangeView } from '../../shared/ipc/marketAnalysisTimelineClient'
import { formatChangeEntries, formatChangeValue, formatUsdAmount } from './marketAnalysisChangeFormat'
import { conclusionReadableNames } from './analysisConclusionVocabulary'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'

// The names are product copy, so the test reads the same registry the surfaces render from.
const names = productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames
const englishNames = productText['en-US'].pages.intelligence.portal.analysisWorkspace.readableNames

it('hides exactly the calendar kinds its contract declares', () => {
  // The list belongs to the calendar contract: a kind added there must be hidden here too, and a list
  // retyped here would silently stop covering it (design 141 §3.2).
  const fact = (subject: string, subjectLabel?: string) => ({
    facts: [{ factId: 'mi-fact-1', domain: 'macro', subject, metric: 'lifecycle-state', kind: 'changed', previousValue: 'scheduled', value: 'released', unit: null, ...(subjectLabel ? { subjectLabel } : {}) }]
  } as never)

  for (const kind of marketCalendarPublicPolicy.kinds) {
    expect(formatChangeEntries(fact(kind), names, 'zh-CN'), kind).toEqual([])
    // …and it comes back the moment the fact carries its own name.
    expect(formatChangeEntries(fact(kind, '9月零售销售(月率)'), names, 'zh-CN')[0]?.label).toContain('9月零售销售(月率)')
  }
  // A subject that is not a kind names itself through the vocabulary, as it always has.
  expect(formatChangeEntries(fact('consumer-price-index'), names, 'zh-CN')[0]?.label).toContain('消费者物价指数')
})

it('reads the vocabulary the surfaces actually name facts with', () => {
  // These tests passed `analysisTimeline.readableNames` for a while. That key does not exist, so they
  // were exercising the identifier fallback and passing anyway — and nothing could catch it: test
  // files are outside the typecheck program (`products/**/*.{ts,tsx}` is not a glob TypeScript
  // expands, and only files reachable from the app are checked). So the value is asserted here
  // instead: if the path rots again, this fails rather than quietly testing nothing.
  expect(names).toBe(conclusionReadableNames)
  expect(Object.keys(names.lifecycleState)).toContain('released')
  expect(Object.keys(names.eventName)).toContain('cpi')
})

function view(facts: MarketAnalysisChangeView['facts']): MarketAnalysisChangeView {
  return { facts, missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: 0, caveatsRemoved: 0, evidenceRefsAdded: 0, evidenceRefsRemoved: 0 }
}

describe('market analysis change formatting', () => {
  it('describes a changed USD flow in readable units instead of raw integers', () => {
    const entries = formatChangeEntries(view([
      { domain: 'capital', subject: 'BTC', metric: 'etf-net-flow-usd', unit: 'USD', kind: 'changed', previousValue: -201_900_000, value: 314_300_000 }
    ]), names)

    expect(entries).toEqual([{
      key: 'capital:BTC:etf-net-flow-usd',
      domainLabel: '资金面',
      label: 'BTC · ETF 净流入',
      kind: 'changed',
      previous: '-2.02 亿美元',
      current: '+3.14 亿美元'
    }])
  })

  it('formats stablecoin totals, percentage rates and plain numbers', () => {
    // The low-level helper defaults to flow semantics (signed); a level passes false.
    expect(formatUsdAmount(258_458_629_557.07956, 'zh-CN', false)).toBe('2584.59 亿美元')
    expect(formatUsdAmount(314_300_000, 'zh-CN')).toBe('+3.14 亿美元')
    expect(formatChangeValue(258_458_629_557.07956, 'USD', 'zh-CN', false)).toBe('2584.59 亿美元')
    expect(formatChangeValue(-0.003657, 'percent', 'zh-CN')).toBe('-0.003657%')
    expect(formatChangeValue(71, null, 'zh-CN')).toBe('71')
  })

  it('formats a derived surprise with its recorded unit and sign', () => {
    const entries = formatChangeEntries(view([
      { domain: 'macro', subject: 'consumer-price-index', metric: 'surprise', unit: 'pp', kind: 'added', previousValue: null, value: 0.30000000000000004 },
      { domain: 'macro', subject: 'consumer-price-index', metric: 'surprise', unit: 'relative-percent', kind: 'added', previousValue: null, value: 10.000000000000002 }
    ]), names)

    expect(entries.map(entry => entry.current)).toEqual(['+0.3 个百分点', '+10%'])
    expect(entries[0]?.label).toBe('消费者物价指数 · 预期差（实际−预期）')
    expect(entries[1]?.label).toBe(entries[0]?.label)
  })

  it('does not sign a level such as a stablecoin total, but does sign a flow', () => {
    const entries = formatChangeEntries(view([
      { domain: 'capital', subject: null, metric: 'current-usd', unit: 'USD', kind: 'changed', previousValue: 258_458_620_000, value: 258_458_629_557.07956 },
      { domain: 'capital', subject: null, metric: 'change-1d-usd', unit: 'USD', kind: 'changed', previousValue: -13_425_507, value: 924_055 }
    ]), names)

    expect(entries[0]).toEqual(expect.objectContaining({ current: '2584.59 亿美元' }))
    expect(entries[1]).toEqual(expect.objectContaining({ previous: '-1342.55 万美元', current: '+92.41 万美元' }))
  })

  it('keeps a long text value readable by shortening it', () => {
    const value = 'x'.repeat(200)
    const formatted = formatChangeValue(value, null, 'zh-CN')
    expect(formatted.length).toBeLessThanOrEqual(80)
    expect(formatted.endsWith('…')).toBe(true)
  })

  it('labels an added or removed entry so the change direction is unambiguous', () => {
    const entries = formatChangeEntries(view([
      { domain: 'capital', subject: 'ETH', metric: 'change-7d-usd', unit: 'USD', kind: 'added', previousValue: null, value: 744_922_551 },
      { domain: 'funding', subject: 'BTC', metric: 'funding-rate-percent', unit: 'percent', kind: 'removed', previousValue: 0.01, value: null }
    ]), names)

    expect(entries[0]).toEqual(expect.objectContaining({ kind: 'added', label: 'ETH · 7 日变化', current: '+7.45 亿美元' }))
    expect(entries[1]).toEqual(expect.objectContaining({ kind: 'removed', label: 'BTC · 资金费率' }))
  })

  it('names a subject that is an internal identifier instead of showing it raw', () => {
    const entries = formatChangeEntries(view([
      { domain: 'capital', subject: 'stablecoins', metric: 'change-1d-usd', unit: 'USD', kind: 'changed', previousValue: -9_240_550, value: 924_055 }
    ]), names)

    expect(entries[0]).toEqual(expect.objectContaining({ label: '稳定币 · 1 日变化' }))
  })

  it('keeps a removal and an addition apart even when they share a label', () => {
    // This used to collapse into one `changed` row, back when a fact id embedded the
    // observation date so a new value arrived as a remove plus an add. Identity is stable now,
    // and fusing them showed unrelated movements as a single value change.
    const entries = formatChangeEntries(view([
      { domain: 'capital', subject: 'stablecoins', metric: 'change-1d-usd', unit: 'USD', kind: 'removed', previousValue: -13_425_507, value: null },
      { domain: 'capital', subject: 'stablecoins', metric: 'change-1d-usd', unit: 'USD', kind: 'added', previousValue: null, value: 924_055 }
    ]), names)

    expect(entries).toHaveLength(2)
    expect(entries.map(entry => entry.kind).sort()).toEqual(['added', 'removed'])
    expect(entries[0]).toMatchObject({ label: '稳定币 · 1 日变化', kind: 'removed', previous: '-1342.55 万美元', current: null })
    expect(entries[1]).toMatchObject({ label: '稳定币 · 1 日变化', kind: 'added', previous: null, current: '+92.41 万美元' })
  })


  it('keeps an add and a remove apart when they are different metrics', () => {
    const entries = formatChangeEntries(view([
      { domain: 'capital', subject: 'stablecoins', metric: 'change-1d-usd', unit: 'USD', kind: 'removed', previousValue: -1, value: null },
      { domain: 'capital', subject: 'stablecoins', metric: 'change-7d-usd', unit: 'USD', kind: 'added', previousValue: null, value: 2 }
    ]), names)

    expect(entries).toHaveLength(2)
  })

  it('falls back to the raw metric name when a label is not registered', () => {
    const entries = formatChangeEntries(view([
      { domain: 'macro', subject: null, metric: 'some-new-metric', unit: null, kind: 'changed', previousValue: 1, value: 2 }
    ]), names)

    expect(entries[0]).toEqual(expect.objectContaining({ label: 'some-new-metric', domainLabel: '宏观' }))
  })

  it('names and scales the change list in the reader’s language instead of always Chinese', () => {
    const entries = formatChangeEntries(view([
      { domain: 'capital', subject: 'stablecoins', metric: 'change-1d-usd', unit: 'USD', kind: 'changed', previousValue: -9_240_550, value: 924_055 }
    ]), englishNames, 'en-US')

    expect(entries[0]).toEqual(expect.objectContaining({
      domainLabel: 'Capital', label: 'Stablecoins · 1 day change', previous: '-$9.24M', current: '+$924.06K'
    }))
  })
})

it('never fuses an unrelated removal and addition into one movement', () => {
  // Two different observations that share the generic subject and metric. Before the fact
  // identity fix every collection changed every macro fact id, so a removal plus an addition
  // was read as one movement; now that ids are stable, merging them invents a value change
  // that never happened (1716 -> 462 for two unrelated indicators).
  const entries = formatChangeEntries({
    facts: [
      { factId: 'mi-fact-a', domain: 'macro', subject: 'nonfarm-payrolls', metric: 'actual', kind: 'removed', previousValue: 1716, unit: 'thousand' },
      { factId: 'mi-fact-b', domain: 'macro', subject: 'initial-claims', metric: 'actual', kind: 'added', value: 462, unit: 'count' }
    ]
  } as never, productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames, 'zh-CN')
  const kinds = entries.map(entry => entry.kind)
  expect(kinds).toContain('removed')
  expect(kinds).toContain('added')
  expect(kinds).not.toContain('changed')
  // Whichever row is shown, it must never pair one observation's value with the other's.
  for (const entry of entries) {
    expect(`${entry.previous ?? ''}|${entry.current ?? ''}`).not.toBe('1716|462')
  }
})

it('still reports a real value change as one changed row', () => {
  const entries = formatChangeEntries({
    facts: [{ factId: 'mi-fact-a', domain: 'macro', subject: 'consumer-price-index', metric: 'actual', kind: 'changed', previousValue: '3.1%', value: '3.2%', unit: null }]
  } as never, productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames, 'zh-CN')
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ kind: 'changed', previous: '3.1%', current: '3.2%' })
})

describe('a change whose subject is only its kind', () => {
  it('names the fact when main resolved a name for it, and stays silent about which one when it did not', () => {
    const names = productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames
    const fact = (subjectLabel?: string) => ({
      facts: [{
        factId: 'mi-fact-macro-economic-indicator-lifecycle-state-market-observation-abc',
        domain: 'macro', subject: 'economic-indicator', metric: 'lifecycle-state',
        ...(subjectLabel ? { subjectLabel } : {}),
        kind: 'changed', previousValue: 'scheduled', value: 'released', unit: null
      }]
    } as never)

    // With a name, the row says which indicator published — the whole point of carrying it.
    const named = formatChangeEntries(fact('9月未季调核心CPI年率'), names, 'zh-CN')
    expect(named[0]!.label).toContain('9月未季调核心CPI年率')
    expect(named[0]!.label).not.toContain('经济指标')

    // Without a name the row is now hidden entirely rather than shown as 「经济指标 · 生命周期」: a row
    // that cannot say which indicator changed tells the reader nothing.
    expect(formatChangeEntries(fact(), names, 'zh-CN')).toEqual([])
  })
})

describe('rows that cannot name their subject', () => {
  const names = productText['zh-CN'].pages.intelligence.portal.analysisWorkspace.readableNames
  const lifecycle = (subject: string, subjectLabel?: string) => ({
    facts: [{
      factId: `mi-fact-macro-${subject}-lifecycle-state-market-observation-abc`,
      domain: 'macro', subject, metric: 'lifecycle-state',
      ...(subjectLabel ? { subjectLabel } : {}),
      kind: 'changed', previousValue: 'scheduled', value: 'released', unit: null
    }]
  } as never)

  it('hides a calendar fact whose subject is only its kind, and keeps every fact that names something', () => {
    // Three identical rows reading 「经济指标 · 生命周期」 is what this removes: the fact cannot say which
    // indicator published, so the row cannot inform anyone.
    expect(formatChangeEntries(lifecycle('economic-indicator'), names, 'zh-CN')).toEqual([])
    expect(formatChangeEntries(lifecycle('central-bank-activity'), names, 'zh-CN')).toEqual([])
    // A fact with its own name is shown — the hiding is temporary by construction.
    expect(formatChangeEntries(lifecycle('economic-indicator', '9月未季调核心CPI年率'), names, 'zh-CN')).toHaveLength(1)
    // And a subject that is a real instrument was never affected.
    expect(formatChangeEntries(lifecycle('consumer-price-index'), names, 'zh-CN')).toHaveLength(1)
  })
})
