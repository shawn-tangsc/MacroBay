import type { NotificationSubmitRequest } from '@platform/notifications/contracts/notificationContracts'

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
export const ANALYSIS_MANUAL_FAILURE_EVENT_ID = 'platform.analysis.manual-failed'

export type AnalysisManualFailure = Readonly<{
  runId: string
  failureCode: string
  /** Absent when the failure had no finer cause than its coarse code. */
  failureDetailCode: string | null
  occurredAt: string
  /** The reader's language at submit time: the reason param is a sentence, not a key. */
  language: 'zh-CN' | 'en-US'
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
export function manualAnalysisFailureReason(input: Pick<AnalysisManualFailure, 'failureCode' | 'failureDetailCode' | 'language'>): string {
  const copy = REASON_COPY[input.failureDetailCode ?? ''] ?? REASON_COPY[input.failureCode] ?? FALLBACK_REASON
  return copy[input.language]
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
export function buildManualAnalysisFailureRequest(input: AnalysisManualFailure): NotificationSubmitRequest {
  const reason = manualAnalysisFailureReason(input)
  return {
    eventTypeId: ANALYSIS_MANUAL_FAILURE_EVENT_ID,
    producerId: RUN_MARKET_ANALYSIS_JOB,
    dedupeVars: { builder: 'template', vars: { runId: input.runId } },
    bodyParams: { reason },
    // The deep link is what makes the notice open the run record; `actions` stays empty until the
    // platform copy table carries its label, because the action label is a typed copy key and a key
    // cannot exist before the approved copy row does. TODO(MI-1-R23): add the labelled action in
    // the same change as that row.
    actions: [],
    deeplink: manualAnalysisFailureDeeplink(input.runId),
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
  try {
    await submit(buildManualAnalysisFailureRequest(input))
  } catch {
    // The record is the source of truth; the notice is an addition to it.
  }
}

/**
 * Binds the producer to the wiring the runtime already has.
 *
 * Lives here, not in the runtime: the runtime file is on the file-size baseline and may only
 * shrink, and the language rule is this notice's own ("a sentence is needed, so a missing language
 * reader means no notice rather than the wrong language").
 */
export function createManualFailureNotice(deps: Readonly<{
  submitNotification?: AnalysisNotificationSubmit
  getLanguage?: () => Promise<'zh-CN' | 'en-US'>
}>): (input: Omit<AnalysisManualFailure, 'language'>) => Promise<void> {
  return async (failure) => {
    if (!deps.getLanguage) return
    const language = await deps.getLanguage()
    await notifyManualAnalysisFailure(deps.submitNotification, { ...failure, language })
  }
}
