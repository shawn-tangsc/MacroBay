import type { AgentModelOption } from './agentModelOptions'

export type AgentMentionedModel = Pick<AgentModelOption, 'value' | 'label' | 'providerId' | 'providerName'>

export function toggleAgentMentionedModel(
  current: readonly AgentMentionedModel[],
  next: AgentMentionedModel
): AgentMentionedModel[] {
  return current.some((item) => item.value === next.value)
    ? current.filter((item) => item.value !== next.value)
    : [...current, next]
}

export function removeAgentMentionedModelToken(
  text: string,
  selectionStart: number,
  fallbackStart?: number | null
): string {
  const prefix = text.slice(0, selectionStart)
  const match = prefix.match(/(^|\s)(@[^\s]*)$/)
  if (match?.[2]) {
    const start = prefix.length - match[2].length
    return `${text.slice(0, start)}${text.slice(selectionStart)}`
  }

  if (typeof fallbackStart === 'number' && text[fallbackStart] === '@') {
    let end = fallbackStart + 1
    while (end < text.length && !/\s/.test(text[end])) end += 1
    return `${text.slice(0, fallbackStart)}${text.slice(end)}`
  }

  return text
}
