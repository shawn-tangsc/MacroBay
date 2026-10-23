export type AssistantContextSourceDescriptor = {
  id: string
  label: string
  description?: string
  enabledByDefault?: boolean
}

export type AssistantContextSourceRegistry = {
  list: () => readonly AssistantContextSourceDescriptor[]
  register: (descriptor: AssistantContextSourceDescriptor) => void
}

export function createAssistantContextSourceRegistry(): AssistantContextSourceRegistry {
  const sources = new Map<string, AssistantContextSourceDescriptor>()

  return {
    list: () => [...sources.values()],
    register(descriptor) {
      sources.set(descriptor.id, descriptor)
    }
  }
}
