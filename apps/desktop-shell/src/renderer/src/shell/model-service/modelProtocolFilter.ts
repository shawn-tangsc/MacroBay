import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import { deriveDeclaredProtocols, normalizeModelSupportedProtocols } from '@platform/ai/providers/modelChatProtocol'

import type { PlatformText } from '../../i18n/platformText'

import { resolveModelMessagesSupport } from './modelMessagesSupport'

/**
 * PLAT-77 / PLAT-81：**协议**是另一种分类维度（与「模型类型」正交），单独一行、单独的 pill。
 *
 * 四种协议平权（OpenAI Chat / OpenAI Responses / Anthropic Messages / Gemini 原生）。
 * 判据是模型自己的 `supportedProtocols`（厂商声明 ∪ 供应商实际可用协议，见 PLAT-82），
 * `chatProtocol` 只表示"发请求走哪条"，一个模型可以同时支持多条
 * （TokenRhythm 声明 responses 的模型仍然能走 chat/completions）。
 *
 * **向后兼容（线上回归）**：该字段是后加的，迁移前的行还没有值。缺失时回退到旧推导
 * （`messagesSupport` / `responsesSupport` / `chatProtocol`）；字段存在时也要并上
 * "行内图标能表达的声明"，否则会出现「行上有 Anthropic 图标、Messages pill 却是 0」。
 *
 * 这是**筛选器**（不是统计）：选中的协议之间是 AND，与类型 pill 也是 AND；
 * 一个都不选 = 不按协议过滤（界面上不存在「全部协议」这个 pill）。
 *
 * 产品决定（2026-10-20 仲裁）：**保留 chat/completions 这一项**，共 4 个 pill；
 * 用户原话「协议只有 4 个：OpenAI Chat / OpenAI Responses / Anthropic Messages / Gemini 原生」。
 */
export type ModelProtocolTab = 'chat-completions' | 'responses' | 'messages' | 'gemini'

export type ModelProtocolCounts = Record<ModelProtocolTab, number>

/** 只按**已开启**的协议窄化；全部关闭 = 不过滤。 */
export type ModelProtocolFilter = Record<ModelProtocolTab, boolean>

export const emptyModelProtocolFilter: ModelProtocolFilter = {
  'chat-completions': false,
  responses: false,
  messages: false,
  gemini: false
}

/** 顺序固定；labelKey 指向 pill 的短文案（不带端点路径后缀）。 */
export const MODEL_PROTOCOL_TABS: ReadonlyArray<{
  key: ModelProtocolTab
  labelKey: 'protocolFilterChat' | 'protocolFilterResponses' | 'protocolFilterMessages' | 'protocolFilterGemini'
}> = [
  { key: 'chat-completions', labelKey: 'protocolFilterChat' },
  { key: 'responses', labelKey: 'protocolFilterResponses' },
  { key: 'messages', labelKey: 'protocolFilterMessages' },
  { key: 'gemini', labelKey: 'protocolFilterGemini' }
]

/**
 * 厂商**逐条声明**的协议（行内 chip 来源与协议 pill 计数共用）。
 *
 * 读 `declaredProtocols`（存储已补齐）；缺失时按 `messagesSupport` / `responsesSupport`
 * 回退，旧行也能显示 Anthropic 标。返回空数组 = 厂商没有逐条声明
 * （`chatProtocol` / 供应商默认端点**不**算声明，只算"按默认端点推断"）。
 */
export function modelDeclaredProtocols(model: ModelDefinition): ModelProtocolTab[] {
  return normalizeModelSupportedProtocols(model.declaredProtocols)
    ?? deriveDeclaredProtocols({
      messagesSupport: resolveModelMessagesSupport('', model),
      responsesSupport: model.responsesSupport
    })
    ?? []
}

function supportedProtocolsOf(model: ModelDefinition): ReadonlySet<ModelProtocolTab> {
  // 检测证据（实测通过）与行内 chip 同口径：协议 pill 不能出现「行上有标、pill 却是 0」。
  const probed = normalizeModelSupportedProtocols(model.probedProtocols) ?? []
  const supported = model.supportedProtocols
  if (supported === undefined || supported.length === 0) {
    // 迁移前的行：旧推导口径（缺省协议 + 声明）。
    return new Set<ModelProtocolTab>([
      ...modelDeclaredProtocols(model),
      ...probed,
      ...(model.chatProtocol ? [model.chatProtocol] : [])
    ])
  }
  return new Set<ModelProtocolTab>([...supported, ...modelDeclaredProtocols(model), ...probed])
}

function supportsProtocol(model: ModelDefinition, tab: ModelProtocolTab): boolean {
  return supportedProtocolsOf(model).has(tab)
}

export function buildModelProtocolCounts(models: readonly ModelDefinition[]): ModelProtocolCounts {
  const counts: ModelProtocolCounts = { 'chat-completions': 0, responses: 0, messages: 0, gemini: 0 }
  for (const model of models) {
    for (const { key } of MODEL_PROTOCOL_TABS) {
      if (supportsProtocol(model, key)) counts[key] += 1
    }
  }
  return counts
}

export function matchesModelProtocol(model: ModelDefinition, filter: ModelProtocolFilter): boolean {
  return MODEL_PROTOCOL_TABS.every(({ key }) => !filter[key] || supportsProtocol(model, key))
}

/** 协议的短文案（pill 与行内失败标红共用同一套名字，不再各写一份）。 */
export function modelProtocolLabel(
  labels: PlatformText['models'],
  protocol: ModelProtocolTab
): string {
  const tab = MODEL_PROTOCOL_TABS.find(({ key }) => key === protocol)
  return tab ? labels[tab.labelKey] : protocol
}

