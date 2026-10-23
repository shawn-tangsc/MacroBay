import { describe, expect, it, vi } from 'vitest'

import type { ChannelCredentialArchiveReservedInspection, ChannelCredentialMigrationReservation, ChannelCredentialSafeView, ChannelCredentialVault, ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { assertLarkSecret, assertSlackSecret } from './ChannelManagementContracts'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'

describe('ChannelManagementService', () => {
  it('creates Lark as non-running metadata with its only public domain preset and blocked enable never starts runtime', () => {
    const { service, database } = harness()
    const created = service.create({ type: 'feishu', name: 'Lark', agentId: 'agent-a', actorId: 'user-a' })
    expect(created).toMatchObject({ ok: true, channel: { type: 'feishu', requestedEnabled: false, state: 'credential-missing' } })
    expect(service.requestEnable({ id: created.channel!.id, actorId: 'user-a' })).toMatchObject({ ok: false, code: 'adapter-not-supported' })
    expect(database.connection.prepare('select type,public_config_json,requested_enabled,migration_state from agent_channels where id=?').get(created.channel!.id)).toEqual({
      type: 'feishu', public_config_json: '{"domain":"lark"}', requested_enabled: 0, migration_state: 'credential-missing'
    })
  })

  it('rejects malformed Lark credential shapes without a secret fallback field', () => {
    expect(() => assertLarkSecret({ app_id: 'cli_12345678', app_secret: 'a'.repeat(20) })).not.toThrow()
    expect(() => assertLarkSecret({ app_id: 'short', app_secret: 'a'.repeat(20) })).toThrow('channel-input-invalid')
    expect(() => assertLarkSecret({ app_id: 'cli_12345678', app_secret: 'a'.repeat(20), access_token: 'forbidden' })).toThrow('channel-input-invalid')
  })

  it.each(['{}', '{"domain":"feishu"}'])('keeps non-Lark Feishu storage rows outside every management and credential path: %s', async (publicConfig) => {
    const { service, database, repository, vault } = harness()
    database.connection.prepare(
      `insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at)
       values('legacy-feishu','feishu','Legacy','agent-a',?,0,'configuration-ready','missing','2026-07-20','2026-07-20')`
    ).run(publicConfig)

    expect(repository.channelType('legacy-feishu')).toBeNull()
    expect(repository.knownChannelType('legacy-feishu')).toBeNull()
    expect(service.get('legacy-feishu')).toBeNull()
    expect(service.list().some((channel) => channel.id === 'legacy-feishu')).toBe(false)
    expect(() => service.requestEnable({ id: 'legacy-feishu', actorId: 'user-a' })).toThrow('channel-not-found')
    expect(repository.credentialMetadata('legacy-feishu')).toBeNull()
    expect(vault.putReservedCalls).toBe(0)
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get('legacy-feishu')).toEqual({ count: 0 })
  })

  it('clears Lark runtime metadata and audit rows during the same delete isolation flow', async () => {
    const { service, database } = harness()
    const id = service.create({ type: 'feishu', name: 'Lark', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.exec(`
      insert into channel_lark_runtime_state(channel_id,generation,last_event_id_hash,updated_at) values('${id}',1,'opaque','2026-07-20');
      insert into channel_lark_runtime_audits(id,channel_id,code,created_at) values('lark-audit-${id}','${id}','lark-test','2026-07-20');
    `)
    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: true, code: 'deleted' })
    for (const table of ['channel_lark_runtime_state', 'channel_lark_runtime_audits']) {
      expect(database.connection.prepare(`select count(*) as count from ${table} where channel_id=?`).get(id)).toEqual({ count: 0 })
    }
  })
  it('creates Slack as non-running metadata, keeps blocked enable fail-closed, and exposes no secret material', () => {
    const { service, database } = harness()
    const created = service.create({ type: 'slack', name: 'Slack', agentId: 'agent-a', actorId: 'user-a' })

    expect(created).toMatchObject({ ok: true, code: 'configuration-ready', channel: {
      type: 'slack', requestedEnabled: false, state: 'credential-missing', credential: { hasCredential: false }
    } })
    expect(service.requestEnable({ id: created.channel!.id, actorId: 'user-a' })).toMatchObject({ ok: false, code: 'adapter-not-supported' })
    expect(database.connection.prepare('select type,requested_enabled,migration_state,config_json,active_chat_ids_json from agent_channels where id=?').get(created.channel!.id)).toEqual({
      type: 'slack', requested_enabled: 0, migration_state: 'credential-missing', config_json: null, active_chat_ids_json: null
    })
    expect(JSON.stringify(created)).not.toMatch(/xoxb-|xapp-|credential_ref|permit/i)
  })

  it('rejects malformed Slack secret shapes before they can reserve a Vault credential', () => {
    expect(() => assertSlackSecret({ bot_token: 'xoxb-short', app_token: 'xapp-valid-token-123' })).toThrow('channel-input-invalid')
    expect(() => assertSlackSecret({ bot_token: 'xoxb-valid-token-123', app_token: 'xapp-valid-token-123', extra: 'nope' })).toThrow('channel-input-invalid')
    expect(() => assertSlackSecret({ bot_token: 'xoxb-valid-token-123', app_token: 'xapp-valid token-123' })).toThrow('channel-input-invalid')
  })
  it('creates only non-running Telegram metadata and planned enable/restart cannot mutate it', () => {
    const { service, database } = harness()
    const created = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' })

    expect(created).toMatchObject({ ok: true, code: 'configuration-ready', channel: { requestedEnabled: false, state: 'credential-missing' } })
    expect(service.requestEnable({ id: created.channel!.id, actorId: 'user-a' })).toMatchObject({ ok: false, code: 'adapter-not-supported' })
    expect(service.restart({ id: created.channel!.id, actorId: 'user-a' })).toMatchObject({ ok: false, code: 'adapter-not-supported' })
    expect(database.connection.prepare('select requested_enabled,migration_state,config_json,active_chat_ids_json from agent_channels where id=?').get(created.channel!.id)).toEqual({
      requested_enabled: 0,
      migration_state: 'credential-missing',
      config_json: null,
      active_chat_ids_json: null
    })
  })

  it('does not enable without complete evidence, and complete evidence still requires a safe credential and runtime owner', async () => {
    const { service, database } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const supported = new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()])
    const guarded = new ChannelManagementService({
      repository: new ChannelManagementRepository(database), vault: harness().vault, cipher: new FakeCipher(), registry: supported,
      handoff: new ChannelSecureHandoff(), runtime: { start: async () => true, stop: () => {} }
    })
    await expect(Promise.resolve(guarded.requestEnable({ id, actorId: 'user-a' }))).resolves.toMatchObject({ ok: false, code: 'channel-credential-missing' })
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)).toEqual({ requested_enabled: 0, migration_state: 'credential-missing' })
  })

  it('fails closed after an accepted enable/restart runtime start failure and fences its generation', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = repository.query.list()[0]?.id ?? 'channel-runtime-failure'
    if (!repository.query.get(id)) expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-runtime-failure:ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    const service = new ChannelManagementService({
      repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(),
      runtime: { start: async () => { throw new Error('fetch failed') }, stop: () => {} }, now: () => new Date('2026-07-19T00:00:00.000Z')
    })
    await expect(Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))).resolves.toMatchObject({ ok: false, code: 'adapter-runtime-start-failed' })
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(database.connection.prepare('select lifecycle_state from channel_runtime_generations where channel_id=?').get(id)).toEqual({ lifecycle_state: 'inactive' })
  })

  it('fences all runtime-ready Telegram channels during bounded application shutdown', () => {
    const { database, repository } = harness()
    const id = repository.query.list()[0]?.id ?? 'channel-shutdown'
    if (!repository.query.get(id)) expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set requested_enabled=1,migration_state='runtime-ready',credential_health='configured' where id=?").run(id)
    database.connection.prepare("insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,1,'active','2026-07-19') on conflict(channel_id) do update set generation=1,lifecycle_state='active'").run(id)
    expect(repository.stopAllRuntimeAndFence('2026-07-19T00:00:00.000Z')).toContain(id)
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get(id)).toEqual({ generation: 2, lifecycle_state: 'inactive' })
  })

  it('quit invalidates a pending owner before deferred credential inspection can activate it', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-pending-quit'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-pending-quit:ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    let resolveInspect!: (value: ChannelCredentialSafeView | null) => void
    vault.inspectSafe = async () => new Promise<ChannelCredentialSafeView | null>((resolve) => { resolveInspect = resolve })
    const start = vi.fn(async () => true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(), runtime: { start, stop: () => {} } })
    const pending = Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    await vi.waitFor(() => expect(resolveInspect).toBeTypeOf('function'))
    expect(repository.stopAllRuntimeAndFence('2026-07-19T00:00:00.000Z')).toContain(id)
    resolveInspect({ credentialRef: 'channel-migration:channel-pending-quit:ref', revision: 1, maskedFields: {} })
    await pending
    expect(start).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual({ count: 0 })
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(database.connection.prepare('select lifecycle_state from channel_runtime_generations where channel_id=?').get(id)).toEqual({ lifecycle_state: 'inactive' })
  })

  it('quit invalidates a pending restart owner before its credential inspection resumes', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-pending-restart'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-pending-restart:ref',credential_revision=1,credential_health='configured',migration_state='runtime-ready',requested_enabled=1 where id=?").run(id)
    database.connection.prepare("insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,1,'active','2026-07-19')").run(id)
    let resolveInspect!: (value: ChannelCredentialSafeView | null) => void
    vault.inspectSafe = async () => new Promise<ChannelCredentialSafeView | null>((resolve) => { resolveInspect = resolve })
    const start = vi.fn(async () => true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(), runtime: { start, stop: () => {} } })
    const pending = Promise.resolve(service.restart({ id, actorId: 'user-a' }))
    await vi.waitFor(() => expect(resolveInspect).toBeTypeOf('function'))
    repository.stopAllRuntimeAndFence('2026-07-19T00:00:00.000Z')
    resolveInspect({ credentialRef: 'channel-migration:channel-pending-restart:ref', revision: 1, maskedFields: {} })
    await pending
    expect(start).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual({ count: 0 })
  })

  it.each(['disable', 'update'])('does not revive a suspended enable after concurrent %s fences its lifecycle owner', async (mutation) => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-enable-race'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-enable-race:ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    let resolveInspect!: (value: ChannelCredentialSafeView | null) => void
    vault.inspectSafe = async () => new Promise<ChannelCredentialSafeView | null>((resolve) => { resolveInspect = resolve })
    const start = vi.fn(async () => true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(), runtime: { start, stop: () => {} } })
    const pending = Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    await vi.waitFor(() => expect(resolveInspect).toBeTypeOf('function'))
    if (mutation === 'disable') service.disable({ id, actorId: 'user-a' })
    else service.update({ id, name: 'changed', agentId: 'agent-a', actorId: 'user-a' })
    resolveInspect({ credentialRef: 'channel-migration:channel-enable-race:ref', revision: 1, maskedFields: {} })
    await pending
    expect(start).not.toHaveBeenCalled()
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
  })

  it.each(['rotate', 'delete'])('does not revive a suspended enable after concurrent %s invalidates its owner', async (mutation) => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-enable-mutation'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-enable-mutation:ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    let resolveInspect!: (value: ChannelCredentialSafeView | null) => void
    vault.inspectSafe = async () => new Promise<ChannelCredentialSafeView | null>((resolve) => { resolveInspect = resolve })
    const start = vi.fn(async () => true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(), runtime: { start, stop: () => {} } })
    const pending = Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    await vi.waitFor(() => expect(resolveInspect).toBeTypeOf('function'))
    if (mutation === 'rotate') await service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await credentialHandoff(service, id, 'token-a') })
    else await service.delete({ id, actorId: 'user-a' })
    resolveInspect({ credentialRef: 'channel-migration:channel-enable-mutation:ref', revision: 1, maskedFields: {} })
    await pending
    expect(start).not.toHaveBeenCalled()
  })

  it('does not let a late failed owner stop or fence the newer enabled generation', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-owner-replacement'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-owner-replacement:ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    let finishA!: (value: boolean) => void
    const starts: Array<{ generation: number; token: string | undefined }> = []
    const stops: Array<string | undefined> = []
    const runtime = {
      start: (_id: string, generation: number, token?: string) => {
        starts.push({ generation, token })
        return starts.length === 1 ? new Promise<boolean>((resolve) => { finishA = resolve }) : Promise.resolve(true)
      },
      stop: (_id: string, token?: string) => { stops.push(token) }
    }
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(), runtime })
    const ownerA = Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    await vi.waitFor(() => expect(starts).toHaveLength(1))
    service.disable({ id, actorId: 'user-a' })
    const ownerB = Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    await expect(ownerB).resolves.toMatchObject({ ok: true, code: 'runtime-ready' })
    const beforeLateA = database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)
    const generationB = database.connection.prepare('select generation from channel_runtime_generations where channel_id=?').get(id)
    finishA(false)
    await expect(ownerA).resolves.toMatchObject({ ok: false })
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)).toEqual(beforeLateA)
    expect(database.connection.prepare('select generation from channel_runtime_generations where channel_id=?').get(id)).toEqual(generationB)
    expect(stops.filter((token) => token === starts[1]?.token)).toHaveLength(0)
  })

  it('treats duplicate enable on an active owner as idempotent without replacing its token or host', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-duplicate-enable'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-duplicate-enable:ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    const start = vi.fn(async () => true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(), runtime: { start, stop: () => {} } })
    await expect(Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))).resolves.toMatchObject({ ok: true, code: 'runtime-ready' })
    const owner = database.connection.prepare('select owner_token,generation from channel_telegram_lifecycle_operations where channel_id=?').get(id)
    const generation = database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get(id)
    await expect(Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))).resolves.toMatchObject({ ok: true, code: 'runtime-ready' })
    expect(database.connection.prepare('select owner_token,generation from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual(owner)
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get(id)).toEqual(generation)
    expect(start).toHaveBeenCalledOnce()
  })

  it('does not create or fence an owner when restart is requested from disabled', () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-disabled-restart'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    expect(service.restart({ id, actorId: 'user-a' })).toMatchObject({ ok: false })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual({ count: 0 })
    expect(database.connection.prepare('select 1 from channel_runtime_generations where channel_id=?').get(id)).toBeUndefined()
  })

  it('atomically replaces an exact active owner on restart and late owner A cannot fence generation B', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-active-restart'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-active-restart:ref',credential_revision=1,credential_health='configured',migration_state='runtime-ready',requested_enabled=1 where id=?").run(id)
    database.connection.prepare("insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,7,'active','2026-07-19')").run(id)
    database.connection.prepare("insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at) values(?,'owner-a','enable',7,'2026-07-19','2026-07-19')").run(id)
    let resolveInspect!: (value: ChannelCredentialSafeView | null) => void
    vault.inspectSafe = async () => new Promise<ChannelCredentialSafeView | null>((resolve) => { resolveInspect = resolve })
    const start = vi.fn(async () => true)
    const stop = vi.fn()
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff(), runtime: { start, stop } })

    const restart = Promise.resolve(service.restart({ id, actorId: 'user-a' }))
    await vi.waitFor(() => expect(resolveInspect).toBeTypeOf('function'))
    expect(repository.ownsLifecycleOwner(id, { token: 'owner-a', purpose: 'enable', generation: 7 })).toBe(false)
    resolveInspect({ credentialRef: 'channel-migration:channel-active-restart:ref', revision: 1, maskedFields: {} })
    await expect(restart).resolves.toMatchObject({ ok: true, code: 'restarted' })

    const ownerB = database.connection.prepare('select owner_token,purpose,generation from channel_telegram_lifecycle_operations where channel_id=?').get(id)
    expect(ownerB).toMatchObject({ purpose: 'restart' })
    expect(ownerB).not.toMatchObject({ owner_token: 'owner-a' })
    const generationB = database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get(id)
    expect(generationB).toMatchObject({ lifecycle_state: 'active' })
    expect(repository.failOwnedRuntime(id, { token: 'owner-a', purpose: 'enable', generation: 7 }, '2026-07-19')).toBe(false)
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get(id)).toEqual(generationB)
    expect(start).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalled()
  })

  it('does not let a superseded provision continue from handoff preparation into a Vault put or metadata write', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-provision-owner-race'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    const handoff = new ChannelSecureHandoff()
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff })
    const handoffA = await credentialHandoff(service, id, 'token-a')
    const handoffB = await credentialHandoff(service, id, 'token-b')
    let releasePrepare!: () => void
    let preparations = 0
    vault.prepareMigration = async () => {
      preparations += 1
      if (preparations === 1) await new Promise<void>((resolve) => { releasePrepare = resolve })
      return { credentialRef: 'reserved-ref', sourceFingerprint: 'fingerprint', fingerprintKeyId: 'key', migrationPermit: 'permit' }
    }

    const first = service.provision({ id, actorId: 'user-a', senderId: 7, handoff: handoffA })
    await vi.waitFor(() => expect(releasePrepare).toBeTypeOf('function'))
    const second = service.provision({ id, actorId: 'user-b', senderId: 7, handoff: handoffB })
    releasePrepare()

    await expect(first).resolves.toMatchObject({ ok: false, code: 'channel-management-metadata-failed' })
    await expect(second).resolves.toMatchObject({ ok: true, code: 'configuration-ready' })
    expect(vault.putReservedCalls).toBe(1)
    expect(database.connection.prepare('select credential_ref,credential_revision,migration_state from agent_channels where id=?').get(id)).toEqual({
      credential_ref: 'reserved-ref', credential_revision: 1, migration_state: 'configuration-ready'
    })
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where channel_id=? and state='completed'").get(id)).toEqual({ count: 1 })
  })

  it.each(['disable', 'update', 'delete'] as const)('does not let a provision reservation continue after concurrent %s wins the mutation fence', async (mutation) => {
    const { database, repository, vault, cipher } = harness()
    const id = `channel-provision-${mutation}-winner`
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    const credential = await credentialHandoff(service, id, 'token-a')
    let releasePrepare!: () => void
    vault.prepareMigration = async () => {
      await new Promise<void>((resolve) => { releasePrepare = resolve })
      return { credentialRef: 'reserved-ref', sourceFingerprint: 'fingerprint', fingerprintKeyId: 'key', migrationPermit: 'permit' }
    }
    const first = service.provision({ id, actorId: 'user-a', senderId: 7, handoff: credential })
    await vi.waitFor(() => expect(releasePrepare).toBeTypeOf('function'))
    if (mutation === 'disable') service.disable({ id, actorId: 'user-b' })
    else if (mutation === 'update') service.update({ id, name: 'New name', agentId: 'agent-a', actorId: 'user-b' })
    else await service.delete({ id, actorId: 'user-b' })
    releasePrepare()

    await expect(first).resolves.toMatchObject({ ok: false, code: 'channel-management-metadata-failed' })
    expect(vault.putReservedCalls).toBe(0)
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where purpose='provision' and state != 'superseded'").get()).toEqual({ count: 0 })
    if (mutation === 'delete') expect(database.connection.prepare('select 1 from agent_channels where id=?').get(id)).toBeUndefined()
    else expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'disabled' })
  })

  it('does not let a superseded rotate continue from a credential handoff into a Vault rotation', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-rotate-owner-race'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    const handoff = new ChannelSecureHandoff()
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff })
    const rotateHandoff = await credentialHandoff(service, id, 'token-a')
    const originalConsume = handoff.consume.bind(handoff)
    let releaseConsume!: () => void
    vi.spyOn(handoff, 'consume').mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => { releaseConsume = resolve })
      return originalConsume(input)
    })
    const rotate = service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: rotateHandoff })
    await vi.waitFor(() => expect(releaseConsume).toBeTypeOf('function'))
    service.disable({ id, actorId: 'user-b' })
    releaseConsume()

    await expect(rotate).resolves.toMatchObject({ ok: false, code: 'channel-management-metadata-failed' })
    expect(database.connection.prepare('select credential_ref,credential_revision,migration_state from agent_channels where id=?').get(id)).toEqual({
      credential_ref: 'known-ref', credential_revision: 1, migration_state: 'disabled'
    })
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where channel_id=? and purpose='rotate'").get(id)).toEqual({ count: 0 })
    expect(vault.inspectRefs).not.toContain('known-ref')
  })

  it.each(['disable', 'update'] as const)('preserves an existing credential after a stale rotate advances its Vault revision and %s fences it', async (mutation) => {
    const { database, repository, vault, cipher } = harness()
    const id = `channel-revoked-rotate-${mutation}`
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    const credential = await credentialHandoff(service, id, 'token-a')
    let releaseRotate!: () => void
    const originalRotate = vault.rotateIfRevision.bind(vault)
    vault.rotateIfRevision = async (ref, expected, value, mutation) => {
      await new Promise<void>((resolve) => { releaseRotate = resolve })
      return originalRotate(ref, expected, value, mutation)
    }
    const rotation = service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: credential })
    await vi.waitFor(() => expect(releaseRotate).toBeTypeOf('function'))
    if (mutation === 'disable') service.disable({ id, actorId: 'user-b' })
    else service.update({ id, name: 'changed', agentId: 'agent-a', actorId: 'user-b' })
    releaseRotate()
    await expect(rotation).resolves.toMatchObject({ ok: false })
    await service.recover()
    expect(database.connection.prepare('select credential_ref,credential_revision,credential_health,migration_state,requested_enabled from agent_channels where id=?').get(id)).toEqual({
      credential_ref: 'known-ref', credential_revision: 2, credential_health: 'configured', migration_state: 'disabled', requested_enabled: 0
    })
    expect(vault.deleted).not.toContain('known-ref')
    expect(vault.inspectRefs).toContain('known-ref')
  })

  it('does not let stale rotate A settle metadata after B obtains a later mutation epoch', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-rotate-epoch-winner'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    let releaseA!: () => void
    let rotateCalls = 0
    const originalRotate = vault.rotateIfRevision.bind(vault)
    vault.rotateIfRevision = async (ref, expected, value, mutation) => {
      rotateCalls += 1
      if (rotateCalls === 1) await new Promise<void>((resolve) => { releaseA = resolve })
      return originalRotate(ref, expected, value, mutation)
    }
    const A = service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await credentialHandoff(service, id, 'token-a') })
    await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'))
    service.disable({ id, actorId: 'user-b' })
    // B gets its durable owner/epoch before A's external rotate returns, but does not call Vault yet.
    const B = service.rotate({ id, actorId: 'user-b', senderId: 7, handoff: await credentialHandoff(service, id, 'token-b') })
    await vi.waitFor(() => expect(database.connection.prepare("select count(*) as count from channel_telegram_lifecycle_operations where channel_id=? and purpose='mutation'").get(id)).toEqual({ count: 1 }))
    releaseA()
    await expect(A).resolves.toMatchObject({ ok: false })
    expect(database.connection.prepare('select credential_revision,credential_health,migration_state from agent_channels where id=?').get(id)).toEqual({
      credential_revision: 1, credential_health: 'configured', migration_state: 'disabled'
    })
    expect(database.connection.prepare("select count(*) as count from channel_telegram_lifecycle_operations where channel_id=? and purpose='mutation'").get(id)).toEqual({ count: 1 })
    // B cannot silently use stale revision 1 after A's Vault advance; it fails closed without A overwriting B's intent.
    await expect(B).resolves.toMatchObject({ ok: false })
    expect(database.connection.prepare('select credential_revision,migration_state from agent_channels where id=?').get(id)).toEqual({ credential_revision: 1, migration_state: 'disabled' })
  })

  it('does not let restart recovery attribute A\'s completed Vault rotation to B after B loses the revision CAS', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-rotate-receipt-attribution'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    let releaseA!: () => void
    const originalRotate = vault.rotateIfRevision.bind(vault)
    let calls = 0
    vault.rotateIfRevision = async (ref, expected, value, mutation) => {
      calls += 1
      if (calls === 1) await new Promise<void>((resolve) => { releaseA = resolve })
      return originalRotate(ref, expected, value, mutation)
    }

    const A = service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await credentialHandoff(service, id, 'token-a') })
    await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'))
    service.disable({ id, actorId: 'user-b' })
    const B = service.rotate({ id, actorId: 'user-b', senderId: 7, handoff: await credentialHandoff(service, id, 'token-b') })
    releaseA()
    await expect(A).resolves.toMatchObject({ ok: false })
    await expect(B).resolves.toMatchObject({ ok: false })

    // B's journal survives the failed CAS until restart recovery. It must not adopt A's receipt.
    await service.recover()
    expect(database.connection.prepare('select credential_revision,credential_health,migration_state,requested_enabled from agent_channels where id=?').get(id)).toEqual({
      credential_revision: 1, credential_health: 'unavailable', migration_state: 'disabled', requested_enabled: 0
    })
    expect(await vault.inspectSafe('known-ref')).toMatchObject({ revision: 2 })
    expect(await vault.inspectMutationReceipt('known-ref')).toMatchObject({ mutationEpoch: 1, revision: 2 })
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where channel_id=? and state in ('external-inflight','revoked-inflight','revoked-cleanup')").get(id)).toEqual({ count: 0 })
    expect(database.connection.prepare("select stable_error_code from channel_management_operations where channel_id=? order by updated_at desc limit 1").get(id)).toEqual({
      stable_error_code: 'channel-credential-mutation-unattributed'
    })
  })

  it('recovers a crashed exact rotate owner, settles its matching receipt, and releases the persisted owner', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-crashed-rotate-owner'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,credential_health='configured',migration_state='disabled',mutation_epoch=1 where id=?").run(id)
    const operationId = '7c8d2be0-374e-4ad1-bbad-616d939e1bbd'
    const ownerToken = 'crash-owner-token'
    database.connection.prepare(
      `insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
       values(?,?,'mutation',null,'2026-07-19','2026-07-19')`
    ).run(id, ownerToken)
    database.connection.prepare(
      `insert into channel_management_operations(id,channel_id,purpose,credential_ref,expected_revision,lifecycle_owner_token,mutation_epoch,state,created_at,updated_at)
       values(?,?,'rotate','known-ref',1,?,1,'external-inflight','2026-07-19','2026-07-19')`
    ).run(operationId, id, ownerToken)
    vault.mutationReceipt = { channelId: id, operationId, mutationEpoch: 1, credentialRef: 'known-ref', revision: 2 }
    vault.inspectRevision = 2
    const recovered = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })

    await recovered.recover()

    expect(database.connection.prepare('select credential_revision,credential_health,migration_state,requested_enabled from agent_channels where id=?').get(id)).toEqual({
      credential_revision: 2, credential_health: 'configured', migration_state: 'disabled', requested_enabled: 0
    })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual({ count: 0 })
    expect(database.connection.prepare('select state from channel_management_operations where id=?').get(operationId)).toEqual({ state: 'completed' })
    expect(repository.beginLifecycleOwner(id, 'mutation', 'next-owner', '2026-07-20')).toMatchObject({ token: 'next-owner', epoch: 2 })
  })

  it('releases a crashed exact owner on a mismatched receipt without adopting the Vault revision', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-crashed-rotate-mismatch'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,credential_health='configured',migration_state='disabled',mutation_epoch=1 where id=?").run(id)
    database.connection.prepare(
      `insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
       values(?,'crash-owner','mutation',null,'2026-07-19','2026-07-19')`
    ).run(id)
    database.connection.prepare(
      `insert into channel_management_operations(id,channel_id,purpose,credential_ref,expected_revision,lifecycle_owner_token,mutation_epoch,state,created_at,updated_at)
       values('crash-op',?,'rotate','known-ref',1,'crash-owner',1,'external-inflight','2026-07-19','2026-07-19')`
    ).run(id)
    vault.mutationReceipt = { channelId: id, operationId: '1b2e9d0d-b9a4-46ed-8f31-8a35dd0752d2', mutationEpoch: 9, credentialRef: 'known-ref', revision: 2 }
    vault.inspectRevision = 2

    await new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() }).recover()

    expect(database.connection.prepare('select credential_revision,credential_health,migration_state from agent_channels where id=?').get(id)).toEqual({
      credential_revision: 1, credential_health: 'unavailable', migration_state: 'disabled'
    })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual({ count: 0 })
    expect(database.connection.prepare("select state,stable_error_code from channel_management_operations where id='crash-op'").get()).toEqual({
      state: 'completed', stable_error_code: 'channel-credential-mutation-unattributed'
    })
  })

  it('releases a crashed exact owner when mutation receipt inspection throws', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-crashed-rotate-receipt-throws'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,credential_health='configured',migration_state='disabled',mutation_epoch=1 where id=?").run(id)
    const operationId = '7c8d2be0-374e-4ad1-bbad-616d939e1bbd'
    database.connection.prepare(
      `insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
       values(?,'receipt-throw-owner','mutation',null,'2026-07-19','2026-07-19')`
    ).run(id)
    database.connection.prepare(
      `insert into channel_management_operations(id,channel_id,purpose,credential_ref,expected_revision,lifecycle_owner_token,mutation_epoch,state,created_at,updated_at)
       values(?,?,'rotate','known-ref',1,'receipt-throw-owner',1,'external-inflight','2026-07-19','2026-07-19')`
    ).run(operationId, id)
    vault.inspectRevision = 2
    vault.inspectMutationReceipt = async () => { throw new Error('vault unavailable') }

    await new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() }).recover()

    expect(database.connection.prepare('select credential_revision,credential_health,migration_state,requested_enabled from agent_channels where id=?').get(id)).toEqual({
      credential_revision: 1, credential_health: 'unavailable', migration_state: 'disabled', requested_enabled: 0
    })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual({ count: 0 })
    expect(database.connection.prepare('select state,stable_error_code from channel_management_operations where id=?').get(operationId)).toEqual({
      state: 'completed', stable_error_code: 'channel-credential-unavailable'
    })
    expect(repository.beginLifecycleOwner(id, 'mutation', 'post-throw-owner', '2026-07-20')).toMatchObject({ token: 'post-throw-owner', epoch: 2 })
  })

  it.each(['disable', 'update'] as const)('retains a permit-bound cleanup journal when %s revokes an in-flight provision', async (mutation) => {
    const { database, repository, vault, cipher } = harness()
    const id = `channel-inflight-provision-${mutation}`
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    const credential = await credentialHandoff(service, id, 'token-a')
    let releasePut!: () => void
    vault.putReserved = async () => {
      await new Promise<void>((resolve) => { releasePut = resolve })
      vault.putReservedCalls += 1
      return { credentialRef: 'reserved-ref', revision: 1, maskedFields: {} }
    }
    const pending = service.provision({ id, actorId: 'user-a', senderId: 7, handoff: credential })
    await vi.waitFor(() => expect(releasePut).toBeTypeOf('function'))
    if (mutation === 'disable') service.disable({ id, actorId: 'user-b' })
    else service.update({ id, name: 'changed', agentId: 'agent-a', actorId: 'user-b' })
    expect(database.connection.prepare("select state,operation_permit from channel_management_operations where channel_id=? and purpose='provision'").get(id)).toMatchObject({ state: 'revoked-inflight' })
    releasePut()
    await expect(pending).resolves.toMatchObject({ ok: false })
    expect(database.connection.prepare('select credential_ref,migration_state from agent_channels where id=?').get(id)).toEqual({ credential_ref: null, migration_state: 'disabled' })
    expect(database.connection.prepare("select state,operation_permit from channel_management_operations where channel_id=? and purpose='provision'").get(id)).toMatchObject({ state: 'completed', operation_permit: null })
  })

  it('does not delete a deterministic provision ref already adopted by a newer winner', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-shared-provision-ref'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    const firstHandoff = await credentialHandoff(service, id, 'same-token')
    let releaseA!: () => void
    let puts = 0
    vault.putReserved = async () => {
      puts += 1
      if (puts === 1) await new Promise<void>((resolve) => { releaseA = resolve })
      vault.putReservedCalls += 1
      return { credentialRef: 'reserved-ref', revision: 1, maskedFields: {} }
    }
    const first = service.provision({ id, actorId: 'user-a', senderId: 7, handoff: firstHandoff })
    await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'))
    service.disable({ id, actorId: 'user-b' })
    const second = service.provision({ id, actorId: 'user-b', senderId: 7, handoff: await credentialHandoff(service, id, 'same-token') })
    await expect(second).resolves.toMatchObject({ ok: true, code: 'configuration-ready' })
    releaseA()
    await expect(first).resolves.toMatchObject({ ok: false })
    expect(database.connection.prepare('select credential_ref,credential_revision,migration_state from agent_channels where id=?').get(id)).toEqual({
      credential_ref: 'reserved-ref', credential_revision: 1, migration_state: 'configuration-ready'
    })
    expect(vault.reservedDeletes).toBe(0)
  })

  it('cannot delete a winner that adopts the same ref after stale cleanup has claimed it', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-cleanup-claim-race'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    const firstHandoff = await credentialHandoff(service, id, 'same-token')
    let releasePut!: () => void
    vault.putReserved = async () => {
      await new Promise<void>((resolve) => { releasePut = resolve })
      return { credentialRef: 'reserved-ref', revision: 1, maskedFields: {} }
    }
    let releaseDelete!: () => void
    vault.deleteReservedIfCleanupClaim = async (input: { cleanupToken: string }) => {
      await new Promise<void>((resolve) => { releaseDelete = resolve })
      return input.cleanupToken === vault.cleanupClaim
    }
    const first = service.provision({ id, actorId: 'user-a', senderId: 7, handoff: firstHandoff })
    await vi.waitFor(() => expect(releasePut).toBeTypeOf('function'))
    service.disable({ id, actorId: 'user-b' })
    releasePut()
    await vi.waitFor(() => expect(releaseDelete).toBeTypeOf('function'))
    vault.putReserved = async () => {
      // Same-value adoption revokes the stale cleanup claim in the real Vault contract.
      vault.cleanupClaim = null
      return { credentialRef: 'reserved-ref', revision: 1, maskedFields: {} }
    }
    await expect(service.provision({ id, actorId: 'user-b', senderId: 7, handoff: await credentialHandoff(service, id, 'same-token') })).resolves.toMatchObject({ ok: true })
    releaseDelete()
    await expect(first).resolves.toMatchObject({ ok: false })
    expect(database.connection.prepare('select credential_ref,credential_revision from agent_channels where id=?').get(id)).toEqual({ credential_ref: 'reserved-ref', credential_revision: 1 })
  })

  it('keeps deleting and both known journals when revoked cleanup fails, then settles on recovery', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-delete-revoked-cleanup'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    const credential = await credentialHandoff(service, id, 'token-a')
    let releasePut!: () => void
    vault.putReserved = async () => {
      await new Promise<void>((resolve) => { releasePut = resolve })
      return { credentialRef: 'reserved-ref', revision: 1, maskedFields: {} }
    }
    const provision = service.provision({ id, actorId: 'user-a', senderId: 7, handoff: credential })
    await vi.waitFor(() => expect(releasePut).toBeTypeOf('function'))
    vault.failReservedDelete = true
    const deletion = service.delete({ id, actorId: 'user-b' })
    releasePut()
    await provision
    await expect(deletion).resolves.toMatchObject({ ok: false, code: 'channel-delete-pending' })
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'deleting' })
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where channel_id=? and state in ('revoked-cleanup','revoked-inflight','external-inflight')").get(id)).toEqual({ count: 1 })
    expect(database.connection.prepare("select credential_cleanup_refs_json from channel_management_operations where channel_id=? and purpose='delete'").get(id)).toMatchObject({ credential_cleanup_refs_json: expect.stringContaining('reserved-ref') })
    vault.failReservedDelete = false
    await service.recover()
    expect(database.connection.prepare('select 1 from agent_channels where id=?').get(id)).toBeUndefined()
  })

  it('clears its pending owner when activation preconditions change after credential inspection', async () => {
    const { database, repository, vault, cipher } = harness()
    const id = 'channel-activation-failure'
    expect(repository.create({ id, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare("update agent_channels set credential_ref='channel-migration:channel-activation-failure:ref',credential_revision=1,credential_health='configured',migration_state='configuration-ready' where id=?").run(id)
    let resolveInspect!: (value: ChannelCredentialSafeView | null) => void
    vault.inspectSafe = async () => new Promise<ChannelCredentialSafeView | null>((resolve) => { resolveInspect = resolve })
    const service = new ChannelManagementService({ repository, vault, cipher, registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]), handoff: new ChannelSecureHandoff() })
    const pending = Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    await vi.waitFor(() => expect(resolveInspect).toBeTypeOf('function'))
    database.connection.prepare("update agent_channels set credential_health='missing' where id=?").run(id)
    resolveInspect({ credentialRef: 'channel-migration:channel-activation-failure:ref', revision: 1, maskedFields: {} })
    await pending
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get(id)).toEqual({ count: 0 })
  })

  it('requires a real Agent, fences update/disable, and never exposes management secrets', () => {
    const { service, database, repository } = harness()
    expect(service.create({ name: 'Telegram', agentId: 'missing', actorId: 'user-a' })).toEqual({ ok: false, code: 'channel-agent-missing' })

    const created = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' })
    const id = created.channel!.id
    database.connection.prepare("insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,1,'active','2026-07-19')").run(id)
    expect(service.update({ id, name: 'Renamed', agentId: 'agent-a', actorId: 'user-a' })).toMatchObject({ ok: true })
    expect(service.disable({ id, actorId: 'user-a' })).toMatchObject({ ok: true, code: 'disabled' })
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get(id)).toEqual({ generation: 3, lifecycle_state: 'inactive' })

    const json = JSON.stringify([service.list(), service.catalog(), repository.query.audits(id, 100, 0), repository.query.runtime(id)])
    expect(json).not.toMatch(/credential_ref|bot_token|activeChatIds|session_id|ciphertext|provider.*key/i)
  })

  it('writes durable delete intent before Vault deletion and restarts known-ref cleanup without making the channel runnable', async () => {
    const { service, database, vault, cipher } = harness({ failDelete: true })
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const ref = `channel-migration:${id}:metadata-ref`
    database.connection.prepare("update agent_channels set credential_ref=?,credential_revision=2,migration_state='configuration-ready' where id=?").run(ref, id)

    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: false, code: 'channel-delete-pending' })
    expect(database.connection.prepare('select migration_state,requested_enabled from agent_channels where id=?').get(id)).toEqual({ migration_state: 'deleting', requested_enabled: 0 })
    expect(database.connection.prepare("select purpose,credential_ref,state from channel_management_operations where channel_id=?").get(id)).toEqual({ purpose: 'delete', credential_ref: ref, state: 'needs-recovery' })
    expect(cipher.destroyed).toEqual([id])

    vault.failDelete = false
    await service.recover()
    expect(database.connection.prepare('select 1 from agent_channels where id=?').get(id)).toBeUndefined()
    expect(vault.deleted).toEqual([ref, ref])
  })

  it('erases every C03 row before final delete, destroys payload keys, and rejects an old renderer-selected identity', async () => {
    const { service, database, repository, cipher } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    seedC03Rows(database, id)

    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: true, code: 'deleted' })
    for (const table of c03Tables) {
      expect(database.connection.prepare(`select count(*) as count from ${table} where channel_id=?`).get(id)).toEqual({ count: 0 })
    }
    expect(cipher.destroyed).toEqual([id])
    expect(() => service.create({ id, name: 'attacker', agentId: 'agent-a', actorId: 'user-a' } as never)).toThrow('channel-input-invalid')
    expect(repository.create({ id, name: 'attacker', agentId: 'agent-a', now: '2026-07-19' })).toBe(false)
    expect(service.get(id)).toBeNull()
  })

  it('keeps deleting on payload-key destruction failure and completes the known delete journal on recovery', async () => {
    const { service, database, cipher, vault } = harness({ failDestroy: true })
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const ref = `channel-migration:${id}:metadata-ref`
    database.connection.prepare("update agent_channels set credential_ref=?,credential_revision=1,migration_state='configuration-ready',credential_health='configured' where id=?").run(ref, id)

    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: false, code: 'channel-delete-pending' })
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'deleting' })
    expect(vault.deleted).toEqual([])
    cipher.failDestroy = false
    await service.recover()
    expect(database.connection.prepare('select 1 from agent_channels where id=?').get(id)).toBeUndefined()
    expect(cipher.destroyed).toEqual([id, id])
    expect(vault.deleted).toEqual([ref])
  })

  it('deletes known Stage 1 provider/archive refs with their dedicated APIs before removing every migration row', async () => {
    const { service, database, vault } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const ref = `channel-migration:${id}:management-ref`
    database.connection.prepare("update agent_channels set credential_ref=?,credential_revision=1,migration_state='configuration-ready' where id=?").run(ref, id)
    seedLegacyMigrationRows(database, id)

    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: true, code: 'deleted' })

    expect(vault.deleted).toEqual(expect.arrayContaining([ref, `channel-migration:${id}:provider-fingerprint`]))
    expect(vault.deleted).not.toContain(`channel-migration-archive:${id}:archive-fingerprint`)
    expect(vault.deletedArchives).toEqual([{ channelId: id, credentialRef: `channel-migration-archive:${id}:archive-fingerprint` }])
    for (const table of ['channel_credential_migrations', 'channel_legacy_discovery_archives', ...c03Tables]) {
      expect(database.connection.prepare(`select count(*) as count from ${table} where channel_id=?`).get(id)).toEqual({ count: 0 })
    }
  })

  it('keeps a complete Stage 1 archive delete intent for restart recovery when archive cleanup fails', async () => {
    const { service, database, vault } = harness({ failArchiveDelete: true })
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    seedLegacyMigrationRows(database, id)

    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: false, code: 'channel-delete-pending' })
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'deleting' })
    const operation = database.connection.prepare("select legacy_migrations_json from channel_management_operations where channel_id=? and purpose='delete'").get(id) as { legacy_migrations_json: string }
    expect(operation.legacy_migrations_json).toContain(`channel-migration-archive:${id}:archive-fingerprint`)
    vault.failArchiveDelete = false
    await service.recover()
    expect(vault.deletedArchives.filter((item) => item.credentialRef === `channel-migration-archive:${id}:archive-fingerprint`)).toHaveLength(2)
    expect(database.connection.prepare('select 1 from agent_channels where id=?').get(id)).toBeUndefined()
  })

  it('uses SQLite revision CAS after Vault rotation and leaves metadata fail-closed for restart recovery', async () => {
    const { service, database, vault } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,migration_state='configuration-ready' where id=?").run(id)
    database.connection.exec(`create trigger management_stale_metadata before update of credential_revision on agent_channels when new.credential_revision = 2 begin select raise(ignore); end;`)

    const handoff = await credentialHandoff(service, id, 'token-a')
    await expect(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff })).resolves.toMatchObject({ ok: false, code: 'channel-management-metadata-failed' })
    expect(database.connection.prepare('select requested_enabled,migration_state,credential_revision from agent_channels where id=?').get(id)).toEqual({
      requested_enabled: 0,
      migration_state: 'configuration-ready',
      credential_revision: 1
    })
    expect(database.connection.prepare("select purpose,state,expected_revision from channel_management_operations where channel_id=?").get(id)).toEqual({
      purpose: 'rotate',
      state: 'needs-recovery',
      expected_revision: 1
    })

    database.connection.exec('drop trigger management_stale_metadata')
    await service.recover()
    expect(database.connection.prepare('select credential_revision,requested_enabled from agent_channels where id=?').get(id)).toEqual({ credential_revision: 2, requested_enabled: 0 })
    expect(vault.inspectRefs).toEqual(['known-ref'])
  })

  it('abandons a rotate intent when Vault failed before write and never pretends the old revision completed', async () => {
    const { service, database, vault } = harness({ failRotate: true })
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,migration_state='configuration-ready',credential_health='configured' where id=?").run(id)

    await expect(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await credentialHandoff(service, id, 'token-a') })).resolves.toMatchObject({ ok: false, code: 'channel-credential-unavailable' })
    await service.recover()
    expect(database.connection.prepare('select credential_revision from agent_channels where id=?').get(id)).toEqual({ credential_revision: 1 })
    expect(database.connection.prepare("select state from channel_management_operations where channel_id=?").get(id)).toEqual({ state: 'abandoned' })
  })

  it('fails closed when a recovered rotate observes a jumped revision instead of adopting it', async () => {
    const { service, database, vault } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,migration_state='configuration-ready',credential_health='configured' where id=?").run(id)
    database.connection.exec(`create trigger management_stale_metadata before update of credential_revision on agent_channels when new.credential_revision = 2 begin select raise(ignore); end;`)
    await service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await credentialHandoff(service, id, 'token-a') })
    database.connection.exec('drop trigger management_stale_metadata')
    vault.inspectRevision = 4
    await service.recover()
    expect(database.connection.prepare('select credential_revision,credential_health,migration_state from agent_channels where id=?').get(id)).toEqual({
      credential_revision: 1, credential_health: 'unavailable', migration_state: 'configuration-ready'
    })
    expect(database.connection.prepare("select state from channel_management_operations where channel_id=?").get(id)).toEqual({ state: 'revoked-cleanup' })
  })

  it('fails closed when a recovered rotation receipt belongs to another operation', async () => {
    const { service, database, vault } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,migration_state='configuration-ready',credential_health='configured' where id=?").run(id)
    database.connection.exec(`create trigger management_stale_metadata before update of credential_revision on agent_channels when new.credential_revision = 2 begin select raise(ignore); end;`)
    await service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await credentialHandoff(service, id, 'token-a') })
    database.connection.exec('drop trigger management_stale_metadata')
    vault.mutationReceipt = {
      channelId: id,
      operationId: '1b2e9d0d-b9a4-46ed-8f31-8a35dd0752d2',
      mutationEpoch: 99,
      credentialRef: 'known-ref',
      revision: 2
    }
    await service.recover()
    expect(database.connection.prepare('select credential_revision,credential_health from agent_channels where id=?').get(id)).toEqual({
      credential_revision: 1, credential_health: 'unavailable'
    })
  })

  it('releases an unwritten provision reservation after restart so the safe retry can proceed', async () => {
    const { service, database, vault } = harness({ failPutReserved: true })
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const handoff = await credentialHandoff(service, id, 'token-a')

    await expect(service.provision({ id, actorId: 'user-a', senderId: 7, handoff })).resolves.toMatchObject({ ok: false, code: 'channel-credential-unavailable' })
    expect(database.connection.prepare("select state from channel_management_operations where channel_id=?").get(id)).toEqual({ state: 'reserved' })
    await service.recover()
    expect(database.connection.prepare("select state from channel_management_operations where channel_id=?").get(id)).toEqual({ state: 'abandoned' })
    vault.failPutReserved = false
    const retry = await credentialHandoff(service, id, 'token-b')
    await expect(service.provision({ id, actorId: 'user-a', senderId: 7, handoff: retry })).resolves.toMatchObject({ ok: true, code: 'configuration-ready' })
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(id)).toEqual({ requested_enabled: 0, migration_state: 'configuration-ready' })
  })

  it('only allows policies and targets tied to this C03 channel, and their DTOs never reveal protected keys', () => {
    const { service, database } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare(`insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at) values('conversation-a',?,x'01','payload-ref',1,'opaque-hash','direct','session-a','2026-07-19','2026-07-19')`).run(id)
    expect(service.setTarget({ channelId: id, conversationId: 'conversation-a', enabled: true, actorId: 'user-a' })).toEqual({ ok: true, code: 'target-updated' })
    expect(service.setTarget({ channelId: id, conversationId: 'not-a-conversation', enabled: true, actorId: 'user-a' })).toEqual({ ok: false, code: 'channel-not-found' })
    expect(JSON.stringify(service.listConversations({ id, limit: 100 }))).not.toMatch(/payload-ref|opaque-hash|session-a/i)
  })

  it('rejects begin-delete-submit credential and policy handoffs without new Vault or policy writes', async () => {
    const { service, database, vault, cipher } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const credential = await credentialHandoff(service, id, 'token-a')
    const policy = await policyHandoff(service, id)
    await service.delete({ id, actorId: 'user-a' })

    await expect(service.provision({ id, actorId: 'user-a', senderId: 7, handoff: credential })).rejects.toThrow('channel-not-found')
    await expect(service.createPolicy({ id, actorId: 'user-a', senderId: 7, handoff: policy })).rejects.toThrow('channel-not-found')
    expect(vault.putReservedCalls).toBe(0)
    expect(cipher.encryptCalls).toBe(0)
    expect(database.connection.prepare('select count(*) as count from channel_allow_policies').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_management_operations where purpose != \'delete\'').get()).toEqual({ count: 0 })
  })

  it('enforces the deleting gate in final SQLite writes, not only in service prechecks', () => {
    const { database, repository } = harness()
    const id = repository.query.list()[0]?.id ?? ''
    const created = id || 'channel-final-cas'
    if (!id) expect(repository.create({ id: created, name: 'Telegram', agentId: 'agent-a', now: '2026-07-19' })).toBe(true)
    database.connection.prepare(`insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at) values('final-cas-conversation',?,x'01','payload-ref',1,'opaque-hash','direct','session-final-cas','2026-07-19','2026-07-19')`).run(created)

    expect(repository.beginDelete(created, 'delete-final-cas', '2026-07-19')).not.toBeNull()
    expect(repository.reserveOperation({ id: 'late-provision', channelId: created, purpose: 'provision', ref: 'late-ref', now: '2026-07-19' })).toBe(false)
    expect(repository.setCredential({ id: created, ref: 'late-ref', revision: 1, expectedRevision: null, now: '2026-07-19' })).toBe(false)
    expect(repository.createPolicy({ channelId: created, subjectType: 'user', ciphertext: new Uint8Array([1]), keyRef: 'payload-ref', keyRevision: 1, keyHash: 'opaque', conversationKind: null, now: '2026-07-19' })).toBe(false)
    expect(repository.setTarget(created, 'final-cas-conversation', true, '2026-07-19')).toBe(false)
    expect(database.connection.prepare("select count(*) as count from channel_management_operations where id = 'late-provision'").get()).toEqual({ count: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_allow_policies where channel_id = ?").get(created)).toEqual({ count: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_delivery_targets where channel_id = ?").get(created)).toEqual({ count: 0 })
  })

  it.each([
    ["update channel_credential_migrations set migration_permit = '' where channel_id = ?", 'empty permit'],
    ["update channel_credential_migrations set credential_ref = '' where channel_id = ? and purpose = 'legacy-discovery-archive'", 'empty archive ref'],
    ["update channel_credential_migrations set credential_ref = 'channel-migration-archive:other-channel:archive-fingerprint' where channel_id = ? and purpose = 'provider-credential'", 'provider/archive kind mismatch']
  ])('rolls back delete before C03 cleanup or Vault access for malformed Stage 1 journal metadata: %s', async (sql, _reason) => {
    const { service, database, vault } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    seedC03Rows(database, id)
    seedLegacyMigrationRows(database, id)
    database.connection.prepare(sql).run(id)

    await expect(service.delete({ id, actorId: 'user-a' })).rejects.toThrow('channel-delete-known-ref-invalid')
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'credential-missing' })
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items where channel_id=?').get(id)).toEqual({ count: 1 })
    expect(database.connection.prepare('select count(*) as count from channel_credential_migrations where channel_id=?').get(id)).toEqual({ count: 2 })
    expect(database.connection.prepare('select count(*) as count from channel_management_operations where channel_id=?').get(id)).toEqual({ count: 0 })
    expect(vault.deleted).toEqual([])
    expect(vault.deletedArchives).toEqual([])
  })

  it.each([
    ["update channel_credential_migrations set credential_ref = 'channel-migration:other-channel:provider-fingerprint' where channel_id = ? and purpose = 'provider-credential'", 'other-channel Stage 1 provider ref'],
    ["update agent_channels set credential_ref = 'channel-migration:other-channel:metadata-ref', credential_revision = 1, migration_state = 'configuration-ready' where id = ?", 'other-channel metadata ref']
  ])('does not fence, clear data, or delete another Channel credential for %s', async (sql, _reason) => {
    const { service, database, vault } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    seedC03Rows(database, id)
    seedLegacyMigrationRows(database, id)
    database.connection.prepare(sql).run(id)

    await expect(service.delete({ id, actorId: 'user-a' })).rejects.toThrow('channel-delete-known-ref-invalid')
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'credential-missing' })
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items where channel_id=?').get(id)).toEqual({ count: 1 })
    expect(database.connection.prepare('select count(*) as count from channel_credential_migrations where channel_id=?').get(id)).toEqual({ count: 2 })
    expect(vault.deleted).toEqual([])
    expect(vault.deletedArchives).toEqual([])
  })

  it.each([
    ["update channel_management_operations set credential_ref = null where id = 'pending-operation'", 'pending ref null'],
    ["update channel_management_operations set credential_ref = '' where id = 'pending-operation'", 'pending ref empty'],
    ["update channel_management_operations set source_fingerprint = null where id = 'pending-operation'", 'pending fingerprint missing']
  ])('rolls back before any cleanup for malformed pending credential operation: %s', async (sql, _reason) => {
    const { service, database, vault, cipher } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    seedC03Rows(database, id)
    seedLegacyMigrationRows(database, id)
    database.connection.prepare(
      `insert into channel_management_operations(id,channel_id,purpose,credential_ref,source_fingerprint,fingerprint_key_id,operation_permit,state,created_at,updated_at)
       values('pending-operation',?,'provision',?,'pendingfingerprint','pending-key','pendingpermit','reserved','2026-01-01','2026-01-01')`
    ).run(id, `channel-migration:${id}:pendingfingerprint`)
    database.connection.prepare(sql).run()

    await expect(service.delete({ id, actorId: 'user-a' })).rejects.toThrow('channel-delete-known-ref-invalid')
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'credential-missing' })
    expect(database.connection.prepare('select 1 from channel_runtime_generations where channel_id=?').get(id)).toBeUndefined()
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items where channel_id=?').get(id)).toEqual({ count: 1 })
    expect(database.connection.prepare('select count(*) as count from channel_credential_migrations where channel_id=?').get(id)).toEqual({ count: 2 })
    expect(database.connection.prepare("select state from channel_management_operations where id='pending-operation'").get()).toEqual({ state: 'reserved' })
    expect(cipher.destroyed).toEqual([])
    expect(vault.deleted).toEqual([])
    expect(vault.deletedArchives).toEqual([])
  })

  it('rolls back delete before any cleanup for an other-Channel payload key ref', async () => {
    const { service, database, vault, cipher } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    seedC03Rows(database, id)
    database.connection.prepare("update channel_inbound_work_items set payload_key_ref = 'channel-payload-key:other-channel:123e4567-e89b-12d3-a456-426614174000' where channel_id=?").run(id)

    await expect(service.delete({ id, actorId: 'user-a' })).rejects.toThrow('channel-delete-known-ref-invalid')
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'credential-missing' })
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items where channel_id=?').get(id)).toEqual({ count: 1 })
    expect(database.connection.prepare('select 1 from channel_runtime_generations where channel_id=?').get(id)).toBeUndefined()
    expect(cipher.destroyed).toEqual([])
    expect(vault.deleted).toEqual([])
    expect(vault.deletedArchives).toEqual([])
  })

  it('keeps deleting and skips every Vault delete when persisted delete journal refs are tampered', async () => {
    const { service, database, vault } = harness({ failDestroy: true })
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const ref = `channel-migration:${id}:metadata-ref`
    database.connection.prepare("update agent_channels set credential_ref=?,credential_revision=1,migration_state='configuration-ready' where id=?").run(ref, id)

    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: false, code: 'channel-delete-pending' })
    database.connection.prepare("update channel_management_operations set legacy_migrations_json = ? where channel_id = ? and purpose = 'delete'")
      .run(JSON.stringify([{ purpose: 'provider-credential', type: 'telegram', ref: 'channel-migration:other-channel:metadata-ref', fingerprint: 'metadata-ref', keyId: 'key', permit: 'permit' }]), id)
    vault.deleted.length = 0
    vault.deletedArchives.length = 0
    ;(database.connection.prepare("update agent_channels set requested_enabled = 0 where id = ?")).run(id)

    await service.recover()
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'deleting' })
    expect(database.connection.prepare("select state,stable_error_code from channel_management_operations where channel_id=? and purpose='delete'").get(id)).toEqual({
      state: 'needs-recovery', stable_error_code: 'channel-delete-pending'
    })
    expect(vault.deleted).toEqual([])
    expect(vault.deletedArchives).toEqual([])
  })

  it('keeps deleting and skips cipher and Vault deletes when persisted payload key refs are tampered', async () => {
    const { service, database, vault, cipher } = harness({ failDestroy: true })
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    await expect(service.delete({ id, actorId: 'user-a' })).resolves.toMatchObject({ ok: false, code: 'channel-delete-pending' })
    database.connection.prepare("update channel_management_operations set payload_key_refs_json = ? where channel_id = ? and purpose = 'delete'")
      .run(JSON.stringify(['channel-payload-key:other-channel:123e4567-e89b-12d3-a456-426614174000']), id)
    cipher.destroyed.length = 0
    vault.deleted.length = 0
    vault.deletedArchives.length = 0

    await service.recover()
    expect(database.connection.prepare('select migration_state from agent_channels where id=?').get(id)).toEqual({ migration_state: 'deleting' })
    expect(database.connection.prepare("select state,stable_error_code from channel_management_operations where channel_id=? and purpose='delete'").get(id)).toEqual({
      state: 'needs-recovery', stable_error_code: 'channel-delete-pending'
    })
    expect(cipher.destroyed).toEqual([])
    expect(vault.deleted).toEqual([])
    expect(vault.deletedArchives).toEqual([])
  })

  it('does not claim a credential is configured when known-ref inspection is missing or unavailable', async () => {
    const { service, database, vault } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare("update agent_channels set credential_ref='known-ref',credential_revision=1,migration_state='configuration-ready',credential_health='configured' where id=?").run(id)

    vault.inspectReturnsNull = true
    await service.recover()
    expect(service.get(id)?.credential.hasCredential).toBe(false)
    vault.inspectReturnsNull = false
    vault.failInspect = true
    await service.recover()
    expect(service.get(id)?.credential.hasCredential).toBe(false)
  })

  it('bounds management, delivery and audit pages at 100 without exposing provider data', () => {
    const { service, database } = harness()
    const id = service.create({ name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    for (let index = 0; index < 101; index += 1) {
      database.connection.prepare(`insert into channel_management_audits(id,channel_id,actor_id,action,code,summary_json,created_at) values(?,?,?,?,?,?,?)`).run(`audit-${index}`, id, 'user-a', 'update', null, '{}', `2026-07-19T00:00:${String(index % 60).padStart(2, '0')}.000Z`)
      database.connection.prepare(`insert into channel_delivery_attempts(id,channel_id,agent_id,conversation_id,source_type,source_hash,idempotency_key,status,created_at,updated_at) values(?,?,?,?,?,?,?,?,?,?)`).run(`attempt-${index}`, id, 'agent-a', 'conversation-a', 'agent-notify', `hash-${index}`, `opaque-${index}`, 'skipped', `2026-07-19T00:00:${String(index % 60).padStart(2, '0')}.000Z`, `2026-07-19T00:00:${String(index % 60).padStart(2, '0')}.000Z`)
    }
    expect(service.listAudits({ id, limit: 100, offset: 0 })).toHaveLength(100)
    expect(service.listDeliveryAttempts({ id, limit: 100, offset: 0 })).toHaveLength(100)
    expect(() => service.listAudits({ id, limit: 101, offset: 0 })).toThrow('channel-input-invalid')
    expect(JSON.stringify(service.listDeliveryAttempts({ id, limit: 1, offset: 0 }))).not.toMatch(/opaque-|hash-|conversation/i)
  })
})

async function credentialHandoff(service: ChannelManagementService, id: string, token: string) {
  const begin = await service.beginCredential({ id, senderId: 7 })
  return encryptHandoff(begin, id, 'credential', JSON.stringify({ bot_token: token }))
}

async function policyHandoff(service: ChannelManagementService, id: string) {
  const begin = await service.beginPolicy({ id, senderId: 7 })
  return encryptHandoff(begin, id, 'policy', JSON.stringify({ subjectType: 'user', key: 'test-subject' }))
}

async function encryptHandoff(
  begin: { sessionId: string; mainPublicJwk: JsonWebKey },
  channelId: string,
  purpose: 'credential' | 'policy',
  text: string
) {
  const { webcrypto } = await import('node:crypto')
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const main = await webcrypto.subtle.importKey('jwk', begin.mainPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const bits = await webcrypto.subtle.deriveBits({ name: 'ECDH', public: main }, pair.privateKey, 256)
  const key = await webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = new Uint8Array(12)
  const aad = new TextEncoder().encode(`${begin.sessionId}:${channelId}:${purpose}`)
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(text)))
  return { sessionId: begin.sessionId, rendererPublicJwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey), iv, ciphertext }
}

function harness(options: { failDelete?: boolean; failArchiveDelete?: boolean; failPutReserved?: boolean; failRotate?: boolean; failDestroy?: boolean } = {}) {
  const database = createAgentPlatformDatabase(':memory:')
  database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','general','Agent','[]','[]','0','2026-01-01','2026-01-01')`)
  const vault = new FakeVault(options.failDelete ?? false, options.failArchiveDelete ?? false, options.failPutReserved ?? false, options.failRotate ?? false)
  const cipher = new FakeCipher(options.failDestroy ?? false)
  const typedCipher: ChannelPayloadCipher = cipher
  const repository = new ChannelManagementRepository(database)
  return {
    database,
    repository,
    vault,
    cipher,
    service: new ChannelManagementService({ repository, vault, cipher: typedCipher, registry: new ChannelAdapterAcceptanceRegistry(), handoff: new ChannelSecureHandoff(), now: () => new Date('2026-07-19T00:00:00.000Z') })
  }
}

class FakeCipher implements ChannelPayloadCipher {
  destroyed: string[] = []
  encryptCalls = 0
  failDestroy: boolean
  constructor(failDestroy = false) { this.failDestroy = failDestroy }
  async encrypt() { this.encryptCalls += 1; return { ciphertext: new Uint8Array([1]), keyRef: 'payload-key', keyRevision: 1 } }
  async decrypt() { return new Uint8Array() }
  async keyedHash() { return 'opaque-policy-hash' }
  async rotate() { return { keyRef: 'payload-key', keyRevision: 1 } }
  async revoke() { return undefined }
  async destroy(channelId: string) { this.destroyed.push(channelId); if (this.failDestroy) throw new Error('unavailable') }
}

class FakeVault implements ChannelCredentialVault {
  deleted: string[] = []
  deletedArchives: Array<{ channelId: string; credentialRef: string }> = []
  inspectRefs: string[] = []
  failDelete: boolean
  failArchiveDelete: boolean
  failPutReserved: boolean
  failRotate: boolean
  failInspect = false
  inspectReturnsNull = false
  putReservedCalls = 0
  reservedDeletes = 0
  failReservedDelete = false
  cleanupClaim: string | null = null
  inspectRevision: number | null = null
  mutationReceipt: { channelId: string; operationId: string; mutationEpoch: number; credentialRef: string; revision: number } | null = null
  private revision = 1

  constructor(failDelete: boolean, failArchiveDelete: boolean, failPutReserved: boolean, failRotate: boolean) {
    this.failDelete = failDelete
    this.failArchiveDelete = failArchiveDelete
    this.failPutReserved = failPutReserved
    this.failRotate = failRotate
  }

  async put(): Promise<ChannelCredentialSafeView> { throw new Error('not-used') }
  async get(): Promise<Record<string, string> | null> { throw new Error('not-used') }
  async has(): Promise<boolean> { return false }
  async rotate(): Promise<ChannelCredentialSafeView> { throw new Error('not-used') }
  async rotateIfRevision(
    ref: string,
    expected: number,
    _value: Record<string, string>,
    mutation: { channelId: string; operationId: string; mutationEpoch: number }
  ): Promise<ChannelCredentialSafeView> {
    if (this.failRotate) throw new Error('unavailable')
    if (ref !== 'known-ref' || expected !== this.revision) throw new Error('unavailable')
    this.revision += 1
    this.mutationReceipt = { ...mutation, credentialRef: ref, revision: this.revision }
    return { credentialRef: ref, revision: this.revision, maskedFields: { bot_token: '********' } }
  }
  async delete(ref: string): Promise<void> {
    this.deleted.push(ref)
    if (this.failDelete) throw new Error('unavailable')
  }
  async inspectSafe(ref: string): Promise<ChannelCredentialSafeView | null> {
    if (this.failInspect) throw new Error('unavailable')
    if (this.inspectReturnsNull) return null
    this.inspectRefs.push(ref)
    return { credentialRef: ref, revision: this.inspectRevision ?? this.revision, maskedFields: { bot_token: '********' } }
  }
  async inspectMutationReceipt(ref: string) {
    return this.mutationReceipt?.credentialRef === ref ? this.mutationReceipt : null
  }
  async prepareMigration() { return { credentialRef: 'reserved-ref', sourceFingerprint: 'fingerprint', fingerprintKeyId: 'key', migrationPermit: 'permit' } }
  async putReserved(): Promise<ChannelCredentialSafeView> {
    this.putReservedCalls += 1
    if (this.failPutReserved) throw new Error('unavailable')
    return { credentialRef: 'reserved-ref', revision: 1, maskedFields: { bot_token: '********' } }
  }
  async inspectReserved(): Promise<ChannelCredentialSafeView | null> {
    return this.failPutReserved ? null : { credentialRef: 'reserved-ref', revision: 1, maskedFields: { bot_token: '********' } }
  }
  async deleteReservedIfRevision() { this.reservedDeletes += 1; if (this.failReservedDelete) throw new Error('unavailable'); return true }
  async claimReservedCleanup() { this.cleanupClaim = `claim-${this.reservedDeletes}`; return { revision: 1, cleanupToken: this.cleanupClaim } }
  async deleteReservedIfCleanupClaim(input: { cleanupToken: string }) {
    this.reservedDeletes += 1
    if (this.failReservedDelete) throw new Error('unavailable')
    return input.cleanupToken === this.cleanupClaim
  }
  async deleteIfRevision() { return true }
  async prepareArchiveMigration(): Promise<ChannelCredentialMigrationReservation> { throw new Error('not-used') }
  async putReservedArchive() { throw new Error('not-used') }
  async inspectReservedArchive(): Promise<boolean> { return false }
  async deleteReservedArchive(input: ChannelCredentialArchiveReservedInspection) {
    this.deletedArchives.push({ channelId: input.channelId, credentialRef: input.credentialRef })
    if (this.failArchiveDelete) throw new Error('unavailable')
  }
}

const c03Tables = [
  'agent_channel_task_subscriptions',
  'channel_inbound_admission_reservations', 'channel_conversation_session_operations', 'channel_delivery_targets',
  'channel_allow_policies', 'channel_inbound_work_items', 'channel_receipts', 'channel_delivery_attempts',
  'channel_delivery_audits', 'channel_runtime_audits', 'channel_conversations', 'channel_runtime_generations'
]

function seedC03Rows(database: ReturnType<typeof createAgentPlatformDatabase>, channelId: string): void {
  database.connection.exec(`
    insert into agent_channel_task_subscriptions(channel_id,task_id) values('${channelId}','task-${channelId}');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('${channelId}',1,'inactive','2026-01-01');
    insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at) values('conv-${channelId}','${channelId}',x'01','channel-payload-key:${channelId}:123e4567-e89b-12d3-a456-426614174000',1,'hash','direct','session-${channelId}','2026-01-01','2026-01-01');
    insert into channel_delivery_targets(id,channel_id,conversation_id,enabled,created_at,updated_at) values('target-${channelId}','${channelId}','conv-${channelId}',1,'2026-01-01','2026-01-01');
    insert into channel_allow_policies(id,channel_id,subject_type,subject_key_ciphertext,subject_key_ref,subject_key_revision,subject_key_hash,created_at) values('policy-${channelId}','${channelId}','user',x'01','channel-payload-key:${channelId}:123e4567-e89b-12d3-a456-426614174000',1,'hash','2026-01-01');
    insert into channel_receipts(id,channel_id,provider_event_key_ciphertext,provider_event_key_ref,provider_event_key_revision,provider_event_key_hash,status,generation,created_at,updated_at) values('receipt-${channelId}','${channelId}',x'01','ref',1,'hash','processing',1,'2026-01-01','2026-01-01');
    insert into channel_inbound_work_items(id,receipt_id,channel_id,conversation_id,dispatch_id,payload_ciphertext,payload_key_ref,payload_key_revision,status,attempt_count,created_at,updated_at) values('work-${channelId}','receipt-${channelId}','${channelId}','conv-${channelId}','dispatch-${channelId}',x'01','channel-payload-key:${channelId}:123e4567-e89b-12d3-a456-426614174000',1,'processing',0,'2026-01-01','2026-01-01');
    insert into channel_delivery_attempts(id,channel_id,agent_id,conversation_id,source_type,source_hash,idempotency_key,status,created_at,updated_at) values('attempt-${channelId}','${channelId}','agent-a','conv-${channelId}','agent-notify','hash','opaque','skipped','2026-01-01','2026-01-01');
    insert into channel_delivery_audits(id,channel_id,attempt_id,code,created_at) values('delivery-audit-${channelId}','${channelId}','attempt-${channelId}','delivery-skipped','2026-01-01');
    insert into channel_runtime_audits(id,channel_id,generation,code,created_at) values('runtime-audit-${channelId}','${channelId}',1,'fenced','2026-01-01');
  `)
}

function seedLegacyMigrationRows(database: ReturnType<typeof createAgentPlatformDatabase>, channelId: string): void {
  database.connection.exec(`
    insert into channel_credential_migrations(id,channel_id,purpose,source_fingerprint,fingerprint_key_id,credential_ref,migration_permit,state,attempt_count,created_at,updated_at)
      values('legacy-provider-${channelId}','${channelId}','provider-credential','provider-fingerprint','provider-key','channel-migration:${channelId}:provider-fingerprint','provider-permit','completed',0,'2026-01-01','2026-01-01');
    insert into channel_credential_migrations(id,channel_id,purpose,source_fingerprint,fingerprint_key_id,credential_ref,migration_permit,state,attempt_count,created_at,updated_at)
      values('legacy-archive-${channelId}','${channelId}','legacy-discovery-archive','archive-fingerprint','archive-key','channel-migration-archive:${channelId}:archive-fingerprint','archive-permit','completed',0,'2026-01-01','2026-01-01');
    insert into channel_legacy_discovery_archives(channel_id,archive_ref,candidate_count,state,expires_at,created_at,updated_at)
      values('${channelId}','channel-migration-archive:${channelId}:archive-fingerprint',1,'pending-manual-review','2027-01-01','2026-01-01','2026-01-01');
  `)
}

function supportedTelegramEntry() {
  return {
    adapterType: 'telegram' as const, adapterVersion: 'release-a', status: 'supported' as const,
    capabilities: { receiveText: true, receiveImages: false, receiveFiles: false, sendText: true, streaming: false, typingIndicator: false, nativeCommands: false, groupMention: false, qrEnrollment: false, reconnect: true },
    receiveSmokeAt: '2026-07-19', sendSmokeAt: '2026-07-19', reconnectSmokeAt: '2026-07-19', restartRecoveryAt: '2026-07-19', proxySmokeAt: '2026-07-19', credentialRotationAt: '2026-07-19', disableDeleteFencingAt: '2026-07-19', capabilityEvidence: {}
  }
}
