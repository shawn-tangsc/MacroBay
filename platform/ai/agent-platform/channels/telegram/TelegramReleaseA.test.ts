import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { buildSessionProxyConfig } from '../../../../network/proxyConfig'
import { createDefaultAppSettings } from '../../../../settings/schema/appSettings'
import { splitTelegramText, stableTelegramAttachment } from './TelegramContracts'
import { TelegramApiClient } from './TelegramApiClient'
import { TelegramDeliveryTransport } from './TelegramDeliveryTransport'
import { seedChannelAdapterSupport } from '../channelTestSupport'
import { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramPollingHost } from './TelegramPollingHost'
import { normalizeTelegramUpdate } from './TelegramUpdateNormalizer'

describe('Telegram Release A contracts', () => {
  it('normalizes text, bounded attachment references and structured group mentions without paths', () => {
    const normalized = normalizeTelegramUpdate({ update_id: 8, message: { message_id: 9, chat: { id: -100, type: 'supergroup' }, from: { id: 4 }, text: '@relay hello', entities: [{ type: 'mention', offset: 0, length: 6 }], photo: [{ file_id: 'photo-ref', file_size: 4 }] } }, 'relay')
    expect(normalized).toMatchObject({ eventKey: 'telegram:update:8', conversationKind: 'group', mentionedBot: true, attachments: [{ stableRef: 'telegram:file:photo-ref' }] })
    expect(JSON.stringify(normalized)).not.toMatch(/token|path|file_path/i)
    expect(stableTelegramAttachment({ kind: 'file', fileId: 'x', size: -1 })).toBeNull()
  })

  it('uses UTF-16-safe 4096 unit segmentation', () => {
    const text = `${'x'.repeat(4095)}😀tail`
    const parts = splitTelegramText(text)
    expect(parts).toHaveLength(2)
    expect(parts.every((part) => part.length <= 4096)).toBe(true)
    expect(parts.join('')).toBe(text)
  })

  it('uses injected platform fetch and classifies 429, 409, 5xx and network failures', async () => {
    const signal = new AbortController().signal
    for (const [status, expected] of [[429, 'telegram-rate-limited'], [409, 'telegram-conflict'], [502, 'telegram-network-unavailable']] as const) {
      const fetch = vi.fn(async () => response(status, { ok: false, parameters: { retry_after: 3 } })) as unknown as typeof globalThis.fetch
      const client = new TelegramApiClient({ getPlatformFetch: () => fetch, token: async () => 'private-token' })
      await expect(client.updates(4, signal)).resolves.toMatchObject({ ok: false, code: expected })
      expect(fetch).toHaveBeenCalledOnce()
    }
    const client = new TelegramApiClient({ getPlatformFetch: () => { throw new Error('network') }, token: async () => 'private-token' })
    await expect(client.botUsername(signal)).resolves.toMatchObject({ ok: false, code: 'telegram-network-unavailable' })
  })

  it.each(['system', 'custom', 'none'] as const)('uses the injected platform fetch after the %s proxy configuration seam', async (proxyMode) => {
    const network = { ...createDefaultAppSettings().network, proxyMode, ...(proxyMode === 'custom' ? { proxyUrl: 'http://127.0.0.1:7890' } : {}) }
    const config = buildSessionProxyConfig(network)
    const fetch = vi.fn(async () => response(200, { ok: true, result: { username: 'relay' } })) as unknown as typeof globalThis.fetch
    const client = new TelegramApiClient({ getPlatformFetch: () => fetch, token: async () => 'private-token' })
    await expect(client.botUsername()).resolves.toEqual({ ok: true, value: 'relay' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(config.mode).toBe(proxyMode === 'custom' ? 'fixed_servers' : proxyMode === 'none' ? 'direct' : 'system')
  })

  it('commits offset only through the active generation gate and remains monotonic across connections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'telegram-offset-'))
    const path = join(directory, 'channels.sqlite')
    try {
      const first = createAgentPlatformDatabase(path)
      seedActive(first, 'channel-a', 1)
      const offsets = new TelegramOffsetRepository(first)
      expect(offsets.commitIfCurrent('channel-a', 1, 12)).toBe(true)
      expect(offsets.commitIfCurrent('channel-a', 1, 11)).toBe(false)
      first.connection.prepare("update channel_runtime_generations set generation = 2, lifecycle_state = 'inactive' where channel_id = 'channel-a'").run()
      expect(offsets.commitIfCurrent('channel-a', 1, 13)).toBe(false)
      expect(offsets.get('channel-a')).toBe(12)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it.each(['slack', 'feishu', 'qq', 'discord'] as const)('refuses forged active %s rows in the Telegram offset gate', (type) => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.prepare("insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20')").run()
    database.connection.prepare("insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values(?,?,?, 'agent-a', ?,1,'runtime-ready','configured','2026-07-20','2026-07-20')").run(
      `${type}-a`, type, type, type === 'feishu' ? '{"domain":"lark"}' : '{}'
    )
    database.connection.prepare("insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,1,'active','2026-07-20')").run(`${type}-a`)
    const offsets = new TelegramOffsetRepository(database)
    expect(offsets.commitIfCurrent(`${type}-a`, 1, 8)).toBe(false)
    expect(offsets.auditIfCurrent(`${type}-a`, 1, 'telegram-poll-failed')).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_telegram_offsets').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_runtime_audits').get()).toEqual({ count: 0 })
  })

  it('does not commit malformed or durable update offsets after a fence', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database, 'channel-a', 1)
    const offsets = new TelegramOffsetRepository(database)
    let callback: (() => void) | undefined
    const api = { updates: vi.fn(async () => {
      database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='channel-a'").run()
      return { ok: true as const, value: [{ update_id: 7 }]
      }
    }) }
    const host = new TelegramPollingHost({ channelId: 'channel-a', generation: 1, inbound: { receive: vi.fn() } as never, offsets, api: api as never, isCurrent: () => true, signal: new AbortController().signal, setTimeout: (next) => { callback = next; return 1 as never }, clearTimeout: () => {} })
    host.start(); callback?.()
    await vi.waitFor(() => expect(api.updates).toHaveBeenCalledOnce())
    expect(offsets.get('channel-a')).toBe(0)
  })

  it('refuses the offset commit when a fence lands after durable inbound handling but before acknowledge returns', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database, 'channel-a', 1)
    const offsets = new TelegramOffsetRepository(database)
    const inbound = { receive: vi.fn(async (request: { acknowledge: () => Promise<void> }) => {
      database.connection.prepare("update agent_channels set requested_enabled=0,migration_state='disabled' where id='channel-a'").run()
      database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='channel-a'").run()
      await expect(request.acknowledge()).rejects.toThrow('telegram-offset-commit-failed')
      return { disposition: 'retry' as const }
    }) }
    let callback: (() => void) | undefined
    const host = new TelegramPollingHost({ channelId: 'channel-a', generation: 1, inbound: inbound as never, offsets, api: { updates: vi.fn(async () => ({ ok: true as const, value: [{ update_id: 8, message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 2 }, text: 'hi' } }] })) } as never, isCurrent: () => true, signal: new AbortController().signal, setTimeout: (next) => { callback = next; return 1 as never }, clearTimeout: () => {} })
    host.start(); callback?.()
    await vi.waitFor(() => expect(inbound.receive).toHaveBeenCalledOnce())
    expect(offsets.get('channel-a')).toBe(0)
  })

  it('backs off 429, 409 and network failures without scheduling after lifetime abort', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database, 'channel-a', 1)
    const delays: number[] = []
    const controller = new AbortController()
    let callback: (() => void) | undefined
    const api = { updates: vi.fn(async () => ({ ok: false as const, code: 'telegram-rate-limited', retryAfterMs: 7_000 })) }
    const host = new TelegramPollingHost({ channelId: 'channel-a', generation: 1, inbound: {} as never, offsets: new TelegramOffsetRepository(database), api: api as never, isCurrent: () => true, signal: controller.signal, setTimeout: (next, delay) => { callback = next; delays.push(delay); return delays.length as never }, clearTimeout: () => {} })
    host.start(); callback?.()
    await vi.waitFor(() => expect(delays).toContain(7_000))
    controller.abort()
    callback?.()
    expect(api.updates).toHaveBeenCalledTimes(1)
  })

  it('passes lifetime cancellation to typing, segments and one markdown plain retry', async () => {
    let current = true
    const controller = new AbortController()
    const calls: Array<{ text: string; plain: boolean; signal?: AbortSignal }> = []
    const client = { sendMessage: vi.fn(async (_chat: string, text: string, plain: boolean, signal?: AbortSignal) => {
      calls.push({ text, plain, signal }); return calls.length === 1 ? { ok: false as const, code: 'telegram-provider-rejected', parseRejected: true } : { ok: true as const, value: true }
    }), typing: vi.fn(async (_chat: string, signal?: AbortSignal) => { expect(signal).toBe(controller.signal); return { ok: true as const, value: true } }) }
    const transport = new TelegramDeliveryTransport()
    transport.setClient('channel-a', client as never, { isCurrent: () => current, signal: controller.signal })
    await transport.typing({ channelId: 'channel-a', providerConversationKey: '1' })
    await expect(transport.send({ channelId: 'channel-a', providerConversationKey: '1', text: 'hello', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'delivered' })
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ plain: false, signal: controller.signal }), expect.objectContaining({ plain: true, signal: controller.signal })]))
    current = false
    await expect(transport.send({ channelId: 'channel-a', providerConversationKey: '1', text: 'stale', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
  })
})

function seedActive(database: ReturnType<typeof createAgentPlatformDatabase>, channelId: string, generation: number): void {
  database.connection.prepare("insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-19','2026-07-19')").run()
  database.connection.prepare("insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values(?, 'telegram', 'Telegram', 'agent-a', '{}', 1, 'runtime-ready', 'configured', '2026-07-19','2026-07-19')").run(channelId)
  database.connection.prepare("insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,?, 'active','2026-07-19')").run(channelId, generation)
  seedChannelAdapterSupport(database, ['telegram'])
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}
