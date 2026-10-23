import type { ProductAgentToolCallTrace } from './productAgentToolSchemas'

export type ProductAgentToolTracePageQuery = {
  agentSessionId?: string
  productId?: string
  consumerProductId?: string
  cursor?: string
  limit?: number
}

export type ProductAgentToolTraceRepository = {
  insert: (trace: ProductAgentToolCallTrace) => Promise<void>
  finalize: (trace: ProductAgentToolCallTrace) => Promise<void>
  get: (toolCallId: string) => Promise<ProductAgentToolCallTrace | null>
  listPage: (query: ProductAgentToolTracePageQuery) => Promise<{
    items: ProductAgentToolCallTrace[]
    nextCursor?: string
  }>
}

export function createInMemoryProductAgentToolTraceRepository(): ProductAgentToolTraceRepository {
  const traces = new Map<string, ProductAgentToolCallTrace>()

  return {
    async insert(trace) {
      traces.set(trace.toolCallId, { ...trace })
    },
    async finalize(trace) {
      traces.set(trace.toolCallId, { ...trace })
    },
    async get(toolCallId) {
      const trace = traces.get(toolCallId)
      return trace ? { ...trace } : null
    },
    async listPage(query) {
      const items = [...traces.values()]
        .filter((trace) => (query.agentSessionId ? trace.agentSessionId === query.agentSessionId : true))
        .filter((trace) => (query.productId ? trace.productId === query.productId : true))
        .filter((trace) => (query.consumerProductId ? trace.consumerProductId === query.consumerProductId : true))
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))

      const limit = Math.max(1, Math.min(query.limit ?? 50, 200))
      const startIndex = query.cursor ? items.findIndex((item) => item.toolCallId === query.cursor) + 1 : 0
      const page = items.slice(startIndex, startIndex + limit)
      const nextCursor = startIndex + limit < items.length ? page.at(-1)?.toolCallId : undefined
      return {
        items: page.map((item) => ({ ...item })),
        nextCursor
      }
    }
  }
}
