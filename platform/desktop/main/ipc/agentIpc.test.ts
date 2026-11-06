import { describe, expect, it, vi } from 'vitest'

import type { AgentIpcPorts } from './agentIpc'

const { registerAgentIpc } = await import('./agentIpc')

const EXPECTED_CHANNELS = [
  'platform:agents-get-state',
  'platform:agents-get-runtime-compatibility',
  'platform:agents-probe-runtime-compatibility',
  'platform:agents-get-model-gateway-status',
  'platform:agents-start-model-gateway',
  'platform:agents-stop-model-gateway',
  'platform:agents-set-model-gateway-enabled',
  'platform:agents-execute-runtime-command',
  'platform:agents-get-runtime-snapshot',
  'platform:agents-get-channel-runtime-snapshot',
  'platform:agents-restart-channel-runtime',
  'platform:agents-list-tool-approvals',
  'platform:agents-resolve-tool-approval',
  'platform:agents-list-agents',
  'platform:agents-create-agent',
  // 频道设置页「选择文件夹…」：路径 → 工作区编号（没有就先登记一条）。
  'platform:agents-ensure-workspace',
  'platform:agents-list-sessions',
  'platform:agents-list-session-messages',
  'platform:agents-create-session',
  'platform:agents-update-agent',
  'platform:agents-delete-agent',
  'platform:agents-reorder-agents',
  'platform:agents-select-agent',
  'platform:agents-update-session',
  'platform:agents-delete-sessions',
  'platform:agents-reorder-sessions',
  'platform:agents-set-session-agent',
  'platform:agents-set-session-workspace',
  'platform:agents-set-session-workspace-by-path',
  'platform:agents-switch-session-pin-state',
  'platform:agents-select-session',
  'platform:agents-clear-session-messages',
  'platform:agents-delete-session-message',
  'platform:agents-replace-state',
  'platform:agents-send-message',
  'platform:agents-cancel-message',
  'platform:agents-cancel-session'
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

function ports(overrides: Partial<AgentIpcPorts> = {}) {
  const handlers = new Proxy(
    {},
    { get: (_target, key) => async (...args: unknown[]) => ({ method: String(key), args }) }
  ) as never
  const base = {
    agentIpcHandlers: handlers,
    getState: vi.fn(async () => ({ marker: 'state' })),
    syncAfterMutation: vi.fn(async () => undefined),
    broadcastStateChanged: vi.fn(),
    replaceState: vi.fn(async (state: unknown) => state),
    cancelMessage: vi.fn(async () => undefined),
    ...overrides
  } as unknown as AgentIpcPorts
  return base
}

function listenersOf(given: AgentIpcPorts) {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  registerAgentIpc(
    { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
    given
  )
  return listeners
}

describe('agent ipc surface', () => {
  it('registers exactly the thirty-seven session/runtime channels, in order', () => {
    const { channels, ipcMain } = record()
    registerAgentIpc(ipcMain as never, ports())

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('keeps the snapshot in step with the module source', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./agentIpc.ts', import.meta.url), 'utf8')
    const referenced = [...source.matchAll(/IpcChannels\.(agents\w+)/gu)].map((match) => match[1])

    const { IpcChannels } = await import('../../ipc/channels')
    const names = [...new Set(referenced)].map((key) => (IpcChannels as Record<string, string>)[key])
    expect(names.sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('broadcasts state through the port instead of reaching for the window', async () => {
    const p = ports()
    const listeners = listenersOf(p)

    await listeners.get('platform:agents-select-agent')!({}, 'agent-1')

    expect(p.broadcastStateChanged).toHaveBeenCalledOnce()
    // 会话写入走同步器，不是直接广播旧状态。
    expect(p.syncAfterMutation).not.toHaveBeenCalled()
  })

  it('syncs after a state mutation so schedulers and panels follow the new state', async () => {
    const p = ports({
      agentIpcHandlers: new Proxy(
        {},
        {
          get: (_target, key) =>
            async (...args: unknown[]) =>
              key === 'createAgent' ? { id: 'agent-1' } : { method: String(key), args }
        }
      ) as never
    })
    const listeners = listenersOf(p)

    await listeners.get('platform:agents-create-agent')!({}, { name: 'new' })

    expect(p.getState).toHaveBeenCalledOnce()
    expect(p.syncAfterMutation).toHaveBeenCalledWith({ marker: 'state' })
  })

  it('cancels a run through the runtime port', async () => {
    const p = ports()
    const listeners = listenersOf(p)

    await listeners.get('platform:agents-cancel-message')!({}, 'run-1')

    expect(p.cancelMessage).toHaveBeenCalledWith('run-1')
  })
})
