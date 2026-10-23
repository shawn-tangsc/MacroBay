import type { AssistantMessagePart } from '../../assistant-platform/schemas/messageSchemas'
import type { WebSearchProviderId, WebSearchStatus } from '../contracts/webSearchContracts'
import type { AssistantWebSearchToolName } from './assistantWebSearchTools'

export type AssistantWebSearchSourcePart = {
  id: number
  title: string
  url: string
  snippet: string
}

export type AssistantWebSearchMessagePart = {
  type: 'web-search'
  toolName: AssistantWebSearchToolName
  status: 'running' | 'success' | 'error'
  providerId?: WebSearchProviderId
  query?: string
  urls?: string[]
  sources: AssistantWebSearchSourcePart[]
  statusItems?: WebSearchStatus[]
  elapsedMs?: number
  error?: string
}

export function isAssistantWebSearchMessagePart(part: AssistantMessagePart): part is AssistantWebSearchMessagePart {
  return part.type === 'web-search'
}

export function createAssistantWebSearchMessagePart(
  input: Omit<AssistantWebSearchMessagePart, 'type'>
): AssistantWebSearchMessagePart {
  return {
    type: 'web-search',
    ...input,
    sources: input.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      snippet: source.snippet
    }))
  }
}
