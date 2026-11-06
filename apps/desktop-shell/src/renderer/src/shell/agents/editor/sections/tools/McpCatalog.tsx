import { useRef } from 'react'
import { Button, Input, Switch, Tag } from 'antd'
import type { InputRef } from 'antd'
import { Copy, ExternalLink, Network, Plus, RefreshCw, Settings2 } from 'lucide-react'

import type { AgentMcpCatalogItem } from '@platform/ai/agent-platform/mcp/agentMcpViewModel'
import type { RuntimeCredentialAction } from '@platform/ai/agent-platform/mcp/runtimeCredentialActions'
import type { McpTool } from '@platform/ai/agent-platform/schemas/toolSchemas'

import { copyTextToClipboard } from '../../../../clipboard'
import { IconButton } from '@platform/ui/components/icon-button'
import { resolveAgentTextKey } from '../../../agentTooltipText'
import type { AgentText } from '../../../agentText'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
import { StatusPill } from '@platform/ui/components/status-pill'
import { Tooltip } from '@platform/ui/components/tooltip'
import { useToast, type ToastApi } from '@platform/ui/components/toast'
import {
  emptyToolsHint,
  McpStatusTag,
  switchAccessibleName,
  UNBINDABLE_STATUSES
} from './mcpRowStatus'

type McpCatalogProps = {
  text: AgentText
  value: string
  catalog: {
    bound: AgentMcpCatalogItem[]
    addable: AgentMcpCatalogItem[]
  }
  toolsByServerId: Record<string, McpTool[]>
  manualMcps: string[]
  onValueChange: (value: string) => void
  onAdd: () => void
  onAddRegistered: (mcpId: string) => void
  onRemove: (mcpId: string) => void
  onRefresh: (mcpId: string) => void
}

/** 「手动绑定」是状态词，不是描述标签。 */
const MANUAL_BADGE_KEY = 'agent.tools.mcpManualBadge'
/** 工具名是分类名词（这个服务器提供了什么），不是状态。 */
const MCP_TOOL_CHIP_KEY = 'agent.tools.mcpToolChip'
/** 复制动作的回执键。 */
const COPIED_TOAST_KEY = 'agent.tools.mcpActionCopied'

export function McpCatalog({
  text,
  value,
  catalog,
  toolsByServerId,
  manualMcps,
  onValueChange,
  onAdd,
  onAddRegistered,
  onRemove,
  onRefresh
}: McpCatalogProps): React.ReactElement {
  const manualInputRef = useRef<InputRef | null>(null)
  // 「去绑定」是真的能做的一步：把光标送到同一面板里的手动添加框，而不是指去一个不存在的设置页。
  const focusManualInput = (): void => manualInputRef.current?.focus()

  return (
    <div className="agent-tool-catalog">
      <div className="agent-tool-list-heading">{text.editor.tools.boundHeading}</div>
      {catalog.bound.length === 0 && manualMcps.length === 0 ? (
        <StateView
          state="empty"
          reasonCode="none-installed"
          size="md"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.bind_target, onSelect: focusManualInput }}
        />
      ) : (
        <div className="agent-tool-catalog compact">
          {catalog.bound.map((mcp) => (
            <McpRow
              key={mcp.id}
              item={mcp}
              tools={toolsByServerId[mcp.id] ?? []}
              text={text}
              checked
              onToggle={(checked) => {
                if (!checked) onRemove(mcp.id)
              }}
              onRefresh={() => onRefresh(mcp.id)}
              onUnbind={() => onRemove(mcp.id)}
            />
          ))}
          {manualMcps.map((mcpId) => (
            <ManualMcpRow
              key={mcpId}
              mcpId={mcpId}
              text={text}
              onToggle={(checked) => {
                if (!checked) onRemove(mcpId)
              }}
            />
          ))}
        </div>
      )}

      <div className="agent-tool-list-heading">{text.editor.tools.mcpRegistryHeading}</div>
      {catalog.addable.length === 0 ? (
        <StateView
          state="empty"
          reasonCode="none-installed"
          size="md"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.bind_target, onSelect: focusManualInput }}
        />
      ) : (
        <div className="agent-tool-catalog compact">
          {catalog.addable.map((mcp) => (
            <McpRow
              key={mcp.id}
              item={mcp}
              tools={toolsByServerId[mcp.id] ?? []}
              text={text}
              checked={false}
              onToggle={(checked) => {
                if (checked) onAddRegistered(mcp.id)
              }}
              onRefresh={() => onRefresh(mcp.id)}
            />
          ))}
        </div>
      )}

      <div className="agent-tool-list-heading">{text.editor.tools.mcpManualHeading}</div>
      <div className="agent-mcp-add-row">
        <Input
          ref={manualInputRef}
          value={value}
          placeholder={text.editor.tools.mcpPlaceholder}
          onChange={(event) => onValueChange(event.target.value)}
          onPressEnter={onAdd}
        />
        <Button className="ant-secondary-button" size="small" icon={<Plus size={13} />} onClick={onAdd}>
          {text.common.add}
        </Button>
      </div>
    </div>
  )
}

function ManualMcpRow({
  mcpId,
  text,
  onToggle
}: {
  mcpId: string
  text: AgentText
  onToggle: (checked: boolean) => void
}): React.ReactElement {
  return (
    <div className="agent-tool-row agent-mcp-row">
      <span className="agent-tool-icon">
        <Network size={14} />
      </span>
      <span className="agent-tool-copy">
        <strong>{mcpId}</strong>
        <small>{text.editor.tools.mcpManualCustomDescription}</small>
      </span>
      <StatusPill
        tone="warn"
        labelKey={MANUAL_BADGE_KEY}
        resolveText={(key) => (key === MANUAL_BADGE_KEY ? text.editor.tools.mcpManualBadge : '')}
      />
      <Switch
        size="small"
        checked
        aria-label={text.common.enabled}
        onChange={onToggle}
      />
    </div>
  )
}

function McpRow({
  item,
  tools,
  text,
  checked,
  onToggle,
  onRefresh,
  onUnbind
}: {
  item: AgentMcpCatalogItem
  tools: readonly McpTool[]
  text: AgentText
  checked: boolean
  onToggle: (checked: boolean) => void
  onRefresh?: () => void
  onUnbind?: () => void
}): React.ReactElement {
  return (
    <div className="agent-tool-row agent-mcp-row">
      <span className="agent-tool-icon">
        <Network size={14} />
      </span>
      <span className="agent-tool-copy">
        <strong>{item.name}</strong>
        {/*
         * 次要行只放**读者认得的东西**：运行时状态、服务描述（描述里已含命令与地址）。
         * 这里原来还退到 `item.id`——那是服务实体的内部标识（不是读者填的字），契约 v2.41
         * 第三档：内部标识任何情况下都不许当文案。什么都没有就不画这一行，不拿 id 垫背。
         */}
        {item.statusText || item.description ? (
          <small>{item.statusText || item.description}</small>
        ) : null}
        {tools.length > 0 ? (
          <span className="agent-mcp-tool-list">
            {tools.slice(0, 4).map((tool) => (
              <Tag key={tool.id} className="agent-mcp-tool-chip">{tool.name}</Tag>
            ))}
            {tools.length > 4 ? <Tag className="agent-mcp-tool-chip">+{tools.length - 4}</Tag> : null}
          </span>
        ) : checked ? (
          <small className="agent-mcp-empty-hint">{emptyToolsHint(item.status, text)}</small>
        ) : null}
        {item.actions.length > 0 ? (
          <span className="agent-mcp-credential-actions">
            {item.actions.map((action) => (
              <McpCredentialActionButton
                key={action.id}
                action={action}
                text={text}
                onRestart={() => onRefresh?.()}
              />
            ))}
          </span>
        ) : null}
      </span>
      <McpStatusTag item={item} text={text} />
      {checked && UNBINDABLE_STATUSES.has(item.status) && onUnbind ? (
        <Button
          className="ant-secondary-button"
          size="small"
          aria-label={text.editor.tools.mcpUnbind}
          onClick={onUnbind}>
          {text.editor.tools.mcpUnbind}
        </Button>
      ) : null}
      {checked && onRefresh ? (
        <IconButton
          ariaLabelKey="editor.tools.refreshMcpTools"
          icon={RefreshCw}
          onSelect={onRefresh}
          resolveText={(key) => resolveAgentTextKey(text, key)}
          size="md"
          tooltipKey="editor.tools.refreshMcpTools"
        />
      ) : null}
      <Switch
        size="small"
        checked={checked}
        // 读屏名说清楚「绑没绑」，而不是把状态词当开关名念出来（那会读成「不可用，开关」）。
        aria-label={switchAccessibleName(item, checked, text)}
        onChange={onToggle}
      />
    </div>
  )
}

function McpCredentialActionButton({
  action,
  text,
  onRestart
}: {
  action: RuntimeCredentialAction
  text: AgentText
  onRestart?: () => void
}): React.ReactElement {
  // 动作自带的是键（`editor.tools.mcpActionOpenUrl` 这类），句子由本线文案表解析——
  // 不再在调用点按 id 重写一张 if 表，动作多一种也不会漏（`RuntimeCredentialAction` 自己带键）。
  const resolveText = (key: string): string => resolveAgentTextKey(text, key)
  const label = resolveText(action.labelKey)
  const toast = useToast()

  return (
    <Tooltip labelKey={action.labelKey} resolveText={resolveText}>
      <Button
        className="ant-secondary-button"
        size="small"
        icon={credentialActionIcon(action.id)}
        aria-label={label}
        onClick={() => {
          void runCredentialAction(action, text, toast, onRestart)
        }}>
        {label}
      </Button>
    </Tooltip>
  )
}

function credentialActionIcon(id: RuntimeCredentialAction['id']): React.ReactNode {
  if (id === 'open-url') return <ExternalLink size={12} />
  if (id === 'open-settings') return <Settings2 size={12} />
  if (id === 'copy-hint') return <Copy size={12} />
  return <RefreshCw size={12} />
}

async function runCredentialAction(
  action: RuntimeCredentialAction,
  text: AgentText,
  toast: ToastApi,
  onRestart?: () => void
): Promise<void> {
  if (action.id === 'open-url' && action.url) {
    await window.platform.app.openExternal(action.url)
    return
  }

  if (action.id === 'open-settings') {
    window.dispatchEvent(
      new CustomEvent('app-shell:navigate', {
        detail: { navKey: 'settings', settingsPanelKey: 'preferences' }
      })
    )
    return
  }

  if (action.id === 'copy-hint' && action.hint) {
    await copyTextToClipboard(action.hint)
    toast.success({
      titleKey: COPIED_TOAST_KEY,
      resolveText: (key) => (key === COPIED_TOAST_KEY ? text.editor.tools.mcpActionCopied : '')
    })
    return
  }

  if (action.id === 'restart' || action.id === 'retry') {
    onRestart?.()
  }
}
