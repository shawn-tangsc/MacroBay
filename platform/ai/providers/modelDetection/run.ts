import type { ModelDefinition, ModelProvider } from '../modelProviderTypes'
import { detectModel, type ModelDetectionOptions } from './detect'
import {
  MODEL_DETECTION_CONCURRENCY,
  type ModelDetectionMode,
  type ModelDetectionResult,
  type ModelDetectionOutcome
} from './types'

/**
 * 批量检测：固定并发 5；取消后不再调度新任务，在飞模型记 `cancelled` 并**照常上报**，
 * 已完成结果保留，未开始任务不产出。
 */
export async function runModelDetection(input: {
  provider: ModelProvider
  models: readonly ModelDefinition[]
  modes: readonly ModelDetectionMode[]
  fetch: typeof fetch
  runId: string
  concurrency?: number
  timeoutMs?: number
  signal?: AbortSignal
  onResult?: (result: ModelDetectionResult) => void
}): Promise<ModelDetectionOutcome> {
  const concurrency = Math.max(1, input.concurrency ?? MODEL_DETECTION_CONCURRENCY)
  const results: ModelDetectionResult[] = []
  let cursor = 0
  const options: ModelDetectionOptions & { runId: string } = {
    fetch: input.fetch,
    runId: input.runId,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.signal ? { signal: input.signal } : {})
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (input.signal?.aborted) return
      const index = cursor
      cursor += 1
      const model = input.models[index]
      if (!model) return
      const result = await detectModel(input.provider, model, input.modes, options)
      results.push(result)
      input.onResult?.(result)
      if (result.status === 'cancelled') return
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return { results, cancelled: input.signal?.aborted === true }
}
