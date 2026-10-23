import type { ModelChatProtocol } from '../modelProviderTypes'
import type { ModelDetectionResult } from './types'

/**
 * PLAT-82：一次 run 的**写库素材**——每个模型"本次实测通过"的协议。
 *
 * 只有 `ok` 进结果（`reused` 也算通过：它复用的是同一条请求的真实结论）。
 * 没有协议结论 / 全部失败 / 被跳过 ⇒ 不出现该模型：**失败不写负结论**。
 */
export type ModelProbedProtocolsEntry = {
  modelId: string
  protocols: ModelChatProtocol[]
}

export function collectProbedProtocols(
  results: readonly ModelDetectionResult[]
): ModelProbedProtocolsEntry[] {
  const entries: ModelProbedProtocolsEntry[] = []
  for (const result of results) {
    const passed = (result.protocols ?? [])
      .filter((entry) => entry.ok)
      .map((entry) => entry.protocol)
    if (passed.length === 0) continue
    entries.push({ modelId: result.modelId, protocols: passed })
  }
  return entries
}
