import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from '../ChannelAdapterAcceptanceRegistry'
import { ChannelDeliveryRepository } from '../ChannelDeliveryRepository'
import { ChannelDeliveryTransportRouter } from '../ChannelDeliveryTransportRouter'
import { ChannelManagementRepository } from '../ChannelManagementRepository'
import { ChannelManagementService } from '../ChannelManagementService'
import { ChannelSecureHandoff } from '../ChannelSecureHandoff'
import { decodeWechatConversation, encodeWechatConversation, splitWechatText } from './WechatContracts'
import { WechatDeliveryTransport } from './WechatDeliveryTransport'
import { seedChannelAdapterSupport } from '../channelTestSupport'
import { WechatEnrollmentRepository } from './WechatEnrollmentRepository'
import { WechatRuntimeManager } from './WechatRuntimeManager'
import { WechatRuntimeRepository } from './WechatRuntimeRepository'

describe('WeChat Release F safety foundation', () => {
  it('creates only blocked metadata and never offers legacy token_path as a credential route', async () => {
    const database = createDatabase(); const service = management(database)
    const created = service.create({ type: 'wechat', name: 'WeChat', agentId: 'agent-a', actorId: 'user-a' })
    expect(created).toMatchObject({ ok: true, channel: { type: 'wechat', requestedEnabled: false, credential: { hasCredential: false } } })
    expect(service.requestEnable({ id: created.channel!.id, actorId: 'user-a' })).toMatchObject({ ok: false, code: 'adapter-not-supported' })
    await expect(service.beginCredential({ id: created.channel!.id, senderId: 1 })).rejects.toThrow('channel-input-invalid')
    expect(database.connection.prepare('select public_config_json,credential_ref,requested_enabled from agent_channels where id=?').get(created.channel!.id)).toEqual({ public_config_json: '{}', credential_ref: null, requested_enabled: 0 })
  })

  it('rejects generic credential and policy handoffs before any Vault, cipher, owner, or state mutation', async () => {
    const database = createDatabase(); const repository = new ChannelManagementRepository(database)
    expect(repository.create({ id: 'wechat-a', type: 'wechat', name: 'WeChat', agentId: 'agent-a', now: 'now' })).toBe(true)
    const handoff = { begin: vi.fn(), consume: vi.fn() }
    const cipher = { encrypt: vi.fn(), keyedHash: vi.fn() }
    const vault = { inspectSafe: vi.fn(), prepareMigration: vi.fn(), putReserved: vi.fn(), rotateIfRevision: vi.fn() }
    const service = new ChannelManagementService({
      repository, vault: vault as never, cipher: cipher as never, registry: new ChannelAdapterAcceptanceRegistry(), handoff: handoff as never
    })

    await expect(service.beginCredential({ id: 'wechat-a', senderId: 1 })).rejects.toThrow('channel-input-invalid')
    await expect(service.beginPolicy({ id: 'wechat-a', senderId: 1 })).rejects.toThrow('channel-input-invalid')
    await expect(service.provision({ id: 'wechat-a', actorId: 'user-a', senderId: 1, handoff: {} as never })).resolves.toEqual({ ok: false, code: 'channel-credential-invalid' })
    await expect(service.rotate({ id: 'wechat-a', actorId: 'user-a', senderId: 1, handoff: {} as never })).resolves.toEqual({ ok: false, code: 'channel-credential-invalid' })
    await expect(service.createPolicy({ id: 'wechat-a', actorId: 'user-a', senderId: 1, handoff: {} as never })).resolves.toEqual({ ok: false, code: 'channel-policy-invalid' })
    expect(handoff.begin).not.toHaveBeenCalled(); expect(handoff.consume).not.toHaveBeenCalled()
    expect(cipher.encrypt).not.toHaveBeenCalled(); expect(cipher.keyedHash).not.toHaveBeenCalled()
    expect(vault.inspectSafe).not.toHaveBeenCalled(); expect(vault.prepareMigration).not.toHaveBeenCalled()
    expect(database.connection.prepare("select requested_enabled,lifecycle_state,credential_ref from agent_channels where id='wechat-a'").get()).toEqual({ requested_enabled: 0, lifecycle_state: 'credential-missing', credential_ref: null })
    expect(database.connection.prepare("select count(*) as count from channel_telegram_lifecycle_operations where channel_id='wechat-a'").get()).toEqual({ count: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_allow_policies where channel_id='wechat-a'").get()).toEqual({ count: 0 })
    expect(repository.createPolicy({ channelId: 'wechat-a', subjectType: 'user', ciphertext: new Uint8Array([1]), keyRef: 'payload-ref', keyRevision: 1, keyHash: 'hash', conversationKind: null, now: 'now' })).toBe(false)
    database.connection.exec(`
      insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
        values('wechat-conversation','wechat-a',x'01','payload-ref',1,'hash','direct',null,'now','now');
      insert into channel_allow_policies(id,channel_id,subject_type,subject_key_ciphertext,subject_key_ref,subject_key_revision,subject_key_hash,created_at)
        values('wechat-policy','wechat-a','user',x'01','payload-ref',1,'hash','now');
      insert into channel_delivery_attempts(id,channel_id,agent_id,conversation_id,source_type,source_hash,idempotency_key,status,created_at,updated_at)
        values('wechat-attempt','wechat-a','agent-a','wechat-conversation','agent-notify','hash','opaque','skipped','now','now');
      insert into channel_delivery_audits(id,channel_id,attempt_id,code,created_at)
        values('wechat-delivery-audit','wechat-a','wechat-attempt','delivery-skipped','now');
    `)
    expect(service.listPolicies({ id: 'wechat-a' })).toEqual([])
    expect(service.listConversations({ id: 'wechat-a' })).toEqual([])
    expect(service.listDeliveryAttempts({ id: 'wechat-a' })).toEqual([])
    expect(service.listDeliveryAudits({ id: 'wechat-a' })).toEqual([])
    expect(service.deletePolicy({ channelId: 'wechat-a', policyId: 'wechat-policy', actorId: 'user-a' })).toEqual({ ok: false, code: 'channel-not-found' })
    expect(repository.deletePolicy('wechat-a', 'wechat-policy')).toBe(false)
    expect(database.connection.prepare("select count(*) as count from channel_allow_policies where id='wechat-policy'").get()).toEqual({ count: 1 })
    expect(service.setTarget({ channelId: 'wechat-a', conversationId: 'wechat-conversation', enabled: true, actorId: 'user-a' })).toEqual({ ok: false, code: 'channel-not-found' })
    expect(repository.setTarget('wechat-a', 'wechat-conversation', true, 'now')).toBe(false)
    expect(database.connection.prepare("select count(*) as count from channel_delivery_targets where channel_id='wechat-a'").get()).toEqual({ count: 0 })
    expect(repository.create({ id: 'telegram-target', type: 'telegram', name: 'Telegram', agentId: 'agent-a', now: 'now' })).toBe(true)
    database.connection.exec("insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at) values('telegram-conversation','telegram-target',x'01','payload-ref',1,'hash','direct',null,'now','now'); insert into channel_allow_policies(id,channel_id,subject_type,subject_key_ciphertext,subject_key_ref,subject_key_revision,subject_key_hash,created_at) values('telegram-policy','telegram-target','user',x'01','payload-ref',1,'hash','now')")
    expect(service.setTarget({ channelId: 'telegram-target', conversationId: 'telegram-conversation', enabled: true, actorId: 'user-a' })).toEqual({ ok: true, code: 'target-updated' })
    expect(service.listPolicies({ id: 'telegram-target' })).toHaveLength(1)
    expect(service.deletePolicy({ channelId: 'telegram-target', policyId: 'telegram-policy', actorId: 'user-a' })).toEqual({ ok: true, code: 'policy-deleted' })
  })

  it('hides forged WeChat credential metadata and settles forged credential journals without Vault recovery', async () => {
    const database = createDatabase(); const repository = new ChannelManagementRepository(database)
    expect(repository.create({ id: 'wechat-a', type: 'wechat', name: 'WeChat', agentId: 'agent-a', now: 'now' })).toBe(true)
    expect(repository.create({ id: 'telegram-a', type: 'telegram', name: 'Telegram', agentId: 'agent-a', now: 'now' })).toBe(true)
    database.connection.exec(`
      update agent_channels set credential_ref='wechat-ref',credential_revision=7,credential_health='configured' where id='wechat-a';
      update agent_channels set credential_ref='telegram-ref',credential_revision=1,credential_health='configured' where id='telegram-a';
      insert into channel_management_operations(id,channel_id,purpose,credential_ref,source_fingerprint,fingerprint_key_id,operation_permit,state,created_at,updated_at)
        values('wechat-op','wechat-a','provision','wechat-ref','fingerprint','key','permit','needs-recovery','now','now');
    `)
    expect(repository.query.get('wechat-a')?.credential).toEqual({ status: 'missing', hasCredential: false, revision: null, maskedFields: {} })
    expect(repository.credentialMetadata('wechat-a')).toBeNull()
    expect(repository.setCredential({ id: 'wechat-a', ref: 'new-ref', revision: 1, expectedRevision: 7, now: 'now' })).toBe(false)
    expect(repository.reserveOperation({ id: 'wechat-provision', channelId: 'wechat-a', purpose: 'provision', ref: 'ref', now: 'now' })).toBe(false)
    expect(repository.reserveOperation({ id: 'wechat-rotate', channelId: 'wechat-a', purpose: 'rotate', ref: 'ref', expectedRevision: 7, now: 'now' })).toBe(false)
    const directOwner = repository.beginLifecycleOwner('wechat-a', 'mutation', 'wechat-owner', 'now')
    expect(directOwner).not.toBeNull()
    expect(repository.reserveOperation({ id: 'wechat-owned-provision', channelId: 'wechat-a', purpose: 'provision', ref: 'ref', owner: directOwner!, now: 'now' })).toBe(false)
    expect(repository.reserveOperation({ id: 'wechat-owned-rotate', channelId: 'wechat-a', purpose: 'rotate', ref: 'ref', expectedRevision: 7, owner: directOwner!, now: 'now' })).toBe(false)
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where channel_id='wechat-a' and id like 'wechat-owned-%'").get()).toEqual({ count: 0 })
    expect(repository.credentialMetadata('telegram-a')).toEqual({ ref: 'telegram-ref', revision: 1 })
    expect(repository.setCredential({ id: 'telegram-a', ref: 'telegram-ref', revision: 2, expectedRevision: 1, now: 'now' })).toBe(true)
    expect(repository.reserveOperation({ id: 'telegram-provision', channelId: 'telegram-a', purpose: 'provision', ref: 'ref', now: 'now' })).toBe(true)
    database.connection.prepare("update channel_management_operations set state='abandoned' where id='telegram-provision'").run()
    const vault = { inspectSafe: vi.fn(async (ref: string) => ({ credentialRef: ref, revision: 2, maskedFields: {} })), inspectReserved: vi.fn() }
    const service = new ChannelManagementService({ repository, vault: vault as never, cipher: {} as never, registry: new ChannelAdapterAcceptanceRegistry(), handoff: {} as never })
    await service.recover()
    expect(vault.inspectSafe).toHaveBeenCalledWith('telegram-ref')
    expect(vault.inspectSafe).not.toHaveBeenCalledWith('wechat-ref')
    expect(vault.inspectReserved).not.toHaveBeenCalled()
    expect(database.connection.prepare("select credential_ref,credential_revision from agent_channels where id='wechat-a'").get()).toEqual({ credential_ref: null, credential_revision: null })
    expect(database.connection.prepare("select state from channel_management_operations where id='wechat-op'").get()).toEqual({ state: 'abandoned' })
  })

  it('keeps QR enrollment one-time, bounded, opaque, and terminal after expiry or cancellation', () => {
    const database = createDatabase(); new ChannelManagementRepository(database).create({ id: 'wechat-a', type: 'wechat', name: 'WeChat', agentId: 'agent-a', now: '2026-07-21T00:00:00.000Z' })
    database.connection.prepare("update agent_channels set lifecycle_state='ready' where id='wechat-a'").run()
    const enrollments = new WechatEnrollmentRepository(database)
    const first = enrollments.begin('wechat-a', 1_000, new Date('2026-07-21T00:00:00.000Z'))!
    const second = enrollments.begin('wechat-a', 1_000, new Date('2026-07-21T00:00:00.100Z'))!
    expect(first.operationId).not.toBe(second.operationId)
    expect(database.connection.prepare('select state,context_ref,context_revision from channel_wechat_qr_enrollments where operation_id=?').get(first.operationId)).toEqual({ state: 'cancelled', context_ref: null, context_revision: null })
    expect(enrollments.cancel('wechat-a', second.operationId, new Date('2026-07-21T00:00:00.200Z'))).toBe(true)
    expect(enrollments.cancel('wechat-a', second.operationId, new Date('2026-07-21T00:00:00.300Z'))).toBe(false)
    const expired = enrollments.begin('wechat-a', 1_000, new Date('2026-07-21T00:00:02.000Z'))!
    expect(enrollments.status('wechat-a', new Date('2026-07-21T00:00:03.001Z'))).toEqual({ operationId: expired.operationId, state: 'expired', expiresAt: expired.expiresAt })
  })

  it('retains fresh and pending QR journals while deleting old terminal records in 500-row pages', () => {
    const database = createDatabase(); new ChannelManagementRepository(database).create({ id: 'wechat-a', type: 'wechat', name: 'WeChat', agentId: 'agent-a', now: 'now' })
    const enrollments = new WechatEnrollmentRepository(database)
    database.connection.exec(`
      with recursive n(value) as (select 1 union all select value+1 from n where value<501)
      insert into channel_wechat_qr_enrollments(operation_id,channel_id,state,expires_at,updated_at)
        select 'old-' || value,'wechat-a',case when value % 2 = 0 then 'cancelled' else 'expired' end,'2026-07-01','2026-07-01' from n;
      insert into channel_wechat_qr_enrollments(operation_id,channel_id,state,expires_at,updated_at) values
        ('fresh-terminal','wechat-a','cancelled','2026-07-21','2026-07-21T00:00:00.000Z'),
        ('current-pending','wechat-a','pending','2099-01-01','2026-07-01');
    `)
    const now = new Date('2026-07-22T00:00:00.000Z')
    expect(enrollments.cleanupTerminal(now)).toBe(500)
    expect(database.connection.prepare("select count(*) as count from channel_wechat_qr_enrollments where operation_id like 'old-%'").get()).toEqual({ count: 1 })
    expect(database.connection.prepare("select state from channel_wechat_qr_enrollments where operation_id='fresh-terminal'").get()).toEqual({ state: 'cancelled' })
    expect(database.connection.prepare("select state from channel_wechat_qr_enrollments where operation_id='current-pending'").get()).toEqual({ state: 'pending' })
    expect(enrollments.cleanupTerminal(now)).toBe(1)
  })

  it.each(['system', 'custom', 'none'] as const)('refuses forged active WeChat state, C03 writes, and %s transport construction', async (_proxyMode) => {
    const database = createDatabase(); seedActiveWechat(database)
    database.connection.exec(`
      insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
        values('wechat-conversation','wechat-a',x'00','payload-ref',1,'opaque','direct','session-a','now','now');
      insert into channel_delivery_targets(id,channel_id,conversation_id,enabled,created_at,updated_at)
        values('wechat-target','wechat-a','wechat-conversation',1,'now','now');
    `)
    const runtime = new WechatRuntimeRepository(database)
    const delivery = new ChannelDeliveryRepository(database)
    expect(runtime.commitIfCurrent('wechat-a', 1, 'cursor_1')).toBe(false)
    expect(runtime.auditIfCurrent('wechat-a', 1, 'wechat-poll-failed')).toBe(false)
    expect(delivery.getConversationKeyCipher('wechat-conversation')).toBeNull()
    expect(delivery.claim({ channelId: 'wechat-a', agentId: 'agent-a', conversationId: 'wechat-conversation', source: 'task-result', sourceId: 'run-a', requireTarget: true, now: new Date() })).toBeNull()
    expect(database.connection.prepare('select count(*) as count from channel_wechat_poll_state').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_delivery_attempts').get()).toEqual({ count: 0 })

    const fetch = vi.fn() as unknown as typeof globalThis.fetch; const webSocket = vi.fn() as never
    const manager = new WechatRuntimeManager({ inbound: {} as never, runtime, enrollments: new WechatEnrollmentRepository(database), vault: {} as never, getPlatformFetch: () => fetch, createPlatformWebSocket: webSocket, delivery: new WechatDeliveryTransport() })
    await expect(manager.start('wechat-a', 1, 'owner')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled(); expect(webSocket).not.toHaveBeenCalled()
  })

  it.each(['{"token_path":"/legacy"}', '{"unexpected":true}'])('startup and quit fence isolated WeChat rows without touching files or Vault: %s', (publicConfig) => {
    const database = createDatabase()
    database.connection.exec(`
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('legacy-wechat','wechat','Legacy','agent-a','${publicConfig}',1,'enabled','configured','now','now'),
        ('wechat-new','wechat','New','agent-a','{}',1,'enabled','configured','now','now'),
        ('telegram-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','now','now');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('legacy-wechat',1,'active','now'),('wechat-new',1,'active','now'),('telegram-a',1,'active','now');
      insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
        values('legacy-wechat','legacy-owner','enable',1,'now','now'),('wechat-new','new-owner','enable',1,'now','now'),('telegram-a','telegram-owner','enable',1,'now','now');
      insert into channel_wechat_qr_enrollments(operation_id,channel_id,state,expires_at,updated_at)
        values('legacy-pending','legacy-wechat','pending','2026-07-01','2026-07-01'),
        ('legacy-terminal','legacy-wechat','cancelled','2026-07-01','2026-07-01');
    `)
    seedChannelAdapterSupport(database, ['telegram'])
    const repository = new ChannelManagementRepository(database)
    const enrollments = new WechatEnrollmentRepository(database)
    const runtime = new WechatRuntimeRepository(database)
    expect(runtime.commitIfCurrent('legacy-wechat', 1, 'cursor')).toBe(false)
    expect(enrollments.status('legacy-wechat')).toBeNull()
    expect(enrollments.cancel('legacy-wechat', 'legacy-pending')).toBe(false)
    expect(enrollments.expire(new Date('2026-07-21T00:00:00.000Z'))).toBe(0)
    expect(enrollments.cleanupTerminal(new Date('2026-07-21T00:00:00.000Z'))).toBe(0)
    expect(database.connection.prepare("select operation_id,state,updated_at from channel_wechat_qr_enrollments where channel_id='legacy-wechat' order by operation_id").all()).toEqual([
      { operation_id: 'legacy-pending', state: 'pending', updated_at: '2026-07-01' },
      { operation_id: 'legacy-terminal', state: 'cancelled', updated_at: '2026-07-01' }
    ])
    expect(repository.activeRuntimeOwners('2026-07-21T00:00:00.000Z')).toEqual([{ channelId: 'telegram-a', generation: 1, token: 'telegram-owner' }])
    for (const channelId of ['legacy-wechat', 'wechat-new']) {
      expect(database.connection.prepare('select requested_enabled,lifecycle_state from agent_channels where id=?').get(channelId)).toEqual({ requested_enabled: 0, lifecycle_state: 'disabled' })
      expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get(channelId)).toEqual({ generation: 2, lifecycle_state: 'inactive' })
      expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(channelId)).toEqual({ count: 0 })
    }
    expect(repository.stopAllRuntimeAndFence('2026-07-21T00:01:00.000Z')).toContain('telegram-a')
    expect(database.connection.prepare('select requested_enabled,lifecycle_state from agent_channels where id=?').get('telegram-a')).toEqual({ requested_enabled: 0, lifecycle_state: 'disabled' })

    const quitDatabase = createDatabase(); seedIsolatedWechat(quitDatabase, publicConfig)
    const quitRepository = new ChannelManagementRepository(quitDatabase)
    expect(quitRepository.stopAllRuntimeAndFence('2026-07-21T00:00:00.000Z')).toEqual(['legacy-wechat'])
    expect(quitDatabase.connection.prepare('select requested_enabled,lifecycle_state from agent_channels where id=?').get('legacy-wechat')).toEqual({ requested_enabled: 0, lifecycle_state: 'disabled' })
    expect(quitDatabase.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get('legacy-wechat')).toEqual({ generation: 2, lifecycle_state: 'inactive' })
    expect(quitDatabase.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get('legacy-wechat')).toEqual({ count: 0 })
  })

  it.each(['disabled', 'deleting'])('does not expose or mutate strict carrier QR journals in %s state', (migrationState) => {
    const database = createDatabase()
    database.connection.exec(`
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,lifecycle_state,created_at,updated_at)
        values('wechat-isolated','wechat','WeChat','agent-a','{}','${migrationState}','now','now');
      insert into channel_wechat_qr_enrollments(operation_id,channel_id,state,expires_at,updated_at) values
        ('pending','wechat-isolated','pending','2026-07-01','2026-07-01'),
        ('terminal','wechat-isolated','cancelled','2026-07-01','2026-07-01');
    `)
    const enrollments = new WechatEnrollmentRepository(database)
    const now = new Date('2026-07-21T00:00:00.000Z')
    expect(enrollments.begin('wechat-isolated', 1_000, now)).toBeNull()
    expect(enrollments.status('wechat-isolated', now)).toBeNull()
    expect(enrollments.cancel('wechat-isolated', 'pending', now)).toBe(false)
    expect(enrollments.expire(now)).toBe(0); expect(enrollments.cleanupTerminal(now)).toBe(0)
    expect(database.connection.prepare("select operation_id,state,updated_at from channel_wechat_qr_enrollments where channel_id='wechat-isolated' order by operation_id").all()).toEqual([
      { operation_id: 'pending', state: 'pending', updated_at: '2026-07-01' }, { operation_id: 'terminal', state: 'cancelled', updated_at: '2026-07-01' }
    ])
  })

  it('rejects a tombstoned strict carrier from every QR journal action', () => {
    const database = createDatabase()
    database.connection.exec(`
      insert into channel_management_tombstones(channel_id,deleted_at) values('wechat-tombstone','now');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,lifecycle_state,created_at,updated_at)
        values('wechat-tombstone','wechat','WeChat','agent-a','{}','ready','now','now');
      insert into channel_wechat_qr_enrollments(operation_id,channel_id,state,expires_at,updated_at) values
        ('pending','wechat-tombstone','pending','2026-07-01','2026-07-01'),
        ('terminal','wechat-tombstone','cancelled','2026-07-01','2026-07-01');
    `)
    const enrollments = new WechatEnrollmentRepository(database); const now = new Date('2026-07-21T00:00:00.000Z')
    expect(enrollments.begin('wechat-tombstone', 1_000, now)).toBeNull(); expect(enrollments.status('wechat-tombstone', now)).toBeNull()
    expect(enrollments.cancel('wechat-tombstone', 'pending', now)).toBe(false); expect(enrollments.expire(now)).toBe(0); expect(enrollments.cleanupTerminal(now)).toBe(0)
    expect(database.connection.prepare("select operation_id,state,updated_at from channel_wechat_qr_enrollments where channel_id='wechat-tombstone' order by operation_id").all()).toEqual([
      { operation_id: 'pending', state: 'pending', updated_at: '2026-07-01' }, { operation_id: 'terminal', state: 'cancelled', updated_at: '2026-07-01' }
    ])
  })

  it('deletes forged strict WeChat credential state locally without provider Vault calls', async () => {
    const database = createDatabase(); const repository = new ChannelManagementRepository(database)
    expect(repository.create({ id: 'wechat-delete', type: 'wechat', name: 'WeChat', agentId: 'agent-a', now: 'now' })).toBe(true)
    database.connection.exec(`
      update agent_channels set credential_ref='forged-provider-ref',credential_revision=9,credential_health='configured',lifecycle_state='ready' where id='wechat-delete';
      insert into channel_management_operations(id,channel_id,purpose,credential_ref,source_fingerprint,fingerprint_key_id,operation_permit,state,created_at,updated_at) values
        ('forged-provision','wechat-delete','provision','forged-reserved','fingerprint','key','permit','needs-recovery','now','now'),
        ('forged-rotate','wechat-delete','rotate','forged-provider-ref',null,null,null,'revoked-cleanup','now','now');
    `)
    const vault = {
      delete: vi.fn(), claimReservedCleanup: vi.fn(), deleteReservedIfCleanupClaim: vi.fn(),
      deleteReservedArchive: vi.fn(), inspectSafe: vi.fn(), inspectReserved: vi.fn(), inspectMutationReceipt: vi.fn()
    }
    const cipher = { destroy: vi.fn(async () => undefined) }
    const service = new ChannelManagementService({ repository, vault: vault as never, cipher: cipher as never, registry: new ChannelAdapterAcceptanceRegistry(), handoff: {} as never })
    await expect(service.delete({ id: 'wechat-delete', actorId: 'user-a' })).resolves.toEqual({ ok: true, code: 'deleted' })
    expect(cipher.destroy).toHaveBeenCalledOnce()
    expect((cipher.destroy.mock.calls as unknown[][])[0]?.[0]).toBe('wechat-delete')
    for (const call of Object.values(vault)) expect(call).not.toHaveBeenCalled()
    expect(database.connection.prepare("select count(*) as count from agent_channels where id='wechat-delete'").get()).toEqual({ count: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_management_tombstones where channel_id='wechat-delete'").get()).toEqual({ count: 1 })
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where channel_id='wechat-delete'").get()).toEqual({ count: 0 })
  })

  it('writes an empty local-only delete journal for forged strict WeChat credential records', () => {
    const database = createDatabase(); const repository = new ChannelManagementRepository(database)
    expect(repository.create({ id: 'wechat-journal', type: 'wechat', name: 'WeChat', agentId: 'agent-a', now: 'now' })).toBe(true)
    database.connection.exec(`
      update agent_channels set credential_ref='forged-provider-ref',credential_revision=9,credential_health='configured',lifecycle_state='ready' where id='wechat-journal';
      insert into channel_management_operations(id,channel_id,purpose,credential_ref,source_fingerprint,fingerprint_key_id,operation_permit,state,created_at,updated_at)
        values('forged-provision','wechat-journal','provision','forged-reserved','fingerprint','key','permit','needs-recovery','now','now');
    `)
    const operation = repository.beginDelete('wechat-journal', 'wechat-delete-op', 'now')!
    expect(operation).toMatchObject({ ref: '', expectedRevision: null, legacyMigrations: [], credentialCleanupRefs: [] })
    expect(database.connection.prepare("select credential_ref,credential_cleanup_refs_json,legacy_migrations_json from channel_management_operations where id='wechat-delete-op'").get()).toEqual({
      credential_ref: '', credential_cleanup_refs_json: '[]', legacy_migrations_json: '[]'
    })
    expect(database.connection.prepare("select state from channel_management_operations where id='forged-provision'").get()).toEqual({ state: 'abandoned' })
  })

  it('keeps codec local, never routes WeChat to Telegram, and purges WeChat state on delete', async () => {
    expect(encodeWechatConversation({ kind: 'group', id: 'group_1' })).toBe('wechat:conversation:group:group_1')
    expect(decodeWechatConversation('wechat:conversation:group:bad key')).toBeNull()
    expect(splitWechatText('x'.repeat(4_001)).map((part) => part.length)).toEqual([2_000, 2_000, 1])
    await expect(new WechatDeliveryTransport().send({ channelId: 'wechat-a', providerConversationKey: 'wechat:conversation:group:group_1', text: 'text', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
    const telegram = { send: vi.fn(), supportsIdempotency: vi.fn(() => false) }
    const router = new ChannelDeliveryTransportRouter({
      typeForChannel: () => 'wechat', telegram,
      slack: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) },
      lark: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) },
      qq: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) },
      discord: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) },
      wechat: new WechatDeliveryTransport()
    })
    await expect(router.send({ channelId: 'wechat-a', providerConversationKey: 'wechat:conversation:group:group_1', text: 'text', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
    expect(telegram.send).not.toHaveBeenCalled()
    const database = createDatabase(); const repository = new ChannelManagementRepository(database)
    expect(repository.create({ id: 'wechat-delete', type: 'wechat', name: 'WeChat', agentId: 'agent-a', now: 'now' })).toBe(true)
    database.connection.exec("insert into channel_wechat_qr_enrollments(operation_id,channel_id,state,expires_at,updated_at) values('qr-a','wechat-delete','cancelled','now','now'); insert into channel_wechat_poll_state(channel_id,generation,next_cursor,updated_at) values('wechat-delete',1,'opaque','now'); insert into channel_wechat_runtime_audits(id,channel_id,code,created_at) values('audit-a','wechat-delete','wechat-test','now')")
    expect(repository.beginDelete('wechat-delete', 'delete-op', 'now')).not.toBeNull()
    for (const table of ['channel_wechat_qr_enrollments', 'channel_wechat_poll_state', 'channel_wechat_runtime_audits']) {
      expect(database.connection.prepare(`select count(*) as count from ${table} where channel_id='wechat-delete'`).get()).toEqual({ count: 0 })
    }
  })
})

function createDatabase() { const value = createAgentPlatformDatabase(':memory:'); value.connection.exec("insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','now','now')"); return value }
function management(database: ReturnType<typeof createAgentPlatformDatabase>) { return new ChannelManagementService({ repository: new ChannelManagementRepository(database), vault: {} as never, cipher: {} as never, registry: new ChannelAdapterAcceptanceRegistry(), handoff: new ChannelSecureHandoff() }) }
function seedActiveWechat(database: ReturnType<typeof createAgentPlatformDatabase>) { database.connection.exec("insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at) values('wechat-a','wechat','WeChat','agent-a','{}',1,'enabled','configured','now','now'); insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('wechat-a',1,'active','now')") }
function seedIsolatedWechat(database: ReturnType<typeof createAgentPlatformDatabase>, publicConfig: string) { database.connection.exec(`insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at) values('legacy-wechat','wechat','Legacy','agent-a','${publicConfig}',1,'enabled','configured','now','now'); insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('legacy-wechat',1,'active','now'); insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at) values('legacy-wechat','legacy-owner','enable',1,'now','now')`) }
