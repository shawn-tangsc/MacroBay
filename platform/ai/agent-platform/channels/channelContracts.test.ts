import { describe, expect, it, vi } from 'vitest'

import { agentChannelTypes } from '../schemas/channelSchemas'
import {
  dispatchChannelInboundDelivery,
  channelInboundDispositionRequiresAcknowledgement,
  type ChannelAdapterAcceptanceEntry,
  type ChannelCapabilities,
  type ChannelInboundDelivery,
  type ChannelRuntimeHost,
  type ChannelTransportDependencies
} from './channelContracts'
import {
  ChannelAdapterAcceptanceRegistry,
  createInitialChannelAdapterAcceptanceEntries
} from './ChannelAdapterAcceptanceRegistry'

const allCapabilitiesDisabled: ChannelCapabilities = {
  receiveText: false,
  receiveImages: false,
  receiveFiles: false,
  sendText: false,
  streaming: false,
  typingIndicator: false,
  nativeCommands: false,
  groupMention: false,
  qrEnrollment: false,
  reconnect: false
}

function createSupportedEntry(
  overrides: Partial<ChannelAdapterAcceptanceEntry> = {}
): ChannelAdapterAcceptanceEntry {
  return {
    adapterType: 'telegram',
    adapterVersion: '1.0.0',
    status: 'supported',
    capabilities: {
      ...allCapabilitiesDisabled,
      receiveText: true,
      sendText: true,
      streaming: true,
      reconnect: true
    },
    receiveSmokeAt: '2026-07-17T00:00:00.000Z',
    sendSmokeAt: '2026-07-17T00:00:00.000Z',
    reconnectSmokeAt: '2026-07-17T00:00:00.000Z',
    restartRecoveryAt: '2026-07-17T00:00:00.000Z',
    proxySmokeAt: '2026-07-17T00:00:00.000Z',
    credentialRotationAt: '2026-07-17T00:00:00.000Z',
    disableDeleteFencingAt: '2026-07-17T00:00:00.000Z',
    capabilityEvidence: {
      streaming: 'telegram-streaming-smoke-2026-07-17'
    },
    ...overrides
  }
}

describe('ChannelAdapterAcceptanceRegistry', () => {
  it('starts all six adapters below supported until their production evidence is recorded', () => {
    const registry = new ChannelAdapterAcceptanceRegistry()

    expect(registry.list().map((entry) => entry.adapterType)).toEqual([...agentChannelTypes])
    expect(registry.getRequired('telegram').status).toBe('planned')
    expect(registry.getRequired('slack').status).toBe('blocked')
    expect(registry.list().every((entry) => registry.canEnable(entry.adapterType) === false)).toBe(true)
  })

  it('rejects a supported status when a declared optional capability lacks evidence', () => {
    const registry = new ChannelAdapterAcceptanceRegistry()
    const incomplete = createSupportedEntry({ capabilityEvidence: {} })

    expect(() => registry.upsert(incomplete)).toThrow(
      'Channel adapter "telegram" cannot be marked supported without streaming evidence.'
    )
  })

  it('rejects a supported status when a required text or reconnect capability is disabled', () => {
    const registry = new ChannelAdapterAcceptanceRegistry()

    expect(() =>
      registry.upsert(
        createSupportedEntry({
          capabilities: {
            ...createSupportedEntry().capabilities,
            receiveText: false
          }
        })
      )
    ).toThrow('Channel adapter "telegram" cannot be marked supported without receiveText capability.')
  })

  it('enables an adapter only after all core and declared capability evidence is present', () => {
    const registry = new ChannelAdapterAcceptanceRegistry()

    registry.upsert(createSupportedEntry())

    expect(registry.canEnable('telegram')).toBe(true)
    expect(registry.getRequired('telegram')).toEqual(createSupportedEntry())
  })
})

describe('Channel inbound contract', () => {
  it('acknowledges only after a terminal listener disposition', async () => {
    for (const disposition of ['acknowledged', 'duplicate', 'ignored', 'retry'] as const) {
      const acknowledge = vi.fn(async () => {})
      const result = await dispatchChannelInboundDelivery(
        {
          event: {
            providerEventId: 'provider-event-1',
            providerMessageId: 'provider-message-1',
            conversationKey: 'provider-conversation-1',
            conversationKind: 'group',
            userKey: 'provider-user-1',
            text: 'hello',
            attachments: [{
              kind: 'file',
              providerAttachmentId: 'provider-file-1',
              mimeType: 'text/plain'
            }],
            mention: { mentionedBot: true, source: 'provider' }
          },
          acknowledge
        },
        async (event) => {
          expect(event.mention).toEqual({ mentionedBot: true, source: 'provider' })
          expect(event.attachments).toEqual([expect.objectContaining({ providerAttachmentId: 'provider-file-1' })])
          return disposition
        }
      )

      expect(result).toBe(disposition)
      expect(acknowledge).toHaveBeenCalledTimes(disposition === 'retry' ? 0 : 1)
    }
  })

  it('waits for durable listener completion before acknowledging the provider event', async () => {
    const acknowledge = vi.fn(async () => {})
    let completeListener: (disposition: 'acknowledged') => void = () => {
      throw new Error('Expected the inbound listener to register its completion callback.')
    }
    const dispatched = dispatchChannelInboundDelivery(
      {
        event: {
          providerEventId: 'provider-event-1',
          conversationKey: 'provider-conversation-1',
          conversationKind: 'direct',
          userKey: 'provider-user-1'
        },
        acknowledge
      },
      () => new Promise<'acknowledged'>((resolve) => {
        completeListener = resolve
      })
    )

    expect(acknowledge).not.toHaveBeenCalled()
    completeListener('acknowledged')

    await expect(dispatched).resolves.toBe('acknowledged')
    expect(acknowledge).toHaveBeenCalledOnce()
  })

  it('does not acknowledge when durable inbound handling rejects and leaves the provider event retryable', async () => {
    const acknowledge = vi.fn(async () => {})

    await expect(
      dispatchChannelInboundDelivery(
        {
          event: {
            providerEventId: 'provider-event-1',
            conversationKey: 'provider-conversation-1',
            conversationKind: 'direct',
            userKey: 'provider-user-1'
          },
          acknowledge
        },
        async () => {
          throw new Error('receipt write failed')
        }
      )
    ).rejects.toThrow('receipt write failed')

    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('strips adapter-supplied routing fields before the platform listener processes provider facts', async () => {
    const acknowledge = vi.fn(async () => {})
    const providerEvent = {
      providerEventId: 'provider-event-1',
      conversationKey: 'provider-conversation-1',
      conversationKind: 'direct' as const,
      userKey: 'provider-user-1',
      text: 'hello',
      agentId: 'foreign-agent',
      sessionId: 'foreign-session',
      workspaceId: 'foreign-workspace',
      allowPolicy: { mode: 'allow-all' },
      deliveryTarget: 'foreign-target',
      isActive: true
    }

    await dispatchChannelInboundDelivery(
      { event: providerEvent, acknowledge },
      async (event) => {
        for (const forbiddenField of [
          'agentId',
          'sessionId',
          'workspace',
          'workspaceId',
          'policy',
          'allowPolicy',
          'deliveryTarget',
          'isActive'
        ]) {
          expect(event).not.toHaveProperty(forbiddenField)
        }
        return 'acknowledged'
      }
    )

    expect(acknowledge).toHaveBeenCalledOnce()
  })

  it('acknowledges duplicates and ignored missing-mention groups without dispatching Agent work', async () => {
    const duplicateAcknowledge = vi.fn(async () => {})
    const ignoredAcknowledge = vi.fn(async () => {})
    const dispatchAgentWork = vi.fn(async (_event: ChannelInboundDelivery['event']) => {})

    const process = async (event: ChannelInboundDelivery['event']) => {
      if (event.providerEventId === 'duplicate-event') return 'duplicate' as const
      if (event.conversationKind === 'group' && !event.mention?.mentionedBot) return 'ignored' as const
      await dispatchAgentWork(event)
      return 'acknowledged' as const
    }

    await dispatchChannelInboundDelivery({
      event: {
        providerEventId: 'duplicate-event',
        conversationKey: 'provider-conversation-1',
        conversationKind: 'direct',
        userKey: 'provider-user-1'
      },
      acknowledge: duplicateAcknowledge
    }, process)
    await dispatchChannelInboundDelivery({
      event: {
        providerEventId: 'group-without-mention',
        conversationKey: 'provider-conversation-2',
        conversationKind: 'group',
        userKey: 'provider-user-2',
        mention: { mentionedBot: false, source: 'provider' }
      },
      acknowledge: ignoredAcknowledge
    }, process)

    expect(duplicateAcknowledge).toHaveBeenCalledOnce()
    expect(ignoredAcknowledge).toHaveBeenCalledOnce()
    expect(dispatchAgentWork).not.toHaveBeenCalled()
  })

  it('returns retry without acknowledgement when attachment work cannot persist', async () => {
    const acknowledge = vi.fn(async () => {})

    const disposition = await dispatchChannelInboundDelivery({
      event: {
        providerEventId: 'attachment-event',
        conversationKey: 'provider-conversation-1',
        conversationKind: 'direct',
        userKey: 'provider-user-1',
        attachments: [{
          kind: 'image',
          providerAttachmentId: 'provider-image-1',
          mimeType: 'image/png'
        }]
      },
      acknowledge
    }, async (event) => {
      expect(event.attachments).toEqual([expect.objectContaining({ providerAttachmentId: 'provider-image-1' })])
      return 'retry'
    })

    expect(disposition).toBe('retry')
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('requires a host to receive normalized provider facts through a delayed-ack listener', async () => {
    const registeredListeners: Array<
      (event: ChannelInboundDelivery['event']) => Promise<'acknowledged' | 'duplicate' | 'ignored' | 'retry'>
    > = []
    const host: ChannelRuntimeHost = {
      connect: vi.fn(async (_signal) => {}),
      close: vi.fn(async (_reason) => {}),
      subscribeToIncoming(nextListener) {
        registeredListeners.push(nextListener)
        return () => {
          registeredListeners.length = 0
        }
      },
      sendMessage: vi.fn(async (_chatId, _text) => {}),
      subscribeToRuntimeStatus: () => () => {}
    }
    const unsubscribe = host.subscribeToIncoming(async () => 'ignored')

    const activeListener = registeredListeners[0]
    if (!activeListener) throw new Error('Expected an inbound listener to be registered.')
    await expect(
      activeListener!({
        providerEventId: 'event-1',
        conversationKey: 'chat-1',
        conversationKind: 'direct',
        userKey: 'user-1',
        text: 'hello'
      })
    ).resolves.toBe('ignored')

    unsubscribe()
    expect(registeredListeners).toEqual([])
  })

  it('keeps streaming optional and scoped to the provider conversation key', async () => {
    const updates: string[] = []
    const host: ChannelRuntimeHost = {
      connect: vi.fn(async (_signal) => {}),
      close: vi.fn(async (_reason) => {}),
      subscribeToIncoming: () => () => {},
      sendMessage: vi.fn(async (_conversationKey, _text) => {}),
      onStreamUpdate: async (conversationKey, fullText) => {
        updates.push(`${conversationKey}:${fullText}`)
      },
      onStreamComplete: async (conversationKey, fullText) => {
        updates.push(`${conversationKey}:${fullText}`)
        return true
      },
      subscribeToRuntimeStatus: () => () => {}
    }

    await host.onStreamUpdate?.('provider-conversation-1', 'partial provider-safe text')
    await expect(host.onStreamComplete?.('provider-conversation-1', 'final provider-safe text')).resolves.toBe(true)

    expect(updates).toEqual([
      'provider-conversation-1:partial provider-safe text',
      'provider-conversation-1:final provider-safe text'
    ])
  })
})

describe('Channel transport contract', () => {
  it('requires explicit platform HTTP, WebSocket, and proxy-mode dependencies', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const createPlatformWebSocket = class {} as unknown as ChannelTransportDependencies['createPlatformWebSocket']
    const transport: ChannelTransportDependencies = {
      getPlatformFetch: () => fetchImpl,
      createPlatformWebSocket,
      proxyMode: 'custom'
    }

    expect(transport.getPlatformFetch()).toBe(fetchImpl)
    expect(transport.createPlatformWebSocket).toBe(createPlatformWebSocket)
    expect(transport.proxyMode).toBe('custom')
  })
})
