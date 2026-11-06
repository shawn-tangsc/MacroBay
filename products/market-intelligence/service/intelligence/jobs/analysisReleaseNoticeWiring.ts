import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import type { AnalysisFailureNoticeDecision } from '../analysis/analysisFailureNotices'
import { ANALYSIS_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { buildAnalysisFailureNoticeRequest, decideAttemptAbandoned } from '../analysis/analysisFailureNotices'
import { analysisRunLineOf } from '../analysis/analysisTriggerSourcePolicy'
import { findAnalysisReleaseCoverage } from '../analysis/analysisReleaseAttempts'
import type { AnalysisChange } from '../analysis/eventGroupService'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import type { IntelligencePipeline } from '../application/intelligencePipeline'

/**
 * 「分析失败通知」这条链的另一半：**决策 → 一次提交**，以及"这次发布归到哪次运行"的覆盖查询。
 *
 * 从 `registerMarketAnalysisRuntime` 里整块搬出来的，逻辑一行未改：装配文件只留"什么时候问"，
 * 这里回答"问什么、拿到决策怎么发"。两条纪律照旧：
 * - **平台文案没落时不发**（半句话比没有更糟）；
 * - **提交失败不许影响已完成的运行**（记录是事实，通知是附加物）。
 */
export async function deliverAnalysisFailureNotice(input: Readonly<{
  decision: AnalysisFailureNoticeDecision
  occurredAt: string
  submit?: (request: NotificationSubmitRequest) => Promise<unknown>
}>): Promise<void> {
  try {
    const request = buildAnalysisFailureNoticeRequest(input.decision, input.occurredAt)
    if (request === undefined || input.submit === undefined) return
    // 事件 id 必须在提交点上显式出现：门禁只认字面量、常量表成员、简写属性与封闭表查表。
    // ① id 那一行要与赋值写在同一行（多行三元门禁解析不到）；② 值与 request 里的一致，只改写法。
    const eventTypeId = input.decision.kind === 'repeated-failure' ? ANALYSIS_NOTIFICATION_EVENT_IDS.repeatedFailure : input.decision.kind === 'attempt-abandoned' ? ANALYSIS_NOTIFICATION_EVENT_IDS.attemptAbandoned : ANALYSIS_NOTIFICATION_EVENT_IDS.recovered
    await input.submit({ ...request, eventTypeId, })
  } catch {
    // 通知是记录的附加物：发不出去不改任何运行状态。
  }
}

/** "这次发布是不是已经有一次分析在管"——覆盖查询的接线，从装配文件里搬出来。 */
export function createReleaseCoverageReader(input: Readonly<{
  now: () => string
  repository: Pick<MarketAnalysisRepository, 'listEventGroups' | 'listTriggerLedger' | 'getRun'>
  pipeline: Pick<IntelligencePipeline, 'listItems'> & { listMetricEvents?: IntelligencePipeline['listMetricEvents'] }
}>): (change: AnalysisChange, currentGroupId: string) => ReturnType<typeof findAnalysisReleaseCoverage> {
  return (change, currentGroupId) => {
    // Older pipeline mocks do not carry metric events; without one the item has no release identity
    // and is left to its own trigger decision instead of being merged by guesswork.
    const readMetricEvents = input.pipeline.listMetricEvents
    return findAnalysisReleaseCoverage({
      change, currentGroupId, now: input.now(),
      listEventGroups: () => input.repository.listEventGroups(),
      listTriggerLedger: (eventGroupId) => input.repository.listTriggerLedger(eventGroupId),
      getRun: (runId) => input.repository.getRun(runId),
      listItems: () => input.pipeline.listItems(),
      listMetricEvents: () => typeof readMetricEvents === 'function' ? readMetricEvents.call(input.pipeline) : []
    })
  }
}

/**
 * 一次发布被判"这篇不会再有了"时的那条通知。
 *
 * 搬出来的是**整块判断**（用哪条运行行、拿不到就不发），不是一句提交：以前这段在装配文件里，
 * 二十行的接线里夹着一条业务规则，改通知就得到处翻。
 */
export async function notifyAbandonedRelease(input: Readonly<{
  triggerKey: string
  groupId: string
  repository: Pick<MarketAnalysisRepository, 'listRuns'>
  occurredAt: string
  submit?: (request: NotificationSubmitRequest) => Promise<unknown>
}>): Promise<void> {
  // 这篇不会再有了。能指的运行行是这次发布前几次尝试留下的那一行；**拿不到就不发**，也不伪造
  // 一个 id——伪造出来的链接点开只能是「没找到」，那比不发更糟。
  const decision = decideAttemptAbandoned({
    line: analysisRunLineOf(input.triggerKey),
    runId: input.repository.listRuns().filter((run) => run.eventGroupId === input.groupId).at(-1)?.id ?? '',
    abandon: 'release'
  })
  await deliverAnalysisFailureNotice({ decision, occurredAt: input.occurredAt, ...(input.submit === undefined ? {} : { submit: input.submit }) })
}
