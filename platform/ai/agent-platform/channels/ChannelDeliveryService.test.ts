import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'
import { ChannelDeliveryService } from './ChannelDeliveryService'
import { seedChannelAdapterSupport } from './channelTestSupport'

describe('ChannelDeliveryService', () => {
  it('uses only enabled targets, stores no text, and keeps one terminal attempt per source', async () => {
    const { service, database, transport } = harness()
    const result = await service.deliverToEnabledTargets({
      channelId: 'channel-a', agentId: 'agent-a', source: 'task-result', sourceId: 'run-1', text: 'token=super-secret-value'
    })

    expect(result).toEqual([{ status: 'delivered', attemptId: expect.any(String), errorCode: null }])
    expect(transport.send).toHaveBeenCalledTimes(1)
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ providerConversationKey: 'provider-conversation-a', text: '[REDACTED]' }))
    expect(JSON.stringify(database.connection.prepare('select * from channel_delivery_attempts').all())).not.toContain('super-secret-value')
    expect(JSON.stringify(database.connection.prepare('select * from channel_delivery_audits').all())).not.toContain('provider-conversation-a')
    expect(database.connection.prepare('select count(*) as count from channel_delivery_attempts').get()).toEqual({ count: 1 })
  })

  it('rejects discovery and legacy data by requiring an enabled target', async () => {
    const { service, database, transport } = harness(false)
    const result = await service.deliverToEnabledTargets({
      channelId: 'channel-a', agentId: 'agent-a', source: 'agent-notify', sourceId: 'notify-1', text: 'notice'
    })
    expect(result).toEqual([{ status: 'skipped', attemptId: null, errorCode: 'delivery-no-enabled-target' }])
    expect(transport.send).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_delivery_attempts').get()).toEqual({ count: 0 })
  })

  it.each(['{}', '{"domain":"feishu"}'])('rejects active isolated Feishu before decrypting or writing delivery ledger rows: %s', async (publicConfig) => {
    const { database } = harness()
    database.connection.exec(`
      delete from channel_delivery_targets;
      delete from channel_conversations;
      delete from channel_runtime_generations;
      delete from agent_channels;
      insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,created_at,updated_at)
        values('legacy-feishu','feishu','Legacy','agent-a','${publicConfig}',1,'runtime-ready','2026-01-01','2026-01-01');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('legacy-feishu',1,'active','2026-01-01');
      insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
        values('legacy-conversation','legacy-feishu',x'70726f7669646572','ref',1,'legacy-hash','direct','session-a','2026-01-01','2026-01-01');
      insert into channel_delivery_targets(id,channel_id,conversation_id,enabled,created_at,updated_at)
        values('legacy-target','legacy-feishu','legacy-conversation',1,'2026-01-01','2026-01-01');
    `)
    const transport = { send: vi.fn(async () => ({ kind: 'delivered' as const })), supportsIdempotency: vi.fn(() => true) }
    const decrypt = vi.fn(async () => new Uint8Array([1]))
    const repository = new ChannelDeliveryRepository(database)
    const service = new ChannelDeliveryService({
      repository,
      cipher: { ...cipherForTests(), decrypt },
      transport,
      now: () => new Date('2026-07-18T00:00:00.000Z')
    })

    await expect(service.deliver({ channelId: 'legacy-feishu', agentId: 'agent-a', conversationId: 'legacy-conversation', source: 'task-result', sourceId: 'run-a', text: 'result' }))
      .resolves.toEqual({ status: 'skipped', attemptId: null, errorCode: 'delivery-not-authorized' })
    await expect(service.deliver({ channelId: 'legacy-feishu', agentId: 'agent-a', conversationId: 'legacy-conversation', source: 'inbound-reply', sourceId: 'dispatch-a', text: 'reply', executionClaim: {
      workItemId: 'work-a', receiptId: 'receipt-a', channelId: 'legacy-feishu', dispatchId: 'dispatch-a', generation: 1, leaseToken: 'lease-a', leaseExpiresAt: '2026-07-18T01:00:00.000Z'
    } })).resolves.toEqual({ status: 'skipped', attemptId: null, errorCode: 'delivery-not-authorized' })
    expect(repository.listEnabledTargets('legacy-feishu', 'agent-a')).toEqual([])
    expect(decrypt).not.toHaveBeenCalled()
    expect(transport.send).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_delivery_attempts where channel_id=?').get('legacy-feishu')).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_delivery_audits where channel_id=?').get('legacy-feishu')).toEqual({ count: 0 })

    // A stale direct SQLite row also cannot be recovered through the task retry lookup.
    database.connection.prepare(
      `insert into channel_delivery_attempts(id,channel_id,agent_id,conversation_id,source_type,source_hash,idempotency_key,status,created_at,updated_at)
       values('stale-task','legacy-feishu','agent-a','legacy-conversation','task-result',?,'opaque','unknown-after-send','2026-01-01','2026-01-01')`
    ).run(hashForTests('run-a:completed'))
    expect(repository.getTaskAttempt({ agentId: 'agent-a', runLogId: 'run-a', attemptId: 'stale-task' })).toBeNull()
  })

  it.each(['telegram', 'slack', 'feishu'])('keeps %s managed delivery authorization intact', async (type) => {
    const { database, service, transport } = harness()
    database.connection.prepare('update agent_channels set type=?,public_config_json=? where id=?').run(type, type === 'feishu' ? '{"domain":"lark"}' : '{}', 'channel-a')
    await expect(service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: `run-${type}`, text: 'result' }))
      .resolves.toEqual(expect.objectContaining({ status: 'delivered' }))
    expect(transport.send).toHaveBeenCalledOnce()
  })

  it('retries a rate-limited task delivery after its backoff and clears the encrypted payload', async () => {
    const { database, transport } = harness()
    let now = new Date('2026-07-18T00:00:00.000Z')
    const cipher = {
      ...cipherForTests(),
      encrypt: async (_channelId: string, value: Uint8Array) => ({ ciphertext: value, keyRef: 'ref', keyRevision: 1 }),
      decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext
    }
    const service = new ChannelDeliveryService({
      repository: new ChannelDeliveryRepository(database), cipher, transport, now: () => now
    })
    transport.send.mockResolvedValueOnce({ kind: 'failed', code: 'delivery-rate-limited' } as never).mockResolvedValue({ kind: 'delivered' })

    expect((await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'run-retry', text: 'retry me' })).status).toBe('failed')
    expect(database.connection.prepare("select status, next_attempt_at from channel_delivery_attempts where source_id='run-retry'").get()).toMatchObject({ status: 'pending', next_attempt_at: expect.any(String) })

    await service.retryDue()
    expect(transport.send).toHaveBeenCalledTimes(1)

    now = new Date('2026-07-18T00:00:06.000Z')
    await service.retryDue()
    expect(transport.send).toHaveBeenCalledTimes(2)
    expect(database.connection.prepare("select status, retry_payload_ciphertext from channel_delivery_attempts where source_id='run-retry'").get()).toEqual({ status: 'delivered', retry_payload_ciphertext: null })
  })

  it('treats unclassified transport errors as unknown and retries only with idempotency evidence', async () => {
    const { service, transport } = harness()
    transport.send.mockRejectedValueOnce(new Error('provider raw error: secret'))
    const first = await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'run-2', text: 'result' })
    expect(first).toEqual({ status: 'unknown-after-send', attemptId: expect.any(String), errorCode: 'delivery-transport-unknown' })
    expect(await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'run-2', text: 'result' })).toEqual(
      expect.objectContaining({ status: 'skipped', errorCode: 'delivery-retry-not-permitted' })
    )
    transport.supportsIdempotency.mockReturnValue(true)
    expect(await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'run-2', text: 'result', retryUnknown: true })).toEqual(
      expect.objectContaining({ status: 'delivered' })
    )
  })

  it('requires the exact dispatch owner for replies and never treats observation as an outbound target', async () => {
    const { service, database, transport } = harness()
    const result = await service.deliver({
      channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'inbound-reply',
      sourceId: 'dispatch-not-owned', text: 'reply'
    })
    expect(result).toEqual({ status: 'skipped', attemptId: null, errorCode: 'delivery-owner-invalid' })
    expect(transport.send).not.toHaveBeenCalled()

    database.connection.exec(`
      insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision, provider_event_key_hash, status, generation, created_at, updated_at)
      values ('receipt-a', 'channel-a', x'01', 'ref', 1, 'event-hash', 'dispatching', 1, '2026-01-01', '2026-01-01');
      insert into channel_inbound_work_items (id, receipt_id, channel_id, conversation_id, dispatch_id, payload_ciphertext, payload_key_ref, payload_key_revision, status, lease_token, lease_expires_at, attempt_count, created_at, updated_at)
      values ('work-a', 'receipt-a', 'channel-a', 'conversation-a', 'dispatch-a', x'01', 'ref', 1, 'dispatching', 'lease-a', '2026-07-18T01:00:00.000Z', 1, '2026-01-01', '2026-01-01');
    `)
    await expect(service.deliver({
      channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'inbound-reply', sourceId: 'dispatch-a', text: 'reply',
      executionClaim: { workItemId: 'work-a', receiptId: 'receipt-a', channelId: 'channel-a', dispatchId: 'dispatch-a', generation: 1, leaseToken: 'lease-a', leaseExpiresAt: '2026-07-18T01:00:00.000Z' }
    })).resolves.toEqual(expect.objectContaining({ status: 'delivered' }))
  })

  it.each([
    ['target disable', (database: ReturnType<typeof createAgentPlatformDatabase>) => database.connection.prepare("update channel_delivery_targets set enabled = 0 where id = 'target-a'").run()],
    ['generation fence', (database: ReturnType<typeof createAgentPlatformDatabase>) => database.connection.prepare("update channel_runtime_generations set generation = 2, lifecycle_state = 'inactive' where channel_id = 'channel-a'").run()],
    ['agent deletion', (database: ReturnType<typeof createAgentPlatformDatabase>) => database.connection.prepare("delete from agent_entities where id = 'agent-a'").run()]
  ])('does not send after %s between delivery claim and send ownership', async (_name, mutate) => {
    const { database, transport, service } = harness(true, () => mutate(database))
    const result = await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'race', text: 'result' })
    expect(result).toEqual({ status: 'skipped', attemptId: expect.any(String), errorCode: 'delivery-not-authorized' })
    expect(transport.send).not.toHaveBeenCalled()
  })

  it('persists only the stable transport code, never raw provider error text', async () => {
    const { database, transport, service } = harness()
    transport.send.mockResolvedValueOnce({ kind: 'failed', code: 'delivery-provider-rejected' } as never)
    const result = await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'stable-code', text: 'result' })
    expect(result).toEqual({ status: 'failed', attemptId: expect.any(String), errorCode: 'delivery-provider-rejected' })
    expect(JSON.stringify(database.connection.prepare('select * from channel_delivery_attempts').all())).not.toContain('provider raw')
  })

  it('gives one retry owner the opaque idempotency key and rejects its concurrent peer', async () => {
    const { database, service, transport } = harness()
    transport.send.mockRejectedValueOnce(new Error('raw provider failure'))
    const first = await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'retry-owner', text: 'result' })
    expect(first.status).toBe('unknown-after-send')
    transport.supportsIdempotency.mockReturnValue(true)
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    const paused = new ChannelDeliveryService({
      repository: new ChannelDeliveryRepository(database), cipher: cipherForTests(), transport,
      now: () => new Date('2026-07-18T00:00:00.000Z'), beforeTransport: () => held
    })
    const owner = paused.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'retry-owner', text: 'result', retryUnknown: true })
    await Promise.resolve()
    const peer = await service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'retry-owner', text: 'result', retryUnknown: true })
    expect(peer).toEqual(expect.objectContaining({ status: 'skipped', errorCode: 'delivery-not-authorized' }))
    release?.()
    await expect(owner).resolves.toEqual(expect.objectContaining({ status: 'delivered' }))
    expect(transport.send).toHaveBeenCalledTimes(2)
  })

  it('does not let a send owner cross the transport boundary after a lifecycle fence', async () => {
    const { database, transport } = harness()
    const service = new ChannelDeliveryService({
      repository: new ChannelDeliveryRepository(database), cipher: cipherForTests(), transport,
      now: () => new Date('2026-07-18T00:00:00.000Z'),
      beforeTransport: () => { database.connection.prepare("update channel_runtime_generations set lifecycle_state = 'inactive' where channel_id = 'channel-a'").run() }
    })
    await expect(service.deliver({ channelId: 'channel-a', agentId: 'agent-a', conversationId: 'conversation-a', source: 'task-result', sourceId: 'fenced-owner', text: 'result' })).resolves.toEqual(
      expect.objectContaining({ status: 'skipped', errorCode: 'delivery-not-authorized' })
    )
    expect(transport.send).not.toHaveBeenCalled()
    expect(database.connection.prepare("select status from channel_delivery_attempts where source_hash = '" + hashForTests('fenced-owner') + "'").get()).toEqual({ status: 'unknown-after-send' })
  })

  it('cleans only terminal delivery metadata in bounded pages', () => {
    const { database } = harness()
    database.connection.exec(`
      with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      n(x) as (select a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + 1 from digits a cross join digits b cross join digits c cross join digits d cross join digits e)
      insert into channel_delivery_attempts (id, channel_id, agent_id, conversation_id, source_type, source_hash, idempotency_key, status, attempt_count, created_at, updated_at, completed_at)
      select 'attempt-' || x, 'channel-a', 'agent-a', 'conversation-a', 'task-result', 'hash-' || x, 'key-' || x, 'delivered', 1, '2026-01-01', '2026-01-01', '2026-01-01' from n where x <= 10001;
      insert into channel_delivery_attempts (id, channel_id, agent_id, conversation_id, source_type, source_hash, idempotency_key, status, attempt_count, created_at, updated_at, completed_at)
      values ('active-attempt', 'channel-a', 'agent-a', 'conversation-a', 'task-result', 'active', 'active-key', 'pending', 1, '2026-01-01', '2026-01-01', null);
    `)
    const repository = new ChannelDeliveryRepository(database)
    database.connection.exec(`
      with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      n(x) as (select a.d + b.d * 10 + c.d * 100 + d.d * 1000 + 1 from digits a cross join digits b cross join digits c cross join digits d)
      insert into channel_delivery_audits (id, channel_id, attempt_id, code, created_at)
      select 'audit-' || x, 'channel-a', null, 'channel-delivery-delivered', '2026-01-01' from n where x <= 5001;
    `)
    expect(repository.cleanupPage('channel-a', new Date('2026-07-18T00:00:00.000Z'))).toEqual({ attempts: 500, audits: 500 })
    expect(database.connection.prepare("select status from channel_delivery_attempts where id = 'active-attempt'").get()).toEqual({ status: 'pending' })
  })
})

function harness(enabled = true, beforeSendOwnership?: () => void) {
  const database = createAgentPlatformDatabase(':memory:')
  database.connection.exec(`
    insert into agent_entities (id, type, name, mcps_json, disabled_tools_json, order_key, created_at, updated_at) values ('agent-a', 'general', 'Agent', '[]', '[]', '0', '2026-01-01', '2026-01-01');
    insert into agent_channels (id, type, name, agent_id, requested_enabled, migration_state, created_at, updated_at) values ('channel-a', 'telegram', 'Channel', 'agent-a', 1, 'runtime-ready', '2026-01-01', '2026-01-01');
    insert into channel_runtime_generations (channel_id, generation, lifecycle_state, updated_at) values ('channel-a', 1, 'active', '2026-01-01');
    insert into channel_conversations (id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision, conversation_key_hash, conversation_kind, agent_session_id, created_at, updated_at) values ('conversation-a', 'channel-a', x'70726f76696465722d636f6e766572736174696f6e2d61', 'ref', 1, 'hash-a', 'direct', 'session-a', '2026-01-01', '2026-01-01');
    insert into channel_conversations (id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision, conversation_key_hash, conversation_kind, agent_session_id, created_at, updated_at) values ('conversation-discovered', 'channel-a', x'646973636f7665726564', 'ref', 1, 'hash-b', 'direct', 'session-b', '2026-01-01', '2026-01-01');
    ${enabled ? "insert into channel_delivery_targets (id, channel_id, conversation_id, enabled, created_at, updated_at) values ('target-a', 'channel-a', 'conversation-a', 1, '2026-01-01', '2026-01-01');" : ''}
  `)
  seedChannelAdapterSupport(database, ['telegram', 'slack', 'lark'])
  const transport = { send: vi.fn(async () => ({ kind: 'delivered' as const })), supportsIdempotency: vi.fn(() => false) }
  const cipher = cipherForTests()
  return { database, transport, service: new ChannelDeliveryService({ repository: new ChannelDeliveryRepository(database), cipher, transport, now: () => new Date('2026-07-18T00:00:00.000Z'), beforeSendOwnership }) }
}

function cipherForTests() { return { encrypt: async () => ({ ciphertext: new Uint8Array(), keyRef: 'ref', keyRevision: 1 }), decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext, keyedHash: async () => 'hash', rotate: async () => ({ keyRef: 'ref', keyRevision: 1 }), revoke: async () => {} } }
function hashForTests(value: string): string { return createHash('sha256').update(value).digest('base64url') }
