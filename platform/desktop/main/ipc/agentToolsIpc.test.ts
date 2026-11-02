import { describe, expect, it, vi } from 'vitest'

import type { AgentToolsIpcPorts } from './agentToolsIpc'

const { registerAgentToolsIpc } = await import('./agentToolsIpc')

const EXPECTED_CHANNELS = [
  'platform:agents-refresh-mcp-tools',
  'platform:agents-skills-list',
  'platform:agents-skills-get-runtime',
  'platform:agents-list-product-tool-packages',
  'platform:agents-update-product-tool-package-binding',
  'platform:agents-list-product-tool-call-trace-page',
  'platform:agents-get-product-tool-call-trace',
  'platform:agents-skills-search',
  'platform:agents-skills-install',
  'platform:agents-skills-install-from-zip',
  'platform:agents-skills-install-from-directory',
  'platform:agents-skills-uninstall',
  'platform:agents-skills-toggle',
  'platform:agents-skills-read-file',
  'platform:agents-skills-list-files',
  'platform:agents-skills-list-local'
]

function record(): { channels: string[]; ipcMain: { handle: (channel: string, listener: unknown) => void } } {
  const channels: string[] = []
  return {
    channels,
    ipcMain: {
      handle: (channel: string) => {
        if (channels.includes(channel)) throw new Error(`duplicate channel: ${channel}`)
        channels.push(channel)
      }
    }
  }
}

function ports(overrides: Partial<AgentToolsIpcPorts> = {}) {
  const handlers = new Proxy(
    {},
    { get: (_target, key) => async (...args: unknown[]) => ({ method: String(key), args }) }
  ) as never
  const skillService = {
    list: vi.fn(async () => []),
    search: vi.fn(async () => []),
    install: vi.fn(async (_state: unknown, options: unknown) => ({ skill: { id: 'skill-1' }, state: { next: true }, options })),
    installFromZip: vi.fn(async () => ({ skill: { id: 'skill-2' }, state: { next: true } })),
    installFromDirectory: vi.fn(async () => ({ skill: { id: 'skill-3' }, state: { next: true } })),
    uninstall: vi.fn(async () => ({ next: true })),
    toggle: vi.fn(async () => ({ skill: { id: 'skill-1' }, state: { next: true } })),
    readFile: vi.fn(async () => 'content'),
    listFiles: vi.fn(async () => ['SKILL.md']),
    listLocal: vi.fn(async () => [])
  }
  const base = {
    agentIpcHandlers: handlers,
    getState: vi.fn(async () => ({ marker: 'state' })),
    skillService: skillService as never,
    skillSearchService: { search: vi.fn(async () => ['hit']) } as never,
    refreshMcpTools: vi.fn(async () => ({ refreshed: true })),
    replaceStateAfterSkillMutation: vi.fn(async () => undefined),
    ...overrides
  } as unknown as AgentToolsIpcPorts
  return { ports: base, skillService }
}

function listenersOf(given: AgentToolsIpcPorts) {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  registerAgentToolsIpc(
    { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
    given
  )
  return listeners
}

describe('agent tools ipc surface', () => {
  it('registers exactly the sixteen tools/skills channels, in order', () => {
    const { channels, ipcMain } = record()
    registerAgentToolsIpc(ipcMain as never, ports().ports)

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('keeps the snapshot in step with the module source', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./agentToolsIpc.ts', import.meta.url), 'utf8')
    const referenced = [...source.matchAll(/IpcChannels\.(agents\w+)/gu)].map((match) => match[1])

    const { IpcChannels } = await import('../../ipc/channels')
    const names = [...new Set(referenced)].map((key) => (IpcChannels as Record<string, string>)[key])
    expect(names.sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('replays the agent state after a skill install, so panels and schedulers follow', async () => {
    const { ports: p, skillService } = ports()
    const listeners = listenersOf(p)

    const installed = await listeners.get('platform:agents-skills-install')!({}, { sourcePath: '/tmp/skill' })

    expect(installed).toEqual({ id: 'skill-1' })
    expect(skillService.install).toHaveBeenCalledOnce()
    expect(p.replaceStateAfterSkillMutation).toHaveBeenCalledWith({ marker: 'state' }, { next: true })
  })

  it('delegates the MCP refresh without touching the runtime service itself', async () => {
    const { ports: p } = ports()
    const listeners = listenersOf(p)

    await listeners.get('platform:agents-refresh-mcp-tools')!({}, 'server-1')

    expect(p.refreshMcpTools).toHaveBeenCalledWith('server-1')
  })
})
