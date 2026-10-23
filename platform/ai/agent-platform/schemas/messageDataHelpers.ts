import type {
  AgentMentionedModelDescriptor,
  AgentMentionedModelsMessagePart,
  AgentMessagePart,
  MessageData
} from './sessionSchemas'

export function createAgentMentionedModelsMessagePart(
  models: readonly AgentMentionedModelDescriptor[]
): AgentMentionedModelsMessagePart {
  const uniqueModels = dedupeAgentMentionedModels(models)
  return {
    type: 'agent-mentioned-models',
    modelIds: uniqueModels.map((model) => model.id),
    models: uniqueModels
  }
}

export function getAgentMentionedModels(data: MessageData): AgentMentionedModelDescriptor[] {
  return data.parts.flatMap((part) => (isAgentMentionedModelsPart(part) ? part.models : []))
}

export function getAgentTextParts(data: MessageData): string[] {
  return data.parts.flatMap((part) => {
    if (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      return [(part as { text: string }).text]
    }
    if (part.type === 'runtime-text') {
      const runtimePart = part as { text?: unknown; fallback?: unknown }
      if (typeof runtimePart.text === 'string' && runtimePart.text.trim()) return [runtimePart.text]
      if (typeof runtimePart.fallback === 'string' && runtimePart.fallback.trim()) return [runtimePart.fallback]
    }
    return []
  })
}

export function getAgentMessagePromptText(data: MessageData): string {
  const blocks = [formatAgentMentionedModelsForPrompt(getAgentMentionedModels(data)), getAgentTextParts(data).join('\n')]
    .map((block) => block.trim())
    .filter(Boolean)
  return blocks.join('\n\n')
}

/**
 * Older turns persisted one `claude-sdk-runtime-control` part per thinking-token event. The
 * transcript never rendered them, but every streaming save and IPC snapshot carried them. Drop
 * them on read so existing sessions shrink as soon as their next save lands.
 */
export function stripQuietRuntimeControlParts(data: MessageData): MessageData {
  const parts = data.parts.filter(
    (part) =>
      !(
        part.type === 'claude-sdk-runtime-control' &&
        (part as { subtype?: unknown }).subtype === 'thinking_tokens'
      )
  )
  return parts.length === data.parts.length ? data : { ...data, parts }
}

export function formatAgentMentionedModelsForPrompt(
  models: readonly AgentMentionedModelDescriptor[]
): string {
  if (models.length === 0) return ''

  const lines = dedupeAgentMentionedModels(models).map((model) => {
    const label = model.label.trim() || model.id
    const provider = model.providerName.trim()
    const suffix = provider ? ` (${provider})` : ''
    return `- ${label}${suffix} [${model.id}]`
  })

  return `Mentioned models:\n${lines.join('\n')}`
}

export function isAgentMentionedModelsPart(
  part: AgentMessagePart
): part is AgentMentionedModelsMessagePart {
  return part.type === 'agent-mentioned-models' && Array.isArray((part as { models?: unknown }).models)
}

function dedupeAgentMentionedModels(
  models: readonly AgentMentionedModelDescriptor[]
): AgentMentionedModelDescriptor[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}
