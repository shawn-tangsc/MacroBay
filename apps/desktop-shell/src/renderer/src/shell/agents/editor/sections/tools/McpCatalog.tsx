import { Button, Input, Switch, Tag, Tooltip, message } from 'antd'
import { Copy, ExternalLink, Network, Plus, RefreshCw, Settings2 } from 'lucide-react'

import type { AgentMcpCatalogItem } from '@platform/ai/agent-platform/mcp/agentMcpViewModel'
import type { RuntimeCredentialAction } from '@platform/ai/agent-platform/mcp/runtimeCredentialActions'
import type { McpTool } from '@platform/ai/agent-platform/schemas/toolSchemas'

import { copyTextToClipboard } from '../../../../clipboard'
import type { AgentText } from '../../../agentText'
import { EmptyCatalog } from './EmptyCatalog'

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
  return (
    <div className="agent-tool-catalog">
      <div className="agent-tool-list-heading">{text.editor.tools.boundHeading}</div>
      {catalog.bound.length === 0 && manualMcps.length === 0 ? (
        <EmptyCatalog
          icon={<Network size={17} />}
          title={text.editor.tools.noMcpTitle}
          description={text.editor.tools.noMcpDescription}
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
        <EmptyCatalog
          icon={<Network size={17} />}
          title={text.editor.tools.noMcpRegistryTitle}
          description={text.editor.tools.noMcpRegistryDescription}
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
      <Tag
        className={
          item.status === 'connected'
            ? 'agent-tool-approval auto'
            : item.status === 'error'
              ? 'agent-tool-approval danger'
              : 'agent-tool-approval'
        }>
        {mcpStatusLabel(item.status, text)}
      </Tag>
      {checked && item.status !== 'connected' && onUnbind ? (
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

/** 读屏名说的是「绑没绑」，把当前状态只作为不可用时的补充。 */
function switchAccessibleName(item: AgentMcpCatalogItem, checked: boolean, text: AgentText): string {
  if (checked) return text.editor.tools.mcpSwitchBound(item.name)
  if (item.status === 'connected') return text.editor.tools.mcpSwitchBind(item.name)
  return text.editor.tools.mcpSwitchBindUnavailable(item.name)
}

/** 四句按状态分开说：连不上、正在连、没启动、连上了但这个服务没有工具，是四件事。 */
function emptyToolsHint(status: AgentMcpCatalogItem['status'], text: AgentText): string {
  switch (status) {
    case 'idle':
      return text.editor.tools.mcpEmptyToolsIdle
    case 'connecting':
      return text.editor.tools.mcpEmptyToolsConnecting
    case 'connected':
      return text.editor.tools.mcpEmptyToolsConnected
    case 'error':
    case 'disabled':
      return text.editor.tools.mcpEmptyToolsError
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

/**
 * 穷举分支，不留静默 `default`：新增一个运行时状态却忘了给它文案时，
 * `never` 检查会让编译失败，而不是让这个值悄悄落进某个兜底说法里（「连接中」那次就是这么来的）。
 */
function mcpStatusLabel(status: AgentMcpCatalogItem['status'], text: AgentText): string {
  switch (status) {
    case 'connected':
      return text.editor.tools.mcpConnected
    case 'connecting':
      return text.editor.tools.mcpConnecting
    case 'error':
      return text.editor.tools.mcpError
    case 'idle':
      return text.editor.tools.mcpIdle
    case 'disabled':
      return text.editor.tools.mcpDisabled
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}
