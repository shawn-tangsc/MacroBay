const DEFAULT_TOPIC_NAMES = new Set(['', 'new topic', '新话题'])

export function shouldAutoRenameAssistantTopic(input: {
  name: string
  isNameManuallyEdited: boolean
}): boolean {
  if (input.isNameManuallyEdited) return false
  const normalized = input.name.trim().toLowerCase()
  return DEFAULT_TOPIC_NAMES.has(normalized)
}

export function summarizeAssistantTopicFallback(text: string, maxLength = 48): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
}
