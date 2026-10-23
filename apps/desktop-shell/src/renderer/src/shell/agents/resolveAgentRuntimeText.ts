import {
  isRuntimeTextPart,
  resolveRuntimeTextPart,
  runtimeTextKeys,
  type RuntimeTextPart
} from '@platform/ai/agent-platform/runtime/runtimeText'

import type { AgentText } from './agentTextTypes'

export function buildAgentRuntimeTextCatalog(
  text: Pick<AgentText, 'runtimeText'>
): Record<string, string> {
  return {
    [runtimeTextKeys.connecting]: text.runtimeText.connecting,
    [runtimeTextKeys.stopped]: text.runtimeText.stopped,
    'agent.runtime.provider-configuration-required': text.runtimeText.providerConfigurationRequired,
    'agent.runtime.provider-request-failed': text.runtimeText.providerRequestFailed,
    // PLAT-74：模型生命周期失败给真实结论，不再落到「请重试」兜底。
    'agent.runtime.provider-model-retired': text.runtimeText.modelRetired,
    'agent.runtime.provider-model-not-activated': text.runtimeText.modelNotActivated,
    'agent.runtime.provider-model-not-found': text.runtimeText.modelNotFound
  }
}

export function resolveAgentRuntimeTextPart(
  part: RuntimeTextPart,
  text: Pick<AgentText, 'runtimeText'>
): string {
  const catalog = buildAgentRuntimeTextCatalog(text)
  if (catalog[part.key]) return resolveRuntimeTextPart(part, catalog)
  if (part.key.startsWith('agent.runtime.')) return text.runtimeText.providerRequestFailed
  return resolveRuntimeTextPart(part, catalog)
}

export function resolveAgentMessagePartText(
  part: unknown,
  text: Pick<AgentText, 'runtimeText' | 'messages'>
): string | null {
  if (isRuntimeTextPart(part)) {
    return resolveAgentRuntimeTextPart(part, text)
  }
  if (
    part &&
    typeof part === 'object' &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  ) {
    return (part as { text: string }).text
  }
  return null
}
