export type ProductAgentToolLogEntry = {
  level: 'info' | 'warn' | 'error'
  message: string
  details?: Record<string, unknown>
}

export type ProductAgentToolHandlerContext = {
  toolCallId: string
  productId: string
  toolName: string
  schemaVersion: number
  consumerProductId?: string
  agentId: string
  agentSessionId: string
  signal: AbortSignal
  log: (entry: ProductAgentToolLogEntry) => Promise<void>
}

export type ProductAgentToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ProductAgentToolHandlerContext
) => Promise<TOutput>

export type ProductAgentToolHandlerRegistration = {
  productId: string
  handlerId: string
  handle: ProductAgentToolHandler
}
