import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { agentTextZh } from '../../../agentTextZh'
import { McpCatalog } from './McpCatalog'

describe('McpCatalog', () => {
  it('renders manually bound MCP servers with the same switch affordance as registry rows', () => {
    const markup = renderToStaticMarkup(
      <McpCatalog
        text={agentTextZh}
        value=""
        catalog={{ bound: [], addable: [] }}
        toolsByServerId={{}}
        manualMcps={['custom-mcp']}
        onValueChange={() => undefined}
        onAdd={() => undefined}
        onAddRegistered={() => undefined}
        onRemove={() => undefined}
        onRefresh={() => undefined}
      />
    )

    expect(markup).toContain('custom-mcp')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="true"')
  })
})
