import type { ProviderStateAccessor } from '../providers/modelProviderTypes'
import { requestOpenAiCompatibleChatCompletion } from './openAiChatCompletionClient'
import { resolveChatModelForRuntime, resolveSafeModelLabelsFromState } from './resolveChatModel'
import type {
  SafeModelInvocationTrace,
  StructuredModelInvocationErrorCode,
  StructuredModelTaskRequest,
  StructuredModelTaskResult
} from './structuredModelInvocationTypes'

const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_MAX_CONCURRENT = 4

export type StructuredModelInvocationService = ReturnType<typeof createStructuredModelInvocationService>

export function createStructuredModelInvocationService(deps: {
  getProviderState: ProviderStateAccessor
  fetch?: typeof fetch
  defaultTimeoutMs?: number
  maxConcurrent?: number
}) {
  const defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  let activeCount = 0
  const waitQueue: Array<() => void> = []

  async function acquireSlot(): Promise<void> {
    if (activeCount < maxConcurrent) {
      activeCount += 1
      return
    }

    await new Promise<void>((resolve) => {
      waitQueue.push(resolve)
    })
    activeCount += 1
  }

  function releaseSlot(): void {
    activeCount = Math.max(0, activeCount - 1)
    const next = waitQueue.shift()
    next?.()
  }

  return {
    async resolveSafeModelLabels(providerId?: string, modelId?: string) {
      const providerState = await deps.getProviderState()
      return resolveSafeModelLabelsFromState(providerState, providerId, modelId)
    },

    async invoke<TOutput>(
      request: StructuredModelTaskRequest<TOutput>
    ): Promise<StructuredModelTaskResult<TOutput>> {
      const startedAt = Date.now()
      await acquireSlot()

      try {
        const resolved = await resolveChatModelForRuntime(deps.getProviderState, request.providerId, request.modelId)
        if (!resolved.ok) {
          return failure(request.taskId, resolved.errorCode, startedAt)
        }

        // A caller that is already aborted must not spend a request at all: the answer is known
        // before the connection is opened, and `cancelled` says why.
        const externalAbort = request.abortSignal
        if (externalAbort?.aborted) {
          return failure(request.taskId, 'cancelled', startedAt, resolved.model.providerId, resolved.model.modelId)
        }

        const abortController = new AbortController()
        const timeoutMs = request.timeoutMs ?? defaultTimeoutMs
        // Who ended the call decides what the caller is told. Only this budget turning over is a
        // timeout; an abort from the caller (window closed, job cancelled, app shutting down) is
        // reported as `cancelled`, and the two used to arrive as one code.
        let timedOut = false
        const timeoutId = setTimeout(() => {
          timedOut = true
          abortController.abort()
        }, timeoutMs)
        const onExternalAbort = () => abortController.abort()
        externalAbort?.addEventListener('abort', onExternalAbort, { once: true })

        try {
          const completion = await requestOpenAiCompatibleChatCompletion({
            baseUrl: resolved.model.baseUrl,
            apiKey: resolved.model.apiKey,
            modelId: resolved.model.modelId,
            messages: request.messages,
            jsonMode: true,
            fetch: deps.fetch,
            abortSignal: abortController.signal
          })

          if (!completion.ok) {
            return failure(request.taskId, completion.errorCode, startedAt, resolved.model.providerId, resolved.model.modelId)
          }

          let parsedJson: unknown
          try {
            parsedJson = JSON.parse(completion.content)
          } catch {
            return failure(
              request.taskId,
              'invalid-json',
              startedAt,
              resolved.model.providerId,
              resolved.model.modelId
            )
          }

          let output: TOutput
          try {
            output = request.parse(parsedJson)
          } catch {
            return failure(
              request.taskId,
              'schema-validation-failed',
              startedAt,
              resolved.model.providerId,
              resolved.model.modelId
            )
          }

          return {
            ok: true,
            output,
            providerId: resolved.model.providerId,
            modelId: resolved.model.modelId,
            trace: createTrace(request.taskId, startedAt, resolved.model.providerId, resolved.model.modelId)
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return failure(
              request.taskId,
              timedOut ? 'timeout' : 'cancelled',
              startedAt,
              resolved.model.providerId,
              resolved.model.modelId
            )
          }
          return failure(
            request.taskId,
            'provider-error',
            startedAt,
            resolved.model.providerId,
            resolved.model.modelId
          )
        } finally {
          clearTimeout(timeoutId)
          externalAbort?.removeEventListener('abort', onExternalAbort)
        }
      } finally {
        releaseSlot()
      }
    }
  }
}

function failure(
  taskId: string,
  errorCode: StructuredModelInvocationErrorCode,
  startedAt: number,
  providerId?: string,
  modelId?: string
): StructuredModelTaskResult<never> {
  return {
    ok: false,
    errorCode,
    trace: createTrace(taskId, startedAt, providerId, modelId, errorCode)
  }
}

function createTrace(
  taskId: string,
  startedAt: number,
  providerId?: string,
  modelId?: string,
  errorCode?: StructuredModelInvocationErrorCode
): SafeModelInvocationTrace {
  return {
    taskId,
    providerId,
    modelId,
    durationMs: Date.now() - startedAt,
    errorCode
  }
}
