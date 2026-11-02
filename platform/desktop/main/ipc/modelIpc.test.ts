import { describe, expect, it, vi } from 'vitest'

import type { ModelIpcPorts } from './modelIpc'

const { registerModelIpc } = await import('./modelIpc')

const EXPECTED_CHANNELS = [
  'platform:model-providers-list',
  'platform:model-providers-upsert',
  'platform:model-providers-remove',
  'platform:model-providers-set-enabled',
  'platform:model-providers-add-or-update-model',
  'platform:model-providers-remove-model',
  'platform:model-providers-set-default-chat-model',
  'platform:model-providers-test-connection',
  'platform:model-providers-generate-image',
  'platform:model-providers-detect-models',
  'platform:model-providers-cancel-model-detection',
  'platform:model-providers-run-runtime-checks',
  'platform:model-providers-get-runtime-check-report',
  'platform:model-providers-get-in-use-retired',
  'platform:model-providers-preview-model-sync',
  'platform:model-providers-apply-model-sync',
  'platform:model-providers-set-custom-headers',
  'platform:model-providers-reveal-custom-headers',
  'platform:model-providers-reveal-api-key'
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

function ports(overrides: Record<string, unknown> = {}) {
  const providerStore = {
    list: vi.fn(async () => [{ id: 'provider-1' }]),
    upsert: vi.fn(async () => ({ id: 'provider-1' })),
    remove: vi.fn(async () => true),
    setEnabled: vi.fn(async () => true),
    addOrUpdateModel: vi.fn(async () => true),
    removeModel: vi.fn(async () => true),
    setDefaultChatModel: vi.fn(async () => true),
    resolveRuntimeProvider: vi.fn(async () => null),
    applyModelSync: vi.fn(async () => ({})),
    setCustomHeaders: vi.fn(async () => ({ id: 'provider-1' })),
    revealCustomHeaders: vi.fn(async () => []),
    revealApiKey: vi.fn(async () => 'key-1'),
    recordProbedProtocols: vi.fn(async () => undefined),
    recordModelAvailability: vi.fn(async () => undefined)
  }
  const base = {
    providerStore: providerStore as never,
    getPlatformFetch: () => (async () => ({ ok: true })) as unknown as typeof fetch,
    getMainWindow: () => null,
    invalidateModelCompatibilityCache: vi.fn(),
    agentRuntimeProbeSnapshotStore: { invalidateProvider: vi.fn(async () => undefined) } as never,
    syncInUseModelPatrolScheduleFromState: vi.fn(),
    inUseModelPatrol: { getRetired: vi.fn(async () => ['retired-1']) } as never,
    providerRuntimeCheckService: {
      runChecks: vi.fn(async () => ({ ok: true })),
      getReport: vi.fn(async () => ({ ok: true }))
    } as never,
    assistantImageMessages: {} as never,
    generatedImageStorage: {} as never,
    ...overrides
  } as unknown as ModelIpcPorts
  return { providerStore, ports: base }
}

function listenersOf(given: ModelIpcPorts) {
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  registerModelIpc(
    { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
    given
  )
  return listeners
}

describe('model ipc surface', () => {
  it('registers exactly the nineteen model channels, in order', () => {
    const { channels, ipcMain } = record()
    registerModelIpc(ipcMain as never, ports().ports)

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('keeps the snapshot in step with the module source', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./modelIpc.ts', import.meta.url), 'utf8')
    const referenced = [...source.matchAll(/IpcChannels\.(modelProviders\w+)/gu)].map((match) => match[1])

    const { IpcChannels } = await import('../../ipc/channels')
    const names = [...new Set(referenced)].map((key) => (IpcChannels as Record<string, string>)[key])

    // 两个事件通道（progress/done）也在本模块里推送，但不注册 handler。
    expect(names.sort()).toEqual(
      [...EXPECTED_CHANNELS, 'platform:model-providers-detection-progress', 'platform:model-providers-detection-done'].sort()
    )
  })

  it('upserts through the store and invalidates both the compatibility cache and the probe snapshot', async () => {
    const { providerStore, ports: p } = ports()
    registerModelIpc({ handle: () => undefined } as never, p)
    const listeners = listenersOf(p)

    await listeners.get('platform:model-providers-upsert')!({}, { id: 'provider-1' })

    expect(providerStore.upsert).toHaveBeenCalledOnce()
    expect((p.invalidateModelCompatibilityCache as unknown as { mock: { calls: unknown[][] } }).mock.calls).toEqual([
      ['provider-1']
    ])
    expect((p.agentRuntimeProbeSnapshotStore as unknown as { invalidateProvider: { mock: { calls: unknown[][] } } })
      .invalidateProvider.mock.calls).toEqual([['provider-1']])
    expect(p.syncInUseModelPatrolScheduleFromState).toHaveBeenCalledOnce()
  })

  it('refuses to reveal a key for a provider that is not in the list', async () => {
    const { providerStore, ports: p } = ports()
    const listeners = listenersOf(p)

    await expect(listeners.get('platform:model-providers-reveal-api-key')!({}, 'provider-unknown')).rejects.toThrow(
      /was not found/
    )
    expect(providerStore.revealApiKey).not.toHaveBeenCalled()
  })
})
