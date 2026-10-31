import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AgentMcpCatalogItem } from '@platform/ai/agent-platform/mcp/agentMcpViewModel'

import { agentTextZh } from '../../../agentTextZh'
import { McpCatalog } from './McpCatalog'

const baseItem: AgentMcpCatalogItem = {
  id: 'mcp-files',
  name: 'Filesystem',
  description: 'Local file access',
  type: 'stdio',
  command: 'npx',
  baseUrl: null,
  providerUrl: null,
  tags: [],
  bound: false,
  pickable: true,
  status: 'idle',
  statusText: '',
  actions: []
}

function renderCatalog(overrides: {
  bound?: AgentMcpCatalogItem[]
  addable?: AgentMcpCatalogItem[]
  manualMcps?: string[]
  toolsByServerId?: Record<string, never[]>
}): string {
  return renderToStaticMarkup(
    <McpCatalog
      text={agentTextZh}
      value=""
      catalog={{ bound: overrides.bound ?? [], addable: overrides.addable ?? [] }}
      toolsByServerId={overrides.toolsByServerId ?? {}}
      manualMcps={overrides.manualMcps ?? []}
      onValueChange={() => undefined}
      onAdd={() => undefined}
      onAddRegistered={() => undefined}
      onRemove={() => undefined}
      onRefresh={() => undefined}
    />
  )
}

describe('McpCatalog', () => {
  it('renders manually bound MCP servers with the same switch affordance as registry rows', () => {
    const markup = renderCatalog({ manualMcps: ['custom-mcp'] })

    expect(markup).toContain('custom-mcp')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="true"')
  })

  it('never calls an errored server "available" — the switch repeats the status tag', () => {
    const markup = renderCatalog({
      addable: [{ ...baseItem, status: 'error', statusText: 'Process exited' }]
    })

    // 无障碍名必须与标签同源；「可添加」是旧标签，出现即说明两套说法又分叉了。
    expect(markup).not.toContain(`aria-label="${agentTextZh.common.available}"`)
    expect(markup).toContain(`aria-label="${agentTextZh.editor.tools.mcpError}"`)
    // 错误态保持可勾：说明归说明，绑定归绑定。
    expect(markup).toContain('role="switch"')
    expect(markup).not.toContain('disabled=""')
  })

  it('shows a never-started server as not started, not as connecting', () => {
    const markup = renderCatalog({ addable: [{ ...baseItem, status: 'idle' }] })

    expect(markup).toContain(agentTextZh.editor.tools.mcpIdle)
    expect(markup).not.toContain(agentTextZh.editor.tools.mcpConnecting)
  })

  it('explains an empty tool list instead of leaving a blank row', () => {
    const markup = renderCatalog({ bound: [{ ...baseItem, bound: true, status: 'connecting' }] })

    expect(markup).toContain(agentTextZh.editor.tools.mcpNoToolsHint)
  })
})
