import { Tag } from 'antd'

import type { AgentMcpCatalogItem } from '@platform/ai/agent-platform/mcp/agentMcpViewModel'

import type { AgentText } from '../../../agentText'

/**
 * 一行 MCP 服务器「怎么描述自己」的全部判断：状态标签、读屏名、空工具解释。
 *
 * 抽出来是因为它们回答的是同一个问题（这一行现在是什么状态），与列表怎么渲染、
 * 怎么增删绑定是两件事；混在一起会让主组件的行数继续长。
 */

export function McpStatusTag({
  item,
  text
}: {
  item: AgentMcpCatalogItem
  text: AgentText
}): React.ReactElement {
  return (
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
  )
}

/** 读屏名说的是「绑没绑」，把当前状态只作为不可用时的补充。 */
export function switchAccessibleName(item: AgentMcpCatalogItem, checked: boolean, text: AgentText): string {
  if (checked) return text.editor.tools.mcpSwitchBound(item.name)
  if (item.status === 'connected') return text.editor.tools.mcpSwitchBind(item.name)
  return text.editor.tools.mcpSwitchBindUnavailable(item.name)
}

/** 四句按状态分开说：连不上、正在连、没启动、连上了但这个服务没有工具，是四件事。 */
export function emptyToolsHint(status: AgentMcpCatalogItem['status'], text: AgentText): string {
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
export function mcpStatusLabel(status: AgentMcpCatalogItem['status'], text: AgentText): string {
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

/**
 * 哪些已绑定行给解绑出口：连不上、被停用、从没启动过。
 * 「正在连接」是过渡态，不给出口——刚打开开关就闪出一个删除按钮，误点就删了刚建的绑定。
 */
export const UNBINDABLE_STATUSES = new Set<AgentMcpCatalogItem['status']>(['error', 'disabled', 'idle'])
