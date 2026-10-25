import { describe, expect, it, vi } from 'vitest'

import { buildSessionProxyConfig } from '../../../../network/proxyConfig'
import { createDefaultAppSettings } from '../../../../settings/schema/appSettings'
import { normalizeSlackEnvelope } from './SlackUpdateNormalizer'
import { splitSlackText } from './SlackContracts'
import { SlackApiClient } from './SlackApiClient'
import { SlackDeliveryTransport } from './SlackDeliveryTransport'

describe('Slack Release B contracts', () => {
  it('normalizes structured mention/thread/file refs without retaining provider URLs', () => {
    const fact = normalizeSlackEnvelope({ envelope_id: 'env-1', type: 'events_api', payload: { event_id: 'event-1', event: {
      type: 'message', channel: 'C1', user: 'U1', ts: '1.2', thread_ts: '1.1', text: 'hello <@B1>', files: [{ id: 'F1', mimetype: 'image/png', url_private: 'https://secret', name: 'x.png' }]
    } } }, 'B1')
    expect(fact).toMatchObject({ eventKey: 'slack:event:event-1', conversationKey: 'slack:conversation:C1:thread:1.1', mentionedBot: true, attachments: [{ stableRef: 'slack:file:F1' }] })
    expect(JSON.stringify(fact)).not.toContain('https://secret')
  })

  it('bounds final delivery segments to Slack text limits', () => {
    expect(splitSlackText('x'.repeat(8_001)).map((value) => value.length)).toEqual([4_000, 4_000, 1])
  })

  it('normalizes direct messages, group mentions, and slash commands without retaining a provider body', () => {
    expect(normalizeSlackEnvelope({ envelope_id: 'env-direct', type: 'events_api', payload: { event_id: 'event-direct', event: {
      type: 'message', channel: 'D1', user: 'U1', channel_type: 'im', text: 'hello'
    } } }, 'B1')).toMatchObject({ conversationKind: 'direct', mentionedBot: true })
    expect(normalizeSlackEnvelope({ envelope_id: 'env-group', type: 'events_api', payload: { event_id: 'event-group', event: {
      type: 'message', channel: 'C1', user: 'U1', channel_type: 'channel', text: 'hello'
    } } }, 'B1')).toMatchObject({ conversationKind: 'channel', mentionedBot: false })
    expect(normalizeSlackEnvelope({ envelope_id: 'env-command', type: 'slash_commands', payload: {
      channel_id: 'C1', user_id: 'U1', command: '/agent', text: 'status', response_url: 'https://private.example.test'
    } as never }, 'B1')).toMatchObject({ eventKey: 'slack:command:env-command', text: '/agent status', mentionedBot: true })
  })

  it('uses injected platform fetch and maps rate-limit/provider/network outcomes without token output', async () => {
    const responses = [
      response(429, { ok: false }, '1'), response(403, { ok: false }), response(503, { ok: false })
    ]
    const fetch = async (_url: string, _init?: RequestInit) => responses.shift()!
    const client = new SlackApiClient({ getPlatformFetch: () => fetch as typeof globalThis.fetch, botToken: async () => 'xoxb-private', appToken: async () => 'xapp-private' })
    await expect(client.sendMessage({ channelId: 'C1', threadTs: null }, 'hello')).resolves.toMatchObject({ ok: false, code: 'slack-rate-limited' })
    await expect(client.sendMessage({ channelId: 'C1', threadTs: null }, 'hello')).resolves.toMatchObject({ ok: false, code: 'slack-provider-rejected' })
    await expect(client.sendMessage({ channelId: 'C1', threadTs: null }, 'hello')).resolves.toMatchObject({ ok: false, code: 'slack-network-unavailable' })
  })

  it.each(['system', 'custom', 'none'] as const)('uses the injected platform fetch after the %s proxy composition seam', async (proxyMode) => {
    const network = { ...createDefaultAppSettings().network, proxyMode, ...(proxyMode === 'custom' ? { proxyUrl: 'http://127.0.0.1:7890' } : {}) }
    const fetch = async () => response(200, { ok: true, user_id: 'B1' })
    const client = new SlackApiClient({ getPlatformFetch: () => fetch as typeof globalThis.fetch, botToken: async () => 'xoxb-private', appToken: async () => 'xapp-private' })
    await expect(client.authUser()).resolves.toEqual({ ok: true, value: 'B1' })
    expect(buildSessionProxyConfig(network).mode).toBe(proxyMode === 'custom' ? 'fixed_servers' : proxyMode === 'none' ? 'direct' : 'system')
  })

  it('treats an external Slack send as unknown after a lifecycle fence and never permits unknown retry', async () => {
    let current = true
    const controller = new AbortController()
    let resolve!: (response: Response) => void
    const client = new SlackApiClient({
      getPlatformFetch: () => (() => new Promise<Response>((next) => { resolve = next })) as unknown as typeof globalThis.fetch,
      botToken: async () => 'xoxb-private', appToken: async () => 'xapp-private'
    })
    const transport = new SlackDeliveryTransport()
    transport.setClient('slack-a', client, { isCurrent: () => current, signal: controller.signal })
    const pending = transport.send({ channelId: 'slack-a', providerConversationKey: 'slack:conversation:C1', text: 'hello', idempotencyKey: 'opaque' })
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    current = false
    resolve(response(200, { ok: true }))
    await expect(pending).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
    expect(transport.supportsIdempotency()).toBe(false)
  })

  it('decodes only Slack conversation keys and emits raw channel/thread fields to chat.postMessage', async () => {
    const bodies: unknown[] = []
    const fetch = async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return response(200, { ok: true })
    }
    const client = new SlackApiClient({ getPlatformFetch: () => fetch as typeof globalThis.fetch, botToken: async () => 'xoxb-private', appToken: async () => 'xapp-private' })
    const transport = new SlackDeliveryTransport()
    transport.setClient('slack-a', client, { isCurrent: () => true, signal: new AbortController().signal })

    await expect(transport.send({ channelId: 'slack-a', providerConversationKey: 'slack:conversation:C1', text: 'root', idempotencyKey: 'root' })).resolves.toEqual({ kind: 'delivered' })
    await expect(transport.send({ channelId: 'slack-a', providerConversationKey: 'slack:conversation:C1:thread:1.1', text: 'reply', idempotencyKey: 'thread' })).resolves.toEqual({ kind: 'delivered' })
    await expect(transport.send({ channelId: 'slack-a', providerConversationKey: 'slack:conversation:C1:thread:not-a-ts', text: 'invalid', idempotencyKey: 'invalid' })).resolves.toEqual({ kind: 'failed', code: 'delivery-provider-rejected' })

    expect(bodies).toEqual([{ channel: 'C1', text: 'root' }, { channel: 'C1', text: 'reply', thread_ts: '1.1' }])
    expect(JSON.stringify(bodies)).not.toContain('slack:conversation:')
  })
})

function response(status: number, body: unknown, retryAfter?: string): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(retryAfter ? { 'retry-after': retryAfter } : {}), json: async () => body } as Response
}
