import { describe, expect, it, vi } from 'vitest'

import type { AgentChannelEntity } from '../schemas/channelSchemas'
import { createAgentStoreState } from '../store/agentStore'
import { ChannelRuntimeService } from './ChannelRuntimeService'
import type { AgentChannelRuntimeHost, AgentChannelRuntimeStatusUpdate } from './channelRuntimeHost'

const createdAt = '2026-01-01T00:00:00.000Z'

function createChannel(overrides: Partial<AgentChannelEntity> = {}): AgentChannelEntity {
  return {
    id: 'channel-1',
    type: 'telegram',
    name: 'Telegram',
    agentId: 'agent-1',
    sessionId: 'session-1',
    workspace: { type: 'system' },
    config: { bot_token: 'token' },
    isActive: true,
    activeChatIds: ['chat-1'],
    permissionMode: 'default',
    createdAt,
    updatedAt: createdAt,
    ...overrides
  } as AgentChannelEntity
}

describe('ChannelRuntimeService', () => {
  it('connects active channels and reports connected/inactive runtime snapshot state', async () => {
    const activeHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const createChannelHost = vi.fn(async () => activeHost)
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost
    })

    const snapshot = await runtime.syncFromState(
      createAgentStoreState({
        channels: [
          createChannel({ id: 'channel-active' }),
          createChannel({ id: 'channel-inactive', isActive: false, activeChatIds: [], sessionId: null })
        ]
      })
    )

    expect(createChannelHost).toHaveBeenCalledTimes(1)
    expect(activeHost.connect).toHaveBeenCalledTimes(1)
    expect(snapshot.channels).toEqual([
      {
        channelId: 'channel-active',
        type: 'telegram',
        agentId: 'agent-1',
        sessionId: 'session-1',
        isActive: true,
        activeChatCount: 1,
        runtimeState: 'connected',
        updatedAt: 100
      },
      {
        channelId: 'channel-inactive',
        type: 'telegram',
        agentId: 'agent-1',
        sessionId: null,
        isActive: false,
        activeChatCount: 0,
        runtimeState: 'inactive',
        updatedAt: 100
      }
    ])
  })

  it('reuses an existing active host when the channel signature has not changed', async () => {
    const host: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const createChannelHost = vi.fn(async () => host)
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost
    })
    const state = createAgentStoreState({
      channels: [createChannel()]
    })

    await runtime.syncFromState(state)
    await runtime.syncFromState(state)

    expect(createChannelHost).toHaveBeenCalledTimes(1)
    expect(host.connect).toHaveBeenCalledTimes(1)
    expect(host.close).not.toHaveBeenCalled()
  })

  it('emits diagnostics snapshots when runtime status changes', async () => {
    let runtimeStatusListener: (status: AgentChannelRuntimeStatusUpdate) => void = () => {
      throw new Error('Expected runtime status listener to be registered.')
    }
    const host: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      subscribeToRuntimeStatus: (listener) => {
        runtimeStatusListener = listener
        return () => {
          runtimeStatusListener = () => {
            throw new Error('Expected runtime status listener to be registered.')
          }
        }
      }
    }
    const onSnapshotChanged = vi.fn()
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost: vi.fn(async () => host),
      onSnapshotChanged
    })

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel()]
      })
    )
    runtimeStatusListener({
      runtimeState: 'connecting',
      lifecycleState: 'awaiting-qr-scan',
      credentialState: 'required',
      credentialHint: 'Scan the code.',
      lastCheckedAt: 150
    })

    expect(onSnapshotChanged).toHaveBeenCalled()
    expect(onSnapshotChanged).toHaveBeenLastCalledWith({
      channels: [
        {
          channelId: 'channel-1',
          type: 'telegram',
          agentId: 'agent-1',
          sessionId: 'session-1',
          isActive: true,
          activeChatCount: 1,
          runtimeState: 'connecting',
          runtimeLifecycleState: 'awaiting-qr-scan',
          credentialState: 'required',
          credentialHint: 'Scan the code.',
          lastCheckedAt: 150,
          updatedAt: 100
        }
      ]
    })
  })

  it('rebuilds changed hosts and closes hosts for deactivated or removed channels', async () => {
    const firstHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const secondHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const createChannelHost = vi
      .fn<() => Promise<AgentChannelRuntimeHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost
    })

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel({ config: { bot_token: 'token-a' } })]
      })
    )

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel({ config: { bot_token: 'token-b' } })]
      })
    )

    expect(firstHost.close).toHaveBeenCalledTimes(1)
    expect(secondHost.connect).toHaveBeenCalledTimes(1)

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel({ isActive: false })]
      })
    )

    expect(secondHost.close).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().channels).toEqual([
      expect.objectContaining({
        channelId: 'channel-1',
        runtimeState: 'inactive',
        isActive: false
      })
    ])

    await runtime.syncFromState(createAgentStoreState({ channels: [] }))
    expect(runtime.getSnapshot().channels).toEqual([])
  })

  it('captures host creation or connect failures as runtime errors without throwing and retries on the next sync', async () => {
    const successfulHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const createChannelHost = vi
      .fn<() => Promise<AgentChannelRuntimeHost>>()
      .mockRejectedValueOnce(new Error('adapter missing'))
      .mockResolvedValueOnce(successfulHost)
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost
    })
    const state = createAgentStoreState({
      channels: [createChannel()]
    })

    const failedSnapshot = await runtime.syncFromState(state)
    expect(failedSnapshot.channels).toEqual([
      expect.objectContaining({
        channelId: 'channel-1',
        runtimeState: 'error',
        runtimeMessage: 'adapter missing'
      })
    ])

    const recoveredSnapshot = await runtime.syncFromState(state)
    expect(recoveredSnapshot.channels).toEqual([
      expect.objectContaining({
        channelId: 'channel-1',
        runtimeState: 'connected'
      })
    ])
  })

  it('closes every active host during dispose', async () => {
    const firstHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const secondHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const createChannelHost = vi
      .fn<() => Promise<AgentChannelRuntimeHost>>()
      .mockResolvedValueOnce(firstHost)
      .mockResolvedValueOnce(secondHost)
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost
    })

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel({ id: 'channel-1' }), createChannel({ id: 'channel-2', sessionId: 'session-2' })]
      })
    )

    await runtime.dispose()

    expect(firstHost.close).toHaveBeenCalledTimes(1)
    expect(secondHost.close).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().channels).toEqual([])
  })

  it('passes the incoming-text handler context through to the host factory', async () => {
    const host: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const handleIncomingText = vi.fn(async () => {})
    const createChannelHost = vi.fn(async () => host)
    const runtime = new ChannelRuntimeService({
      createChannelHost,
      handleIncomingText
    })

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel()]
      })
    )

    expect(createChannelHost).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'channel-1' }),
      expect.objectContaining({
        handleIncomingText
      })
    )
  })

  it('projects host runtime status updates into channel diagnostic snapshots', async () => {
    let emitRuntimeStatus: (status: {
      lifecycleState: 'awaiting-qr-scan'
      credentialState: 'required'
      credentialHint: string
      credentialUrl: string
      credentialQrText: string
      credentialExpiresAt: number
      sessionState: 'reconnecting'
      message: string
      retryable: true
    }) => void = () => {
      throw new Error('Expected runtime status listener to be registered.')
    }
    const unsubscribe = vi.fn()
    const host: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      subscribeToRuntimeStatus: (listener) => {
        emitRuntimeStatus = listener
        return unsubscribe
      }
    }
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost: vi.fn(async () => host)
    })

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel()]
      })
    )

    emitRuntimeStatus({
      lifecycleState: 'awaiting-qr-scan',
      credentialState: 'required',
      credentialHint: 'Scan the QR code from your phone.',
      credentialUrl: 'https://example.com/qr',
      credentialQrText: 'otpauth://channel-qr',
      credentialExpiresAt: 456,
      sessionState: 'reconnecting',
      message: 'Waiting for QR confirmation.',
      retryable: true
    })

    expect(runtime.getSnapshot({ includeDiagnostics: true }).channels).toEqual([
      {
        channelId: 'channel-1',
        type: 'telegram',
        agentId: 'agent-1',
        sessionId: 'session-1',
        isActive: true,
        activeChatCount: 1,
        runtimeState: 'connecting',
        runtimeMessage: 'Waiting for QR confirmation.',
        runtimeRetryable: true,
        runtimeLifecycleState: 'awaiting-qr-scan',
        credentialState: 'required',
        credentialHint: 'Scan the QR code from your phone.',
        credentialUrl: 'https://example.com/qr',
        credentialQrText: 'otpauth://channel-qr',
        credentialExpiresAt: 456,
        sessionState: 'reconnecting',
        lastCheckedAt: 100,
        updatedAt: 100
      }
    ])

    await runtime.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('persists host-provided channel config updates and reconnects with the refreshed config', async () => {
    let emitRuntimeStatus: (status: {
      nextConfig: AgentChannelEntity['config']
      requestReconnect: true
      lifecycleState: 'reconnecting'
      message: string
      retryable: true
    }) => void = () => {
      throw new Error('Expected runtime status listener to be registered.')
    }
    const firstHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      subscribeToRuntimeStatus: (listener) => {
        emitRuntimeStatus = listener
        return () => {}
      }
    }
    const secondHost: AgentChannelRuntimeHost = {
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }
    const createChannelHost = vi
      .fn()
      .mockImplementationOnce(async (channel: AgentChannelEntity) => {
        expect(channel.config).toEqual({ bot_token: 'token' })
        return firstHost
      })
      .mockImplementationOnce(async (channel: AgentChannelEntity) => {
        expect(channel.config).toEqual({ bot_token: 'token-refreshed' })
        return secondHost
      })
    const persistChannelConfig = vi.fn(async () => {})
    const runtime = new ChannelRuntimeService({
      now: () => 100,
      createChannelHost,
      persistChannelConfig
    })

    await runtime.syncFromState(
      createAgentStoreState({
        channels: [createChannel()]
      })
    )

    emitRuntimeStatus({
      nextConfig: { bot_token: 'token-refreshed' },
      requestReconnect: true,
      lifecycleState: 'reconnecting',
      message: 'Refreshing channel credentials.',
      retryable: true
    })

    await vi.waitFor(() => {
      expect(createChannelHost).toHaveBeenCalledTimes(2)
    })

    expect(persistChannelConfig).toHaveBeenCalledWith('channel-1', {
      bot_token: 'token-refreshed'
    })
    expect(firstHost.close).toHaveBeenCalledTimes(1)
    expect(secondHost.connect).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot({ includeDiagnostics: true }).channels).toEqual([
      expect.objectContaining({
        channelId: 'channel-1',
        runtimeState: 'connected'
      })
    ])
  })
})
