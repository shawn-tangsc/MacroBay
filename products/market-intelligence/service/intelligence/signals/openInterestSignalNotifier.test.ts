import { describe, expect, it, vi } from 'vitest'

import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { OpenInterestHistoryResult, OpenInterestLiquidationHint } from '../../../contracts/openInterestHistory'
import type { SignalAnalysisRequest } from '../jobs/requestSignalAnalysis'
import { signalTriggerKey } from '../../../contracts/moduleSignal'
import {
  createOpenInterestSignalNotifier,
  createSignalledOpenInterestRefresh,
  openInterestSignalNotificationPolicy,
  selectSignalNotificationCandidates
} from './openInterestSignalNotifier'
import { openInterestSignalsFromHistory } from './openInterestSignals'

const bucketMs = 15 * 60_000
const bucketAt = '2026-11-03T10:15:00.000Z'
const asOf = '2026-11-03T10:30:00.000Z'

const accepted: NotificationSubmitOutcome = { kind: 'accepted', recordId: 'record-1', levels: ['center'] }

function reading(overrides: Partial<Extract<OpenInterestHistoryResult, { state: 'available' }>> = {}): OpenInterestHistoryResult {
  return {
    state: 'available',
    asOf,
    window: '24h',
    btc: [{ observedAt: bucketAt, notionalUsd: 7.4e9 }],
    eth: [{ observedAt: bucketAt, notionalUsd: 2.4e9 }],
    liquidationHints: [{ observedAt: bucketAt, asset: 'btc', direction: 'long', dropPct: -2.7, volumeMultiple: 3.4, notionalUsd: 7.4e9 }],
    liquidationHintsState: 'available',
    ...overrides
  }
}

function notifier(input: Readonly<{
  history?: OpenInterestHistoryResult
  now?: string
}> = {}) {
  const submit = vi.fn(async (_request: NotificationSubmitRequest) => accepted)
  const notify = createOpenInterestSignalNotifier({
    submit,
    readHistory: async () => input.history ?? reading(),
    now: () => input.now ?? asOf
  })
  return { submit, notify }
}

describe('open interest signal notification', () => {
  it('submits the platform dedupe vars, never a key of its own', async () => {
    const { submit, notify } = notifier()
    await notify()
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]![0]
    expect(request.eventTypeId).toBe('market-intelligence.signal.triggered')
    expect(request.producerId).toBe('market-intelligence.collectSource')
    // 日内键里**不带任何时间**（契约 v2.43 §7.4）：时间只出现在 occurredAt。
    expect(request.dedupeVars).toEqual({
      builder: 'moduleSignal',
      moduleId: 'open-interest',
      ruleId: 'oi-liquidation-proxy',
      asset: 'btc',
      cadence: 'intraday'
    })
    // 信号自己的三档，不是展示那套（info/success/warning/critical）。
    expect(request.signalSeverity).toBe('high')
    // 成品句子由源头拼好；阈值来自规则常量（强阈值的来源就是那一个数）。
    expect(request.bodyVariant).toBeUndefined()
    expect(request.titleParams).toBeUndefined()
    expect(request.rendered).toEqual({
      'zh-CN': {
        title: 'BTC 多头爆仓加剧',
        body: '多头被强制平仓：15 分钟跌 2.7%（强阈值 2.5%），成交放大 3.4 倍，规模约 74 亿美元',
        reason: '规则命中，且读数达到这条规则的阈值。'
      },
      'en-US': {
        title: 'BTC long liquidations deepened',
        body: 'Longs forced out: down 2.7% in 15 min (strong threshold 2.5%), volume 3.4×, about $7.4B',
        reason: 'A rule matched and the reading reached its threshold.'
      }
    })
    // The key string has one implementation (the platform builder); the call site carries only vars.
    expect('dedupeKey' in request).toBe(false)
    // The instant is the bucket's own, not the moment this ran.
    expect(request.occurredAt).toBe(bucketAt)
    // Nothing to open: the shell resolves settings deeplinks only, so no pointer is sent.
    expect(request.actions).toEqual([])
    expect(request.deeplink).toBeUndefined()
  })

  it('follows the rule thresholds: different constants produce different sentences’ parameters', async () => {
    const submit = vi.fn(async (_request: NotificationSubmitRequest) => accepted)
    const notify = createOpenInterestSignalNotifier({
      submit,
      readHistory: async () => reading(),
      now: () => asOf,
      // 注入另一组阈值：文案参数必须跟着走，模板里没有第二个数。
      thresholds: { dropPct: -1.1, strongDropPct: -9.9 }
    })
    await notify()
    // 句子跟着注入的常量走：模板里没有第二个数，所以换常量就换读数。
    expect(submit.mock.calls[0]![0].rendered?.['zh-CN']!.body).toContain('强阈值 9.9%')
    expect(submit.mock.calls[0]![0].rendered?.['en-US']!.body).toContain('strong threshold 9.9%')
  })

  it('uses the base variant with the plain threshold when the drop is not the strong one', async () => {
    const { submit, notify } = notifier({
      history: reading({
        liquidationHints: [{ observedAt: bucketAt, asset: 'btc', direction: 'long', dropPct: -1.6, volumeMultiple: 2.2, notionalUsd: 7.4e9 }]
      })
    })
    await notify()
    const request = submit.mock.calls[0]![0]
    expect(request.signalSeverity).toBe('medium')
    expect(request.rendered?.['zh-CN']!.title).toBe('BTC 多头爆仓')
    expect(request.rendered?.['zh-CN']!.body).toBe('多头被强制平仓：15 分钟跌 1.6%（阈值 1.5%），成交放大 2.2 倍，规模约 74 亿美元')
    expect(request.rendered?.['en-US']!.body).toBe('Longs forced out: down 1.6% in 15 min (threshold 1.5%), volume 2.2×, about $7.4B')
  })

  it('gives the same bucket the same vars on the next tick, so the platform merges instead of re-pushing', async () => {
    const { submit, notify } = notifier()
    await notify()
    await notify()
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit.mock.calls[1]![0].dedupeVars).toEqual(submit.mock.calls[0]![0].dedupeVars)
  })

  it('does not announce a bucket that is older than the freshness window', async () => {
    const stale = new Date(Date.parse(asOf) - openInterestSignalNotificationPolicy.freshnessMs - bucketMs).toISOString()
    const { submit, notify } = notifier({
      history: reading({
        btc: [{ observedAt: stale, notionalUsd: 7.4e9 }],
        liquidationHints: [{ observedAt: stale, asset: 'btc', direction: 'long', dropPct: -2.7, volumeMultiple: 3.4, notionalUsd: 7.4e9 }]
      })
    })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when the volume leg could not answer: no reading is not "no liquidation"', async () => {
    const { submit, notify } = notifier({ history: reading({ liquidationHints: undefined, liquidationHintsState: 'unavailable' }) })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when the whole read failed', async () => {
    const { submit, notify } = notifier({
      history: { state: 'unavailable', failureCode: 'open-interest-history-query-unavailable' }
    })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('the alert names the side that was liquidated', () => {
  /**
   * 一条空头读数：方向在 hint 上，价格涨、持仓降——「空头被清」的形状。
   *
   * 这里必须从**读到的 hint** 出发，而不是手搓一个 `ruleId`：上一层的
   * `hint.direction → 规则 → signal.ruleId → 变体` 才是「方向」真正经过的那条链，
   * 句子层的用例直接喂 ruleId，接反了也发现不了。
   */
  function shortReading(overrides: Partial<OpenInterestLiquidationHint> = {}): OpenInterestHistoryResult {
    return reading({
      liquidationHints: [{
        observedAt: bucketAt,
        asset: 'btc',
        direction: 'short',
        dropPct: -2.7,
        pricePct: 1.8,
        volumeMultiple: 3.4,
        notionalUsd: 7.4e9,
        ...overrides
      }]
    })
  }

  it('carries the short direction from the reading into both languages', async () => {
    const { submit, notify } = notifier({ history: shortReading() })
    await notify()
    expect(submit).toHaveBeenCalledTimes(1)
    const request = submit.mock.calls[0]![0]
    // 方向由规则 id 说死，而这个 id 是从 hint 的 direction 映射来的，不是通知层猜的。
    expect(request.dedupeVars).toMatchObject({ moduleId: 'open-interest', ruleId: 'oi-short-liquidation-proxy', cadence: 'intraday' })
    expect(request.rendered?.['zh-CN']!.title).toBe('BTC 空头爆仓加剧')
    expect(request.rendered?.['zh-CN']!.body).toContain('涨 1.8%')
    // 正文取的是带符号的涨幅（+1.8），不是跌幅（−2.7）：两个数故意不同，取错就红。
    expect(request.rendered?.['zh-CN']!.body).not.toContain('跌')
    expect(request.rendered?.['zh-CN']!.body).not.toContain('2.7%')
    expect(request.rendered?.['en-US']!.title).toBe('BTC short liquidations deepened')
    expect(request.rendered?.['en-US']!.body).toContain('up 1.8%')
    expect(request.rendered?.['en-US']!.body).not.toMatch(/down|fell/iu)
    // 英文那份不许回落到中文：出现汉字就说明它读了另一张表。
    expect(request.rendered!['en-US']!.title + request.rendered!['en-US']!.body).not.toMatch(/[\u4e00-\u9fff]/u)
  })

  it('uses the short headline with the plain threshold when the drop is not the strong one', async () => {
    const { submit, notify } = notifier({
      history: shortReading({ dropPct: -1.6, pricePct: 0.9, volumeMultiple: 2.2 })
    })
    await notify()
    expect(submit.mock.calls[0]![0].signalSeverity).toBe('medium')
    expect(submit.mock.calls[0]![0].rendered?.['zh-CN']!.title).toBe('BTC 空头爆仓')
    expect(submit.mock.calls[0]![0].rendered?.['zh-CN']!.body).toContain('涨 0.9%（阈值 1.5%）')
  })

  it('never lets the two sides share one sentence', async () => {
    const longSide = notifier()
    await longSide.notify()
    const shortSide = notifier({ history: shortReading() })
    await shortSide.notify()
    const long = longSide.submit.mock.calls[0]![0]
    const short = shortSide.submit.mock.calls[0]![0]
    for (const language of ['zh-CN', 'en-US'] as const) {
      expect(short.rendered![language]!.title).not.toBe(long.rendered![language]!.title)
      expect(short.rendered![language]!.body).not.toBe(long.rendered![language]!.body)
    }
  })

  it('stays silent instead of announcing a short squeeze whose price fell', async () => {
    // 数字格式化只出绝对值：把 −1.8 喂进来会印成「涨 1.8%」，一句话把读者送到反方向去。
    const { submit, notify } = notifier({ history: shortReading({ pricePct: -1.8 }) })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })

  it('stays silent when the short read has no price at all, never reusing the drop', async () => {
    const { submit, notify } = notifier({ history: shortReading({ pricePct: undefined }) })
    await notify()
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('candidate selection', () => {
  it('drops unavailable readings and buckets the reader would read as old news', () => {
    const signals = openInterestSignalsFromHistory(reading({ liquidationHints: undefined, liquidationHintsState: 'unavailable' }), asOf)
    expect(signals.every(signal => signal.readiness === 'unavailable')).toBe(true)
    expect(selectSignalNotificationCandidates(signals, asOf)).toHaveLength(0)

    const fresh = openInterestSignalsFromHistory(reading(), asOf)
    expect(selectSignalNotificationCandidates(fresh, asOf)).toHaveLength(1)
    // An instant that cannot be parsed is not a candidate: it cannot be deduplicated or placed.
    expect(selectSignalNotificationCandidates(fresh, 'not-a-time')).toHaveLength(0)
  })
})

describe('signals follow a successful collection', () => {
  it('notifies after the refresh and keeps its result', async () => {
    const notify = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))
    const wrapped = createSignalledOpenInterestRefresh({ refresh, readHistory: async () => reading(), submit: undefined, now: () => asOf })
    // No submit hook means no notifier at all: the refresh must still run and answer.
    expect(await wrapped.refresh()).toEqual({ state: 'updated' })
    expect(notify).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not notify when the source is switched off', async () => {
    const submit = vi.fn(async () => accepted)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'unavailable' as const }),
      readHistory: async () => reading(),
      submit,
      now: () => asOf
    })
    expect(await wrapped.refresh()).toEqual({ state: 'unavailable' })
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps the collection result when the notification cannot be submitted', async () => {
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => reading(),
      submit: async () => { throw new Error('notification store down') },
      now: () => asOf
    })
    // The buckets are already stored; a notification failure must not make the collection look broken.
    expect(await wrapped.refresh()).toEqual({ state: 'updated' })
  })
})

describe('a failed read leaves exactly one trace, and no submission', () => {
  /** 把被捕获的 console.log 行解析出来，只留这一种 marker。 */
  function readFailureLines(spy: { mock: { calls: readonly (readonly unknown[])[] } }): Array<Record<string, unknown>> {
    return spy.mock.calls
      .map((call: readonly unknown[]): Record<string, unknown> | undefined => {
        try { return JSON.parse(String(call[0])) as Record<string, unknown> } catch { return undefined }
      })
      .filter((row: Record<string, unknown> | undefined): row is Record<string, unknown> => row !== undefined && row.marker === 'MI_SIGNAL_READ_FAILED')
  }

  it('keeps the collection result, logs once, and submits nothing when the read throws', async () => {
    const trace = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const submit = vi.fn(async () => accepted)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => { throw Object.assign(new Error('ipc closed'), { reasonCode: 'ipc-closed' }) },
      submit,
      now: () => asOf
    })
    try {
      // 采集结果不变：通知侧读不到，不是这次采集失败。
      expect(await wrapped.refresh()).toEqual({ state: 'updated' })
      expect(submit).not.toHaveBeenCalled()
      const lines = readFailureLines(trace)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toEqual({ marker: 'MI_SIGNAL_READ_FAILED', sourceId: 'binance-futures-positioning', reasonCode: 'ipc-closed' })
      // 不带叙事文案：字段就这三个。
      expect(Object.keys(lines[0]!).sort()).toEqual(['marker', 'reasonCode', 'sourceId'])
    } finally {
      trace.mockRestore()
    }
  })

  it('logs the DTO failure code when the read answers unavailable instead of throwing', async () => {
    const trace = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const submit = vi.fn(async () => accepted)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => ({ state: 'unavailable' as const, failureCode: 'open-interest-history-query-unavailable' }),
      submit,
      now: () => asOf
    })
    try {
      expect(await wrapped.refresh()).toEqual({ state: 'updated' })
      expect(submit).not.toHaveBeenCalled()
      const lines = readFailureLines(trace)
      expect(lines).toHaveLength(1)
      expect(lines[0]!.reasonCode).toBe('open-interest-history-query-unavailable')
    } finally {
      trace.mockRestore()
    }
  })

  it('does not log the read marker for a submission failure: the runtime already records that one', async () => {
    const trace = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const wrapped = createSignalledOpenInterestRefresh({
      refresh: async () => ({ state: 'updated' as const }),
      readHistory: async () => reading(),
      submit: async () => { throw new Error('notification store down') },
      now: () => asOf
    })
    try {
      expect(await wrapped.refresh()).toEqual({ state: 'updated' })
      // 提交侧留痕归运行时；这里再记一条就是同一件事的第二个出处。
      expect(readFailureLines(trace)).toHaveLength(0)
    } finally {
      trace.mockRestore()
    }
  })
})

describe('the refresh path no longer calls analyses', () => {
  it('exposes only a refresh, because the tick scan is the single entry', async () => {
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))
    const submit = vi.fn(async () => ({ kind: 'accepted' as const, recordId: 'r', levels: [] }))
    const wrapped = createSignalledOpenInterestRefresh({
      refresh,
      readHistory: async () => reading(),
      submit,
      now: () => asOf
    })
    // The analysis binding is gone by construction: a second entry would make "when did it fire"
    // have two answers, and a push lost between write and hand-off is never repaired.
    expect(Object.keys(wrapped)).toEqual(['refresh'])
    await wrapped.refresh()
    expect(submit).toHaveBeenCalled()
  })
})
