import type { AppLanguage } from '../../../settings/schema/appSettings'
import type { AssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import type {
  NormalizedAssistantTemplateRegistration,
  AssistantTemplateCatalogItem,
  AssistantTemplateDetail
} from './assistantTemplateSchemas'
import { localizeAssistantTemplateText } from './assistantTemplateSchemas'

export function buildAssistantTemplateCatalogItem(
  template: NormalizedAssistantTemplateRegistration,
  repos: AssistantPlatformRepositories,
  language: AppLanguage
): AssistantTemplateCatalogItem {
  const install = repos.templateInstalls.listBySource(template.templateId)[0]
  return {
    templateId: template.templateId,
    sourceKind: template.sourceKind,
    sourceProductId: template.sourceProductId,
    sourceProductName: template.sourceProductName
      ? localizeAssistantTemplateText(template.sourceProductName, language)
      : undefined,
    version: template.version,
    name: localizeAssistantTemplateText(template.name, language),
    description: localizeAssistantTemplateText(template.description, language),
    icon: template.icon ?? '💬',
    promptPreview: localizeAssistantTemplateText(template.prompt, language).slice(0, 240),
    groups: [...template.groups],
    tags: template.tags.map((tag) => localizeAssistantTemplateText(tag, language)).filter(Boolean),
    installed: Boolean(install),
    installedAssistantId: install?.assistantId,
    hasUpdate: install ? template.version > install.sourceTemplateVersion : false,
    installPolicy: template.installPolicy
  }
}

export function buildAssistantTemplateDetail(
  template: NormalizedAssistantTemplateRegistration,
  repos: AssistantPlatformRepositories,
  language: AppLanguage
): AssistantTemplateDetail {
  return {
    ...buildAssistantTemplateCatalogItem(template, repos, language),
    prompt: localizeAssistantTemplateText(template.prompt, language)
  }
}

export function matchesAssistantTemplateCatalogQuery(
  item: AssistantTemplateCatalogItem,
  search?: string
): boolean {
  const keyword = search?.trim().toLowerCase()
  if (!keyword) return true
  return [
    item.name,
    item.description,
    item.promptPreview,
    item.sourceProductName ?? '',
    ...item.groups,
    ...item.tags
  ]
    .join(' ')
    .toLowerCase()
    .includes(keyword)
}
