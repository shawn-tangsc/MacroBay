import { describe, expect, it } from 'vitest'

import type { Tool } from '../../schemas/toolSchemas'
import { ToolRegistry } from './ToolRegistry'

const builtinRead: Tool = {
  id: 'Read',
  name: 'Read',
  description: 'Read files',
  origin: 'builtin',
  approval: 'auto'
}

const builtinWrite: Tool = {
  id: 'Write',
  name: 'Write',
  description: 'Write files',
  origin: 'builtin',
  approval: 'prompt'
}

const mcpSearch: Tool = {
  id: 'mcp__github__search',
  name: 'search',
  description: 'Search GitHub issues',
  origin: 'mcp',
  approval: 'prompt',
  sourceId: 'mcp-github',
  sourceName: 'GitHub'
}

describe('tool registry', () => {
  it('registers tools under a source id and resolves them by id', () => {
    const registry = new ToolRegistry()

    registry.registerTools('builtin', [builtinRead, builtinWrite])
    registry.registerTools('mcp-github', [mcpSearch])

    expect(registry.listAll().map((tool) => tool.id)).toEqual(['Read', 'Write', 'mcp__github__search'])
    expect(registry.get('Write')).toEqual(builtinWrite)
    expect(registry.get('missing')).toBeNull()
  })

  it('replaces one source without disturbing other sources', () => {
    const registry = new ToolRegistry()

    registry.registerTools('builtin', [builtinRead, builtinWrite])
    registry.registerTools('mcp-github', [mcpSearch])
    registry.registerTools('builtin', [builtinRead])

    expect(registry.listAll().map((tool) => tool.id)).toEqual(['Read', 'mcp__github__search'])
    expect(registry.listBySource('builtin').map((tool) => tool.id)).toEqual(['Read'])
    expect(registry.listBySource('mcp-github').map((tool) => tool.id)).toEqual(['mcp__github__search'])
  })

  it('prevents duplicate tool ids across sources', () => {
    const registry = new ToolRegistry()

    registry.registerTools('builtin', [builtinRead])

    expect(() =>
      registry.registerTools('other', [
        {
          ...builtinRead,
          name: 'Conflicting Read'
        }
      ])
    ).toThrow('Tool id "Read" is already registered by source "builtin".')
  })

  it('unregisters a source and removes its tools from lookup', () => {
    const registry = new ToolRegistry()

    registry.registerTools('builtin', [builtinRead])
    registry.registerTools('mcp-github', [mcpSearch])
    registry.unregisterSource('mcp-github')

    expect(registry.listAll().map((tool) => tool.id)).toEqual(['Read'])
    expect(registry.get('mcp__github__search')).toBeNull()
  })

  it('lists tools across an explicit source subset without including unrelated sources', () => {
    const registry = new ToolRegistry()

    registry.registerTools('builtin', [builtinRead, builtinWrite])
    registry.registerTools('mcp-github', [mcpSearch])

    expect(registry.listBySources(['mcp-github', 'missing']).map((tool) => tool.id)).toEqual(['mcp__github__search'])
  })
})
