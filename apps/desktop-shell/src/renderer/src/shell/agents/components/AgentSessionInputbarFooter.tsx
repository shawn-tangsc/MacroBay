import {
  AtSign,
  Maximize2,
  Minimize2,
  Paperclip,
  SendHorizontal,
  Slash,
  StopCircle,
  Wrench
} from 'lucide-react'
import { Popover } from 'antd'
import type { ReactNode } from 'react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { Tool } from '@platform/ai/agent-platform/schemas/toolSchemas'

import AgentBuiltinToolsPopoverContent from './AgentBuiltinToolsPopoverContent'

type AgentSessionInputbarFooterProps = {
  agent: AgentEntity
  expanded: boolean
  toolsOpen: boolean
  isStreaming: boolean
  canSend: boolean
  activeToolSummary: string
  builtinTools: Tool[]
  /** Model selector rendered next to the send action. */
  modelPicker?: ReactNode
  labels: {
    mentionModel: string
    attachment: string
    availableTools: string
    mcpSkillsManagedInConfig: string
    approval: Record<string, string>
    tools: string
    commands: string
    collapse: string
    expand: string
    stop: string
    send: string
    removeAttachment: string
  }
  onToolsOpenChange: (open: boolean) => void
  onMentionClick: () => void
  onAddFiles: () => void
  onToggleTool: (toolId: string, enabled: boolean) => void
  onOpenCommands: () => void
  onToggleExpanded: () => void
  onStop: () => void
  onSend: () => void
}

export default function AgentSessionInputbarFooter({
  agent,
  expanded,
  toolsOpen,
  isStreaming,
  canSend,
  activeToolSummary,
  builtinTools,
  modelPicker,
  labels,
  onToolsOpenChange,
  onMentionClick,
  onAddFiles,
  onToggleTool,
  onOpenCommands,
  onToggleExpanded,
  onStop,
  onSend
}: AgentSessionInputbarFooterProps) {
  return (
    <div className="agent-inputbar-footer">
      <div className="agent-inputbar-tools">
        <button type="button" aria-label={labels.mentionModel} title={labels.mentionModel} onClick={onMentionClick}>
          <AtSign size={15} />
        </button>
        <button type="button" aria-label={labels.attachment} title={labels.attachment} onClick={onAddFiles}>
          <Paperclip size={15} />
        </button>
        <Popover
          open={toolsOpen}
          trigger="click"
          placement="topLeft"
          onOpenChange={onToolsOpenChange}
          content={
            <AgentBuiltinToolsPopoverContent
              title={labels.availableTools}
              summary={activeToolSummary}
              note={labels.mcpSkillsManagedInConfig}
              approvalLabels={labels.approval}
              builtinTools={builtinTools}
              disabledToolIds={agent.disabledTools ?? []}
              onToggle={onToggleTool}
            />
          }>
          <button type="button" aria-label={labels.tools} title={labels.tools}>
            <Wrench size={15} />
          </button>
        </Popover>
        <button type="button" aria-label={labels.commands} title={labels.commands} onClick={onOpenCommands}>
          <Slash size={15} />
        </button>
        <button
          type="button"
          aria-label={expanded ? labels.collapse : labels.expand}
          title={expanded ? labels.collapse : labels.expand}
          onClick={onToggleExpanded}>
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      <div className="agent-inputbar-actions">
        {modelPicker ? <div className="agent-inputbar-model">{modelPicker}</div> : null}
        {isStreaming ? (
          <button type="button" className="agent-send-button stop" aria-label={labels.stop} title={labels.stop} onClick={onStop}>
            <StopCircle size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className="agent-send-button"
          aria-label={labels.send}
          title={labels.send}
          disabled={!canSend}
          onClick={onSend}>
          <SendHorizontal size={16} />
        </button>
      </div>
    </div>
  )
}
