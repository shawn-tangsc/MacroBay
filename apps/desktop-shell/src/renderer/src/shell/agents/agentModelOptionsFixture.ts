import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

/** PLAT-70：`agentModelOptions` 测试共用夹具（chat / 带智能体标记 / 厂商构造）。 */
export const chatCapabilities = {
  chat: true,
  vision: false,
  embedding: false,
  tools: true
}

export const agentCapabilities = {
  ...chatCapabilities,
  agentRuntimes: { claudeCode: true }
}

export function testProvider(
  input: Partial<SafeModelProvider> & Pick<SafeModelProvider, 'id' | 'name'>
): SafeModelProvider {
  return {
    id: input.id,
    name: input.name,
    enabled: input.enabled ?? true,
    // 端点清单是供应商形态的唯一事实源（`[0]` = 默认端点）。
    endpoints: input.endpoints ?? [{ protocol: 'chat-completions', baseUrl: 'https://example.test' }],
    baseUrl: input.baseUrl ?? 'https://example.test',
    hasApiKey: input.hasApiKey ?? true,
    apiKeyPreview: input.apiKeyPreview ?? 'sk...test',
    isSystem: input.isSystem ?? true,
    websites: input.websites,
    models: input.models ?? [],
    defaultChatModelId: input.defaultChatModelId
  }
}

export function testCompatibility(
  providerId: string,
  modelId: string,
  overrides: Partial<{ selectable: boolean; route: 'direct' | 'gateway' | 'none'; status: string; summary: string }> = {}
) {
  return {
    providerId,
    modelId,
    runtimeId: 'claude-code' as const,
    selectable: false,
    route: 'none' as const,
    status: 'unknown' as const,
    summary: '',
    ...overrides
  } as never
}

export function optionValues(groups: ReturnType<typeof import('./agentModelOptions').buildAgentModelOptions>): string[] {
  return groups.flatMap((group) => group.options.map((option) => option.value))
}
