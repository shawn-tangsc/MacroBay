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

    // 读屏名说的是「绑没绑」，不再把状态词当开关名念出来。
    expect(markup).not.toContain(`aria-label="${agentTextZh.common.available}"`)
    expect(markup).toContain(`aria-label="${agentTextZh.editor.tools.mcpSwitchBindUnavailable('Filesystem')}"`)
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

    expect(markup).toContain(agentTextZh.editor.tools.mcpEmptyToolsConnecting)
  })

  it('names a bound switch by binding, not by status', () => {
    const markup = renderCatalog({ bound: [{ ...baseItem, bound: true, status: 'error', statusText: 'Process exited' }] })

    expect(markup).toContain(`aria-label="${agentTextZh.editor.tools.mcpSwitchBound('Filesystem')}"`)
  })

  it('offers an unbind exit only on a bound row that cannot work', () => {
    const broken = renderCatalog({ bound: [{ ...baseItem, bound: true, status: 'error', statusText: 'Process exited' }] })
    const healthy = renderCatalog({ bound: [{ ...baseItem, bound: true, status: 'connected' }] })

    expect(broken).toContain(`aria-label="${agentTextZh.editor.tools.mcpUnbind}"`)
    expect(healthy).not.toContain(`aria-label="${agentTextZh.editor.tools.mcpUnbind}"`)
  })

  it('does not explain an empty tool list on a server that is not bound yet', () => {
    const markup = renderCatalog({ addable: [{ ...baseItem, status: 'idle' }] })

    expect(markup).not.toContain(agentTextZh.editor.tools.mcpEmptyToolsConnecting)
  })
})
