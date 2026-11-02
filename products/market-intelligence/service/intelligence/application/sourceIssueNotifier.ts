import type {
  NotificationAction,
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import type { NotificationCopyKey } from '@platform/i18n/notificationCopy'

import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS,
  notificationEventActionKey
} from '../../../contracts/notificationEventKeys'
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

export type SourceIssueKind = 'consecutive-failed' | 'stale'

const SOURCE_ISSUE_EVENT_IDS: Readonly<Record<SourceIssueKind, string>> = Object.freeze({
  'consecutive-failed': EVENT_IDS.sourceConsecutiveFailed,
  stale: EVENT_IDS.sourceStale
})

/** 来源采集 job 的 handler id：产品自己的 job 提交也要带它（契约 §3.2）。 */
const SOURCE_COLLECTION_PRODUCER_ID = 'market-intelligence.collectSource'

export type SourceIssueSnapshot = {
  sourceId: string
  consecutiveFailures: number
  lastSuccessAt?: string
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
  if (input.lastSuccessAt === undefined) return null
  return isSourceStaleAsOf({
    sourceId: input.sourceId,
    adapterConfig: input.adapterConfig as Record<string, unknown> | undefined,
    lastSuccessAt: input.lastSuccessAt,
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
  health?: { consecutiveFailures: number; lastSuccessAt?: string }
  adapterConfig?: Readonly<Record<string, unknown>>
  now?: string
}): Promise<void> {
  if (!input.notifier || !input.health) return
  try {
    await input.notifier({
      sourceId: input.sourceId,
      consecutiveFailures: input.health.consecutiveFailures,
      ...(input.health.lastSuccessAt === undefined ? {} : { lastSuccessAt: input.health.lastSuccessAt }),
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
  /** 来源的显示名；解析不出时退回 sourceId，不猜。 */
  resolveSourceName?: (sourceId: string) => string
}

/**
 * 动作标签：`NotificationAction.labelKey` 在平台类型里只收平台闭集键，而情报事件的句子
 * 在产品文案表里（契约 §3.3 的 `scope: 'product'` 解析）。这里按同一前缀生成产品键，
 * 并转一次类型——平台修正这个类型后这一处可以删。
 */
function sourceIssueActions(kind: SourceIssueKind, sourceId: string): readonly NotificationAction[] {
  const deeplink = {
    scope: 'product' as const,
    productId: 'market-intelligence',
    settingsSectionId: 'intelligence-sources',
    entityType: 'source',
    entityId: sourceId
  }
  return [
    {
      id: 'open-source-settings',
      labelKey: notificationEventActionKey(SOURCE_ISSUE_EVENT_IDS[kind]) as NotificationCopyKey,
      kind: 'open',
      deeplink
    }
  ]
}

export function createSourceIssueNotifier(deps: SourceIssueNotifierDeps) {
  return async function notifySourceIssue(input: SourceIssueSnapshot): Promise<NotificationSubmitOutcome | null> {
    const kind = decideSourceIssue(input, deps.defaultFreshnessMs)
    if (kind === null) return null

    const definition = getIntelligenceSourceDefinition(input.sourceId)
    const sourceName = deps.resolveSourceName?.(input.sourceId) ?? definition?.displayName ?? input.sourceId
    const failures = String(input.consecutiveFailures)
    const eventTypeId = SOURCE_ISSUE_EVENT_IDS[kind]
    const deeplink = {
      scope: 'product' as const,
      productId: 'market-intelligence',
      settingsSectionId: 'intelligence-sources',
      entityType: 'source',
      entityId: input.sourceId
    }

    return deps.submit({
      eventTypeId,
      producerId: SOURCE_COLLECTION_PRODUCER_ID,
      dedupeVars: { builder: 'sourceIssue', sourceId: input.sourceId },
      titleParams: { sourceName, failures },
      bodyParams: { sourceName, failures },
      reasonParams: { sourceName, failures },
      actions: sourceIssueActions(kind, input.sourceId),
      deeplink,
      occurredAt: input.now
    })
  }
}
