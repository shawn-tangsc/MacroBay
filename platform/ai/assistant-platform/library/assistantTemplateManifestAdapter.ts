import type { ProductManifest } from '../../../product-manifest'
import type { AssistantTemplateRegistration } from './assistantTemplateSchemas'

export function createAssistantTemplateRegistrationsFromManifests(
  manifests: readonly ProductManifest[]
): AssistantTemplateRegistration[] {
  return manifests.flatMap((manifest) =>
    (manifest.assistantTemplates ?? []).map((template) => ({
      templateId: template.id,
      sourceKind: 'product',
      sourceProductId: manifest.id,
      sourceProductName: manifest.name,
      version: template.version,
      name: template.name,
      description: template.description,
      icon: template.icon,
      prompt: template.prompt,
      groups: template.groups,
      tags: template.tags,
      defaultModelId: template.defaultModelId,
      settings: template.settings,
      mcpServerIds: template.mcpServerIds,
      contextSourceIds: template.contextSourceIds,
      knowledgeBaseRefs: template.knowledgeBaseRefs,
      installPolicy: template.installPolicy ?? 'library-only'
    }))
  )
}
