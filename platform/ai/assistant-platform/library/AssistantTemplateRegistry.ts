import {
  normalizeAssistantTemplateRegistration,
  type AssistantTemplateRegistration,
  type NormalizedAssistantTemplateRegistration
} from './assistantTemplateSchemas'

export class AssistantTemplateRegistry {
  private readonly templates = new Map<string, NormalizedAssistantTemplateRegistration>()

  register(registration: AssistantTemplateRegistration): void {
    const normalized = normalizeAssistantTemplateRegistration({
      ...registration,
      templateId: normalizeTemplateId(registration)
    })
    if (this.templates.has(normalized.templateId)) {
      throw new Error(`Duplicate assistant template id: ${normalized.templateId}`)
    }
    this.templates.set(normalized.templateId, normalized)
  }

  registerMany(registrations: readonly AssistantTemplateRegistration[]): void {
    registrations.forEach((registration) => this.register(registration))
  }

  list(): NormalizedAssistantTemplateRegistration[] {
    return [...this.templates.values()]
  }

  get(templateId: string): NormalizedAssistantTemplateRegistration | null {
    return this.templates.get(templateId) ?? null
  }

  clear(): void {
    this.templates.clear()
  }
}

export function normalizeTemplateId(registration: Pick<AssistantTemplateRegistration, 'templateId' | 'sourceKind' | 'sourceProductId'>): string {
  if (registration.templateId.includes(':')) return registration.templateId
  if (registration.sourceKind === 'platform') return `platform:${registration.templateId}`
  if (registration.sourceKind === 'product') {
    if (!registration.sourceProductId?.trim()) {
      throw new Error(`Product assistant template requires a sourceProductId: ${registration.templateId}`)
    }
    return `product:${registration.sourceProductId}:${registration.templateId}`
  }
  return `imported:${registration.templateId}`
}
