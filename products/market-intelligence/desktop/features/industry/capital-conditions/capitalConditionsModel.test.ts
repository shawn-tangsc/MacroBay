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
      state: 'available', conclusion: 'partial', etfReading: { state: 'unreadable', missing: { btc: 'source-unreadable', eth: 'source-unreadable' }, comparison: { state: 'unaligned', reason: 'source-unreadable' }, coverage: [] }, observedAt: '2026-08-18T07:00:00.000Z',
      currentUsd: '$254.9B', change1dUsd: '+$82.4M', change1dPercent: '+0.03%', change7dUsd: '+$82.4M', change7dPercent: '+0.03%',
      change30dUsd: '-$500M', change30dPercent: '-0.21%'
    })
    const serialized = JSON.stringify(result)
    // 卡片状态里不许出现读取时刻、URL、原文或错误文本。
    expect(serialized).not.toMatch(/verifiedAt|https?:|raw|error|failure/i)
    // 唯一允许的 `source-` 字样是架构师定的那个闭集原因码，别的来源名一律不许上卡片状态。
    // 三处：两支各自的缺因 + 对比列的不可比原因。
    expect(serialized.match(/source-[a-z-]+/g) ?? []).toEqual(['source-unreadable', 'source-unreadable', 'source-unreadable'])
  })

  it('projects complete five- and twenty-day cumulative sums from the same validated rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)

    if (result.state !== 'available' || !result.etfReading.btc || !result.etfReading.eth) throw new Error('expected safe ETF presentation')
    expect(result.etfReading.btc!.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '+$111', complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: '+$381', complete: true }
    ])
    expect(result.etfReading.eth!.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '-$111', complete: true },
      { windowDays: 20, coveredDays: 20, netFlowUsd: '-$381', complete: true }
    ])
    expect(result.etfReading.coverage).toEqual([
      { windowDays: 5, coveredDays: 5, complete: true },
      { windowDays: 20, coveredDays: 20, complete: true }
    ])
  })

  it('marks the twenty-day window incomplete when the local window only holds twelve rows', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(12),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)

    if (result.state !== 'available' || !result.etfReading.btc || !result.etfReading.eth) throw new Error('expected safe ETF presentation')
    expect(result.etfReading.btc!.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '+$50', complete: true },
      { windowDays: 20, coveredDays: 12, netFlowUsd: '+$78', complete: false }
    ])
    expect(result.etfReading.eth!.cumulative).toEqual([
      { windowDays: 5, coveredDays: 5, netFlowUsd: '-$50', complete: true },
      { windowDays: 20, coveredDays: 12, netFlowUsd: '-$78', complete: false }
    ])
    expect(result.etfReading.coverage).toEqual([
      { windowDays: 5, coveredDays: 5, complete: true },
      { windowDays: 20, coveredDays: 12, complete: false }
    ])
  })

  it('does not fabricate cumulative windows when the ETF snapshot is unavailable', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: { state: 'unavailable' },
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }
    }, asOf)

    expect(result).toMatchObject({ state: 'available', etfReading: { state: 'unreadable' } })
    expect(JSON.stringify(result)).not.toContain('cumulative')
  })

  it('keeps one slot per calendar day up to asOf, carrying whichever series exist', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01, dailyFlows: stablecoinRows() }
    }, asOf)

    expect(result).toMatchObject({
      state: 'available',
      etfReading: {
        state: 'available',
        btc: { asset: 'BTC', latestNetFlowUsd: '+$30', observedAt: '2026-08-18T07:00:00.000Z' },
        eth: { asset: 'ETH', latestNetFlowUsd: '-$30', observedAt: '2026-08-18T07:00:00.000Z' }
      }
    })
    if (result.state !== 'available' || !result.etfReading.btc || !result.etfReading.eth) throw new Error('expected safe ETF presentation')
    expect(result.etfReading.btc!.rows).toHaveLength(30)
    expect(result.etfReading.eth!.rows).toHaveLength(30)
    expect(result.etfReading.btc!.rows.at(-2)).toMatchObject({ direction: 'zero', magnitudePercent: 0 })
    if (result.flowHistory?.state !== 'available') throw new Error('expected a readable flow history')
    // 横轴是日历，不是「有数据的那几天」：固定 7 格，每天一格。
    // 「今天」= asOf 的 UTC 日（2026-08-18）——它没有数据，所以**今天这一格不画**，
    // 窗口整体往前退一天，结束在昨天（2026-08-17）。用户 2026-11-16：
    // 「如果当天无数据就不显示，仅当天，但是前一天前无论有没有数据都要展示」。
    expect(result.flowHistory.rows.map((row) => row.tradingDate)).toEqual([
      '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17'
    ])
    // 有数据的那天三条线都在；数值照旧来自两份流水。
    expect(result.flowHistory.rows[1]).toEqual({ tradingDate: '2026-08-12', funds: -24, btc: 25, eth: -25 })
    // 窗口是**固定长度**：今天被拿掉，最前面补一天，不是只剩 6 格。
    expect(result.flowHistory.rows).toHaveLength(7)
  })

  it('reports too few days with any reading as "not yet" instead of "the sources failed"', () => {
    // 稳定币只有最后三天，ETF 那一份整个落在窗口之前：横轴照旧 7 格，但有读数的只有 3 天。
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshotStartingAt('2026-07-20', 5),
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1,
        change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0,
        dailyFlows: stablecoinRows().slice(-3)
      }
    }, asOf)

    if (result.state !== 'available') throw new Error('expected safe state')
    expect(result.flowHistory).toEqual({ state: 'not-yet', availableDays: 3 })
  })

  it('reports zero days with any reading as "not yet" with a zero count', () => {
    // 两份流水都落在横轴窗口之前：格子都在，但没有一天有读数。
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshotStartingAt('2026-06-01', 5),
      coreStablecoins: {
        observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1,
        change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0,
        dailyFlows: stablecoinRows().slice(0, 3)
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

    // 一支 DTO 的资产标错（ETH 位置写着 BTC）是**整包**不合契约：校验在资产标签上就拒了，两支都读不到。
    expect(result).toMatchObject({ state: 'available', currentUsd: '$254.9B', etfReading: { state: 'unreadable', missing: { btc: 'source-unreadable', eth: 'source-unreadable' } } })
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
      etfReading: { state: 'available', btc: { latestNetFlowUsd: '$0' }, eth: { latestNetFlowUsd: '$0' } }
    })
    if (result.state !== 'available' || !result.etfReading.btc) throw new Error('expected zero-flow ETF presentation')
    expect(result.etfReading.btc.rows.every((row) => row.direction === 'zero' && row.magnitudePercent === 0)).toBe(true)
  })

  it.each([
    [{ state: 'empty', asOf }, { state: 'empty' }],
    [{ state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' }, { state: 'unavailable', reason: 'snapshot-unavailable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: Number.POSITIVE_INFINITY, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable', reason: 'value-unformattable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: Number.MAX_VALUE, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable', reason: 'value-unformattable' }],
    [{ state: 'available', asOf, etf: { state: 'unavailable' }, coreStablecoins: { observedAt: '2026-08-18T07:00:00Z', verifiedAt: asOf, currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0 }, conclusion: 'partial' }, { state: 'unavailable', reason: 'contract-mismatch' }]
  ])('fails closed for unsafe safe-query variants', (input, expected) => {
    expect(projectDashboardCapitalConditionsSnapshot(input, asOf)).toEqual(expected)
  })

  it('projects negative zero signed facts as ordinary unsigned zero', () => {
    expect(projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, etf: { state: 'unavailable' }, conclusion: 'partial',
      coreStablecoins: { observedAt: asOf, verifiedAt: asOf, currentUsd: 1, change1dUsd: -0, change1dPercent: -0, change7dUsd: -0, change7dPercent: -0, change30dUsd: -0, change30dPercent: -0 }
    }, asOf)).toEqual({
      state: 'available', conclusion: 'partial', etfReading: { state: 'unreadable', missing: { btc: 'source-unreadable', eth: 'source-unreadable' }, comparison: { state: 'unaligned', reason: 'source-unreadable' }, coverage: [] }, observedAt: asOf, currentUsd: '$1',
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

describe('flow window, the "today may be missing" rule', () => {
  it('drops only today when today has no reading', () => {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshot(),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0, dailyFlows: stablecoinRows().slice(0, 27) }
    }, asOf)
    if (result.state !== 'available' || result.flowHistory?.state !== 'available') throw new Error('expected a readable flow history')
    // 流水里不可能有「今天」（验证器要求 tradingDate < asOf 的日），所以最后一格是昨天。
    expect(result.flowHistory.rows.at(-1)!.tradingDate).toBe('2026-08-17')
    expect(result.flowHistory.rows).toHaveLength(7)
  })

  it('keeps a gap day in the middle: no series, but the date stays and it is not zero', () => {
    // 稳定币流到 08-11 为止、ETF 从 08-13 起：**08-12 两条线都没有**——那一天必须留在横轴上，
    // 而且它前后两天都有数（「昨天缺数、前天有数」）。缺口不画柱，也不是 0。
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf: etfSnapshotStartingAt('2026-08-13', 5),
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 1, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 0, change30dPercent: 0, dailyFlows: stablecoinRows().slice(0, 24) }
    }, asOf)
    if (result.state !== 'available' || result.flowHistory?.state !== 'available') throw new Error('expected a readable flow history')
    // 窗口固定 7 格，缺数那天**只有日期**（没有 funds/btc/eth 任何一个键——不是 0）。
    const gap = result.flowHistory.rows.find((row) => row.tradingDate === '2026-08-12')
    expect(gap, '缺数的那天不许从横轴上消失').toEqual({ tradingDate: '2026-08-12' })
    // 前后两天照常带值。
    expect(result.flowHistory.rows.find((row) => row.tradingDate === '2026-08-11')).toMatchObject({ funds: expect.any(Number) })
    expect(result.flowHistory.rows.find((row) => row.tradingDate === '2026-08-13')).toMatchObject({ btc: expect.any(Number) })
    expect(result.flowHistory.rows).toHaveLength(7)
  })
})
