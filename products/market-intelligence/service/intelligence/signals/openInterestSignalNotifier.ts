import type { NotificationSubmitOutcome, NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import { signalWindow, type ModuleSignal } from '../../../contracts/moduleSignal'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import type { SignalAnalysisRequest, SignalAnalysisOutcome } from '../jobs/requestSignalAnalysis'
import { liquidationHintPolicy } from '../../../contracts/openInterestPositioning'
import { openInterestSignalsFromHistory, openInterestSignalRule } from './openInterestSignals'
import {
  multipleParam,
  pctParam,
  usdParam,
  signalAssetSymbol,
  signalHeadline,
  SIGNAL_HEADLINE_KEYS
} from './signalNotificationCopy'

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
 * 一条信号 → 一次提交。只填参数，不填句子：标题与正文由平台的文案键按事件 id 解析。
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
  return {
    eventTypeId: EVENT_IDS.signalTriggered,
    producerId: OPEN_INTEREST_PRODUCER_ID,
    signalSeverity: signal.severity,
    dedupeVars,
    titleParams: {
      asset: signalAssetSymbol(signal.asset),
      headline: signalHeadline(SIGNAL_HEADLINE_KEYS.oiDrop)
    },
    bodyVariant: aggravated ? 'oiDropAggravated' : 'oiDrop',
    bodyParams: aggravated
      ? {
          dropPct: pctParam(dropPct),
          strongPct: pctParam(thresholds.strongDropPct),
          multiple: multipleParam(volumeMultiple),
          notional: usdParam(notionalUsd)
        }
      : {
          dropPct: pctParam(dropPct),
          thresholdPct: pctParam(thresholds.dropPct),
          multiple: multipleParam(volumeMultiple),
          notional: usdParam(notionalUsd)
        },
    actions: [] as const,
    occurredAt: signal.observedAt
  }
}

/**
 * The one place a fired open-interest signal becomes an analysis request.
 *
 * The receiver (`jobs/requestSignalAnalysis`) owns the group, the ledger row and the queue; this
 * function only fills the fields it cannot know: the rule's own key, the board the signal belongs
 * to, and the bucket it happened in. Building the trigger key here instead of at the call site is
 * what keeps a typo out of the budget: the contract accepts exactly `signal.<module>.<rule>`.
 */
export function analysisRequestFor(signal: ModuleSignal): SignalAnalysisRequest | undefined {
  // "Nothing was read" is not "the rule fired"; a low-severity mark is the chip's business only.
  if (signal.readiness !== 'available' || signal.asset === null) return undefined
  if (signal.severity !== 'medium' && signal.severity !== 'high') return undefined
  // This rule judges one closed bucket, not a 24-hour window: the window belongs to the rule, not
  // to the reader and not to the receiver.
  const window = signalWindow(signal.cadence, 1)
  if (window === undefined) return undefined
  return {
    // Hand over the signal itself: key, asset, severity, instant and dedupe key all come from it,
    // so the entry cannot be told two different things about one reading.
    signal,
    window,
    // The open-interest board is the funding one; reusing the existing group type, not a new one.
    groupType: 'funding'
  }
}

export function createOpenInterestSignalNotifier(deps: Readonly<{
  submit?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  readHistory: (input: Readonly<{ asOf: string; window: '24h' }>) => Promise<OpenInterestHistoryResult>
  now?: () => string
  /**
   * The analysis entry, when one is wired. Absent leaves behaviour exactly as it was: the rule
   * still produces its chip and its notification, it just cannot ask for a run.
   */
  requestAnalysis?: (request: SignalAnalysisRequest) => Promise<SignalAnalysisOutcome>
  /** Buckets already offered in this process, keyed by the signal's dedupe key. */
  handed?: Map<string, number>
  /** 阈值来自规则常量；测试注入别的值，用来证明句子跟着常量走。 */
  thresholds?: Readonly<{ dropPct: number; strongDropPct: number }>
}>) {
  return async function notifyOpenInterestSignals(): Promise<readonly NotificationSubmitOutcome[]> {
    const asOf = (deps.now ?? (() => new Date().toISOString()))()
    const asOfMs = Date.parse(asOf)
    if (deps.handed !== undefined && Number.isFinite(asOfMs)) {
      for (const [key, expiresAt] of deps.handed) if (expiresAt <= asOfMs) deps.handed.delete(key)
    }
    const reading = await deps.readHistory({ asOf, window: '24h' })
    const candidates = selectSignalNotificationCandidates(openInterestSignalsFromHistory(reading, asOf), asOf)
    const outcomes: NotificationSubmitOutcome[] = []
    for (const signal of candidates) {
      const request = buildOpenInterestSignalRequest(signal, deps.thresholds ?? liquidationHintPolicy)
      if (request !== undefined && deps.submit !== undefined) outcomes.push(await deps.submit(request))
      const analysis = analysisRequestFor(signal)
      if (analysis === undefined || deps.requestAnalysis === undefined) continue
      // The same bucket stays "fresh" for two buckets; asking twice would queue a second run for a
      // reading the ledger already holds. The memory is per process; the ledger's unique key is
      // what carries across restarts.
      if (deps.handed?.has(analysis.signal.dedupeKey) === true) continue
      try {
        const outcome = await deps.requestAnalysis(analysis)
        // "Disabled" is not "handed": the switch may be turned on while this bucket is still fresh.
        if (outcome.state !== 'disabled') {
          const observedMs = Date.parse(analysis.signal.observedAt)
          deps.handed?.set(analysis.signal.dedupeKey, (Number.isFinite(observedMs) ? observedMs : asOfMs) + openInterestSignalNotificationPolicy.analysisHandoffMemoryMs)
        }
      } catch {
        // One hand-off failing must not turn a stored bucket into a failed collection, and must
        // not stop the next signal from being offered.
      }
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
  requestAnalysis?: (request: SignalAnalysisRequest) => Promise<SignalAnalysisOutcome>
}>): {
  refresh: () => Promise<T>
  /**
   * Late binding, not a constructor argument: the analysis runtime is assembled after this refresh
   * service, and the module that wires both is a file-size baseline that may not grow. Until it is
   * called the refresh behaves exactly as before.
   */
  bindSignalAnalysis: (service: (request: SignalAnalysisRequest) => Promise<SignalAnalysisOutcome>) => void
} {
  let requestAnalysis = input.requestAnalysis
  // One memory for the lifetime of this refresh service, not per call: the whole point is that the
  // next refresh does not ask again for a bucket this one already offered.
  const handed = new Map<string, number>()
  return {
    async refresh(): Promise<T> {
      const result = await input.refresh()
      if (result.state === 'unavailable') return result
      // Nothing is wired: keep the collection path free of a read it would only throw away.
      if (input.submit === undefined && requestAnalysis === undefined) return result
      const notify = createOpenInterestSignalNotifier({
        ...(input.submit === undefined ? {} : { submit: input.submit }),
        readHistory: input.readHistory,
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(requestAnalysis === undefined ? {} : { requestAnalysis }),
        handed
      })
      try {
        await notify()
      } catch {
        // 采集结果已经落盘；一条通知发不出去不该让这次采集看起来失败。
      }
      return result
    },
    bindSignalAnalysis(service) { requestAnalysis = service }
  }
}
