import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

import {
  ANALYSIS_CHECK_MODEL_ACTION_KEY, ANALYSIS_RETRY_ACTION_KEY, ANALYSIS_TIMELINE_ACTION_KEY,
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS
} from '../../../contracts/notificationEventKeys'
import { RUN_MARKET_ANALYSIS_JOB } from '../jobs/marketAnalysisJobIds'
import type { AnalysisKind } from '../../../contracts/analysisKinds'

/**
 * 分析没跑成时发一条应用内通知（用户 2026-11-17「失败了，怎么不报应用内通知出来」）。
 *
 * 三条口径来自产品（2026-11-18 签署），实现只照做：
 * 1. **手动触发 → 每次都发**：读者就在应用里等，失败必须有人回答。连点由入队单飞挡在冻结前，
 *    所以同一次点击不会产生第二条运行。
 * 2. **自动运行 → 只报链路级**：同一组连续 3 次失败，或最近一次成功之后 2 小时零成功。逐次不发。
 * 3. **聚合**：自动按 30 分钟窗口 + 同一 failureCode 合成一条（键里带 `bucket30m`），次数由平台的
 *    合并计数给；**不同 failureCode 键不同，绝不合并**——读者要做的事不一样。
 *    「同一 failureCode 最多 4 条」用的是平台的 `dailyLimit`，单位是**读者日**，不是滚动 24 小时。
 *
 * 动作只由「谁触发 + 失败码类别」决定，不由文案猜：连接类（`connect-failed` / `provider-error`）
 * 一律「检查模型连接」且不给重试——重试只会再失败一次；`network-not-ready` 单独一档：只给重试，
 * 正文说「网络还没就绪」，不给「检查模型连接」（那不是配置问题）；其余失败手动给「重试」、
 * 自动只给「查看时间轴」。
 */
export type AnalysisFailureNoticeInput = Readonly<{
  /** `manual` = 读者点名要的那次（含按条解读）；其余都算自动。 */
  kind: 'manual' | 'automatic'
  /** 哪条线的运行：通知正文要能看出被解读的是一条新闻还是一次市场分析（R39 §7）。 */
  analysisKind?: AnalysisKind
  runId: string
  eventGroupId: string
  triggerKey: string
  failureCode: string | null
  failureDetailCode: string | null
  occurredAt: string
}>

export type AnalysisFailureClass = 'connection' | 'network' | 'other'

/**
 * 连接类失败：读者要做的是查配置/网络，不是重试。
 *
 * `network-not-ready` 必须排在连接类前面：它的粗码也是 `analysis-provider-error`，但事实是
 * 「启动时网络还没就绪」，不是「连不上」。混进连接类会给读者一条「检查模型连接」的错误指引。
 */
export function classifyAnalysisFailure(input: Pick<AnalysisFailureNoticeInput, 'failureCode' | 'failureDetailCode'>): AnalysisFailureClass {
  if (input.failureDetailCode === 'network-not-ready') return 'network'
  return input.failureDetailCode === 'connect-failed' || input.failureCode === 'analysis-provider-error' ? 'connection' : 'other'
}

/** 手动 = 读者按下的那条路径（`manual.*` 与按条解读的 `news.manual`）。 */
export function isManualTriggerKey(triggerKey: string): boolean {
  return triggerKey === 'news.manual' || triggerKey.startsWith('manual.')
}

export const analysisFailureNoticePolicy = Object.freeze({
  /** 自动失败 30 分钟一个窗口：同一 failureCode 在同一个窗口里只发一条。 */
  automaticBucketMs: 30 * 60 * 1_000,
  /** 链路级的两个门槛（产品口径）：连续失败 3 次，或最近一次成功后 2 小时零成功。 */
  consecutiveFailureLimit: 3,
  silentAfterSuccessMs: 2 * 60 * 60 * 1_000
})

/** 30 分钟窗口的标识：窗口起点，UTC 分钟对齐，窗口内恒定。 */
export function automaticFailureBucket(occurredAt: string): string {
  const ms = Date.parse(occurredAt)
  const aligned = Math.floor(ms / analysisFailureNoticePolicy.automaticBucketMs) * analysisFailureNoticePolicy.automaticBucketMs
  return new Date(aligned).toISOString()
}

/** 自动失败该不该报：连续失败够 3 次，或距最近一次成功已超过 2 小时（且这一次仍是失败）。 */
export function shouldReportAutomaticFailure(input: Readonly<{
  occurredAt: string
  /** 同一组里、这一次之前的运行，按 queuedAt 从新到旧。 */
  history: readonly Readonly<{ status: string; completedAt: string | null; queuedAt: string }>[]
}>): boolean {
  const nowMs = Date.parse(input.occurredAt)
  let consecutive = 0
  let lastSuccessMs: number | null = null
  for (const run of input.history) {
    if (run.status === 'succeeded') { lastSuccessMs = Date.parse(run.completedAt ?? run.queuedAt); break }
    if (run.status === 'failed' || run.status === 'invalid-output') consecutive += 1
  }
  // 这一次本身也算一次失败。
  if (consecutive + 1 >= analysisFailureNoticePolicy.consecutiveFailureLimit) return true
  if (lastSuccessMs === null) return false
  return Number.isFinite(lastSuccessMs) && nowMs - lastSuccessMs >= analysisFailureNoticePolicy.silentAfterSuccessMs
}

function deeplinkForTimeline(eventGroupId: string) {
  return {
    scope: 'product' as const, productId: 'market-intelligence', pageId: 'intelligence',
    entityType: 'analysis-event-group', entityId: eventGroupId
  }
}

const checkModelDeeplink = { scope: 'platform' as const, settingsSectionId: 'models' }

export function buildAnalysisFailureRequest(input: AnalysisFailureNoticeInput): NotificationSubmitRequest {
  const failureClass = classifyAnalysisFailure(input)
  // 成品句子在源头拼（与 `taskFailureNotifier` 同一姿态）：产品事件的文案不在平台表里，
  // 提交时把两种语言一次备好，读取端按读者当前语言挑——成品句和「存键」两种形状，平台都收。
  // 正文按 kind 说清是哪一类（R39 §7）：一条新闻的解读失败，不能说成「时间轴里能看到」。
  const news = input.analysisKind === 'news'
  const body = failureBody(failureClass, news)
  const rendered = news ? {
    'zh-CN': {
      title: '新闻解读没能生成',
      body: body['zh-CN'],
      reason: '新闻解读失败了，而你在等它的结果。'
    },
    'en-US': {
      title: 'News reading did not run',
      body: body['en-US'],
      reason: 'A news reading failed while you were waiting for it.'
    }
  } as const : {
    'zh-CN': {
      title: '分析没能生成',
      body: body['zh-CN'],
      reason: failureClass === 'network'
        ? '启动时网络还没就绪，这次分析没有开始。'
        : '分析失败了，而你在等它的结果。'
    },
    'en-US': {
      title: 'Analysis did not run',
      body: body['en-US'],
      reason: failureClass === 'network'
        ? 'The network was not ready when this analysis started.'
        : 'An analysis failed while you were waiting for it.'
    }
  } as const
  // 「期间还有 N 次」不写进模板：次数由平台的合并计数统一说，两个数会打架。
  // 键带 detail：同一个粗码下「网络没就绪」和「连不上」是读者要做两件事的两种失败，
  // 合并会让后发生的那条消失。
  const identity = input.kind === 'manual'
    ? `manual:${input.runId}`
    : `${input.triggerKey}:${input.failureCode ?? 'unknown'}:${input.failureDetailCode ?? 'unknown'}:${automaticFailureBucket(input.occurredAt)}`
  const retryAction = {
    id: 'retry-analysis', kind: 'custom' as const,
    labelRef: { scope: 'product' as const, productId: 'market-intelligence', key: ANALYSIS_RETRY_ACTION_KEY }
  }
  const timelineAction = {
    id: 'view-timeline', kind: 'open' as const, deeplink: deeplinkForTimeline(input.eventGroupId),
    labelRef: { scope: 'product' as const, productId: 'market-intelligence', key: ANALYSIS_TIMELINE_ACTION_KEY }
  }
  const actions: NotificationSubmitRequest['actions'] = failureClass === 'connection'
    // 连接类：读者要做的是查配置/网络。网络没就绪不是连接问题——给它「检查模型连接」是错误指引。
    ? [{
      id: 'check-model', kind: 'open', deeplink: checkModelDeeplink,
      labelRef: { scope: 'product' as const, productId: 'market-intelligence', key: ANALYSIS_CHECK_MODEL_ACTION_KEY }
    }]
    // 启动窗口的网络没就绪：稍后会好，动作只有「重试」。
    : failureClass === 'network'
      ? [retryAction]
      // 新闻解读不进时间轴：动作只有「重试」，不给「查看时间轴」——那条 deeplink 里没有这条解读。
      : news
        ? (input.kind === 'manual' ? [retryAction] : [])
        : input.kind === 'manual'
          ? [retryAction, timelineAction]
          : [timelineAction]
  return {
    eventTypeId: MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS.analysisFailed,
    producerId: RUN_MARKET_ANALYSIS_JOB,
    dedupeVars: { builder: 'template', vars: { identity } },
    rendered,
    actions,
    occurredAt: input.occurredAt
  }
}

/**
 * 正文按失败类别说清读者能做什么。网络没就绪是「还没到」而不是「连不上」：
 * 它只说稍后重试，不给检查模型连接的指引。
 */
function failureBody(
  failureClass: AnalysisFailureClass,
  news: boolean
): Readonly<{ 'zh-CN': string; 'en-US': string }> {
  if (failureClass === 'network') {
    return {
      'zh-CN': '网络还没就绪，稍后重试。',
      'en-US': 'The network is not ready yet; try again shortly.'
    }
  }
  if (failureClass === 'connection') {
    return news
      ? {
        'zh-CN': '这次没有连上模型服务，所以没有得出这条新闻的解读。检查模型配置或网络后可以重试。',
        'en-US': 'The model service could not be reached, so no reading of this news item was produced. Check the model settings or your network, then try again.'
      }
      : {
        'zh-CN': '这次没有连上模型服务，所以没有得出解读。检查模型配置或网络后可以重试。',
        'en-US': 'The model service could not be reached, so no reading was produced. Check the model settings or your network, then try again.'
      }
  }
  return news
    ? {
      'zh-CN': '这次新闻解读没有完成，可以在新闻抽屉里重试。',
      'en-US': 'This news reading did not finish; you can retry from the news drawer.'
    }
    : {
      'zh-CN': '这次分析没有完成，时间轴里能看到失败与重试。',
      'en-US': 'This analysis did not finish; the timeline shows the failure and the retry.'
    }
}

/** 提交失败一律吞掉：运行已经记成失败了，通知发不出去不该再制造第二个失败。 */
export async function notifyAnalysisFailure(
  submit: ((request: NotificationSubmitRequest) => Promise<unknown>) | undefined,
  input: AnalysisFailureNoticeInput
): Promise<void> {
  if (!submit) return
  try { await submit(buildAnalysisFailureRequest(input)) } catch { /* 记录是事实，通知是加法 */ }
}
