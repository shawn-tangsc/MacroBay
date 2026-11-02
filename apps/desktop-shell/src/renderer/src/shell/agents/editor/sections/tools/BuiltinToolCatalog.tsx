import { Switch } from 'antd'

import type { Tool } from '@platform/ai/agent-platform/schemas/toolSchemas'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'

import type { AgentText } from '../../../agentText'

/** 审批方式两种：`auto` 放行、其余需要读者点一次，所以是 `ok` / `muted`。 */
const APPROVAL_PILLS = {
  auto: { tone: 'ok', labelKey: 'agent.tools.approvalAuto' },
  prompt: { tone: 'muted', labelKey: 'agent.tools.approvalPrompt' }
} as const satisfies Record<'auto' | 'prompt', { tone: StatusPillTone; labelKey: string }>

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
  const pill = tool.approval === 'auto' ? APPROVAL_PILLS.auto : APPROVAL_PILLS.prompt
  return (
    <div className="agent-tool-row">
      <span className="agent-tool-icon">{icon}</span>
      <span className="agent-tool-copy">
        <strong>{tool.name}</strong>
        <small>{tool.description}</small>
      </span>
      <StatusPill
        tone={pill.tone}
        labelKey={pill.labelKey}
        resolveText={(key) =>
          key === APPROVAL_PILLS.auto.labelKey ? text.editor.tools.approvalAutoBadge : text.editor.tools.approvalPromptBadge
        }
      />
      <Switch size="small" checked={enabled} onChange={onToggle} />
    </div>
  )
}
