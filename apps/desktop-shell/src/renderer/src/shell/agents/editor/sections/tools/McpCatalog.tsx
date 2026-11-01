import { useRef } from 'react'
import { Button, Input, Switch, Tag, Tooltip, message } from 'antd'
import type { InputRef } from 'antd'
import { Copy, ExternalLink, Network, Plus, RefreshCw, Settings2 } from 'lucide-react'

import type { AgentMcpCatalogItem } from '@platform/ai/agent-platform/mcp/agentMcpViewModel'
import type { RuntimeCredentialAction } from '@platform/ai/agent-platform/mcp/runtimeCredentialActions'
import type { McpTool } from '@platform/ai/agent-platform/schemas/toolSchemas'

import { copyTextToClipboard } from '../../../../clipboard'
import type { AgentText } from '../../../agentText'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'
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
      <Tag className="agent-tool-approval">{text.editor.tools.mcpManualBadge}</Tag>
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
        <small>{item.statusText || item.description || item.command || item.baseUrl || item.id}</small>
        {tools.length > 0 ? (
          <span className="agent-mcp-tool-list">
            {tools.slice(0, 4).map((tool) => (
              <Tag key={tool.id} className="agent-mcp-tool-chip">
                {tool.name}
              </Tag>
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
        <Button
          className="ant-icon-button"
          size="small"
          icon={<RefreshCw size={13} />}
          aria-label={text.editor.tools.refreshMcpTools}
          title={text.editor.tools.refreshMcpTools}
          onClick={onRefresh}
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
  const label = resolveCredentialActionLabel(action, text)

  return (
    <Tooltip title={label}>
      <Button
        className="ant-secondary-button"
        size="small"
        icon={credentialActionIcon(action.id)}
        aria-label={label}
        onClick={() => {
          void runCredentialAction(action, text, onRestart)
        }}>
        {label}
      </Button>
    </Tooltip>
  )
}

function resolveCredentialActionLabel(action: RuntimeCredentialAction, text: AgentText): string {
  if (action.id === 'open-url') return text.editor.tools.mcpActionOpenUrl
  if (action.id === 'restart') return text.editor.tools.mcpActionRestart
  if (action.id === 'open-settings') return text.editor.tools.mcpActionOpenSettings
  if (action.id === 'copy-hint') return text.editor.tools.mcpActionCopyHint
  return text.editor.tools.mcpActionRetry
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
    message.success(text.editor.tools.mcpActionCopied)
    return
  }

  if (action.id === 'restart' || action.id === 'retry') {
    onRestart?.()
  }
}
