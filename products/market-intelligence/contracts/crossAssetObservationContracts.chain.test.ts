import { describe, expect, it } from 'vitest'

import { createCrossAssetSnapshotQuery } from '../service/intelligence/cross-asset/crossAssetSnapshotQuery'
import { parseCrossAssetSnapshot } from './crossAssetObservationContracts'
import type { CrossAssetRejection } from './crossAssetObservationContracts'

/**
 * 真链守卫：**服务真产出的快照，喂给渲染层那个解析器，必须通过**。
 *
 * 为什么要有这一条：`2026-11-11` 的事故是两边各自的手写夹具都绿、链路却断——`metric()` 的字段表
 * 把可选的 `atMs` 写成了固定字段（`exact()` 数属性个数，于是它变成必填），而只有 `closedReturns`
 * 带 `atMs`，`relativeReturns` 与可用的相关性都不带 → 真快照被自己的契约拒掉（`rejectedAt='keys'`），
 * 界面因此整表「未接入」+ 一句假的「版本不一致，重启应用」。
 *
 * 所以这里不喂夹具形状的快照：从 `createCrossAssetSnapshotQuery` 真跑一份（含可用的
 * `relativeReturns` 与可用的 `correlations`），再交给 `parseCrossAssetSnapshot`。
 */
const STEP = 300_000
const at = (iso: string) => Date.parse(iso)
const nowMs = at('2026-07-16T02:00:00.000Z')

const bar = (symbol: string, barOpenMs: number, close: number) => ({
  symbol, barOpenMs, barEndMs: barOpenMs + STEP, open: String(close), high: String(close + 1), low: String(close - 1), close: String(close), volume: '1'
})

/** 四条腿各 289 根连续 5 分钟 K 线（24h 满覆盖，所以相关性与相对涨跌都是可用的）。 */
const continuous = (symbol: string, base: number) => Array.from({ length: 289 }, (_, index) =>
  // 收盘要有真实波动（±0.4% 交替）：一条直线会让相关系数落进 `zero-variance`，
  // 那样这条守卫就覆盖不到「可用的相关性」那一支了。
  bar(symbol, nowMs - (289 - index) * STEP, base * (index % 2 === 0 ? 1.002 : 0.998)))
const bySymbol = {
  USTEC: continuous('USTEC', 28_000),
  QQQUSDT: continuous('QQQUSDT', 680),
  BTCUSDT: continuous('BTCUSDT', 118_000),
  ETHUSDT: continuous('ETHUSDT', 3_900)
}

function produceSnapshot() {
  const query = createCrossAssetSnapshotQuery({
    now: () => nowMs,
    store: {
      revision: 1,
      queryAt: (request: { symbol: string; fromMs: number; toMs: number; asOfMs: number }) =>
        ((bySymbol as Record<string, readonly unknown[]>)[request.symbol] ?? [] as unknown[])
          .map(entry => entry as ReturnType<typeof bar>)
          .filter(entry => entry.barOpenMs >= request.fromMs && entry.barOpenMs <= request.toMs && entry.barEndMs <= request.asOfMs)
    } as never,
    live: () => ({
      state: 'live' as const,
      quotes: {
        index: { state: 'live' as const, price: '709.10', tradedAtMs: nowMs, receivedAtMs: nowMs },
        btc: { state: 'live' as const, price: '118.25', tradedAtMs: nowMs, receivedAtMs: nowMs },
        eth: { state: 'live' as const, price: '3.91', tradedAtMs: nowMs, receivedAtMs: nowMs }
      }
    }),
    indexFeed: () => ({ state: 'ready' as const })
  })
  return query.query({ range: '24h' })
}

describe('a snapshot the service really produced parses on the renderer side', () => {
  it('passes its own contract, including the metrics that carry no atMs', () => {
    const raw = produceSnapshot()
    const rejection: CrossAssetRejection = {}
    const parsed = parseCrossAssetSnapshot(raw, rejection)

    // 先钉「没有被拒」以及拒在哪一字段：这条用例存在的意义就是它。
    expect(rejection.field, `rejectedAt=${rejection.field ?? 'none'}`).toBeUndefined()
    expect(parsed).toBeDefined()

    // 真快照里必须包含**不带 atMs** 的那两族——这正是事故点，缺了它这条守卫就没覆盖到。
    expect(raw.relativeReturns.btcMinusIndex.state, 'relativeReturns must be available here').toBe('available')
    expect(raw.relativeReturns.ethMinusBtc.state, 'relativeReturns must be available here').toBe('available')
    expect(raw.correlations.indexBtc.state, 'correlations must be available here').toBe('available')
    expect('atMs' in raw.relativeReturns.btcMinusIndex).toBe(false)
    expect('atMs' in raw.correlations.indexBtc).toBe(false)

    // 带 atMs 的那一族（closedReturns）仍然是可用的，且时刻是分析末端那根。
    expect(raw.closedReturns.btc['24h'].state).toBe('available')
    expect(parsed!.closedReturns.btc['24h'].state).toBe('available')
  })
})
