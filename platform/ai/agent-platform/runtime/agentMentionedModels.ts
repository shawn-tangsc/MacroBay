import type { UniqueModelId } from '../schemas/agentSchemas'
import type { AgentMentionedModelDescriptor } from '../schemas/sessionSchemas'
import type { ProviderState } from '../../providers/modelProviderTypes'

export type AgentRuntimeMentionedModelInput =
  | UniqueModelId
  | {
      id: UniqueModelId
      label?: string | null
      providerName?: string | null
    }

export function resolveRuntimeMentionedModels(
  input: readonly AgentRuntimeMentionedModelInput[] | undefined,
  providerState: ProviderState
): AgentMentionedModelDescriptor[] {
  if (!input || input.length === 0) return []

  return input.flatMap((item) => {
    if (typeof item === 'string') {
      return [resolveMentionedModelDescriptor(item, providerState)]
    }

    const resolved = resolveMentionedModelDescriptor(item.id, providerState)
    return [
      {
        id: item.id,
        label: item.label?.trim() || resolved.label,
        providerName: item.providerName?.trim() || resolved.providerName
      }
    ]
  })
}

function resolveMentionedModelDescriptor(
  modelId: UniqueModelId,
  providerState: ProviderState
): AgentMentionedModelDescriptor {
  const separatorIndex = modelId.indexOf(':')
  const providerId = separatorIndex > 0 ? modelId.slice(0, separatorIndex) : modelId
  const rawModelId = separatorIndex > 0 ? modelId.slice(separatorIndex + 1) : modelId
  const provider = providerState.providers.find((item) => item.id === providerId)
  const model = provider?.models.find((item) => item.id === rawModelId)

  return {
    id: modelId,
    label: model?.name ?? rawModelId,
    providerName: provider?.name ?? providerId
  }
}
