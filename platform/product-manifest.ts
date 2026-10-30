import type { WorkspacePanelRegistration } from './workspace/contracts'

export interface LocalizedText {
  'zh-CN': string
  'en-US': string
}

/**
 * P2-01 additive：一级菜单页的 workspace 能力声明。**可选**——缺省时由
 * `WorkspacePageRegistrationPolicy` 补齐平台默认值（可分离 + 单实例），因此旧 manifest 无需改动。
 */
export interface ProductMenuPageWorkspaceCapability {
  supportsDetached?: boolean
  allowMultipleInstances?: boolean
}

export interface ProductMenuPageContribution {
  id: string
  title: LocalizedText
  icon: string
  order: number
  module: string
  workspace?: ProductMenuPageWorkspaceCapability
}

export interface ProductSettingsSectionContribution {
  id: string
  title: LocalizedText
  icon: string
  order: number
  module: string
}

export interface ProductShellContributions {
  menuPages: readonly ProductMenuPageContribution[]
  settingsSections: readonly ProductSettingsSectionContribution[]
  panels?: readonly ProductWorkspacePanelContribution[]
}

/** id/pageIds 是产品内标识；module 是受生成器校验的产品内相对入口。 */
export interface ProductWorkspacePanelContribution extends Omit<WorkspacePanelRegistration, 'panelId'> {
  id: string
}

export interface ProductRoute {
  id: string
  path: string
  title: string
}

export interface ProductNavigationItem {
  id: string
  title: string
  routeId: string
  icon?: string
}

export interface ProductAgentRegistration {
  id: string
  title: string
  description?: string
  seedModule?: string
  /** Explicit opt-in: preview/demo seed modules must never run during desktop startup. */
  seedOnStartup?: boolean
  skillIds?: readonly string[]
  toolIds?: readonly string[]
  workflowIds?: readonly string[]
}

export interface ProductSkillRegistration {
  id: string
  title: string
  description?: string
  module?: string
}

export interface ProductToolRegistration {
  id: string
  title: string
  description?: string
  module?: string
  scopes?: readonly string[]
}

export const productAgentToolApprovalModes = ['never', 'on-sensitive', 'always'] as const
export type ProductAgentToolApprovalMode = (typeof productAgentToolApprovalModes)[number]

export type ProductAgentToolRegistration = {
  toolName: string
  productId: string
  handlerId: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  schemaVersion: number
  description: string
  /**
   * 工具的本地化短名，给配置界面和运行记录用；省略时界面回退到 `toolName`。
   * `description` 是写给模型的长指令，不能直接当标题。
   */
  title?: LocalizedText
  /** Read-only tools may run without a prompt under `allow-read-only`; mutating tools always ask. */
  readOnly: boolean
  requiresTemporalBoundary: boolean
  timeoutMs?: number
  maxOutputBytes?: number
  requiresApproval: ProductAgentToolApprovalMode
}

export interface ProductWorkflowRegistration {
  id: string
  title: string
  description?: string
  module?: string
  agentIds?: readonly string[]
}

export type ProductAssistantTemplateGroupId =
  | 'featured'
  | 'career'
  | 'business'
  | 'tools'
  | 'language'
  | 'office'
  | 'general'
  | 'writing'
  | 'programming'
  | 'emotional'
  | 'education'
  | 'creative'
  | 'academic'
  | 'design'
  | 'art'
  | 'entertainment'
  | 'life'
  | 'medical'
  | 'game'
  | 'translation'

export type ProductAssistantTemplateRegistration = {
  id: string
  name: LocalizedText
  description?: LocalizedText
  icon?: string
  prompt: LocalizedText
  groups?: readonly ProductAssistantTemplateGroupId[]
  tags?: readonly LocalizedText[]
  defaultModelId?: string | null
  settings?: Record<string, unknown>
  mcpServerIds?: readonly string[]
  contextSourceIds?: readonly string[]
  knowledgeBaseRefs?: readonly unknown[]
  installPolicy?: 'library-only' | 'auto-install'
  version: number
}

export interface ProductEventConsumerRegistration {
  id: string
  topics: readonly string[]
  handlerId: string
}

export interface ProductServiceRoute {
  method: string
}

export interface ProductManifest {
  id: string
  /** 产品显示名。用户可见处一律按当前语言取名，不得直接把某一语言的字符串写进 UI。 */
  name: LocalizedText
  version: string
  description?: string
  shellContributions?: ProductShellContributions
  routes: readonly ProductRoute[]
  navigation: readonly ProductNavigationItem[]
  settingsSections: readonly unknown[]
  serviceRoutes: readonly ProductServiceRoute[]
  tools: readonly ProductToolRegistration[]
  skills: readonly ProductSkillRegistration[]
  agents: readonly ProductAgentRegistration[]
  workflows: readonly ProductWorkflowRegistration[]
  policies: readonly unknown[]
  evaluations: readonly unknown[]
  jobHandlers: readonly unknown[]
  eventConsumers?: readonly ProductEventConsumerRegistration[]
  productAgentTools?: readonly ProductAgentToolRegistration[]
  assistantTemplates?: readonly ProductAssistantTemplateRegistration[]
  migrations: readonly unknown[]
}

export interface ProductSummary {
  id: string
  /** 产品显示名；渲染层按当前语言解析，不在主进程提前压成单一语言。 */
  name: LocalizedText
  version: string
  description?: string
  routeCount: number
  toolCount: number
  skillCount: number
  agentCount: number
  workflowCount: number
}

export function summarizeProductManifests(manifests: readonly ProductManifest[]): ProductSummary[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    routeCount: manifest.routes.length,
    toolCount: manifest.tools.length,
    skillCount: manifest.skills.length,
    agentCount: manifest.agents.length,
    workflowCount: manifest.workflows.length
  }))
}
