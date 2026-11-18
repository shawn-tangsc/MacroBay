import type {
  StructuredModelInvocationErrorCode,
  TransportErrorKind
} from '@platform/ai/invocation/structuredModelInvocationTypes'

/**
 * Why a provider call failed, at the level a reader can act on.
 *
 * The coarse code `analysis-provider-error` covered four different faults: the gateway cutting a
 * call at its fallback budget, the provider answering with a rate limit, the connection never
 * being established, and the provider returning an error of its own. A timeline row, a run-log
 * line and (later) a notification that all say "it failed" tell the reader nothing they can do.
 *
 * 判据按**事实**走，不按耗时猜（原来的 `connectFailureMaxMs` 已退役）：
 * - 收到响应 ⇒ `httpStatus` 说话：`http-429` / `http-4xx` / `http-5xx`；
 * - 没收到响应 ⇒ `transportErrorKind` 说话：连接类（dns/refused/reset/tls）才是 `connect-failed`，
 *   `timeout` 是 `gateway-timeout`，`aborted`/`unknown` 不下连接结论；
 * - 两者都没有时，55 秒那条兜底只把「网关按预算切断了这次调用」记成 `upstream-aborted`；
 *   短耗时不再推出任何成因，落在 `provider-other`。
 *
 * 历史行不追溯改写：`failureDetailCode` 是写入时的事实记录，重判会把当时的记录变成另一件事。
 * 状态码属于诊断/安全元数据，不进入读者正文。
 */
export const analysisFailureDetailPolicy = Object.freeze({
  version: 'marketAnalysisFailureDetail.v2',
  /**
   * The gateway's undeclared-budget fallback is 60 s (raised to the caller's declared budget once
   * that budget is propagated). The observed cut lands at 59–61 s; five seconds of margin keeps a
   * slow-but-honest attempt that failed at 50 s out of it.
   */
  upstreamAbortMinMs: 55_000
})

export const analysisFailureDetailCodes = Object.freeze([
  'upstream-aborted',
  'http-429',
  'http-4xx',
  'http-5xx',
  'connect-failed',
  'gateway-timeout',
  /** 启动就绪门在 20 秒预算内没探通；只覆盖启动窗口，不是网络抖动的通用兜底。 */
  'network-not-ready',
  'provider-other'
] as const)

export type AnalysisFailureDetailCode = (typeof analysisFailureDetailCodes)[number]

/** True when the detail code carries provider facts; used for the notification's reason sentence. */
export function isAnalysisFailureDetailCode(value: string): value is AnalysisFailureDetailCode {
  return (analysisFailureDetailCodes as readonly string[]).includes(value)
}

const CONNECTION_TRANSPORT_ERROR_KINDS: ReadonlySet<TransportErrorKind> = new Set(['dns', 'refused', 'reset', 'tls'])

/**
 * Maps one failed invocation onto a detail code.
 *
 * `provider-other` is the floor, never `null`: a failure with no readable cause is still recorded
 * as "a provider error we could not classify", because a blank detail is what let every failure
 * look the same.
 */
export function classifyProviderFailureDetail(input: Readonly<{
  errorCode: StructuredModelInvocationErrorCode | string
  durationMs?: number | null
  httpStatus?: number | null
  transportErrorKind?: TransportErrorKind | string | null
}>): AnalysisFailureDetailCode {
  // 1. 收到了响应：状态码是事实，优先于一切推断。
  const httpStatus = input.httpStatus
  if (typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599) {
    if (httpStatus === 429) return 'http-429'
    return httpStatus < 500 ? 'http-4xx' : 'http-5xx'
  }
  // 2. 没收到响应：只有传输类别说它是连接类，才记 `connect-failed`。
  const transportErrorKind = input.transportErrorKind
  if (transportErrorKind === 'timeout') return 'gateway-timeout'
  if (typeof transportErrorKind === 'string' && CONNECTION_TRANSPORT_ERROR_KINDS.has(transportErrorKind as TransportErrorKind)) {
    return 'connect-failed'
  }
  // 3. 没有状态码也没有正向传输证据时，保留两条原有的事实判据。
  if (input.errorCode === 'rate-limited') return 'http-429'
  // The invocation's own timer fired: the call was given a budget and used all of it.
  if (input.errorCode === 'timeout') return 'gateway-timeout'
  if (input.errorCode !== 'provider-error') return 'provider-other'
  const durationMs = input.durationMs
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return 'provider-other'
  if (durationMs >= analysisFailureDetailPolicy.upstreamAbortMinMs) return 'upstream-aborted'
  // 短耗时只说明这一跳很快失败，说明不了是不是连接；不许再由此推出 `connect-failed`。
  return 'provider-other'
}

/**
 * The detail to store for a failed run.
 *
 * Runs that already have a finer cause of their own keep it: an output rejection records the
 * validation rule, a not-ready provider records its own code. Only the provider line gets the
 * detail codes above — never a blank, and never the coarse code copied into the detail column.
 */
export function resolveAnalysisRunFailureDetail(input: Readonly<{
  failureCode: string
  providerFailure?: Readonly<{
    errorCode: string
    durationMs?: number | null
    httpStatus?: number | null
    transportErrorKind?: TransportErrorKind | string | null
  }>
}>): string {
  if (input.failureCode !== 'analysis-provider-error' && input.failureCode !== 'analysis-timeout') return input.failureCode
  if (!input.providerFailure) return 'provider-other'
  return classifyProviderFailureDetail(input.providerFailure)
}
