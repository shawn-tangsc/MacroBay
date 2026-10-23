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
      trace: SafeModelInvocationTrace
    }
