import { Switch } from 'antd'

import type { Tool } from '@platform/ai/agent-platform/schemas/toolSchemas'
import type { ToolApproval } from '@platform/ai/agent-platform/schemas/toolSchemas'

type AgentBuiltinToolsPopoverContentProps = {
  title: string
  summary: string
  note: string
  approvalLabels: Record<ToolApproval, string>
  builtinTools: readonly Tool[]
  disabledToolIds: readonly string[]
  onToggle: (toolId: string, enabled: boolean) => void
}

export default function AgentBuiltinToolsPopoverContent({
  title,
  summary,
  note,
  approvalLabels,
  builtinTools,
  disabledToolIds,
  onToggle
}: AgentBuiltinToolsPopoverContentProps): React.ReactElement {
  return (
    <div className="agent-input-popover">
      <strong>{title}</strong>
      <span>{summary}</span>
      <div className="agent-input-tool-list">
        {builtinTools.map((tool) => {
          const enabled = !disabledToolIds.includes(tool.id)
          return (
            <label key={tool.id}>
              <span>
                <strong>{tool.name}</strong>
                <small>{approvalLabels[tool.approval]}</small>
              </span>
              <Switch size="small" checked={enabled} onChange={(checked) => onToggle(tool.id, checked)} />
            </label>
          )
        })}
      </div>
      <small>{note}</small>
    </div>
  )
}
