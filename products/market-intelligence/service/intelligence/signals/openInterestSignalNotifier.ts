import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { openInterestSignalsFromHistory, openInterestSignalRule } from './openInterestSignals'

/**
 * 持仓量这条腿的通知出站（通知目录 §四之三）：规则命中一次，就对读者说一次。
 *
 * 三件事刻意留在这里、不散到调用点：
 *
 * 1. **去重键不由这里拼**。只给 `dedupeVars`（`builder: 'moduleSignal'` + 这次发生的四个分量），
 *    键字符串只有平台那一处实现——调用点各拼一份，同一件事迟早会被拆成两条通知。
 * 2. **只推新鲜的桶**。一条信号说的是它自己那个桶；晚两个桶还发，就是把三小时前的瀑布当新闻。
 *    重复推同一个桶是安全的（平台按 occurrence 合并、不重复投递），但不该靠它兜住「推旧闻」。
 * 3. **读失败与没有信号不是一件事**。`readiness: 'unavailable'` 是「这次没读到」，不是「规则没响」，
 *    推给读者会教会他忽略这条通知。
 */
const OPEN_INTEREST_PRODUCER_ID = 'market-intelligence.collectSource'

export const openInterestSignalNotificationPolicy = Object.freeze({
  /** 两个桶：给慢一拍的采集留一步余量，再多就是旧闻。 */
  freshnessMs: 2 * openInterestSignalRule.bucketMs
})

/** 这一轮值得推的信号：读到了、说得清是哪个资产、而且就是刚过去的桶。 */
export function selectSignalNotificationCandidates(
  signals: readonly ModuleSignal[],
  asOf: string
): readonly ModuleSignal[] {
  const asOfMs = Date.parse(asOf)
  if (!Number.isFinite(asOfMs)) return Object.freeze([])
  return Object.freeze(signals.filter((signal) => {
    if (signal.readiness !== 'available' || signal.asset === null) return false
    const observedMs = Date.parse(signal.observedAt)
    if (!Number.isFinite(observedMs)) return false
    const ageMs = asOfMs - observedMs
    return ageMs >= 0 && ageMs <= openInterestSignalNotificationPolicy.freshnessMs
  }))
}

/**
 * 一条信号 → 一次提交。只填参数，不填句子：标题与正文由平台的文案键按事件 id 解析。
 *
 * 没有动作、也没有落点：外壳今天只认「设置分区」这一种 deeplink（页面/产品两支没有生产者，
 * 写了也走不到）。挂一个点不动的动作，比不挂更糟——读者会以为是自己没点对。
 */
function submitRequestFor(signal: ModuleSignal): NotificationSubmitRequest | undefined {
  if (signal.asset === null) return undefined
  const base = {
    eventTypeId: EVENT_IDS.signalTriggered,
    producerId: OPEN_INTEREST_PRODUCER_ID,
    actions: [] as const,
    occurredAt: signal.observedAt
  }
  if (signal.cadence.kind === 'intraday') {
    return {
      ...base,
      dedupeVars: {
        builder: 'moduleSignal',
        moduleId: signal.moduleId,
        ruleId: signal.ruleId,
        asset: signal.asset,
        observedAt: signal.observedAt,
        cadence: 'intraday',
        bucketMs: signal.cadence.bucketMs
      }
    }
  }
  return {
    ...base,
    dedupeVars: {
      builder: 'moduleSignal',
      moduleId: signal.moduleId,
      ruleId: signal.ruleId,
      asset: signal.asset,
      observedAt: signal.observedAt,
      cadence: 'trading-day'
    }
  }
}

export function createOpenInterestSignalNotifier(deps: Readonly<{
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  readHistory: (input: Readonly<{ asOf: string; window: '24h' }>) => Promise<OpenInterestHistoryResult>
  now?: () => string
}>) {
  return async function notifyOpenInterestSignals(): Promise<readonly NotificationSubmitOutcome[]> {
    const asOf = (deps.now ?? (() => new Date().toISOString()))()
    const reading = await deps.readHistory({ asOf, window: '24h' })
    const candidates = selectSignalNotificationCandidates(openInterestSignalsFromHistory(reading, asOf), asOf)
    const outcomes: NotificationSubmitOutcome[] = []
    for (const signal of candidates) {
      const request = submitRequestFor(signal)
      if (request === undefined) continue
      outcomes.push(await deps.submit(request))
    }
    return Object.freeze(outcomes)
  }
}

/**
 * 采集完再出站：先写入、再说话。
 *
 * - 来源关着（`unavailable`）时不推——没有新读数，就没有「刚发生」这回事；
 * - 通知失败不改变采集结果——桶已经落盘了，一条推不出去的通知不该让这次采集看起来失败；
 * - 提交失败也不重试：下一轮采集会带着同一个桶再来一次，平台按 occurrence 合并，不会重复打扰。
 */
export function createSignalledOpenInterestRefresh<T extends { state?: string }>(input: Readonly<{
  refresh: () => Promise<T>
  readHistory: (input: Readonly<{ asOf: string; window: '24h' }>) => Promise<OpenInterestHistoryResult>
  submit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  now?: () => string
}>): { refresh: () => Promise<T> } {
  const notify = input.submit === undefined
    ? undefined
    : createOpenInterestSignalNotifier({ submit: input.submit, readHistory: input.readHistory, ...(input.now === undefined ? {} : { now: input.now }) })
  return {
    async refresh(): Promise<T> {
      const result = await input.refresh()
      if (notify === undefined || result.state === 'unavailable') return result
      try {
        await notify()
      } catch {
        // 采集结果已经落盘；一条通知发不出去不该让这次采集看起来失败。
      }
      return result
    }
  }
}
