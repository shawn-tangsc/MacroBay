import { useMemo, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import {
  assistantMentionedModelIds,
  toggleAssistantMentionedModel,
  type AssistantMentionedModel
} from './assistantMentionedModels'

type UseAssistantMentionModelsInput = {
  providers: SafeModelProvider[]
  pinnedModelIds: readonly string[]
}

export function useAssistantMentionModels(input: UseAssistantMentionModelsInput) {
  const [mentionedModels, setMentionedModels] = useState<AssistantMentionedModel[]>([])

  const options = useMemo(() => {
    const items: AssistantMentionedModel[] = []
    const seen = new Set<string>()
    for (const provider of input.providers) {
      if (!provider.enabled || !provider.hasApiKey) continue
      for (const model of provider.models) {
        if (!model.capabilities.chat) continue
        const value = `${provider.id}:${model.id}`
        if (seen.has(value)) continue
        seen.add(value)
        items.push({
          value,
          label: `${provider.name} / ${model.name}`,
          providerId: provider.id,
          modelId: model.id
        })
      }
    }
    for (const pinned of input.pinnedModelIds) {
      if (seen.has(pinned)) continue
      const separatorIndex = pinned.indexOf(':')
      if (separatorIndex <= 0) continue
      seen.add(pinned)
      items.unshift({
        value: pinned,
        label: pinned,
        providerId: pinned.slice(0, separatorIndex),
        modelId: pinned.slice(separatorIndex + 1)
      })
    }
    return items
  }, [input.pinnedModelIds, input.providers])

  function toggle(value: string): void {
    const option = options.find((item) => item.value === value)
    if (!option) return
    setMentionedModels((current) => toggleAssistantMentionedModel(current, option))
  }

  function clear(): void {
    setMentionedModels([])
  }

  return {
    mentionedModels,
    mentionedModelIds: assistantMentionedModelIds(mentionedModels),
    options,
    toggle,
    clear,
    setMentionedModels
  }
}
