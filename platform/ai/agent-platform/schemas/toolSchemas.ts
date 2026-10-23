export const toolApprovals = ['auto', 'prompt'] as const
export type ToolApproval = (typeof toolApprovals)[number]

export const toolOrigins = ['builtin', 'mcp', 'internal', 'product'] as const
export type ToolOrigin = (typeof toolOrigins)[number]

export type Tool = {
  id: string
  name: string
  description?: string
  origin: ToolOrigin
  approval: ToolApproval
  sourceId?: string
  sourceName?: string
  productId?: string
  readOnly?: boolean
  schemaVersion?: number
  requiresTemporalBoundary?: boolean
}

export type McpToolInputSchema = Record<string, unknown>

export type McpTool = {
  id: string
  name: string
  description?: string
  inputSchema?: McpToolInputSchema
}
