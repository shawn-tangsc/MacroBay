import { describe, expect, it } from 'vitest'

import { buildWarmQueryReuseKey } from './claudeCodeRuntimeDependencies'

function optionsWith(servers: Record<string, unknown>) {
  return {
    mcpServers: servers,
    allowedTools: [],
    disallowedTools: [],
    cwd: '/tmp/workspace',
    env: {},
    permissionMode: 'default'
  } as never
}

describe('buildWarmQueryReuseKey', () => {
  it('survives an in-process MCP server instance that contains cycles', () => {
    const instance: Record<string, unknown> = { tools: [] }
    instance.self = instance
    const servers = { 'market-intelligence': { type: 'sdk', name: 'market-intelligence', instance } }

    const first = buildWarmQueryReuseKey(optionsWith(servers), 'policy')
    const second = buildWarmQueryReuseKey(optionsWith(servers), 'policy')

    expect(typeof first).toBe('string')
    expect(first).toBe(second)
    expect(first).toContain('"market-intelligence":"sdk"')
  })

  it('treats two instances of the same server kind as the same policy', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    const left = buildWarmQueryReuseKey(
      optionsWith({ 'agent-skills': { type: 'sdk', name: 'agent-skills', instance: cyclic } }),
      'policy'
    )
    const right = buildWarmQueryReuseKey(
      optionsWith({ 'agent-skills': { type: 'sdk', name: 'agent-skills', instance: {} } }),
      'policy'
    )

    expect(left).toBe(right)
  })
})
