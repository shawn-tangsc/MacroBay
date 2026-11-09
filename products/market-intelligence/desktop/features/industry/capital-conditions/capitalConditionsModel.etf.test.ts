import { describe, expect, it } from 'vitest'

import { projectDashboardCapitalConditionsSnapshot } from './capitalConditionsModel'

/**
 * 资金面那两格的读数（`etfReading`）单独一份：**有值 / 缺（未知 + 原因）/ 不可比** 是三件不同的事。
 *
 * 从 `capitalConditionsModel.test.ts` 原样挪出来（体积门禁：那份文件当时 480 行，离 500 只剩 20）。
 * 只挪文件，用例与断言一字未改。
 */
const asOf = '2026-08-18T08:00:00.000Z'

/**
 * 资金面那两格：**有值 / 缺（未知 + 原因）/ 不可比** 是三件不同的事。
 *
 * `etf` 那个字符串出口把四条完全不同的路都压成 `'unavailable'`：快照读不到、BTC 没最新值、
 * ETH 没最新值、两支窗口不齐。于是 BTC 明明有数字，整块却换成一行错误态。以下四条钉住拆开后的语义。
 */
describe('ETF reading: each asset keeps its own value, and alignment only affects the comparison', () => {
  const observedAt = '2026-08-18T07:00:00.000Z'
  function datesEndingAt(end: string, length: number): string[] {
    const endMs = Date.parse(`${end}T00:00:00.000Z`)
    return Array.from({ length }, (_, index) => new Date(endMs - (length - 1 - index) * 86_400_000).toISOString().slice(0, 10))
  }
  function snapshot(btcEnd: string, ethEnd: string, length = 30) {
    return {
      state: 'available' as const, schemaVersion: 1 as const, sourceId: '0xrouter' as const, windowEnd: btcEnd, verifiedAt: observedAt,
      btc: { asset: 'BTC' as const, rows: datesEndingAt(btcEnd, length).map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt })) },
      eth: { asset: 'ETH' as const, rows: datesEndingAt(ethEnd, length).map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt })) }
    }
  }
  function project(etf: unknown) {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf,
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)
    if (result.state !== 'available') throw new Error(`expected an available card, got ${result.state}`)
    // 模型每一张可用卡片都必须给出读数；缺了就是模型没填（本阶段它是可选字段）。
    if (!result.etfReading) throw new Error('expected the ETF reading on an available card')
    return result.etfReading
  }

  it('keeps the BTC cell when only ETH has no usable latest value', () => {
    const value = snapshot('2026-08-17', '2026-08-17')
    // 最新一行给了不可格式化的数字：契约只要求有限，投影层拒绝显示——这就是「有行但没有值」。
    const rows = value.eth.rows.map((row, index) => index === value.eth.rows.length - 1 ? { ...row, netFlowUsd: 1e16 } : row)
    const reading = project({ ...value, eth: { ...value.eth, rows } })

    expect(reading.state).toBe('partial')
    expect(reading.btc?.latestNetFlowUsd).toMatch(/\$\d/)
    expect(reading.eth).toBeUndefined()
    expect(reading.missing).toEqual({ eth: 'value-missing' })
  })

  it('keeps both cells when the windows do not line up, and says so only in the comparison', () => {
    const reading = project(snapshot('2026-08-17', '2026-08-16'))

    expect(reading.state).toBe('available')
    expect(reading.btc?.latestNetFlowUsd).toMatch(/\$\d/)
    expect(reading.eth?.latestNetFlowUsd).toMatch(/\$\d/)
    expect(reading.missing).toBeUndefined()
    expect(reading.comparison).toEqual({ state: 'unaligned', reason: 'latest-trading-day-differs', lagging: 'eth', laggingDays: 1 })
  })

  it('reports an unreadable snapshot as unknown with a reason, not as an empty block', () => {
    const reading = project({ state: 'unavailable' })

    expect(reading.state).toBe('unreadable')
    expect(reading.btc).toBeUndefined()
    expect(reading.eth).toBeUndefined()
    expect(reading.missing).toEqual({ btc: 'source-unreadable', eth: 'source-unreadable' })
    expect(reading.comparison).toEqual({ state: 'unaligned', reason: 'source-unreadable' })
  })

  it('treats a zero net flow as a value, not as missing', () => {
    const value = snapshot('2026-08-17', '2026-08-17')
    const rows = value.btc.rows.map((row, index) => index === value.btc.rows.length - 1 ? { ...row, netFlowUsd: 0 } : row)
    const reading = project({ ...value, btc: { ...value.btc, rows } })

    expect(reading.state).toBe('available')
    expect(reading.btc?.latestNetFlowUsd).toBe('$0')
    expect(reading.missing).toBeUndefined()
  })
})

/**
 * 对比列要念得出「落后 N 个交易日」，表头要念得出「5 天里覆盖了 4 天」——这两件都是**读数的派生**，
 * 展示层自己算就是第二次实现。
 */
describe('ETF reading: the lag is counted in trading days, and coverage is computed across both sides', () => {
  const observedAt = '2026-08-18T07:00:00.000Z'
  /** 只取工作日：rows 是交易日序列，周末不该被算成「落后」。 */
  function tradingDaysEndingAt(end: string, length: number): string[] {
    const days: string[] = []
    let cursor = Date.parse(`${end}T00:00:00.000Z`)
    while (days.length < length) {
      const day = new Date(cursor).getUTCDay()
      if (day !== 0 && day !== 6) days.unshift(new Date(cursor).toISOString().slice(0, 10))
      cursor -= 86_400_000
    }
    return days
  }
  function snapshot(btcEnd: string, ethEnd: string, length = 30) {
    return {
      state: 'available' as const, schemaVersion: 1 as const, sourceId: '0xrouter' as const, windowEnd: btcEnd, verifiedAt: observedAt,
      btc: { asset: 'BTC' as const, rows: tradingDaysEndingAt(btcEnd, length).map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt })) },
      eth: { asset: 'ETH' as const, rows: tradingDaysEndingAt(ethEnd, length).map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt })) }
    }
  }
  function project(etf: unknown) {
    const result = projectDashboardCapitalConditionsSnapshot({
      state: 'available', asOf, conclusion: 'partial', etf,
      coreStablecoins: { observedAt: '2026-08-18T07:00:00.000Z', verifiedAt: '2026-08-18T07:30:00.000Z', currentUsd: 254_900_000_000, change1dUsd: 0, change1dPercent: 0, change7dUsd: 0, change7dPercent: 0, change30dUsd: 1, change30dPercent: 0.01 }
    }, asOf)
    if (result.state !== 'available' || !result.etfReading) throw new Error('expected the ETF reading')
    return result.etfReading
  }

  it('counts the lag in trading days, never in calendar days, and never reports a zero lag for two different dates', () => {
    // ETH 停在周五 08-14，BTC 已经走到周二 08-18：中间只有 08-17、08-18 两个交易日（周末不算）。
    const reading = project(snapshot('2026-08-18', '2026-08-14'))

    // 契约不变量：日期不同就一定要落后至少一个交易日——「落后 0 天」只可能意味着日期相同。
    if (reading.comparison.state === 'unaligned' && reading.comparison.reason === 'latest-trading-day-differs') {
      expect(reading.comparison.lagging).toBe('eth')
      expect(reading.comparison.laggingDays).toBeGreaterThan(0)
    } else {
      throw new Error('expected an unaligned comparison for two different latest trading days')
    }
    expect(reading.comparison).toEqual({ state: 'unaligned', reason: 'latest-trading-day-differs', lagging: 'eth', laggingDays: 2 })
  })

  it('still says how much of each window is covered when only one side has a value', () => {
    const value = snapshot('2026-08-18', '2026-08-18')
    // 30 个交易日 → 5 天窗口完整、20 天窗口也完整；只留 BTC 有值时，min 退化成那一支的覆盖。
    const reading = project(value)
    expect(reading.coverage.map(window => [window.windowDays, window.coveredDays])).toEqual([[5, 5], [20, 20]])

    const ethBroken = project({ ...value, eth: { ...value.eth, rows: value.eth.rows.map((row, index) => index === value.eth.rows.length - 1 ? { ...row, netFlowUsd: 1e16 } : row) } })
    expect(ethBroken.state).toBe('partial')
    // 只有一支有值也照算：表头仍能说「5 天里覆盖 5 天」，而不是把覆盖数藏起来。
    expect(ethBroken.coverage.map(window => [window.windowDays, window.coveredDays])).toEqual([[5, 5], [20, 20]])
  })
})
