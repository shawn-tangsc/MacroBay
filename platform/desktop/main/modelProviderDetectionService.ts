import {
  collectProbedProtocols,
  runModelDetection,
  type ModelDetectionMode,
  type ModelDetectionResult
} from '../../ai/providers/modelDetection'
import type { ModelChatProtocol, ModelProvider } from '../../ai/providers/modelProviderTypes'

/**
 * PLAT-82：「检测模型」的主进程运行器。
 *
 * 归属：探测在主进程执行（Key 只在主进程解析、并发 5、abort 记账在 main）。
 * 结果**只存内存**：不 upsert、不写库，run 结束即从 `runs` 删除；重启即清空。
 *
 * runId 生命周期（设计 §6）：
 *  - 重复 runId ⇒ `{ accepted: false }`（不打断已在跑的 run）；
 *  - done 之后从 Map 删除（同一 runId 可以再次使用）；
 *  - cancel 未知 runId ⇒ 幂等成功。
 */
export type ModelDetectionRequest = {
  modes: ModelDetectionMode[]
  runId: string
  /**
   * 只检测这些模型（按供应商顺序过滤）；缺省 = 全部模型。
   *
   * 自动检测用它把范围收窄到「新增 / 变更 / 结论过期」的模型，避免每次保存都全量发请求。
   */
  modelIds?: string[]
}

export type ModelDetectionAcceptance = {
  accepted: boolean
  total: number
}

export type ModelProviderDetectionService = {
  detectModels: (providerId: string, request: ModelDetectionRequest) => Promise<ModelDetectionAcceptance>
  cancelModelDetection: (runId: string) => void
  /** 仅供测试/诊断：当前在跑的 runId。 */
  runningRunIds: () => string[]
}

const DETECTION_MODES: readonly ModelDetectionMode[] = ['connectivity', 'protocol']

/** `undefined` = 没传（全部模型）；空数组 = 明确一个都不测（`total: 0`）。 */
function normalizeModelIds(raw: unknown): Set<string> | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return undefined
  return new Set(
    raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )
}

function normalizeModes(raw: unknown): ModelDetectionMode[] | null {
  if (!Array.isArray(raw)) return null
  const modes = Array.from(new Set(raw.filter((entry): entry is ModelDetectionMode =>
    typeof entry === 'string' && (DETECTION_MODES as readonly string[]).includes(entry))))
  return modes.length > 0 ? modes : null
}

export function createModelProviderDetectionService(input: {
  resolveProvider: (providerId: string) => Promise<ModelProvider | undefined | null>
  fetch: () => typeof fetch
  onProgress: (result: ModelDetectionResult) => void
  onDone: (runId: string, payload: { stopped: boolean }) => void
  /**
   * PLAT-82：run 结束后把「本次实测通过」的协议写回模型（**一次写入**，覆盖本次 run 的所有模型）。
   *
   * 写库失败不影响结果上报：done 一定发，其它模型也不会被连带丢弃。
   * 状态文案（成功/失败/跳过/已停止）永远只在内存，这里只写"某协议可用"这一条事实。
   */
  recordProbedProtocols?: (
    providerId: string,
    updates: ReadonlyArray<{ modelId: string; protocols: ModelChatProtocol[] }>
  ) => Promise<void>
  /**
   * 可用性结论写回：只写 `ok` / `failed`，跳过与取消不写。
   *
   * 写库失败不影响 done 上报（否则界面会永远停在"检测中"）。
   */
  recordModelAvailability?: (
    providerId: string,
    updates: ReadonlyArray<{ modelId: string; status: 'ok' | 'failed'; reasonCode?: string }>,
    checkedAt: string
  ) => Promise<void>
}): ModelProviderDetectionService {
  const runs = new Map<string, AbortController>()

  async function detectModels(providerId: string, request: ModelDetectionRequest): Promise<ModelDetectionAcceptance> {
    const runId = typeof request?.runId === 'string' ? request.runId.trim() : ''
    const modes = normalizeModes(request?.modes)
    if (!runId) throw new Error('runId is required.')
    if (!modes) throw new Error('At least one detection mode is required.')
    if (runs.has(runId)) return { accepted: false, total: 0 }

    const provider = await input.resolveProvider(providerId)
    if (!provider) throw new Error(`Provider "${providerId}" was not found.`)
    // 缺省 = 全部模型；带 `modelIds` 时按供应商顺序收窄（自动检测只测新增/变更/过期的那几个）。
    const selected = normalizeModelIds(request?.modelIds)
    const models = selected === undefined
      ? provider.models
      : provider.models.filter((model) => selected.has(model.id))

    const controller = new AbortController()
    runs.set(runId, controller)
    // 一模型一事件：progress 直接发完整 `ModelDetectionResult`。
    void runModelDetection({
      provider,
      models,
      modes,
      fetch: input.fetch(),
      runId,
      signal: controller.signal,
      onResult: (result) => input.onProgress(result)
    }).then(
      async (outcome) => {
        const availability = outcome.results
          .filter((result) => result.status === 'ok' || result.status === 'failed')
          .map((result) => ({
            modelId: result.modelId,
            status: result.status as 'ok' | 'failed',
            ...(result.reasonCode ? { reasonCode: result.reasonCode } : {})
          }))
        if (input.recordModelAvailability && availability.length > 0) {
          try {
            await input.recordModelAvailability(providerId, availability, new Date().toISOString())
          } catch {
            // 结论存不下也不能让 done 丢掉。
          }
        }
        const updates = collectProbedProtocols(outcome.results)
        if (input.recordProbedProtocols && updates.length > 0) {
          try {
            await input.recordProbedProtocols(providerId, updates)
          } catch {
            // 存不下也不能让 done 丢掉（否则界面永远停在"检测中"）。
          }
        }
        input.onDone(runId, { stopped: outcome.cancelled })
      },
      () => input.onDone(runId, { stopped: true })
    ).finally(() => {
      runs.delete(runId)
    })

    return { accepted: true, total: models.length }
  }

  function cancelModelDetection(runId: string): void {
    const controller = runs.get(runId)
    // 未知 runId ⇒ 幂等成功（不抛错）。
    controller?.abort('model-detection-cancelled')
  }

  return {
    detectModels,
    cancelModelDetection,
    runningRunIds: () => [...runs.keys()]
  }
}
