import type { LocalizedText } from '../../../product-manifest'
import type { AssistantEntity, AssistantSettings } from '../schemas/assistantSchemas'
import { normalizeAssistantSettings } from '../schemas/assistantSchemas'

export const assistantTemplateSourceKinds = ['platform', 'product', 'imported'] as const
export type AssistantTemplateSourceKind = (typeof assistantTemplateSourceKinds)[number]

export const assistantTemplateInstallPolicies = ['library-only', 'auto-install'] as const
export type AssistantTemplateInstallPolicy = (typeof assistantTemplateInstallPolicies)[number]

export const assistantTemplateGroupIds = [
  'mine',
  'featured',
  'career',
  'business',
  'tools',
  'language',
  'office',
  'general',
  'writing',
  'programming',
  'emotional',
  'education',
  'creative',
  'academic',
  'design',
  'art',
  'entertainment',
  'life',
  'medical',
  'game',
  'translation'
] as const

export type AssistantTemplateGroupId = (typeof assistantTemplateGroupIds)[number]

export type AssistantTemplateRegistration = {
  templateId: string
  sourceKind: AssistantTemplateSourceKind
  sourceProductId?: string
  /** 产品显示名；目录构建时按语言解析成字符串。 */
  sourceProductName?: LocalizedText
  version: number
  name: LocalizedText
  description?: LocalizedText
  icon?: string
  prompt: LocalizedText
  groups?: readonly AssistantTemplateGroupId[]
  tags?: readonly LocalizedText[]
  defaultModelId?: string | null
  settings?: Partial<AssistantSettings>
  mcpServerIds?: readonly string[]
  contextSourceIds?: readonly string[]
  knowledgeBaseRefs?: readonly unknown[]
  installPolicy?: AssistantTemplateInstallPolicy
}

export type NormalizedAssistantTemplateRegistration = Omit<
  AssistantTemplateRegistration,
  'groups' | 'installPolicy' | 'settings' | 'mcpServerIds' | 'contextSourceIds' | 'tags'
> & {
  groups: readonly AssistantTemplateGroupId[]
  installPolicy: AssistantTemplateInstallPolicy
  settings?: Partial<AssistantSettings>
  mcpServerIds: readonly string[]
  contextSourceIds: readonly string[]
  tags: readonly LocalizedText[]
}

export type AssistantTemplateCatalogItem = {
  templateId: string
  sourceKind: AssistantTemplateSourceKind
  sourceProductId?: string
  sourceProductName?: string
  version: number
  name: string
  description: string
  icon: string
  promptPreview: string
  groups: AssistantTemplateGroupId[]
  tags: string[]
  installed: boolean
  installedAssistantId?: string
  hasUpdate?: boolean
  installPolicy: AssistantTemplateInstallPolicy
}

export type AssistantTemplateDetail = AssistantTemplateCatalogItem & {
  prompt: string
}

export type AssistantTemplateGroupView = {
  id: AssistantTemplateGroupId
  count: number
}

export type AssistantTemplateListQuery = {
  group?: AssistantTemplateGroupId
  search?: string
}

export type InstallAssistantTemplateRequest = {
  templateId: string
  nameOverride?: string
  openAfterInstall?: boolean
}

export type InstallAssistantTemplateResult = {
  assistant: AssistantEntity
  catalogItem: AssistantTemplateCatalogItem
}

export function isAssistantTemplateGroupId(value: unknown): value is AssistantTemplateGroupId {
  return typeof value === 'string' && (assistantTemplateGroupIds as readonly string[]).includes(value)
}

export function localizeAssistantTemplateText(text: LocalizedText | undefined, language: keyof LocalizedText): string {
  if (!text) return ''
  return text[language]?.trim() || text['en-US']?.trim() || text['zh-CN']?.trim() || ''
}

export function normalizeAssistantTemplateRegistration(
  registration: AssistantTemplateRegistration
): NormalizedAssistantTemplateRegistration {
  validateAssistantTemplateRegistration(registration)
  return {
    ...registration,
    groups: registration.groups?.length ? [...registration.groups] : ['general'],
    installPolicy: registration.installPolicy ?? 'library-only',
    settings: registration.settings ? normalizeAssistantSettings(registration.settings) : undefined,
    mcpServerIds: registration.mcpServerIds ? [...registration.mcpServerIds] : [],
    contextSourceIds: registration.contextSourceIds ? [...registration.contextSourceIds] : [],
    tags: registration.tags ? [...registration.tags] : []
  }
}

export function validateAssistantTemplateRegistration(registration: AssistantTemplateRegistration): void {
  if (!registration.templateId.trim()) {
    throw new Error('Assistant template requires a templateId.')
  }
  if (!assistantTemplateSourceKinds.includes(registration.sourceKind)) {
    throw new Error(`Invalid assistant template source kind: ${String(registration.sourceKind)}`)
  }
  if (registration.sourceKind === 'product' && !registration.sourceProductId?.trim()) {
    throw new Error('Product assistant templates require a sourceProductId.')
  }
  if (registration.sourceKind === 'platform' && registration.sourceProductId) {
    throw new Error('Platform assistant templates cannot include a sourceProductId.')
  }
  if (!Number.isInteger(registration.version) || registration.version <= 0) {
    throw new Error(`Assistant template version must be a positive integer: ${registration.templateId}`)
  }
  assertLocalizedText(registration.name, `Assistant template name "${registration.templateId}"`)
  assertLocalizedText(registration.prompt, `Assistant template prompt "${registration.templateId}"`)
  for (const group of registration.groups ?? []) {
    if (!isAssistantTemplateGroupId(group)) {
      throw new Error(`Unknown assistant template group "${String(group)}" in ${registration.templateId}`)
    }
  }
  if (
    registration.installPolicy !== undefined &&
    !assistantTemplateInstallPolicies.includes(registration.installPolicy)
  ) {
    throw new Error(`Invalid assistant template install policy: ${String(registration.installPolicy)}`)
  }
}

function assertLocalizedText(text: LocalizedText | undefined, label: string): void {
  if (!text?.['zh-CN']?.trim() || !text?.['en-US']?.trim()) {
    throw new Error(`${label} must include both zh-CN and en-US text.`)
  }
}
