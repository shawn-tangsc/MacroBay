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

/**
 * 只渲染**真能用**的工具。
 *
 * 未上线的能力不占位：禁用件接不到焦点、也说不清为什么不能点，几个「即将支持」的灰按钮只是
 * 在工具条里制造噪音（Chief 2026-11-02 裁定）。发现性写在工具说明里一次讲清，能力上线时按钮
 * 随功能自然长出来——`placeholder` 保留字段含义「还没上线」，不再参与渲染。
 */
export function listVisibleAssistantInputbarTools(tools: readonly AssistantInputbarTool[]): AssistantInputbarTool[] {
  return tools.filter((tool) => tool.enabled)
}
