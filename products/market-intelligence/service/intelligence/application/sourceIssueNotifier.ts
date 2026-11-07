import type {
  NotificationAction,
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import type { RuntimeStateRecord } from '@platform/jobs'

import { isSourceStaleAsOf } from './macroSourceHealth'
import { getIntelligenceSourceDefinition } from './sourceCatalog'

/**
 * 来源两条事件（情报 v3.7 §三）：`consecutive-failed` 与 `stale`。
 *
 * 两件事共用**平台注册的**去重键 `sourceIssue(sourceId)`（契约 §7.1）：这里只给参数
 * `{ builder: 'sourceIssue', sourceId }`，键由平台展开——不许自己拼，拼法与归一只有一处。
 * 「每个来源 24 小时一条、窗口内点掉旧记录也不新建」由声明里的 `dedupeUnit: 'condition'`
 * + `conditionWindowMs` 判，运行时的事，这里不计数、不判窗口（双份窗口一定会漂）。
 *
 * 判定顺序写死：连续失败优先于陈旧。同一来源同时满足两条时，"要配密钥" 比 "很久没数据"
 * 更具体；两条共用同一个键，先提交的那条决定标题与投递（契约 §16.3 合并不重推）。
 */
export const SOURCE_ISSUE_FAILURE_THRESHOLD = 3

/**
 * 「静默多久算异常」的两档窗口（Chief 2026-11-07 按实测定）：
 * 实测同一刻 CoinDesk 17.7h / Decrypt 16.7h / The Block 16.8h 都没新条目，而那天是**周六**；
 * 三家一起安静更像周末低产，不是某一家坏了。所以工作日 12 小时、周末 24 小时。
 */
export const WEEKDAY_SILENCE_MS = 12 * 60 * 60 * 1000
export const WEEKEND_SILENCE_MS = 24 * 60 * 60 * 1000

/**
 * 今天算不算周末——**按读者时区**判（这是给人看的判断，跟读者时区走；
 * 「窗口多长」本身是时长，不随时区变化）。
 */
export function isWeekendIn(timeZone: string, now: string): boolean {
  let weekday: string
  try {
    weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(now))
  } catch {
    // 时区坏了不猜：按工作日判（窗口更短、更容易报），并让调用方在诊断里看到时区无效。
    return false
  }
  return weekday === 'Sat' || weekday === 'Sun'
}

/** 这一次判定该用哪个窗口。`weekend` 同时进诊断——误报时一眼能看出是不是周末。 */
export function resolveSilenceWindow(
  now: string,
  timeZone: string
): Readonly<{ windowMs: number; weekend: boolean }> {
  const weekend = isWeekendIn(timeZone, now)
  return { windowMs: weekend ? WEEKEND_SILENCE_MS : WEEKDAY_SILENCE_MS, weekend }
}

export type SourceIssueKind = 'consecutive-failed' | 'stale'

const SOURCE_ISSUE_EVENT_IDS: Readonly<Record<SourceIssueKind, string>> = Object.freeze({
  'consecutive-failed': EVENT_IDS.sourceConsecutiveFailed,
  stale: EVENT_IDS.sourceStale
})

/** 来源采集 job 的 handler id：产品自己的 job 提交也要带它（契约 §3.2）。 */
const SOURCE_COLLECTION_PRODUCER_ID = 'market-intelligence.collectSource'

/**
 * 同一刻各源静默了多少小时（诊断用，只写源 id 与小时数）。**不进通知正文**，也不做判定：
 * 判定只看本来源。它的用处是误报时能一眼看出「今天三家都安静」还是「只有它在安静」。
 *
 * 静默的起点取检查点里的 `lastPublishedAt`（最后一次真的带来新条目），没有才退回 `lastSuccessAt`。
 */
export function silenceHoursBySource(
  states: readonly RuntimeStateRecord[],
  now: string
): Readonly<Record<string, number>> {
  const nowMs = Date.parse(now)
  const out: Record<string, number> = {}
  for (const state of states) {
    const checkpoint = state.checkpoint as { lastPublishedAt?: unknown } | undefined
    const lastPublishedAt = typeof checkpoint?.lastPublishedAt === 'string' ? checkpoint.lastPublishedAt : undefined
    const lastEvidenceAt = lastPublishedAt ?? state.lastSuccessAt
    if (lastEvidenceAt === undefined) continue
    const hours = (nowMs - Date.parse(lastEvidenceAt)) / 3_600_000
    if (!Number.isFinite(hours)) continue
    out[state.resourceId] = Math.round(hours * 10) / 10
  }
  return out
}

export type SourceIssueSnapshot = {
  sourceId: string
  consecutiveFailures: number
  lastSuccessAt?: string
  /**
   * **最后一次真的带来新条目的时刻**（检查点里的 `lastPublishedAt`）。
   *
   * 为什么不看 `lastSuccessAt`：采集每 15 分钟都成功、抓回来 25 条全是被去重挡掉的旧条目时，
   * `lastSuccessAt` 永远是「刚才」——陈旧判定就永远不触发，用户看到的是「今天没新闻」，
   * 实际是「这个源停了」。2026-11-07 CoinDesk 就是这样：17 小时没有新条目，运行记录全绿。
   */
  lastNewItemAt?: string
  adapterConfig?: Readonly<Record<string, unknown>>
  /** 判定用的当前时刻（UTC）。 */
  now: string
}

/**
 * 该不该发来源事件，发哪一条。纯函数，便于反向用例：
 *  - 连续失败不足 3 次 → 不发（1、2 次是过程，不是结论）；
 *  - 从未成功过且没有失败累计 → 不发（那是「待首次采集」，不是「陈旧」）；
 *  - 其余按来源自己的新鲜度窗口判陈旧，窗口取 `adapterConfig.freshnessWindowMs`，
 *    缺省跟 `sourceCoverageAsOf` 同一个 6 小时默认值（同一件事只有一个判据）。
 */
export function decideSourceIssue(input: SourceIssueSnapshot, defaultFreshnessMs: number): SourceIssueKind | null {
  if (input.consecutiveFailures >= SOURCE_ISSUE_FAILURE_THRESHOLD) return 'consecutive-failed'
  // 陈旧看的是「最后一次真的带来新条目」；没有这个数才退回「最后一次采集成功」（旧来源没有检查点）。
  const lastEvidenceAt = input.lastNewItemAt ?? input.lastSuccessAt
  if (lastEvidenceAt === undefined) return null
  return isSourceStaleAsOf({
    sourceId: input.sourceId,
    adapterConfig: input.adapterConfig as Record<string, unknown> | undefined,
    lastSuccessAt: lastEvidenceAt,
    asOf: input.now,
    defaultFreshnessMs
  })
    ? 'stale'
    : null
}

export type SourceIssueNotifier = (input: SourceIssueSnapshot) => Promise<unknown>

/**
 * 采集结果刚写下时调一次：连续失败够了发「连续失败」，还没到窗口发「陈旧」。
 * 通知失败不能把采集判成失败（状态已落盘），所以这里吞掉提交异常。
 */
export async function notifySourceIssueForSource(input: {
  notifier?: SourceIssueNotifier
  sourceId: string
  health?: { consecutiveFailures: number; lastSuccessAt?: string; lastPublishedAt?: string }
  adapterConfig?: Readonly<Record<string, unknown>>
  now?: string
}): Promise<void> {
  if (!input.notifier || !input.health) return
  try {
    await input.notifier({
      sourceId: input.sourceId,
      consecutiveFailures: input.health.consecutiveFailures,
      ...(input.health.lastSuccessAt === undefined ? {} : { lastSuccessAt: input.health.lastSuccessAt }),
      ...(input.health.lastPublishedAt === undefined ? {} : { lastNewItemAt: input.health.lastPublishedAt }),
      ...(input.adapterConfig === undefined ? {} : { adapterConfig: input.adapterConfig }),
      now: input.now ?? new Date().toISOString()
    })
  } catch {
    // 采集结果已经落库；一条通知发不出去不该让这次采集看起来失败。
  }
}

export type SourceIssueNotifierDeps = {
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  /** 判定窗口的缺省值（毫秒）；调用方与来源覆盖视图用同一个默认。 */
  defaultFreshnessMs: number
  /** 读者时区：只用来判「今天是不是周末」，不参与时长计算。 */
  timeZone: () => string
  /** 来源的显示名；解析不出时退回 sourceId，不猜。 */
  resolveSourceName?: (sourceId: string) => string
  /** 平台落盘日志（app.log）。 */
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  /** 同一刻各源的静默小时数（源 id → 小时），只进诊断，不进通知正文。 */
  silenceHours?: () => Readonly<Record<string, number>>
}

/**
 * 动作标签用**平台**的「去设置」（`notification.action.open-settings`）：动作键在平台闭集里，
 * 产品不往动作位塞自己的文案键，渲染端就不必按 productId 特判。
 */
function sourceIssueActions(sourceId: string): readonly NotificationAction[] {
  return [
    {
      id: 'open-source-settings',
      labelKey: 'notification.action.open-settings',
      kind: 'open',
      deeplink: sourceIssueDeeplink(sourceId)
    }
  ]
}

/** 落点：设置页的情报源面板，定位到这个来源。 */
function sourceIssueDeeplink(sourceId: string) {
  return {
    scope: 'product' as const,
    productId: 'market-intelligence',
    settingsSectionId: 'intelligence-sources',
    entityType: 'source',
    entityId: sourceId
  }
}

export function createSourceIssueNotifier(deps: SourceIssueNotifierDeps) {
  return async function notifySourceIssue(input: SourceIssueSnapshot): Promise<NotificationSubmitOutcome | null> {
    const window = resolveSilenceWindow(input.now, deps.timeZone())
    const kind = decideSourceIssue(input, window.windowMs)
    if (kind === null) return null

    // 诊断：这次为什么判成陈旧、当时各源各静默多久。误报时能一眼分开「周末低产」与「真异常」。
    if (kind === 'stale' && deps.log) {
      const lastNewItemAt = input.lastNewItemAt ?? input.lastSuccessAt
      deps.log('info', 'intelligence.source.silence', {
        sourceId: input.sourceId,
        silentHours: lastNewItemAt === undefined
          ? null
          : Math.round((Date.parse(input.now) - Date.parse(lastNewItemAt)) / 3_600_000 * 10) / 10,
        weekend: window.weekend,
        windowHours: window.windowMs / 3_600_000,
        ...(deps.silenceHours === undefined ? {} : { sources: deps.silenceHours() })
      })
    }

    const definition = getIntelligenceSourceDefinition(input.sourceId)
    const sourceName = deps.resolveSourceName?.(input.sourceId) ?? definition?.displayName ?? input.sourceId
    const failures = String(input.consecutiveFailures)
    const eventTypeId = SOURCE_ISSUE_EVENT_IDS[kind]

    return deps.submit({
      eventTypeId,
      producerId: SOURCE_COLLECTION_PRODUCER_ID,
      dedupeVars: { builder: 'sourceIssue', sourceId: input.sourceId },
      titleParams: { sourceName, failures },
      bodyParams: { sourceName, failures },
      reasonParams: { sourceName, failures },
      actions: sourceIssueActions(input.sourceId),
      deeplink: sourceIssueDeeplink(input.sourceId),
      occurredAt: input.now
    })
  }
}
