import type { AppLanguage } from '../../../settings/schema/appSettings'
import type { CreateAssistantDto, AssistantEntity, AssistantTag } from '../schemas/assistantSchemas'
import type { AssistantPlatformRepositories } from '../repositories/createAssistantPlatformRepositories'
import type { AssistantTemplateRegistry } from './AssistantTemplateRegistry'
import {
  assistantTemplateGroupIds,
  localizeAssistantTemplateText,
  type AssistantTemplateCatalogItem,
  type AssistantTemplateDetail,
  type AssistantTemplateGroupView,
  type AssistantTemplateListQuery,
  type InstallAssistantTemplateRequest,
  type InstallAssistantTemplateResult,
  type NormalizedAssistantTemplateRegistration
} from './assistantTemplateSchemas'
import {
  buildAssistantTemplateCatalogItem,
  buildAssistantTemplateDetail,
  matchesAssistantTemplateCatalogQuery
} from './assistantTemplateCatalog'
import { hashAssistantPrompt } from './assistantTemplateInstallState'

export type AssistantLibraryServiceDependencies = {
  registry: AssistantTemplateRegistry
  repos: AssistantPlatformRepositories
}

export class AssistantLibraryService {
  private readonly registry: AssistantTemplateRegistry
  private readonly repos: AssistantPlatformRepositories

  constructor(deps: AssistantLibraryServiceDependencies) {
    this.registry = deps.registry
    this.repos = deps.repos
  }

  listTemplates(query: AssistantTemplateListQuery = {}, language: AppLanguage = 'zh-CN'): AssistantTemplateCatalogItem[] {
    return this.registry
      .list()
      .map((template) => buildAssistantTemplateCatalogItem(template, this.repos, language))
      .filter((item) => (query.group && query.group !== 'mine' ? item.groups.includes(query.group) : true))
      .filter((item) => (query.group === 'mine' ? item.installed : true))
      .filter((item) => matchesAssistantTemplateCatalogQuery(item, query.search))
      .sort((left, right) => left.name.localeCompare(right.name, language))
  }

  getTemplate(templateId: string, language: AppLanguage = 'zh-CN'): AssistantTemplateDetail | null {
    const template = this.registry.get(templateId)
    return template ? buildAssistantTemplateDetail(template, this.repos, language) : null
  }

  listGroups(language: AppLanguage = 'zh-CN'): AssistantTemplateGroupView[] {
    const items = this.listTemplates({}, language)
    return assistantTemplateGroupIds.map((id) => ({
      id,
      count: id === 'mine' ? items.filter((item) => item.installed).length : items.filter((item) => item.groups.includes(id)).length
    }))
  }

  installTemplate(
    input: InstallAssistantTemplateRequest,
    language: AppLanguage = 'zh-CN'
  ): InstallAssistantTemplateResult {
    const template = this.registry.get(input.templateId)
    if (!template) throw new Error(`Assistant template not found: ${input.templateId}`)
    return this.repos.transact(() => {
      const assistant = this.repos.assistants.create(toCreateAssistantDto(template, language, input.nameOverride))
      this.repos.templateInstalls.upsert({
        assistantId: assistant.id,
        sourceKind: template.sourceKind,
        sourceProductId: template.sourceProductId ?? null,
        sourceTemplateId: template.templateId,
        sourceTemplateVersion: template.version,
        promptHashAtInstall: hashAssistantPrompt(assistant.prompt)
      })

      return {
        assistant,
        catalogItem: buildAssistantTemplateCatalogItem(template, this.repos, language)
      }
    })
  }

  createAssistant(input: CreateAssistantDto): AssistantEntity {
    return this.repos.assistants.create(input)
  }
}

function toCreateAssistantDto(
  template: NormalizedAssistantTemplateRegistration,
  language: AppLanguage,
  nameOverride?: string
): CreateAssistantDto {
  const prompt = localizeAssistantTemplateText(template.prompt, language)
  return {
    name: nameOverride?.trim() || localizeAssistantTemplateText(template.name, language),
    prompt,
    icon: template.icon ?? '💬',
    description: localizeAssistantTemplateText(template.description, language),
    settings: template.settings,
    modelId: template.defaultModelId ?? null,
    mcpServerIds: [...template.mcpServerIds],
    contextSourceIds: [...template.contextSourceIds],
    tags: template.tags.map((tag) => toAssistantTag(tag, language))
  }
}

function toAssistantTag(tag: { 'zh-CN': string; 'en-US': string }, language: AppLanguage): AssistantTag {
  const name = localizeAssistantTemplateText(tag, language)
  return {
    id: slugify(name),
    name
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'tag'
}
