import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'
import { renderPlatformEventCopy } from '@platform/notifications/producers/platformEventCopy'

import { ANALYSIS_NOTIFICATION_EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { RUN_MARKET_ANALYSIS_JOB } from '../jobs/marketAnalysisJobIds'

/**
 * 0′：a failure the reader asked for is always answered.
 *
 * The reader pressed "Analyze now" and is watching the panel. The run spends two to four minutes,
 * then nothing appears — that is the one silence a reader cannot act on, because he is standing
 * right there waiting. Every other failure level is throttled; this one is not.
 *
 * The event id, its surfaces and its dedupe key are a cross-module contract: the approval row is
 * signed in the platform notification table, and until it is, this producer cannot deliver. The
 * id below is the agreed one; nothing here changes the platform side by itself.
 *
 * Two rules the wording follows: the body carries a human sentence, never a raw provider error
 * (those can contain URLs and key fragments), and the code stays behind the deep link into the run
 * log rather than in the sentence.
 */
export const ANALYSIS_MANUAL_FAILURE_EVENT_ID = ANALYSIS_NOTIFICATION_EVENT_IDS.manualFailed

/**
 * The failure itself. It carries **no reader language**: both sentences are composed at submit
 * time, so a reader who switches language later still reads the sentence in the new language.
 * (The old shape took the language and froze one sentence into the record.)
 */
export type AnalysisManualFailure = Readonly<{
  runId: string
  failureCode: string
  /** Absent when the failure had no finer cause than its coarse code. */
  failureDetailCode: string | null
  occurredAt: string
}>

type ReasonCopy = Readonly<{ 'zh-CN': string; 'en-US': string }>

/**
 * One sentence per cause a reader can tell apart.
 *
 * The detail codes are the ones `analysisFailureDetail` writes; the coarse codes cover the failures
 * that are our own content rather than the provider's. Everything else falls back to "it did not
 * finish" rather than inventing a cause.
 */
const REASON_COPY: Readonly<Record<string, ReasonCopy>> = Object.freeze({
  'upstream-aborted': {
    'zh-CN': '模型服务在生成中途断开了连接',
    'en-US': 'the model service dropped the connection while answering'
  },
  'http-429': {
    'zh-CN': '模型服务正在限流，没有接受这次请求',
    'en-US': 'the model service was rate-limiting and refused the request'
  },
  'connect-failed': {
    'zh-CN': '连不上模型服务',
    'en-US': 'the model service could not be reached'
  },
  'gateway-timeout': {
    'zh-CN': '等了太久，这次调用超时了',
    'en-US': 'the call timed out waiting for an answer'
  },
  'provider-other': {
    'zh-CN': '模型服务返回了错误',
    'en-US': 'the model service returned an error'
  },
  'analysis-provider-not-ready': {
    'zh-CN': '模型服务还没准备好（检查模型配置）',
    'en-US': 'the model service is not ready; check the model settings'
  },
  'analysis-invalid-output-schema': {
    'zh-CN': '模型返回的内容不符合要求，这次没有发布',
    'en-US': 'the answer did not match the required format, so it was not published'
  },
  'analysis-invalid-json': {
    'zh-CN': '模型返回的内容不是合法 JSON，这次没有发布',
    'en-US': 'the answer was not valid JSON, so it was not published'
  },
  'analysis-missing-evidence': {
    'zh-CN': '结论与冻结的证据对不上，这次没有发布',
    'en-US': 'the conclusion did not match the frozen evidence, so it was not published'
  },
  'analysis-unsafe-output': {
    'zh-CN': '结论里有不该出现的内容，这次没有发布',
    'en-US': 'the conclusion contained content that may not be published'
  },
  'analysis-storage-failed': {
    'zh-CN': '结论没能写进本地存储',
    'en-US': 'the conclusion could not be saved locally'
  }
})

const FALLBACK_REASON: ReasonCopy = Object.freeze({
  'zh-CN': '这次分析没有完成',
  'en-US': 'this analysis did not finish'
})

/**
 * The sentence the body shows.
 *
 * The detail code wins over the coarse one: `analysis-provider-error` with `upstream-aborted` should
 * say the connection dropped, not "the provider returned an error".
 */
export function manualAnalysisFailureReasonCopy(input: Pick<AnalysisManualFailure, 'failureCode' | 'failureDetailCode'>): ReasonCopy {
  return REASON_COPY[input.failureDetailCode ?? ''] ?? REASON_COPY[input.failureCode] ?? FALLBACK_REASON
}

/** The deep link lands on the run-log page, where the code and the record can be read. */
export function manualAnalysisFailureDeeplink(runId: string) {
  return {
    scope: 'product' as const,
    productId: 'market-intelligence',
    settingsSectionId: 'intelligence-sources',
    entityType: 'analysis-run',
    entityId: runId
  }
}

/**
 * A pure request builder: the same failure always produces the same request field for field, which
 * is what makes "one notice per manual attempt" checkable.
 *
 * The dedupe key is the run id, not a day: two failed presses are two distinct attempts and both
 * deserve an answer. The platform expands the key from the declaration.
 */
export function buildManualAnalysisFailureRequest(input: AnalysisManualFailure): NotificationSubmitRequest | undefined {
  const reason = manualAnalysisFailureReasonCopy(input)
  const deeplink = manualAnalysisFailureDeeplink(input.runId)
  // Both sentences are composed here, from the product's own cause table; the platform's copy
  // table only owns the sentence around them. Undefined means the copy is not there, and a
  // half-composed notice is worse than silence.
  const rendered = renderPlatformEventCopy({
    eventTypeId: ANALYSIS_MANUAL_FAILURE_EVENT_ID,
    paramsByLanguage: { 'zh-CN': { reason: reason['zh-CN'] }, 'en-US': { reason: reason['en-US'] } }
  })
  if (rendered === undefined) return undefined
  return {
    eventTypeId: ANALYSIS_MANUAL_FAILURE_EVENT_ID,
    producerId: RUN_MARKET_ANALYSIS_JOB,
    dedupeVars: { builder: 'template', vars: { runId: input.runId } },
    rendered,
    // The event declares `requiresUserAction`, so a notice without an action is rejected outright;
    // the copy row for the label exists now (`…manual-failed.open`), which is what the old TODO
    // was waiting for. Same deep link as the card: the run record is where the code can be read.
    actions: [{
      id: 'open-run-log',
      labelKey: 'notification.event.platform.analysis.manual-failed.open',
      kind: 'open',
      deeplink
    }],
    deeplink,
    occurredAt: input.occurredAt
  }
}

export type AnalysisNotificationSubmit = (request: NotificationSubmitRequest) => Promise<unknown>

/**
 * Submits the notice, swallowing every failure.
 *
 * The run has already been recorded as failed; a notification that cannot be submitted must not
 * turn that into a second, different failure. Same posture as the quota notice.
 */
export async function notifyManualAnalysisFailure(
  submit: AnalysisNotificationSubmit | undefined,
  input: AnalysisManualFailure
): Promise<void> {
  if (!submit) return
  const request = buildManualAnalysisFailureRequest(input)
  if (request === undefined) return
  try {
    await submit(request)
  } catch {
    // The record is the source of truth; the notice is an addition to it.
  }
}

/**
 * Binds the producer to the wiring the runtime already has.
 *
 * It no longer asks for the reader's language: the notice carries both sentences, so the record
 * cannot be frozen into the language of the day it was written in.
 */
export function createManualFailureNotice(deps: Readonly<{
  submitNotification?: AnalysisNotificationSubmit
}>): (input: AnalysisManualFailure) => Promise<void> {
  return async (failure) => {
    await notifyManualAnalysisFailure(deps.submitNotification, failure)
  }
}
