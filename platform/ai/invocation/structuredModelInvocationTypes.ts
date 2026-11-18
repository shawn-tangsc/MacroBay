export type StructuredModelInvocationErrorCode =
  | 'model-not-ready'
  | 'provider-disabled'
  | 'missing-api-key'
  | 'timeout'
  /**
   * The caller aborted the invocation (window closed, job cancelled, app shutting down). It is
   * not a timeout: the model was never given its budget, so a surface that says "the model took
   * too long" would send the reader after the wrong cause.
   */
  | 'cancelled'
  | 'rate-limited'
  | 'provider-error'
  | 'invalid-json'
  | 'schema-validation-failed'

/**
 * 没收到任何 HTTP 响应时，底层传输错误的闭集。
 *
 * 它回答的是「连接在哪一步断的」，不是「服务端怎么回答的」——后者由 `httpStatus` 表达。
 * 两者必须分开：状态码是事实，传输类别也是事实，而耗时只是旁证（旧的 `connect-failed`
 * 按「<5 秒」推断，正是把旁证当成了事实）。
 */
export type TransportErrorKind = 'dns' | 'refused' | 'reset' | 'tls' | 'timeout' | 'aborted' | 'unknown'

export type StructuredModelMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type StructuredModelTaskRequest<TOutput> = {
  taskId: string
  providerId?: string
  modelId?: string
  messages: StructuredModelMessage[]
  parse: (value: unknown) => TOutput
  timeoutMs?: number
  abortSignal?: AbortSignal
}

export type SafeModelInvocationTrace = {
  taskId: string
  providerId?: string
  modelId?: string
  durationMs: number
  errorCode?: StructuredModelInvocationErrorCode
}

export type StructuredModelTaskResult<TOutput> =
  | {
      ok: true
      output: TOutput
      providerId: string
      modelId: string
      trace: SafeModelInvocationTrace
    }
  | {
      ok: false
      errorCode: StructuredModelInvocationErrorCode
      /**
       * 收到响应时它带的状态码。有它就以它为准：一个 500 无论多快回来都是「服务端给了错误
       * 回答」，不是「连不上」。`429` 仍由 `errorCode: 'rate-limited'` 单独表达，这里照样带上。
       */
      httpStatus?: number
      /** 没收到响应时底层错误的归类；收到响应时不会出现。 */
      transportErrorKind?: TransportErrorKind
      trace: SafeModelInvocationTrace
    }
