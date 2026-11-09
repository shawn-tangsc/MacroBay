import { describe, expect, it } from 'vitest'

import type { ModuleSignal } from '../../../contracts/moduleSignal'
import type { ModuleSignalRead } from '../../../contracts/moduleSignalRead'
import { projectDashboardPositioning, projectModuleSignalChip } from './dashboardOpenInterestModel'

const at = '2026-10-31T14:30:00.000Z'

const signal = (overrides: Partial<ModuleSignal> = {}): ModuleSignal => ({
  version: '1',
  moduleId: 'open-interest',
  ruleId: 'oi-liquidation-proxy',
  asset: 'btc',
  severity: 'medium',
  observedAt: at,
  cadence: { kind: 'intraday', bucketMs: 15 * 60_000 },
  values: { dropPct: -1.8, volumeMultiple: 2.4, notionalUsd: 7.4e9 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-10-31T14:30:00.000Z',
  readiness: 'available',
  triggerOwner: 'module-signal',
  ...overrides
})

/** A successful read carrying these signals; the chip never sees the window. */
/**
 * 一次读不成的四种来路，读者能做的事不同：形状/版本不符时点重试必然再失败，必须说清「完全退出后重开」；
 * 其余三种（时钟不合法、契约自报读不到、客户端抛错）是「这次没读成」，可以再试。
 */
it('names the cause of an unreadable positioning read, because only some are worth a retry', () => {
  const readAt = (value: unknown, asOfArg: string = at) => projectDashboardPositioning(value, asOfArg, '7d')
  expect(readAt({}, 'not-a-clock')).toMatchObject({ state: 'unavailable', cause: 'invalid-clock' })
  expect(readAt({ state: 'available' })).toMatchObject({ state: 'unavailable', cause: 'contract-mismatch' })
  expect(readAt({ state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }))
    .toMatchObject({ state: 'unavailable', cause: 'query-failed' })
  expect(readAt({ get state() { throw new Error('boom') } })).toMatchObject({ state: 'unavailable', cause: 'query-failed' })
})

const read = (signals: readonly ModuleSignal[]): ModuleSignalRead => ({
  state: 'available',
  signals: signals.map(signal => ({ signal, window: { unit: 'buckets', amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 } })),
  droppedInvalid: 0
})

/**
 * 卡片说「数据已滞后」，但库里数据比它新（用户 2026-11-10 报）。
 *
 * 7 天窗口把 15 分钟格折成小时点、**按小时开头盖时间戳**（`openInterestHistoryQuery.foldToHours`），
 * 所以最后那个点的时刻最多比它承载的读数早 45 分钟。判定却拿这个折叠后的点去减 `asOf`：
 * 01:45 的读数被标成 01:00，`asOf` 一到 01:30 之后就越过 30 分钟门槛 → 报「已滞后」，而数据是新的。
 */
const available = (overrides: Record<string, unknown> = {}) => ({
  state: 'available' as const,
  asOf: '2026-11-10T01:50:00.000Z',
  window: '7d' as const,
  btc: [
    { observedAt: '2026-11-10T00:00:00.000Z', notionalUsd: 7_100_000_000 },
    { observedAt: '2026-11-10T01:00:00.000Z', notionalUsd: 7_269_000_000 }
  ],
  eth: [
    { observedAt: '2026-11-10T00:00:00.000Z', notionalUsd: 3_100_000_000 },
    { observedAt: '2026-11-10T01:00:00.000Z', notionalUsd: 3_190_000_000 }
  ],
  liquidationHintsState: 'available' as const,
  ...overrides
})

it('hands the card both instants from one place: the folded point and the newest reading', () => {
  // 卡面那段「观测时间 X · 最新读数 Y」不许各算一处：投影里一次给出两个时刻（同源），
  // 否则窗口切换时会冒出「显示 01:00 · 01:45 但曲线末点其实不是 01:00」的第三类错。
  const view = projectDashboardPositioning(available({ newestReadingAt: '2026-11-10T01:45:00.000Z' }), '2026-11-10T01:50:00.000Z', '7d')
  if (view.state !== 'available') throw new Error('expected available')
  expect(view.pointAt).toBe('2026-11-10T01:00:00.000Z')
  expect(view.newestReadingAt).toBe('2026-11-10T01:45:00.000Z')
  // 老载荷没有最新读数：两个时刻相等（同一个来源），卡面因此只写一段。
  const legacy = projectDashboardPositioning(available(), '2026-11-10T01:50:00.000Z', '7d')
  if (legacy.state !== 'available') throw new Error('expected available')
  expect(legacy.pointAt).toBe('2026-11-10T01:00:00.000Z')
  expect(legacy.newestReadingAt).toBe(legacy.pointAt)
})

it('does not call the data stale when the reading behind the folded hour is newer', () => {
  // 折叠点的时刻是 01:00，但那一格承载的最新读数是 01:45 —— 数据只差 5 分钟，不是「已滞后」。
  const fresh = projectDashboardPositioning(available({ newestReadingAt: '2026-11-10T01:45:00.000Z' }), '2026-11-10T01:50:00.000Z', '7d')
  expect(fresh.state).toBe('available')
  expect(fresh.state === 'available' ? fresh.staleSince : undefined).toBeUndefined()
})

it('still says 已滞后 when the newest reading really is old', () => {
  // 反方向：最新读数就是 01:00、asOf 已经 01:50 —— 这 50 分钟是真实的滞后，必须照旧报出来。
  const stale = projectDashboardPositioning(available({ newestReadingAt: '2026-11-10T01:00:00.000Z' }), '2026-11-10T01:50:00.000Z', '7d')
  expect(stale.state === 'available' ? stale.staleSince : undefined).toBe('2026-11-10T01:00:00.000Z')
  // 老载荷没有这个字段时退回折叠点（与今天行为一致，不静默变成「永不滞后」）。
  const legacy = projectDashboardPositioning(available(), '2026-11-10T01:50:00.000Z', '7d')
  expect(legacy.state === 'available' ? legacy.staleSince : undefined).toBe('2026-11-10T01:00:00.000Z')
})

describe('module signal chip', () => {
  it('says the read failed, with the code, instead of drawing nothing', () => {
    // The failure is a different fact from a quiet market, so it gets its own state; the code is
    // kept because retryability is decided from it further down.
    expect(projectModuleSignalChip({ state: 'unavailable', failureCode: 'query-failed' }))
      .toMatchObject({ state: 'unreadable', failureCode: 'query-failed' })
    expect(projectModuleSignalChip({ state: 'unavailable', failureCode: 'invalid-as-of' }))
      .toMatchObject({ state: 'unreadable', failureCode: 'invalid-as-of' })
  })

  it('draws nothing when the rule has nothing to say', () => {
    // The product decision: a normal market shows no chip at all, not an empty container.
    expect(projectModuleSignalChip(read([]))).toEqual({ state: 'hidden' })
    expect(projectModuleSignalChip(undefined)).toEqual({ state: 'hidden' })
  })

  it('shows the reading a fired rule produced, numbers intact', () => {
    expect(projectModuleSignalChip(read([signal()]))).toEqual({
      state: 'alert', asset: 'btc', direction: 'long', dropPct: -1.8, volumeMultiple: 2.4,
      // The internal rule id stays out of the view: the card shows the rule's own words instead.
      observedAt: at
    })
  })

  it('shows only the loudest signal when one module reports several', () => {
    const chip = projectModuleSignalChip(read([
      signal({ severity: 'medium' }),
      signal({ severity: 'high', values: { dropPct: -2.9, volumeMultiple: 3.4, notionalUsd: 7.2e9 } }),
      signal({ severity: 'low', asset: 'eth' })
    ]))
    expect(chip).toMatchObject({ state: 'alert', dropPct: -2.9, asset: 'btc' })
  })

  it('says data is insufficient instead of printing a partial reading', () => {
    expect(projectModuleSignalChip(read([signal({ readiness: 'unavailable', values: {} })]))).toEqual({ state: 'insufficient' })
    // An asset-less reading is a contract failure, and the card must not invent one.
    expect(projectModuleSignalChip(read([signal({ asset: null })]))).toEqual({ state: 'insufficient' })
  })

  it('ignores another module: that chip belongs to that module’s card', () => {
    expect(projectModuleSignalChip(read([signal({ moduleId: 'etf-flows', ruleId: 'etf-outflow-3d' })]))).toEqual({ state: 'hidden' })
  })

  it('carries no severity into the view: the reader must not compare two modules by it', () => {
    const chip = projectModuleSignalChip(read([signal({ severity: 'high' })]))
    expect(JSON.stringify(chip)).not.toContain('severity')
    expect(JSON.stringify(chip)).not.toContain('high')
  })
})

describe('the window projection', () => {
  const dto = (shown: number, total: number) => ({
    state: 'available' as const, asOf: at, window: '24h' as const,
    btc: [{ observedAt: at, notionalUsd: 8.9e9 }], eth: [],
    liquidationHints: Array.from({ length: shown }, (_, index) => ({
      observedAt: new Date(Date.parse(at) - index * 900_000).toISOString(),
      asset: 'btc' as const, direction: 'long' as const, dropPct: -1.9, volumeMultiple: 3, notionalUsd: 8.9e9
    })),
    liquidationHintsTotal: total,
    liquidationHintsState: 'available' as const
  })

  it('reports the hits it could not draw, and reports zero when none were cut', () => {
    // 只给布尔的话，读者会把「画了 8 个」当成「窗口里就 8 次」——把截断说成全部。
    expect(projectDashboardPositioning(dto(8, 10), at, '24h')).toMatchObject({ state: 'available', hiddenHits: 2 })
    expect(projectDashboardPositioning(dto(5, 5), at, '24h')).toMatchObject({ state: 'available', hiddenHits: 0 })
  })
})

describe('the direction on a mark', () => {
  it('carries the rule\'s own direction, both sides, never inferred from the sign', () => {
    // 空头那条判的是价格上涨，读数符号与多头相反；渲染层如果按跌幅正负猜，就把两头说反了。
    const dto = {
      state: 'available' as const, asOf: at, window: '24h' as const,
      btc: [{ observedAt: at, notionalUsd: 8.9e9 }], eth: [],
      liquidationHints: [
        { observedAt: at, asset: 'btc' as const, direction: 'long' as const, dropPct: -2.1, pricePct: -1.4, volumeMultiple: 3, notionalUsd: 8.9e9 },
        { observedAt: new Date(Date.parse(at) - 900_000).toISOString(), asset: 'eth' as const, direction: 'short' as const, dropPct: -1.8, pricePct: 1.2, volumeMultiple: 2.4, notionalUsd: 2.4e9 }
      ],
      liquidationHintsTotal: 2,
      liquidationHintsState: 'available' as const
    }
    const projected = projectDashboardPositioning(dto, at, '24h')
    if (projected.state !== 'available') throw new Error('expected available')
    expect(projected.hints.map(mark => [mark.asset, mark.direction])).toEqual([['btc', 'long'], ['eth', 'short']])
  })
})
