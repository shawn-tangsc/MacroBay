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
import { IconButton } from '@platform/ui/components/icon-button'

import AgentBuiltinToolsPopoverContent from './AgentBuiltinToolsPopoverContent'

/** 输入条工具栏那一排的读屏名。句子仍在 `AgentText` 里，这里只留键。 */
const INPUTBAR_KEYS = {
  mention: 'agent.inputbar.mention',
  attachment: 'agent.inputbar.attachment',
  tools: 'agent.inputbar.tools',
  commands: 'agent.inputbar.commands',
  expand: 'agent.inputbar.expand',
  collapse: 'agent.inputbar.collapse',
  stop: 'agent.inputbar.stop',
  send: 'agent.inputbar.send'
} as const

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
  const resolveText = (key: string): string => {
    switch (key) {
      case INPUTBAR_KEYS.mention:
        return labels.mentionModel
      case INPUTBAR_KEYS.attachment:
        return labels.attachment
      case INPUTBAR_KEYS.tools:
        return labels.tools
      case INPUTBAR_KEYS.commands:
        return labels.commands
      case INPUTBAR_KEYS.expand:
        return labels.expand
      case INPUTBAR_KEYS.collapse:
        return labels.collapse
      case INPUTBAR_KEYS.stop:
        return labels.stop
      case INPUTBAR_KEYS.send:
        return labels.send
      default:
        return key
    }
  }

  return (
    <div className="agent-inputbar-footer">
      <div className="agent-inputbar-tools">
        <IconButton
          ariaLabelKey={INPUTBAR_KEYS.mention}
          icon={AtSign}
          size="md"
          tooltipKey={INPUTBAR_KEYS.mention}
          onSelect={onMentionClick}
          resolveText={resolveText}
        />
        <IconButton
          ariaLabelKey={INPUTBAR_KEYS.attachment}
          icon={Paperclip}
          size="md"
          tooltipKey={INPUTBAR_KEYS.attachment}
          onSelect={onAddFiles}
          resolveText={resolveText}
        />
        {/*
          Popover 会克隆它唯一的子元素并挂上 onClick 与 ref；`IconButton` 只接受自己的 props、
          不透传外部属性，直接当子元素会既拿不到事件也拿不到 ref。所以触发点包一层 span：
          点击从按钮冒泡到 span，弹层照常由它打开。
        */}
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
          <span>
            <IconButton
              ariaLabelKey={INPUTBAR_KEYS.tools}
              icon={Wrench}
              size="md"
              tooltipKey={INPUTBAR_KEYS.tools}
              onSelect={() => undefined}
              resolveText={resolveText}
            />
          </span>
        </Popover>
        <IconButton
          ariaLabelKey={INPUTBAR_KEYS.commands}
          icon={Slash}
          size="md"
          tooltipKey={INPUTBAR_KEYS.commands}
          onSelect={onOpenCommands}
          resolveText={resolveText}
        />
        <IconButton
          ariaLabelKey={expanded ? INPUTBAR_KEYS.collapse : INPUTBAR_KEYS.expand}
          icon={expanded ? Minimize2 : Maximize2}
          size="md"
          tooltipKey={expanded ? INPUTBAR_KEYS.collapse : INPUTBAR_KEYS.expand}
          onSelect={onToggleExpanded}
          resolveText={resolveText}
        />
      </div>
      <div className="agent-inputbar-actions">
        {modelPicker ? <div className="agent-inputbar-model">{modelPicker}</div> : null}
        {isStreaming ? (
          <IconButton
            ariaLabelKey={INPUTBAR_KEYS.stop}
            icon={StopCircle}
            size="sm"
            tone="danger"
            tooltipKey={INPUTBAR_KEYS.stop}
            onSelect={onStop}
            resolveText={resolveText}
          />
        ) : null}
        <IconButton
          ariaLabelKey={INPUTBAR_KEYS.send}
          icon={SendHorizontal}
          size="sm"
          disabled={!canSend}
          // 禁用时不许带提示：接不到焦点的按钮，Tooltip 只有鼠标能看，键盘用户拿不到理由。
          {...(canSend ? { tooltipKey: INPUTBAR_KEYS.send } : {})}
          onSelect={onSend}
          resolveText={resolveText}
        />
      </div>
    </div>
  )
}
