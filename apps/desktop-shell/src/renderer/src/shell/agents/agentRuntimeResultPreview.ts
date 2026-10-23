import {
  buildContentBlockCard,
  buildJsonOrTextCard,
  buildTableCard,
  summarizeValue
} from './agentRuntimeResultPreviewHelpers'

export type AgentRuntimeResultPreviewKind =
  | 'text'
  | 'json'
  | 'image'
  | 'resource'
  | 'table'
  | 'error'

export type AgentRuntimeResultPreviewCard = {
  key: string
  kind: AgentRuntimeResultPreviewKind
  title: string
  meta?: string
  text?: string
  previewUrl?: string
  openTarget?: string
  openTargetKind?: 'external' | 'path'
  table?: {
    columns: string[]
    rows: string[][]
  }
}

export type AgentRuntimeResultPreviewLabels = {
  text: string
  json: string
  image: string
  resource: string
  table: string
  error: string
}

type BuildAgentRuntimeResultPreviewCardsInput = {
  isError?: boolean
  errorText?: unknown
  output?: unknown
  content?: unknown
  structuredContent?: unknown
  labels: AgentRuntimeResultPreviewLabels
  fallback: string
}

export function buildAgentRuntimeResultPreviewCards(
  input: BuildAgentRuntimeResultPreviewCardsInput
): AgentRuntimeResultPreviewCard[] {
  if (input.isError) {
    const text = summarizeValue(input.errorText ?? input.output, input.fallback)
    return [
      {
        key: 'error:0',
        kind: 'error',
        title: input.labels.error,
        text: text ?? input.fallback
      }
    ]
  }

  const cards: AgentRuntimeResultPreviewCard[] = []

  if (Array.isArray(input.content)) {
    input.content.forEach((block, index) => {
      const card = buildContentBlockCard(block, index, input.labels, input.fallback)
      if (card) cards.push(card)
    })
  }

  const structuredTable = buildTableCard(input.structuredContent, 'structured', input.labels.table)
  if (structuredTable) cards.push(structuredTable)

  if (cards.length === 0) {
    const structuredJson = buildJsonOrTextCard(input.structuredContent, 'structured', input.labels, input.fallback)
    if (structuredJson) cards.push(structuredJson)
  }

  if (cards.length === 0) {
    const outputTable = buildTableCard(input.output, 'output', input.labels.table)
    if (outputTable) {
      cards.push(outputTable)
    } else {
      const outputCard = buildJsonOrTextCard(input.output, 'output', input.labels, input.fallback)
      if (outputCard) cards.push(outputCard)
    }
  }

  return cards
}
