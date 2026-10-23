import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import {
  listAgentSessionMessages,
  type AgentStoreState
} from '@platform/ai/agent-platform/store/agentStore'

export type AgentSessionMessageWindowOptions = {
  loadedPageCount: number
  pageSize?: number
}

export type AgentSessionMessageWindow = {
  messages: AgentSessionMessageEntity[]
  hasOlder: boolean
  nextCursor?: string
}

export function buildAgentSessionMessageWindow(
  state: AgentStoreState,
  sessionId: string | null | undefined,
  options: AgentSessionMessageWindowOptions
): AgentSessionMessageWindow {
  const loadedPageCount = Math.max(1, Math.trunc(options.loadedPageCount))
  const pages: AgentSessionMessageEntity[][] = []
  let cursor: string | undefined
  let hasOlder = false

  for (let pageIndex = 0; pageIndex < loadedPageCount; pageIndex += 1) {
    const page = listAgentSessionMessages(state, sessionId, {
      cursor,
      limit: options.pageSize
    })
    pages.push(page.items)
    cursor = page.nextCursor
    hasOlder = Boolean(page.nextCursor)
    if (!cursor) break
  }

  return {
    messages: [...pages].reverse().flatMap((page) => [...page].reverse()),
    hasOlder,
    nextCursor: cursor
  }
}

export function appendAgentSessionMessagePage(
  current: AgentSessionMessageWindow,
  page: { items: AgentSessionMessageEntity[]; nextCursor?: string }
): AgentSessionMessageWindow {
  const nextMessages = [...page.items].reverse().concat(current.messages)
  return {
    messages: dedupeMessages(nextMessages),
    hasOlder: Boolean(page.nextCursor),
    nextCursor: page.nextCursor
  }
}

function dedupeMessages(messages: readonly AgentSessionMessageEntity[]): AgentSessionMessageEntity[] {
  const seen = new Set<string>()
  const next: AgentSessionMessageEntity[] = []
  for (const message of messages) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    next.push(message)
  }
  return next
}
