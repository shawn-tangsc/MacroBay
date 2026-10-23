import { Switch, Tag } from 'antd'

import type { Tool } from '@platform/ai/agent-platform/schemas/toolSchemas'

import type { AgentText } from '../../../agentText'

type BuiltinToolCatalogProps = {
  text: AgentText
  icon: React.ReactNode
  items: Tool[]
  disabledToolIds: ReadonlySet<string>
  onToggle: (id: string, checked: boolean) => void
}

export function BuiltinToolCatalog({
  text,
  icon,
  items,
  disabledToolIds,
  onToggle
}: BuiltinToolCatalogProps): React.ReactElement {
  return (
    <div className="agent-tool-catalog">
      {items.length === 0 ? <p className="agent-empty-copy">{text.editor.tools.noMoreAddableTools}</p> : null}
      {items.map((tool) => (
        <ToolRow
          key={tool.id}
          text={text}
          tool={tool}
          icon={icon}
          enabled={!disabledToolIds.has(tool.id)}
          onToggle={(checked) => onToggle(tool.id, checked)}
        />
      ))}
    </div>
  )
}

function ToolRow({
  text,
  tool,
  icon,
  enabled,
  onToggle
}: {
  text: AgentText
  tool: Tool
  icon: React.ReactNode
  enabled: boolean
  onToggle: (checked: boolean) => void
}): React.ReactElement {
  return (
    <div className="agent-tool-row">
      <span className="agent-tool-icon">{icon}</span>
      <span className="agent-tool-copy">
        <strong>{tool.name}</strong>
        <small>{tool.description}</small>
      </span>
      <Tag className={tool.approval === 'auto' ? 'agent-tool-approval auto' : 'agent-tool-approval'}>
        {tool.approval === 'auto' ? text.editor.tools.approvalAutoBadge : text.editor.tools.approvalPromptBadge}
      </Tag>
      <Switch size="small" checked={enabled} onChange={onToggle} />
    </div>
  )
}
