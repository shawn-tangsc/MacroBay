/**
 * 数据源注册表的**唯一出口**：把三份声明拼成一张表，并给出取用函数。
 *
 * 三份声明各自独立，因为它们回答三个不同的问题：
 * - `providerRegistryTypes.ts` —— 一条源能声明什么（契约）；
 * - `providerDefinitions.ts` —— 每个源声明了什么（数据表）；
 * - `activationRegistry.ts` —— 面板与 agent 的激活分组（数据表）。
 *
 * 这个文件只做两件事：补上 `providerLinks`，以及按 id 查。**导出面与拆分前逐项相同**，
 * 调用方一行 import 都不用改——拆的是读者的负担，不是接口。
 */
import { agentRegistry, panelRegistry } from './activationRegistry'
import { providerDefinitions } from './providerDefinitions'
import { providerLinks } from './providerLinks'
import type { AgentDefinition, PanelDefinition, ProviderDefinition, SourceDefinition } from './providerRegistryTypes'

export type {
  ActivationGroupDefinition,
  AgentDefinition,
  AgentId,
  PanelDefinition,
  PanelId,
  ProviderDefinition,
  ProviderNoticeKind,
  SourceCapabilities,
  SourceCategory,
  SourceCollection,
  SourceDefinition,
  SourceKind,
  SourcePurpose,
  SourceReadiness,
  SourceTier,
  SourceVisibility
} from './providerRegistryTypes'

export { agentRegistry, panelRegistry }

export const providerRegistry: readonly ProviderDefinition[] = providerDefinitions.map((provider) => ({
  ...provider,
  ...providerLinks[provider.providerId]
}))

export function allSources(): SourceDefinition[] {
  return providerRegistry.flatMap((provider) => provider.sources)
}

export function getSource(sourceId: string): SourceDefinition | undefined {
  return allSources().find((source) => source.sourceId === sourceId)
}

export function getProvider(providerId: string): ProviderDefinition | undefined {
  return providerRegistry.find((provider) => provider.providerId === providerId)
}

export function getAgent(agentId: string): AgentDefinition | undefined {
  return agentRegistry.find((agent) => agent.agentId === agentId)
}

export function getPanel(panelId: string): PanelDefinition | undefined {
  return panelRegistry.find((panel) => panel.panelId === panelId)
}