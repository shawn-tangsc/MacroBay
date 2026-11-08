import type { WorkspacePanelRegistration } from './workspace/contracts'
import type { NotificationEventDeclaration } from './notifications/contracts/notificationEventCatalog'
import type { NotificationEventPolicyEntry } from './notifications/contracts/notificationEventCatalog'
import type { NotificationCopyTableSet } from './notifications/contracts/notificationCopyPort'

export interface LocalizedText {
  'zh-CN': string
  'en-US': string
}

/**
 * 产品**声明**的工具审批字段文案：`工具名 → 字段名 → 两种语言的一句话`。
 *
 * 为什么不在壳层写：那些字段名是产品的业务概念，平台删掉产品包之后不该还留着它们的名字与文案。
 * 壳层只提供「把请求参数画成字段行」的能力，词由产品给——取不到就不画字段行，退回原来的
 * JSON 摘要，而不是编一个名字。
 */
export type ProductApprovalFieldLabelTable = Readonly<
  Record<string, Readonly<Record<string, LocalizedText>>>
>

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
  /**
   * 声明「这一页是默认首页」。
   *
   * **标在菜单项上，不是写一个 `defaultHomePageId: 'x'` 字符串**：字符串形状让「指向一个不在菜单里的
   * 页」成为可达状态，于是就得为它写回落、诊断和用例；标在项上，那个状态在结构上不存在——项不在了，
   * 它的 `home` 自然也不在。
   *
   * 只有首次启动、或布局被重置（没有任何可恢复的活动页）时才会被用到；「接着上次看」优先。
   */
  home?: true
}

/**
 * 设置分区能被壳层按**业务意图**找见的名字（闭集），而不是让壳层记住某个产品的面板 id。
 *
 * 壳层有一类入口不属于平台：「配置任务要用的数据源在哪一页」只有产品说得清，可壳层不许认识任何
 * 具体产品——认识了，删掉那个产品包之后壳里还留着一个指向不存在页面的按钮。所以产品在自己的设置
 * 分区上标一个意图，壳层按意图找：**找到就带路，找不到就不出这个入口**（与
 * `ProductApprovalFieldLabelTable` 同一条规矩）。
 *
 * 新增一个意图之前先问：壳层真的有一个「带路」场景吗？不是给每个分区都标一遍。
 * `resource-sources` = 产品里那页「任务/自动工作用到的数据源在哪配、怎么启用」。
 */
export type ProductSettingsNavIntent = 'resource-sources'

export interface ProductSettingsSectionContribution {
  id: string
  title: LocalizedText
  icon: string
  order: number
  module: string
  /** 见 `ProductSettingsNavIntent`：壳层按它找这一页，而不是按面板 id。 */
  navIntent?: ProductSettingsNavIntent
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
  /**
   * 该产品**发布**的话题（`MI-11-R22` A1）。定时任务的事件订阅只允许选这里声明过的 topic，
   * 校验目录由生成物 `products/generated/productManifests.ts` 汇总而来。
   *
   * 与下面的 `eventConsumers`（该产品**消费**的话题）方向相反：两字段不是同义词，谁也不许从谁推导。
   * 没声明的话题不可订阅——发布方新增话题必须同批声明，否则任务建得成、永远不触发。
   */
  eventTopics?: readonly string[]
  eventConsumers?: readonly ProductEventConsumerRegistration[]
  /**
   * 该产品**声明**的通知事件（契约 §3）。目录由平台汇总注入，平台不 import 产品代码。
   *
   * 生效的批准值来自下面同侧的 `notificationApproval`（契约 §7.1b），**不在这里**：
   * 声明写「申请」，批准写「批准」，装配时 `requested ⊆ approved` 才有意义。
   * 形状错误在生成期报（`validate.ts`），不等到读者勾了订阅才发现永远不响。
   */
  notificationEvents?: readonly NotificationEventDeclaration[]
  /**
   * 该产品**声明**的批准值（契约 §7.1b，2026-11-08）：`{ '<eventTypeId>': 批准行 }`，**值由产品自己签**。
   *
   * 平台与产品各带自己那份，装配时合成一份批准视图（`mergeApprovalView`）；同一 id 出现在
   * 两个来源即为装配错误。声明里的 id 必须出现在本产品的 `notificationEvents` 里（装配时校验）。
   */
  notificationApproval?: Readonly<Record<string, NotificationEventPolicyEntry>>
  /**
   * 该产品**声明**的通知文案表（契约 §3.3）：`{ 'zh-CN': {...}, 'en-US': {...} }`。
   *
   * 平台不 import 产品文案文件，装配从注入的 manifest 列表里收这张表；没声明的产品，
   * 它的事件文案解析不到，走平台兜底句并记一次 `copy-unresolved` 诊断。
   */
  notificationCopy?: NotificationCopyTableSet
  /**
   * 该产品**声明**的 producerId（契约 §14.1）：产品自己发的事件所用的稳定任务/来源标识。
   * 声明之后平台不再为同一个 producerId 兜底发；没声明的默认平台发，并记一次
   * `unclaimed-producer` 诊断。格式在生成期校验（前缀、非空、去重），存在性只能运行期观察。
   */
  notificationProducerClaims?: readonly string[]
  productAgentTools?: readonly ProductAgentToolRegistration[]
  assistantTemplates?: readonly ProductAssistantTemplateRegistration[]
  /**
   * 该产品**声明**的工具审批字段文案（契约见 `ProductApprovalFieldLabelTable`）。
   *
   * 生成物 `products/generated/shellRegistry.ts` 把它汇总成一张表交给壳层；同一个工具名
   * 只能由一个产品声明（生成期校验），否则同一个字段会有两种叫法。
   */
  agentApprovalFieldLabels?: ProductApprovalFieldLabelTable
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
