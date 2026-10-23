import type { ModelDefinition, ModelMessagesSupport } from '@platform/ai/providers/modelProviderTypes'

/**
 * PLAT-62 / PLAT-82：**只认记录在案的结论**（上游声明或实测）。
 *
 * 产品决定（2026-10-20）：**协议支持不允许用模型名前缀推断**。
 * 上游没返回、我们也没实测过 ⇒ 就是 `unknown`，不能因为 id 长得像 `glm-*` 就说它支持 messages。
 * 旧的前缀表（`MESSAGES_CAPABLE_MODEL_PREFIXES`）已删除。
 *
 * 只用于展示与筛选；不写回持久化。
 */
export function resolveModelMessagesSupport(
  _providerId: string,
  model: ModelDefinition
): ModelMessagesSupport {
  return model.messagesSupport === 'yes' || model.messagesSupport === 'no' ? model.messagesSupport : 'unknown'
}
