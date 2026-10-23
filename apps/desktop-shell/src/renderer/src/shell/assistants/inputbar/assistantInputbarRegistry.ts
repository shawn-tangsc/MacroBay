export type AssistantInputbarToolId =
  | 'attachment'
  | 'new-topic'
  | 'clear-topic'
  | 'quick-panel'
  | 'mcp-tools'
  | 'web-search'
  | 'context-source'

export type AssistantInputbarTool = {
  id: AssistantInputbarToolId
  labelKey: AssistantInputbarToolId
  enabled: boolean
  placeholder?: boolean
}

const DEFAULT_TOOLS: AssistantInputbarTool[] = [
  { id: 'attachment', labelKey: 'attachment', enabled: true },
  { id: 'new-topic', labelKey: 'new-topic', enabled: true },
  { id: 'clear-topic', labelKey: 'clear-topic', enabled: true },
  { id: 'quick-panel', labelKey: 'quick-panel', enabled: true },
  { id: 'mcp-tools', labelKey: 'mcp-tools', enabled: false, placeholder: true },
  { id: 'web-search', labelKey: 'web-search', enabled: false, placeholder: true },
  { id: 'context-source', labelKey: 'context-source', enabled: false, placeholder: true }
]

export function createAssistantInputbarTools(): AssistantInputbarTool[] {
  return DEFAULT_TOOLS.map((tool) => ({ ...tool }))
}

export function listVisibleAssistantInputbarTools(tools: readonly AssistantInputbarTool[]): AssistantInputbarTool[] {
  return tools.filter((tool) => tool.enabled || tool.placeholder)
}
