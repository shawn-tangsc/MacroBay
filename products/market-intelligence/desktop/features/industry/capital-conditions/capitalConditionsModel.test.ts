import { describe, expect, it } from 'vitest'

import {
  dashboardCapitalConditionsPresentationPolicy,
  projectDashboardCapitalConditionsSnapshot,
  projectEtfOutflowChip
} from './capitalConditionsModel'
import type { ModuleSignal } from '../../../../contracts/moduleSignal'

const asOf = '2026-08-18T08:00:00.000Z'

describe('dashboard capital conditions model', () => {
  it('projects the validated core observation time with only compact safe facts', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available',
      asOf,
      etf: { state: 'unavailable' },
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z',
        currentUsd: 254_900_000_000, change1dUsd: 82_400_000, change1dPercent: 0.0323, change7dUsd: 82_400_000, change7dPercent: 0.0323,
        change30dUsd: -500_000_000, change30dPercent: -0.21
      },
      conclusion: 'partial'
    }, asOf)

    expect(result).toEqual({
      state: 'available', conclusion: 'partial', etf: 'unavailable', observedAt: '2026-08-18T07:00:00.000Z',
      currentUsd: '$254.9B', change1dUsd: '+$82.4M', change1dPercent: '+0.03%', change7dUsd: '+$82.4M', change7dPercent: '+0.03%',
      change30dUsd: '-$500M', change30dPercent: '-0.21%'
    })
    expect(JSON.stringify(result)).not.toMatch(/verifiedAt|https?:|source|raw|error|failure/i)
  })

  it('projects complete five- and twenty-day cumulative sums from the same validated rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)

    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected safe ETF presentation')
    expect(result.etf.btc.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '+$111', complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: '+$381', complete: true }
    ])
    expect(result.etf.eth.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '-$111', complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: '-$381', complete: true }
    ])
    expect(result.etf.coverage).toEqual([
      { windowDays: 5, coveredDays: 5, complete: true },
      { windowDays: 20, coveredDays: 20, complete: true }
    ])
  })

  it('marks the twenty-day window incomplete when the local window only holds twelve rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(12),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)

    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected safe ETF presentation')
    expect(result.etf.btc.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '+$50', complete: true },
      { windowDays: 20, coveredDays: 12, netFlowUsd: '+$78', complete: false }
    ])
    expect(result.etf.eth.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '-$50', complete: true },
      { windowDays: 20, coveredDays: 12, netFlowUsd: '-$78', complete: false }
    ])
    expect(result.etf.coverage).toEqual([
      { windowDays: 5, coveredDays: 5, complete: true },
      { windowDays: 20, coveredDays: 12, complete: false }
    ])
  })

  it('does not fabricate cumulative windows when the ETF snapshot is unavailable', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: { state: 'unavailable' },
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)

    expect(result).toMatchObject({ state: 'available', etf: 'unavailable' })
    expect(JSON.stringify(result)).not.toContain('cumulative')
  })

  it('merges only common persisted capital, BTC, and ETH dates into three-series chart rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01, dailyFlows: stablecoinRows() }
    }, asOf)

    expect(result).toMatchObject({
      state: 'available',
      etf: {
        state: 'available',
        btc: { asset: 'BTC', latestNetFlowUsd: '+$30', observedAt: '2026-08-18T07:00:00.000Z' },
        eth: { asset: 'ETH', latestNetFlowUsd: '-$30', observedAt: '2026-08-18T07:00:00.000Z' }
      }
    })
    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected safe ETF presentation')
    expect(result.etf.btc.rows).toHaveLength(30)
    expect(result.etf.eth.rows).toHaveLength(30)
    expect(result.etf.btc.rows.at(-2)).toMatchObject({ direction: 'zero', magnitudePercent: 0 })
    if (result.flowHistory?.state !== 'available') throw new Error('expected a readable flow history')
    expect(result.flowHistory.rows[0]).toEqual({ tradingDate: '2026-08-11', funds: -23, btc: 24, eth: -24 })
    expect(result.flowHistory.rows).toHaveLength(7)
  })

  it('reports too few aligned days as "not yet" instead of "the sources failed"', () => {
    // Valid stablecoin history, but the ETF window only overlaps its last three days.
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshotStartingAt('2026-08-15', 5),
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1,
        change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0,
        dailyFlows: stablecoinRows()
      }
    }, asOf)

    if (result.state !== 'available') throw new Error('expected safe state')
    expect(result.flowHistory).toEqual({ state: 'not-yet', availableDays: 3 })
  })

  it('reports zero aligned days as "not yet" with a zero count', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshotStartingAt('2026-06-01', 5),
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1,
        change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0,
        dailyFlows: stablecoinRows()
      }
    }, asOf)

    if (result.state !== 'available') throw new Error('expected safe state')
    expect(result.flowHistory).toEqual({ state: 'not-yet', availableDays: 0 })
  })

  it('keeps the flow unknown when the stablecoin daily history is missing altogether', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1,
        change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0
      }
    }, asOf)

    if (result.state !== 'available') throw new Error('expected safe state')
    expect(result.flowHistory).toBeUndefined()
  })

  it('keeps a malformed ETF DTO unavailable without affecting verified stablecoin facts', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial',
      etf: { ...etfSnapshot(), btc: { ...etfSnapshot().btc, asset: 'ETH' } },
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)

    expect(result).toMatchObject({ state: 'available', currentUsd: '$254.9B', etf: 'unavailable' })
  })

  it('keeps a complete zero-flow ETF window available for explicit zero-axis bars', () => {
    const snapshot = etfSnapshot()
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial',
      etf: {
        ...snapshot,
        btc: { ...snapshot.btc, rows: snapshot.btc.rows.map((row) => ({ ...row, netFlowUsd: 0 })) },
        eth: { ...snapshot.eth, rows: snapshot.eth.rows.map((row) => ({ ...row, netFlowUsd: 0 })) }
      },
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)

    expect(result).toMatchObject({
      state: 'available',
      etf: { state: 'available', btc: { latestNetFlowUsd: '$0' }, eth: { latestNetFlowUsd: '$0' } }
    })
    if (result.state !== 'available' || result.etf === 'unavailable') throw new Error('expected zero-flow ETF presentation')
    expect(result.etf.btc.rows.every((row) => row.direction === 'zero' && row.magnitudePercent === 0)).toBe(true)
  })

  it.each([
    [{ state: 'empty', asOf }, { state: 'empty' }],
    [{ state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: Number.POSITIVE_INFINITY, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: Number.MAX_VALUE, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: '2026-08-18T07:00:00Z', verifiedAt: asOf, currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable' }]
  ])('fails closed for unsafe safe-query variants', (input, expected) => {
    expect(projectDashboardCapitalConditionsSnapshot(input, asOf)).toEqual(expected)
  })

  it('projects negative zero signed facts as ordinary unsigned zero', () => {
    expect(projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, etf: { state: 'unavailable' }, conclusion: 'partial',
      coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: 1, change1dUsd: -0, change1dPercent: -0, change7dUsd: -0, change7dPercent: -0, change30dUsd: -0, change30dPercent: -0 }
    }, asOf)).toEqual({
      state: 'available', conclusion: 'partial', etf: 'unavailable', observedAt: asOf, currentUsd: '$1',
      change1dUsd: '$0', change1dPercent: '0.00%', change7dUsd: '$0', change7dPercent: '0.00%', change30dUsd: '$0', change30dPercent: '0.00%'
    })
  })

  it('owns the accepted compact number policy without using it for conclusion logic', () => {
    expect(dashboardCapitalConditionsPresentationPolicy).toMatchObject({
      usd: {
        maximumFractionDigits: 1,
        compactUnits: [
          { suffix: 'B', threshold: 1_000_000_000 },
          { suffix: 'M', threshold: 1_000_000 },
          { suffix: 'K', threshold: 1_000 }
        ]
      },
      percent: { fractionDigits: 2, includePositiveSign: true }
    })
  })

  it.each([
    [999, '$999'],
    [1_000, '$1K'],
    [1_000_000, '$1M'],
    [1_000_000_000, '$1B']
  ])('keeps the named compact-unit boundary for %d USD', (currentUsd, expected) => {
    expect(projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, etf: { state: 'unavailable' }, conclusion: 'partial',
      coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)).toMatchObject({ state: 'available', currentUsd: expected })
  })
})

function etfSnapshot(length = 30) {
  const dates = Array.from({ length }, (_, index) => new Date(Date.parse('2026-07-19T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  const observedAt = '2026-08-18T07:00:00.000Z'
  return {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter' as const, windowEnd: dates.at(-1)!, verifiedAt: observedAt,
    btc: { asset: 'BTC' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index === 28 ? 0 : index + 1, observedAt })) },
    eth: { asset: 'ETH' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index === 28 ? 0 : -(index + 1), observedAt })) }
  }
}

function stablecoinRows() {
  const dates = Array.from({ length: 30 }, (_, index) => new Date(Date.parse('2026-07-19T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  return dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index === 0 ? 100 : -index }))
}

function etfSnapshotStartingAt(start: string, length: number) {
  const dates = Array.from({ length }, (_, index) => new Date(Date.parse(`${start}T00:00:00.000Z`) + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  const observedAt = '2026-08-18T07:00:00.000Z'
  return {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter' as const, windowEnd: dates.at(-1)!, verifiedAt: observedAt,
    btc: { asset: 'BTC' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt })) },
    eth: { asset: 'ETH' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt })) }
  }
}

describe('ETF signal chip', () => {
  const OPEN = { panel: true, notification: true } as const
  const CLOSED = { panel: false, notification: false } as const
  const tradingDay = '2026-08-28T00:00:00.000Z'

  const signal = (overrides: Partial<ModuleSignal> = {}): ModuleSignal => ({
    version: '1',
    moduleId: 'etf-flows',
    ruleId: 'etf-outflow-3d',
    asset: 'btc',
    severity: 'medium',
    observedAt: tradingDay,
    cadence: { kind: 'trading-day' },
    values: { cumulativeNetFlowUsd: -150_000_000, coveredDays: 3, requiredDays: 3 },
    dedupeKey: 'etf-flows:etf-outflow-3d:btc:2026-08-28',
    readiness: 'available',
    triggerOwner: 'module-signal',
    ...overrides
  })

  /** 一次成功的读取：牌子的模型只关心信号本身。 */
  const read = (signals: readonly ModuleSignal[]) => ({
    state: 'available' as const,
    signals: signals.map(signal => ({ signal, window: { unit: 'trading-days' as const, amount: 3, upperBoundMs: null } })),
    droppedInvalid: 0
  })

  // 金额只从规则给的 `values` 里读：这里再求和一次，卡片就会和通知各说一个数。
  it('reads the amount and the coverage out of the rule’s own values', () => {
    expect(projectEtfOutflowChip(read([signal()]), OPEN)).toEqual({
      state: 'alert', asset: 'btc', amountUsd: '$150M', cumulativeUsd: '-$150M',
      coveredDays: 3, requiredDays: 3, observedAt: tradingDay
    })
  })

  it('lets the loudest signal speak and keeps the one-chip rule', () => {
    const chip = projectEtfOutflowChip(read([
      signal(),
      signal({ asset: 'eth', severity: 'high', values: { cumulativeNetFlowUsd: -320_000_000, coveredDays: 3, requiredDays: 3 } })
    ]), OPEN)
    expect(chip).toMatchObject({ state: 'alert', asset: 'eth', amountUsd: '$320M' })
  })

  it('shows no number when the rule could not judge, and never calls it quiet', () => {
    expect(projectEtfOutflowChip(read([signal({ readiness: 'unavailable' })]), OPEN)).toEqual({ state: 'insufficient' })
    expect(projectEtfOutflowChip(read([signal({ values: { coveredDays: 2, requiredDays: 3 } })]), OPEN)).toEqual({ state: 'insufficient' })
  })

  // 方向：这条规则说的是「钱在撤」，净流入不是它的事。没有这条用例，符号写反也能全绿——
  // 牌子会对一笔流入喊「净流出 $150M」，而卡上其他数字看起来都对。
  it('keeps an inflow off the chip, whatever its size', () => {
    expect(projectEtfOutflowChip(read([
      signal({ values: { cumulativeNetFlowUsd: 150_000_000, coveredDays: 3, requiredDays: 3 } })
    ]), OPEN)).toEqual({ state: 'insufficient' })
    expect(projectEtfOutflowChip(read([
      signal({ values: { cumulativeNetFlowUsd: 0, coveredDays: 3, requiredDays: 3 } })
    ]), OPEN)).toEqual({ state: 'insufficient' })
  })

  // 逐资产的规则必须点名资产：说不清是哪个资产，就不能拿它的数画牌子。
  it('refuses to name an amount without an asset', () => {
    expect(projectEtfOutflowChip(read([signal({ asset: null })]), OPEN)).toEqual({ state: 'insufficient' })
  })

  it('draws nothing when the rule has nothing to say', () => {
    expect(projectEtfOutflowChip(read([]), OPEN)).toEqual({ state: 'hidden' })
    expect(projectEtfOutflowChip(read([signal({ moduleId: 'open-interest' })]), OPEN)).toEqual({ state: 'hidden' })
  })

  // 读不到 ≠ 没事：读取失败有自己的那一态，读者能重试；没事不能重试。
  it('marks a failed signal read as its own state, not as insufficient data', () => {
    expect(projectEtfOutflowChip({ state: 'unavailable', failureCode: 'query-failed' }, OPEN))
      .toEqual({ state: 'unreadable', failureCode: 'query-failed' })
    expect(projectEtfOutflowChip({ state: 'unavailable', failureCode: 'invalid-as-of' }, OPEN))
      .toEqual({ state: 'unreadable', failureCode: 'invalid-as-of' })
    // 还没有读取时什么都不画：那是「还没到」，不是「读不到」。
    expect(projectEtfOutflowChip(undefined, OPEN)).toEqual({ state: 'hidden' })
  })

  // 出厂状态：牌子开着，生产调用不需要传开关就画得出来。
  it('draws from the shipped switch without being handed one', () => {
    expect(projectEtfOutflowChip(read([signal()]))).toMatchObject({ state: 'alert', amountUsd: '$150M' })
  })

  // 牌子是总闸：它关着的时候，卡片连灰牌都不画。
  it('draws nothing at all while the panel switch is closed', () => {
    expect(projectEtfOutflowChip(read([signal()]), CLOSED)).toEqual({ state: 'hidden' })
    expect(projectEtfOutflowChip(undefined, CLOSED)).toEqual({ state: 'hidden' })
  })
})
