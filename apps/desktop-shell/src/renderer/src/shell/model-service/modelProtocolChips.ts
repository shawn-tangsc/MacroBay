import type { ModelChatProtocol } from '@platform/ai/providers/modelProviderTypes'
import { normalizeModelSupportedProtocols } from '@platform/ai/providers/modelChatProtocol'
import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { MODEL_PROTOCOL_TABS, modelDeclaredProtocols } from './modelProtocolFilter'

/**
 * PLAT-82：模型行**协议 chip** 的派生（唯一实现）。
 *
 * 集合 = 模型记录里的 `supportedProtocols ∪ declaredProtocols ∪ probedProtocols`：
 *  - 记录部分：**支持哪个就画哪个**，一个都不多画（Anthropic 供应商的模型没有 chat 标，
 *    纯 Gemini 供应商只有 gemini 标）；判据仍由 `deriveModelSupportedProtocols` 生产；
 *  - 检测证据（`probedProtocols`）是**持久化**的，不是本会话结果：实测通过后由主进程写回
 *    模型记录，刷新列表即可见，重启仍在。失败不产生 chip、也不标红。
 *
 * 来源（`source`，决定 title，优先级 declared > probed > endpoint）：
 *  - `declared`：厂商逐条声明（`declaredProtocols`）⇒「厂商声明」；
 *  - `probe`：我们自己实测通过的（`probedProtocols`）⇒「实测通过」；
 *  - `endpoint`：仅由模型默认协议 / 供应商默认端点并入 ⇒「按默认端点推断」。
 *
 * 顺序固定为筛选 pill 的顺序（chat-completions → responses → messages → gemini）。
 */
export type ModelProtocolChipSource = 'declared' | 'endpoint' | 'probe'

export type ModelProtocolChip = {
  protocol: ModelChatProtocol
  source: ModelProtocolChipSource
}

export function modelRowProtocolChips(model: ModelDefinition): ModelProtocolChip[] {
  const declared = modelDeclaredProtocols(model)
  const probed = normalizeModelSupportedProtocols(model.probedProtocols) ?? []
  // 与协议 pill 同一口径（`supportedProtocols ∪ declaredProtocols`）：两处计数不允许打架，
  // 也保证「厂商声明过却实测失败」的协议一定有 chip 可以变红。检测证据一并并进来，
  // 即使同步把 `supportedProtocols` 覆盖回厂商口径，实测通过的证据也不会丢。
  const present = new Set<string>([
    ...(normalizeModelSupportedProtocols(model.supportedProtocols) ?? []),
    ...declared,
    ...probed
  ])
  const chips: ModelProtocolChip[] = []
  for (const { key } of MODEL_PROTOCOL_TABS) {
    if (!present.has(key)) continue
    const source: ModelProtocolChipSource = declared.includes(key)
      ? 'declared'
      : probed.includes(key) ? 'probe' : 'endpoint'
    chips.push({ protocol: key, source })
  }
  return chips
}
