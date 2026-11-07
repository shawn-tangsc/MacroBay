import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { liquidationHintPolicy } from '../../../contracts/openInterestPositioning'
import { openInterestSignalsFromHistory, openInterestShortSignalRule, openInterestSignalRule } from './openInterestSignals'
import { signalAssetSymbol } from './signalNotificationCopy'
import { renderOpenInterestSentence } from './signalNotificationSentence'

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
  freshnessMs: 2 * openInterestSignalRule.bucketMs,
  /**
   * 一个桶问过分析之后，在本进程内还要记它多久。
   *
   * 刷新每次都重读滚动窗口，同一个桶在两个桶的新鲜期里会被看到两次；不记的话，第二次会再
   * 要一次运行——账本行因为唯一键只有一行、额度也只算一次，但模型调用是两次。窗口给到四倍
   * 新鲜期，覆盖采集的慢一拍与系统时钟的小抖动，不承担跨进程去重（那是账本唯一键的事）。
   */
  analysisHandoffMemoryMs: 8 * openInterestSignalRule.bucketMs
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
 * 一条信号 → 一次提交。**句子在这里拼**（契约 v2.56）：标题、正文、「为什么推了」中英各一份，
 * 平台只按读者语言挑一份。结构化读数的真源是信号表，不是这条通知记录——详情页要读数回源里取，
 * 不要反解析句子。
 *
 * 没有动作、也没有落点：外壳今天只认「设置分区」这一种 deeplink（页面/产品两支没有生产者，
 * 写了也走不到）。挂一个点不动的动作，比不挂更糟——读者会以为是自己没点对。
 */
export function buildOpenInterestSignalRequest(
  signal: ModuleSignal,
  /** 阈值取规则自己的常量；测试注入别的值即可证明「文案跟着常量走、模板里没有第二个数」。 */
  thresholds: Readonly<{ dropPct: number; strongDropPct: number }> = liquidationHintPolicy
): NotificationSubmitRequest | undefined {
  if (signal.asset === null) return undefined
  const dropPct = signal.values.dropPct
  const volumeMultiple = signal.values.volumeMultiple
  const notionalUsd = signal.values.notionalUsd
  if (!Number.isFinite(dropPct) || !Number.isFinite(volumeMultiple) || !Number.isFinite(notionalUsd)) {
    return undefined
  }

  // 日内键里**不带任何时间**（契约 v2.43 §7.4）：合并与冷却是声明的滚动窗口管的事。
  const dedupeVars = signal.cadence.kind === 'intraday'
    ? {
        builder: 'moduleSignal' as const,
        moduleId: signal.moduleId,
        ruleId: signal.ruleId,
        asset: signal.asset,
        cadence: 'intraday' as const
      }
    : {
        builder: 'moduleSignal' as const,
        moduleId: signal.moduleId,
        ruleId: signal.ruleId,
        asset: signal.asset,
        observedAt: signal.observedAt,
        cadence: 'trading-day' as const
      }

  const aggravated = signal.severity === 'high'
  // 成品句子在源头拼好（契约 v2.56）；阈值取规则常量，句子跟着常量走，模板里没有第二个数。
  // 方向由规则 id 决定（契约：方向是规则的属性，不是信号字段）；读数符号只是复核。
  const direction = signal.ruleId === openInterestShortSignalRule.ruleId ? 'short' as const : 'long' as const
  const rendered = renderOpenInterestSentence({
    asset: signalAssetSymbol(signal.asset),
    dropPct,
    volumeMultiple,
    notionalUsd,
    thresholdPct: aggravated ? thresholds.strongDropPct : thresholds.dropPct,
    direction,
    ...(Number.isFinite(signal.values.priceChangePct) ? { pricePct: signal.values.priceChangePct } : {}),
    aggravated
  })
  if (rendered === undefined) return undefined

  return {
    eventTypeId: EVENT_IDS.signalTriggered,
    producerId: OPEN_INTEREST_PRODUCER_ID,
    signalSeverity: signal.severity,
    dedupeVars,
    rendered,
    actions: [] as const,
    occurredAt: signal.observedAt
  }
}

export function createOpenInterestSignalNotifier(deps: Readonly<{
  submit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  readHistory: (input: Readonly<{ asOf: string; window: '24h' }>) => Promise<OpenInterestHistoryResult>
  now?: () => string
  /** 阈值来自规则常量；测试注入别的值，用来证明句子跟着常量走。 */
  thresholds?: Readonly<{ dropPct: number; strongDropPct: number }>
}>) {
  return async function notifyOpenInterestSignals(): Promise<readonly NotificationSubmitOutcome[]> {
    const asOf = (deps.now ?? (() => new Date().toISOString()))()
    const reading = await deps.readHistory({ asOf, window: '24h' })
    const candidates = selectSignalNotificationCandidates(openInterestSignalsFromHistory(reading, asOf), asOf)
    const outcomes: NotificationSubmitOutcome[] = []
    for (const signal of candidates) {
      const request = buildOpenInterestSignalRequest(signal, deps.thresholds ?? liquidationHintPolicy)
      if (request !== undefined && deps.submit !== undefined) outcomes.push(await deps.submit(request))
    }
    return Object.freeze(outcomes)
  }
}

/**
/**
 * 采集完再出站：先写入、再说话。
 *
 * **不再叫分析**（2026-11-06 定，r9 08 §4.1）：分析的唯一入口是十五分钟扫描。这里的交接会
 * 制造第二个入口，而推式在「采集写完、交接之前」崩掉时没人补；扫描下一个 tick 从同一份数据
 * 重算，最多晚一步且能自愈。
 *
 * - 来源关着（`unavailable`）时不推——没有新读数，就没有「刚发生」这回事；
 * - 通知失败不改变采集结果——桶已经落盘了，一条推不出去的通知不该让这次采集看起来失败；
 * - 提交失败也不重试：下一轮采集会带着同一个桶再来一次，平台按 occurrence 合并。
 */
export function createSignalledOpenInterestRefresh<T extends { state?: string }>(input: Readonly<{
  refresh: () => Promise<T>
  readHistory: (input: Readonly<{ asOf: string; window: '24h' }>) => Promise<OpenInterestHistoryResult>
  submit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  now?: () => string
}>): {
  refresh: () => Promise<T>
} {
  return {
    async refresh(): Promise<T> {
      const result = await input.refresh()
      if (result.state === 'unavailable') return result
      // Nothing is wired: keep the collection path free of a read it would only throw away.
      if (input.submit === undefined) return result
      const notify = createOpenInterestSignalNotifier({
        ...(input.submit === undefined ? {} : { submit: input.submit }),
        readHistory: input.readHistory,
        ...(input.now === undefined ? {} : { now: input.now })
      })
      try {
        await notify()
      } catch {
        // 采集结果已经落盘；一条通知发不出去不该让这次采集看起来失败。
      }
      return result
    }
  }
}
