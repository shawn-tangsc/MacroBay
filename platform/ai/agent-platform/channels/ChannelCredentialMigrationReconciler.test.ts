import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { createAgentPlatformRepositories } from '../repositories/createAgentPlatformRepositories'
import { createAgentPlatformServices } from '../services'
import { createDefaultAgentPersistentState } from '../store/agentPersistentStore'
import { createAgentSqliteStoreWithOptions } from '../store/agentSqliteStore'
import type { ChannelCredentialMigrationReservation, ChannelCredentialVault } from '../../../secrets/channels'
import { ChannelCredentialMigrationReconciler } from './ChannelCredentialMigrationReconciler'

const now = new Date('2026-07-18T00:00:00.000Z')

describe('ChannelCredentialMigrationReconciler', () => {
  it('migrates a legacy row before AgentStore hydration without exposing secrets or candidates', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' }, ['chat-2', 'chat-1'], 'legacy-session')
    const vault = createVaultFake({ dynamicProviderFingerprint: true })
    const store = createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })
    })

    expect((await store.getState()).channels).toEqual([])
    expect(vault.putReserved).toHaveBeenCalledWith(expect.objectContaining({ value: { bot_token: 'telegram-secret' } }))
    const row = database.connection.prepare(
      'select config_json, session_id, active_chat_ids_json, permission_mode, migration_state from channel_legacy_channels where id = ?'
    ).get('channel-1') as Record<string, unknown>
    expect(row).toEqual({ config_json: null, session_id: null, active_chat_ids_json: null, permission_mode: null, migration_state: 'completed' })
    expect(JSON.stringify(row)).not.toContain('telegram-secret')
    const archive = database.connection.prepare('select candidate_count, archive_ref from channel_legacy_discovery_archives').get() as Record<string, unknown>
    expect(archive.candidate_count).toBe(2)
    expect(JSON.stringify(archive)).not.toContain('chat-1')
  })

  it('rejects legacy repository, store, and service writes before they can persist secrets', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repositories = createAgentPlatformRepositories(database)
    const channel = legacyChannel({ bot_token: 'write-secret' }) as never
    expect(() => repositories.channels.upsert(channel)).toThrow('channel-legacy-write-rejected')
    await expect(createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState()).update(
      (state) => ({ ...state, channels: [channel] }),
      { channelRowsOnly: true }
    )).rejects.toThrow('channel-legacy-write-rejected')
    const services = createAgentPlatformServices({
      getState: async () => createDefaultAgentPersistentState(),
      update: async () => createDefaultAgentPersistentState(),
      replace: async () => createDefaultAgentPersistentState()
    })
    await expect(services.channels.create(channel)).rejects.toThrow('channel-legacy-write-rejected')
    expect(database.connection.prepare('select count(*) as total from channel_legacy_channels').get()).toEqual({ total: 0 })
  })

  it('commits the reserved journal before calling putReserved and reuses its ref on retry', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' })
    const vault = createVaultFake({
      onPutReserved: () => expect(database.connection.prepare('select state from channel_credential_migrations').get()).toMatchObject({ state: 'reserved' })
    })
    const reconciler = new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })

    await reconciler.reconcile()
    const firstRef = (database.connection.prepare("select credential_ref from channel_credential_migrations where purpose = 'provider-credential'").get() as { credential_ref: string }).credential_ref
    database.connection.prepare("update channel_legacy_channels set migration_state = 'legacy', config_json = ?, credential_ref = null where id = 'channel-1'")
      .run(JSON.stringify({ bot_token: 'telegram-secret' }))
    await reconciler.reconcile()
    const secondRef = (database.connection.prepare("select credential_ref from channel_credential_migrations where purpose = 'provider-credential'").get() as { credential_ref: string }).credential_ref
    expect(secondRef).toBe(firstRef)
  })

  it('finishes a legacy-scrubbed journal after restart using its known reserved ref', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' })
    const vault = createVaultFake({ dynamicProviderFingerprint: true })
    const reconciler = new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })
    await reconciler.reconcile()
    database.connection.prepare("update channel_legacy_channels set migration_state = 'legacy-scrubbed' where id = 'channel-1'").run()
    database.connection.prepare("update channel_credential_migrations set state = 'legacy-scrubbed'").run()

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    expect(database.connection.prepare("select migration_state from channel_legacy_channels where id = 'channel-1'").get()).toEqual({ migration_state: 'completed' })
    expect(database.connection.prepare("select state from channel_credential_migrations where purpose = 'provider-credential'").get()).toEqual({ state: 'completed' })
  })

  it('retains a committed provider credential when completion fails, then completes it after restart', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' })
    const vault = createVaultFake({ dynamicProviderFingerprint: true })
    const reconciler = new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })
    const originalSetJournalState = (reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState.bind(reconciler)
    let failCompletion = true
    ;(reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState = (id, state, error) => {
      if (failCompletion && state === 'completed') {
        failCompletion = false
        throw new Error('simulated completion interruption')
      }
      originalSetJournalState(id, state, error)
    }

    await reconciler.reconcile()

    // The metadata transaction used real SQLite and committed before completion failed.
    expect(database.connection.prepare("select migration_state, credential_ref from channel_legacy_channels where id = 'channel-1'").get())
      .toMatchObject({ migration_state: 'legacy-scrubbed', credential_ref: 'channel-migration:channel-1:provider' })
    expect(vault.delete).not.toHaveBeenCalled()

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    expect(vault.inspectReserved).toHaveBeenCalledWith(expect.objectContaining({ credentialRef: 'channel-migration:channel-1:provider' }))
    expect(vault.delete).not.toHaveBeenCalled()
    expect(database.connection.prepare("select migration_state from channel_legacy_channels where id = 'channel-1'").get())
      .toEqual({ migration_state: 'completed' })
  })

  it('quarantines committed metadata without deleting its credential when restart inspection fails', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' })
    const vault = createVaultFake({ dynamicProviderFingerprint: true })
    const reconciler = new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })
    const originalSetJournalState = (reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState.bind(reconciler)
    let failCompletion = true
    ;(reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState = (id, state, error) => {
      if (failCompletion && state === 'completed') {
        failCompletion = false
        throw new Error('simulated completion interruption')
      }
      originalSetJournalState(id, state, error)
    }
    await reconciler.reconcile()

    const missingVault = createVaultFake({ providerInitiallyPresent: false })
    await new ChannelCredentialMigrationReconciler({ database, vault: missingVault, now: () => now }).reconcile()

    expect(missingVault.delete).not.toHaveBeenCalled()
    expect(database.connection.prepare("select migration_state, credential_ref from channel_legacy_channels where id = 'channel-1'").get())
      .toMatchObject({ migration_state: 'quarantined', credential_ref: 'channel-migration:channel-1:provider' })
    expect(database.connection.prepare("select state from channel_credential_migrations where purpose = 'provider-credential'").get())
      .toEqual({ state: 'legacy-scrubbed' })
  })

  it('retries a pending fallback scrub without hydrating its channels after an overwrite failure', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const fallback = { ...createDefaultAgentPersistentState(), channels: [legacyChannel({ bot_token: 'fallback-secret' })] }
    const vault = createVaultFake()
    const failWrite = vi.fn(async () => { throw new Error('disk unavailable') })
    await new ChannelCredentialMigrationReconciler({
      database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: failWrite
    }).reconcile()
    expect(database.connection.prepare("select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'").get()).toMatchObject({
      value_json: JSON.stringify({ state: 'pending', overwriteConfirmed: false })
    })

    const successfulWrite = vi.fn(async () => undefined)
    await new ChannelCredentialMigrationReconciler({
      database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: successfulWrite
    }).reconcile()
    expect(successfulWrite).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
    expect(database.connection.prepare("select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'").get()).toMatchObject({
      value_json: JSON.stringify({ state: 'pending', overwriteConfirmed: true })
    })
  })

  it('hydrates fallback non-Channel state after a scrub-only crash window, then completes the marker', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    let fallback: Record<string, unknown> = {
      ...createDefaultAgentPersistentState(),
      agents: [{ id: 'agent-fallback', type: 'claude-code', name: 'Fallback agent', model: null, modelName: null, orderKey: '1', createdAt: now.toISOString(), updatedAt: now.toISOString() }],
      sessions: [{ id: 'session-fallback', agentId: 'agent-fallback', name: 'Fallback session', workspaceId: null, workspace: null, orderKey: '1', createdAt: now.toISOString(), updatedAt: now.toISOString() }],
      tasks: [{ id: 'task-fallback', agentId: 'agent-fallback', name: 'Fallback task', prompt: 'Run', trigger: { kind: 'interval', ms: 60_000 }, timeoutMinutes: 2, workspace: { type: 'system' }, channelIds: [], enabled: false, status: 'paused', createdAt: now.toISOString(), updatedAt: now.toISOString() }],
      channels: [legacyChannel({ bot_token: 'fallback-token' })]
    }
    const readFallback = vi.fn(async () => fallback)
    const writeFallback = vi.fn(async (next) => { fallback = next as Record<string, unknown> })
    const vault = createVaultFake()

    // Simulate a process exit after Channel scrub but before AgentStore persistence.
    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now, readLegacyState: readFallback, writeLegacyState: writeFallback }).reconcile()
    expect(database.connection.prepare("select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'").get())
      .toMatchObject({ value_json: JSON.stringify({ state: 'pending', overwriteConfirmed: true }) })
    expect(JSON.stringify(fallback)).not.toContain('fallback-token')

    const store = createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: readFallback,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault, now: () => now, readLegacyState: readFallback, writeLegacyState: writeFallback })
    })
    const state = await store.getState()
    expect(state.agents.map((agent) => agent.id)).toEqual(['agent-fallback'])
    expect(state.sessions.map((session) => session.id)).toEqual(['session-fallback'])
    expect(state.tasks.map((task) => task.id)).toEqual(['task-fallback'])
    expect(state.channels).toEqual([])
    expect(JSON.stringify(state)).not.toContain('fallback-token')
    expect(database.connection.prepare("select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'").get())
      .toMatchObject({ value_json: JSON.stringify({ state: 'completed', overwriteConfirmed: true }) })

    const readsBeforeRestart = readFallback.mock.calls.length
    await createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: readFallback,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault, now: () => now, readLegacyState: readFallback, writeLegacyState: writeFallback })
    }).getState()
    expect(readFallback).toHaveBeenCalledTimes(readsBeforeRestart)
  })

  it('keeps the fallback marker pending after an overwrite failure, then retries before completing hydration', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    let fallback: Record<string, unknown> = {
      ...createDefaultAgentPersistentState(),
      agents: [{ id: 'agent-retry', type: 'claude-code', name: 'Retry agent', model: null, modelName: null, orderKey: '1', createdAt: now.toISOString(), updatedAt: now.toISOString() }],
      channels: [legacyChannel({ bot_token: 'retry-token', token_path: '/private/retry-path' })]
    }
    const failingWrite = vi.fn(async () => { throw new Error('disk unavailable') })
    const vault = createVaultFake()
    const firstStore = createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: async () => fallback,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: failingWrite })
    })

    const limitedState = await firstStore.getState()
    expect(limitedState.agents.map((agent) => agent.id)).toEqual(['agent-retry'])
    expect(limitedState.channels).toEqual([])
    expect(JSON.stringify(limitedState)).not.toContain('retry-token')
    expect(JSON.stringify(fallback)).toContain('retry-token') // Test baseline: the failed atomic replacement changed no file content.
    expect(database.connection.prepare("select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'").get())
      .toMatchObject({ value_json: JSON.stringify({ state: 'pending', overwriteConfirmed: false }) })

    const successfulWrite = vi.fn(async (next) => { fallback = next as Record<string, unknown> })
    const retryStore = createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: async () => fallback,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: successfulWrite })
    })
    expect((await retryStore.getState()).agents.map((agent) => agent.id)).toEqual(['agent-retry'])
    expect(successfulWrite).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
    expect(JSON.stringify(fallback)).not.toContain('retry-token')
    expect(database.connection.prepare("select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'").get())
      .toMatchObject({ value_json: JSON.stringify({ state: 'completed', overwriteConfirmed: true }) })

    const readAfterCompletion = vi.fn(async () => fallback)
    await createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: readAfterCompletion,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault, now: () => now, readLegacyState: readAfterCompletion, writeLegacyState: successfulWrite })
    }).getState()
    expect(readAfterCompletion).not.toHaveBeenCalled()
  })

  it('scrubs malformed fallback channels without writing a provider credential', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    let fallback: Record<string, unknown> = {
      ...createDefaultAgentPersistentState(),
      agents: [{ id: 'agent-malformed', type: 'claude-code', name: 'Malformed fallback agent', model: null, modelName: null, orderKey: '1', createdAt: now.toISOString(), updatedAt: now.toISOString() }],
      channels: { config: { bot_token: 'malformed-token', token_path: '/private/malformed.json' } }
    }
    const writeFallback = vi.fn(async (next) => { fallback = next as Record<string, unknown> })
    const vault = createVaultFake()
    const reconciler = new ChannelCredentialMigrationReconciler({ database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: writeFallback })

    await reconciler.reconcile()
    expect(writeFallback).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
    expect(JSON.stringify(writeFallback.mock.calls[0]?.[0])).not.toContain('malformed-token')
    expect(JSON.stringify(writeFallback.mock.calls[0]?.[0])).not.toContain('/private/malformed.json')
    expect(vault.prepareMigration).not.toHaveBeenCalled()
    expect(vault.putReserved).not.toHaveBeenCalled()

    const store = createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: async () => fallback,
      channelMigrationReconciler: reconciler
    })
    expect((await store.getState()).channels).toEqual([])
  })

  it('hydrates a no-Channel legacy fallback even though no scrub marker exists', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const fallback = {
      ...createDefaultAgentPersistentState(),
      agents: [{ id: 'agent-only', type: 'claude-code', name: 'Agent only', model: null, modelName: null, orderKey: '1', createdAt: now.toISOString(), updatedAt: now.toISOString() }]
    }
    const store = createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: async () => fallback,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault: createVaultFake(), now: () => now, readLegacyState: async () => fallback, writeLegacyState: async () => undefined })
    })
    expect((await store.getState()).agents.map((agent) => agent.id)).toEqual(['agent-only'])
  })

  it('does not read a sensitive fallback after SQLite already contains persisted state', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.prepare(
      "insert into agent_platform_state_entries (key, value_json, updated_at) values ('activeSelection', ?, ?)"
    ).run(JSON.stringify({ activeAgentId: null, activeSessionId: null }), now.toISOString())
    const vault = createVaultFake()
    const sensitiveFallback = {
      ...createDefaultAgentPersistentState(),
      channels: [legacyChannel({ bot_token: 'fallback-token', token_path: '/private/fallback-path' })]
    }
    const readLegacyState = vi.fn(async () => sensitiveFallback)
    const writeLegacyState = vi.fn(async () => undefined)

    await new ChannelCredentialMigrationReconciler({
      database, vault, now: () => now, readLegacyState, writeLegacyState
    }).reconcile()

    expect(readLegacyState).not.toHaveBeenCalled()
    expect(writeLegacyState).not.toHaveBeenCalled()
    expect(vault.prepareMigration).not.toHaveBeenCalled()
    expect(vault.putReserved).not.toHaveBeenCalled()
    expect(JSON.stringify(database.connection.prepare('select * from agent_platform_state_entries').all())).not.toContain('fallback-token')
    expect(JSON.stringify(database.connection.prepare('select * from channel_legacy_channels').all())).not.toContain('/private/fallback-path')
  })

  it('preserves fallback non-channel state while a pending scrub blocks Channel hydration', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const fallback = {
      ...createDefaultAgentPersistentState(),
      agents: [{ id: 'agent-1', type: 'claude-code', name: 'Fallback agent', model: null, modelName: null, orderKey: '1', createdAt: now.toISOString(), updatedAt: now.toISOString() }],
      channels: [legacyChannel({ bot_token: 'fallback-secret' })]
    }
    const writeFallback = vi.fn(async () => undefined)
    const vault = createVaultFake()
    database.connection.prepare(
      "insert into agent_platform_state_entries (key, value_json, updated_at) values ('channel-fallback-scrub', ?, ?)"
    ).run(JSON.stringify({ state: 'pending' }), now.toISOString())

    const state = await createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: async () => fallback,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({
        database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: writeFallback
      })
    }).getState()

    expect(state.agents.map((agent) => agent.id)).toEqual(['agent-1'])
    expect(state.channels).toEqual([])
    expect(JSON.stringify(state)).not.toContain('fallback-secret')
  })

  it('keeps an unreferenced Vault credential in needs-cleanup until a restart can delete it', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' })
    const vault = createVaultFake({ failDelete: true })
    database.connection.exec(`
      insert into channel_credential_migrations (
        id, channel_id, purpose, source_fingerprint, fingerprint_key_id, credential_ref, migration_permit,
        state, attempt_count, created_at, updated_at
      ) values ('journal-1', 'channel-1', 'provider-credential', 'provider', 'key',
        'channel-migration:channel-1:provider', 'permit', 'needs-cleanup', 0, '${now.toISOString()}', '${now.toISOString()}');
    `)
    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()
    expect(database.connection.prepare("select state from channel_credential_migrations where id = 'journal-1'").get()).toEqual({ state: 'needs-cleanup' })

    const retryVault = createVaultFake()
    await new ChannelCredentialMigrationReconciler({ database, vault: retryVault, now: () => now }).reconcile()
    expect(database.connection.prepare("select state from channel_credential_migrations where id = 'journal-1'").get()).toEqual({ state: 'cleanup-completed' })
  })

  it('records and retries archive cleanup after a reenrollment metadata transaction failure', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'wechat', { token_path: '/private/wechat-token.json' }, ['chat-1'])
    // A pre-existing archive forces the reenrollment archive metadata INSERT to fail.
    database.connection.prepare(
      `insert into channel_legacy_discovery_archives (
        channel_id, archive_ref, candidate_count, state, expires_at, created_at, updated_at
      ) values ('channel-1', 'older-known-ref', 0, 'pending-manual-review', ?, ?, ?)`
    ).run(now.toISOString(), now.toISOString(), now.toISOString())
    const failingVault = createVaultFake({ failArchiveDelete: true })

    await new ChannelCredentialMigrationReconciler({ database, vault: failingVault, now: () => now }).reconcile()

    expect(failingVault.delete).not.toHaveBeenCalled()
    expect(failingVault.deleteReservedArchive).toHaveBeenCalledWith(expect.objectContaining({
      credentialRef: 'channel-migration-archive:channel-1:archive'
    }))
    expect(database.connection.prepare(
      "select state from channel_credential_migrations where purpose = 'legacy-discovery-archive'"
    ).get()).toEqual({ state: 'needs-cleanup' })

    const retryVault = createVaultFake()
    await new ChannelCredentialMigrationReconciler({ database, vault: retryVault, now: () => now }).reconcile()

    expect(retryVault.delete).not.toHaveBeenCalled()
    expect(retryVault.deleteReservedArchive).toHaveBeenCalledWith(expect.objectContaining({
      credentialRef: 'channel-migration-archive:channel-1:archive'
    }))
    expect(database.connection.prepare(
      "select state from channel_credential_migrations where purpose = 'legacy-discovery-archive'"
    ).get()).toEqual({ state: 'cleanup-completed' })
  })

  it('completes an interrupted WeChat archive journal without completing the quarantined Channel', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'wechat', { token_path: '/private/wechat-token.json' }, ['chat-1'])
    const vault = createVaultFake()
    const reconciler = new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })
    const originalSetJournalState = (reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState.bind(reconciler)
    let failCompletion = true
    ;(reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState = (id, state, error) => {
      if (failCompletion && state === 'completed') {
        failCompletion = false
        throw new Error('simulated archive completion interruption')
      }
      originalSetJournalState(id, state, error)
    }

    await reconciler.reconcile()
    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    expect(vault.prepareMigration).not.toHaveBeenCalled()
    expect(vault.putReserved).not.toHaveBeenCalled()
    const row = database.connection.prepare(
      "select migration_state, requested_enabled, migration_error_code, credential_ref from channel_legacy_channels where id = 'channel-1'"
    ).get() as Record<string, unknown>
    expect(row).toEqual({
      migration_state: 'quarantined',
      requested_enabled: 0,
      migration_error_code: 'channel-legacy-credential-reenrollment-required',
      credential_ref: null
    })
    expect(database.connection.prepare(
      "select state from channel_credential_migrations where purpose = 'legacy-discovery-archive'"
    ).get()).toEqual({ state: 'completed' })
  })

  it('re-scrubs and quarantines a provider row when a SQLite trigger defeats the scrub postcheck', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' })
    database.connection.exec(`
      create table scrub_fault_once (id integer primary key);
      insert into scrub_fault_once values (1);
      create trigger defeat_provider_scrub after update on channel_legacy_channels
      when new.migration_state = 'legacy-scrubbed' and exists (select 1 from scrub_fault_once)
      begin
        delete from scrub_fault_once;
        update channel_legacy_channels set config_json = '{"bot_token":"trigger-secret"}' where id = new.id;
      end;
    `)
    const vault = createVaultFake()

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    const row = database.connection.prepare(
      "select config_json, session_id, active_chat_ids_json, permission_mode, migration_state, requested_enabled from channel_legacy_channels where id = 'channel-1'"
    ).get() as Record<string, unknown>
    expect(row).toEqual({
      config_json: null, session_id: null, active_chat_ids_json: null, permission_mode: null,
      migration_state: 'quarantined', requested_enabled: 0
    })
    expect(JSON.stringify(row)).not.toContain('trigger-secret')
    expect(database.connection.prepare(
      "select state from channel_credential_migrations where purpose = 'provider-credential'"
    ).get()).toEqual({ state: 'legacy-scrubbed' })
  })

  it('re-scrubs a WeChat locator after a SQLite trigger defeats reenrollment scrub verification', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'wechat', { token_path: '/private/wechat-token.json' }, ['chat-1'])
    database.connection.exec(`
      create table reenrollment_scrub_fault_once (id integer primary key);
      insert into reenrollment_scrub_fault_once values (1);
      create trigger defeat_reenrollment_scrub after update on channel_legacy_channels
      when new.migration_state = 'quarantined' and exists (select 1 from reenrollment_scrub_fault_once)
      begin
        delete from reenrollment_scrub_fault_once;
        update channel_legacy_channels set config_json = '{"token_path":"/private/triggered-wechat.json"}' where id = new.id;
      end;
    `)
    const vault = createVaultFake()

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    const row = database.connection.prepare(
      "select config_json, session_id, active_chat_ids_json, permission_mode, migration_state, requested_enabled, migration_error_code from channel_legacy_channels where id = 'channel-1'"
    ).get() as Record<string, unknown>
    expect(row).toEqual({
      config_json: null, session_id: null, active_chat_ids_json: null, permission_mode: null,
      migration_state: 'quarantined', requested_enabled: 0,
      migration_error_code: 'channel-legacy-credential-reenrollment-required'
    })
    expect(JSON.stringify(row)).not.toContain('/private/triggered-wechat.json')
    expect(database.connection.prepare(
      "select state from channel_credential_migrations where purpose = 'legacy-discovery-archive'"
    ).get()).toEqual({ state: 'legacy-scrubbed' })
    expect(vault.prepareMigration).not.toHaveBeenCalled()
  })

  it('atomically retries provider and archive completion after an archive-completion interruption', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' }, ['chat-1'])
    const vault = createVaultFake()
    const reconciler = new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })
    const originalSetJournalState = (reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState.bind(reconciler)
    let failArchiveCompletion = true
    ;(reconciler as unknown as { setJournalState: (id: string, state: string, error: string | null) => void }).setJournalState = (id, state, error) => {
      if (failArchiveCompletion && state === 'completed' && id !== 'channel-1') {
        const purpose = database.connection.prepare('select purpose from channel_credential_migrations where id = ?').get(id) as { purpose?: string } | undefined
        if (purpose?.purpose === 'legacy-discovery-archive') {
          failArchiveCompletion = false
          throw new Error('simulated archive completion interruption')
        }
      }
      originalSetJournalState(id, state, error)
    }

    await reconciler.reconcile()
    expect(database.connection.prepare("select migration_state from channel_legacy_channels where id = 'channel-1'").get())
      .toEqual({ migration_state: 'legacy-scrubbed' })
    expect(database.connection.prepare(
      "select count(*) as total from channel_credential_migrations where state = 'completed'"
    ).get()).toEqual({ total: 0 })

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    expect(database.connection.prepare("select migration_state from channel_legacy_channels where id = 'channel-1'").get())
      .toEqual({ migration_state: 'completed' })
    expect(database.connection.prepare(
      "select count(*) as total from channel_credential_migrations where state = 'completed'"
    ).get()).toEqual({ total: 2 })
  })

  it('does not finalize when a known archive ref cannot be inspected after provider inspection', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' }, ['chat-1'])
    const vault = createVaultFake()
    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()
    database.connection.prepare("update channel_legacy_channels set migration_state = 'legacy-scrubbed' where id = 'channel-1'").run()
    database.connection.prepare("update channel_credential_migrations set state = 'legacy-scrubbed'").run()

    const missingArchiveVault = createVaultFake({ archiveInitiallyPresent: false })
    await new ChannelCredentialMigrationReconciler({ database, vault: missingArchiveVault, now: () => now }).reconcile()

    expect(missingArchiveVault.inspectReserved).toHaveBeenCalled()
    expect(missingArchiveVault.inspectReservedArchive).toHaveBeenCalled()
    expect(missingArchiveVault.delete).not.toHaveBeenCalled()
    expect(database.connection.prepare("select migration_state from channel_legacy_channels where id = 'channel-1'").get())
      .toEqual({ migration_state: 'quarantined' })
    expect(database.connection.prepare(
      "select count(*) as total from channel_credential_migrations where state = 'completed'"
    ).get()).toEqual({ total: 0 })
  })

  it('does not finalize when a known provider ref cannot be inspected after archive inspection', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret' }, ['chat-1'])
    const vault = createVaultFake()
    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()
    database.connection.prepare("update channel_legacy_channels set migration_state = 'legacy-scrubbed' where id = 'channel-1'").run()
    database.connection.prepare("update channel_credential_migrations set state = 'legacy-scrubbed'").run()

    const missingProviderVault = createVaultFake({ providerInitiallyPresent: false })
    await new ChannelCredentialMigrationReconciler({ database, vault: missingProviderVault, now: () => now }).reconcile()

    expect(missingProviderVault.inspectReserved).toHaveBeenCalled()
    expect(missingProviderVault.inspectReservedArchive).toHaveBeenCalled()
    expect(missingProviderVault.delete).not.toHaveBeenCalled()
    expect(database.connection.prepare("select migration_state from channel_legacy_channels where id = 'channel-1'").get())
      .toEqual({ migration_state: 'quarantined' })
    expect(database.connection.prepare(
      "select count(*) as total from channel_credential_migrations where state = 'completed'"
    ).get()).toEqual({ total: 0 })
  })

  it.each([
    { type: 'telegram' as const, config: { bot_token: 'persistent-trigger-secret' }, errorCode: 'channel-legacy-credential-migration-failed' },
    { type: 'wechat' as const, config: { token_path: '/private/persistent-trigger.json' }, errorCode: 'channel-legacy-credential-reenrollment-required' }
  ])('rejects store hydration when persistent %s scrub trigger cannot be cleared', async ({ type, config, errorCode }) => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, type, config as unknown as Record<string, string>)
    const restoredConfig = type === 'wechat'
      ? '{"token_path":"/private/persistent-trigger.json"}'
      : '{"bot_token":"persistent-trigger-secret"}'
    database.connection.exec(`
      create trigger persistent_scrub_fault after update on channel_legacy_channels
      when new.migration_state in ('legacy-scrubbed', 'quarantined')
      begin
        update channel_legacy_channels set config_json = '${restoredConfig}' where id = new.id;
      end;
    `)
    const vault = createVaultFake()
    const store = createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({ database, vault, now: () => now })
    })

    await expect(store.getState()).rejects.toThrow('channel migration scrub')

    const row = database.connection.prepare(
      "select config_json, migration_state, requested_enabled, migration_error_code from channel_legacy_channels where id = 'channel-1'"
    ).get() as Record<string, unknown>
    expect(row).toMatchObject({
      config_json: JSON.stringify(config), migration_state: 'quarantined', requested_enabled: 0,
      migration_error_code: errorCode
    })
    if (type === 'wechat') {
      expect(vault.prepareMigration).not.toHaveBeenCalled()
      expect(vault.inspectReserved).not.toHaveBeenCalled()
    }

    database.connection.exec('drop trigger persistent_scrub_fault')
    await expect(store.getState()).resolves.toMatchObject({ channels: [] })
  })

  it('preserves the WeChat reenrollment error when a restarted archive inspection is unavailable', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'wechat', { token_path: '/private/wechat-token.json' }, ['chat-1'])
    const vault = createVaultFake()
    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()
    database.connection.prepare(
      "update channel_credential_migrations set state = 'legacy-scrubbed' where purpose = 'legacy-discovery-archive'"
    ).run()

    const unavailableArchiveVault = createVaultFake()
    await new ChannelCredentialMigrationReconciler({ database, vault: unavailableArchiveVault, now: () => now }).reconcile()

    expect(unavailableArchiveVault.prepareMigration).not.toHaveBeenCalled()
    expect(unavailableArchiveVault.inspectReserved).not.toHaveBeenCalled()
    expect(database.connection.prepare(
      "select migration_state, requested_enabled, migration_error_code, credential_ref from channel_legacy_channels where id = 'channel-1'"
    ).get()).toEqual({
      migration_state: 'quarantined', requested_enabled: 0,
      migration_error_code: 'channel-legacy-credential-reenrollment-required', credential_ref: null
    })
  })

  it('quarantines a conflicting state-entry source without deleting committed provider metadata', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'direct-secret' })
    const vault = createVaultFake({ dynamicProviderFingerprint: true })
    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()
    database.connection.prepare("update channel_legacy_channels set migration_state = 'legacy', config_json = ? where id = 'channel-1'")
      .run(JSON.stringify({ bot_token: 'direct-secret' }))
    database.connection.prepare("insert into agent_platform_state_entries (key, value_json, updated_at) values ('channels', ?, ?)")
      .run(JSON.stringify([legacyChannel({ bot_token: 'conflicting-secret' })]), now.toISOString())

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    expect(vault.delete).not.toHaveBeenCalled()
    expect(database.connection.prepare(
      "select migration_state, requested_enabled, credential_ref from channel_legacy_channels where id = 'channel-1'"
    ).get()).toMatchObject({
      migration_state: 'quarantined',
      requested_enabled: 0,
      credential_ref: 'channel-migration:channel-1:provider'
    })
    expect(database.connection.prepare("select 1 from agent_platform_state_entries where key = 'channels'").get()).toBeUndefined()
  })

  it('cleans up a known unreferenced provider ref after a conflicting source, then retries on restart', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'first-secret' })
    const failingVault = createVaultFake({ failDelete: true, dynamicProviderFingerprint: true })
    await new ChannelCredentialMigrationReconciler({ database, vault: failingVault, now: () => now }).reconcile()
    database.connection.prepare(
      "update channel_legacy_channels set migration_state = 'legacy', config_json = ?, credential_ref = null, public_config_json = null where id = 'channel-1'"
    ).run(JSON.stringify({ bot_token: 'second-secret' }))

    await new ChannelCredentialMigrationReconciler({ database, vault: failingVault, now: () => now }).reconcile()

    expect(database.connection.prepare(
      "select state from channel_credential_migrations where purpose = 'provider-credential'"
    ).get()).toEqual({ state: 'needs-cleanup' })
    const retryVault = createVaultFake({ dynamicProviderFingerprint: true })
    await new ChannelCredentialMigrationReconciler({ database, vault: retryVault, now: () => now }).reconcile()
    expect(retryVault.delete).toHaveBeenCalledWith('channel-migration:channel-1:provider')
    expect(database.connection.prepare(
      "select state from channel_credential_migrations where purpose = 'provider-credential'"
    ).get()).toEqual({ state: 'cleanup-completed' })
  })

  it('quarantines WeChat token_path without Vault writes, filesystem access, or path leakage', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const tokenPath = '/private/wechat-token.json'
    insertLegacyChannel(database, 'wechat', { token_path: tokenPath }, ['chat-1'], 'legacy-session')
    const vault = createVaultFake()

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    expect(vault.prepareMigration).not.toHaveBeenCalled()
    expect(vault.putReserved).not.toHaveBeenCalled()
    expect(vault.putReservedArchive).toHaveBeenCalledWith(expect.objectContaining({ candidates: ['chat-1'] }))
    const row = database.connection.prepare(
      'select config_json, session_id, active_chat_ids_json, migration_state, migration_error_code, legacy_session_state from channel_legacy_channels where id = ?'
    ).get('channel-1') as Record<string, unknown>
    expect(row).toMatchObject({
      config_json: null,
      session_id: null,
      active_chat_ids_json: null,
      migration_state: 'quarantined',
      migration_error_code: 'channel-legacy-credential-reenrollment-required',
      legacy_session_state: 'legacy-unmapped'
    })
    expect(JSON.stringify(row)).not.toContain(tokenPath)
  })

  it('scrubs an invalid legacy source into a generic quarantine without leaving config JSON', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    insertLegacyChannel(database, 'telegram', { bot_token: 'telegram-secret', allowed_chat_ids: 'legacy' })
    const vault = createVaultFake()

    await new ChannelCredentialMigrationReconciler({ database, vault, now: () => now }).reconcile()

    expect(vault.putReserved).not.toHaveBeenCalled()
    const row = database.connection.prepare(
      'select config_json, session_id, active_chat_ids_json, permission_mode, migration_state, migration_error_code from channel_legacy_channels where id = ?'
    ).get('channel-1') as Record<string, unknown>
    expect(row).toMatchObject({
      config_json: null,
      session_id: null,
      active_chat_ids_json: null,
      permission_mode: null,
      migration_state: 'quarantined',
      migration_error_code: 'channel-legacy-credential-migration-failed'
    })
    expect(JSON.stringify(row)).not.toContain('telegram-secret')
  })

  it('migrates state-entry and fallback channels before they can hydrate, then removes their source secrets', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.prepare("insert into agent_platform_state_entries (key, value_json, updated_at) values ('channels', ?, ?)")
      .run(JSON.stringify([legacyChannel({ bot_token: 'entry-secret' })]), now.toISOString())
    const vault = createVaultFake()
    const fallback = { ...createDefaultAgentPersistentState(), channels: [legacyChannel({ bot_token: 'fallback-secret' })] }
    const writeFallback = vi.fn(async () => undefined)

    await new ChannelCredentialMigrationReconciler({
      database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: writeFallback
    }).reconcile()

    expect(database.connection.prepare("select 1 from agent_platform_state_entries where key = 'channels'").get()).toBeUndefined()
    expect(vault.putReserved).toHaveBeenCalledWith(expect.objectContaining({ value: { bot_token: 'entry-secret' } }))
    expect(writeFallback).not.toHaveBeenCalled() // SQLite now has a persisted migration result.
  })

  it('uses and scrubs fallback channels only when SQLite was initially empty', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const fallback = { ...createDefaultAgentPersistentState(), channels: [legacyChannel({ bot_token: 'fallback-secret' })] }
    const writeFallback = vi.fn(async () => undefined)
    const vault = createVaultFake()

    const state = await createAgentSqliteStoreWithOptions(database, createDefaultAgentPersistentState(), {
      legacyStateLoader: async () => fallback,
      legacyStateArchiver: writeFallback,
      channelMigrationReconciler: new ChannelCredentialMigrationReconciler({
        database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: writeFallback
      })
    }).getState()

    expect(state.channels).toEqual([])
    expect(vault.putReserved).toHaveBeenCalledWith(expect.objectContaining({ value: { bot_token: 'fallback-secret' } }))
    expect(writeFallback).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
  })

  it('scrubs tombstoned legacy row, state-entry and fallback sources without any Vault operation or Channel revival', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.prepare("insert into channel_management_tombstones(channel_id,deleted_at) values('channel-1',?)").run(now.toISOString())
    insertLegacyChannel(database, 'telegram', { bot_token: 'row-secret' })
    database.connection.prepare("insert into agent_platform_state_entries(key,value_json,updated_at) values('channels',?,?)")
      .run(JSON.stringify([legacyChannel({ bot_token: 'entry-secret' })]), now.toISOString())
    database.connection.prepare("insert into agent_platform_state_entries(key,value_json,updated_at) values('channel-fallback-scrub',?,?)")
      .run(JSON.stringify({ state: 'pending', overwriteConfirmed: false }), now.toISOString())
    const fallback = { ...createDefaultAgentPersistentState(), channels: [legacyChannel({ bot_token: 'fallback-secret' })] }
    const writeFallback = vi.fn(async () => undefined)
    const vault = createVaultFake()

    await new ChannelCredentialMigrationReconciler({
      database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: writeFallback
    }).reconcile()

    expect(vault.prepareMigration).not.toHaveBeenCalled()
    expect(vault.putReserved).not.toHaveBeenCalled()
    expect(vault.prepareArchiveMigration).not.toHaveBeenCalled()
    expect(vault.putReservedArchive).not.toHaveBeenCalled()
    const row = database.connection.prepare('select config_json,session_id,active_chat_ids_json,requested_enabled,migration_state from channel_legacy_channels where id=?').get('channel-1') as Record<string, unknown>
    expect(row).toEqual({ config_json: null, session_id: null, active_chat_ids_json: null, requested_enabled: 0, migration_state: 'quarantined' })
    expect(database.connection.prepare("select 1 from agent_platform_state_entries where key='channels'").get()).toBeUndefined()
    expect(writeFallback).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
    expect(JSON.stringify(row)).not.toContain('row-secret')
    expect(JSON.stringify(writeFallback.mock.calls)).not.toContain('fallback-secret')
  })

  it('overwrites malformed tombstoned fallback channels after persisted state without any Vault operation', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.prepare("insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','general','Agent','[]','[]','0',?,?)")
      .run(now.toISOString(), now.toISOString())
    database.connection.prepare("insert into channel_management_tombstones(channel_id,deleted_at) values('channel-1',?)").run(now.toISOString())
    const fallback = {
      ...createDefaultAgentPersistentState(),
      channels: { id: 'channel-1', config: { bot_token: 'malformed-token', token_path: '/private/token-path' } }
    }
    const writeFallback = vi.fn(async () => undefined)
    const vault = createVaultFake()

    await new ChannelCredentialMigrationReconciler({
      database, vault, now: () => now, readLegacyState: async () => fallback, writeLegacyState: writeFallback
    }).reconcile()

    expect(writeFallback).toHaveBeenCalledWith(expect.objectContaining({ channels: [] }))
    expect(JSON.stringify(writeFallback.mock.calls)).not.toContain('malformed-token')
    expect(JSON.stringify(writeFallback.mock.calls)).not.toContain('/private/token-path')
    expect(vault.prepareMigration).not.toHaveBeenCalled()
    expect(vault.putReserved).not.toHaveBeenCalled()
    expect(vault.prepareArchiveMigration).not.toHaveBeenCalled()
    expect(vault.putReservedArchive).not.toHaveBeenCalled()
    expect(database.connection.prepare('select 1 from channel_legacy_channels where id=?').get('channel-1')).toBeUndefined()
  })
})

function insertLegacyChannel(
  database: ReturnType<typeof createAgentPlatformDatabase>,
  type: 'telegram' | 'wechat',
  config: Record<string, string>,
  activeChatIds?: string[],
  sessionId?: string
): void {
  database.connection.prepare(
    `insert into channel_legacy_channels (
      id, type, name, agent_id, session_id, workspace_json, config_json, is_active, active_chat_ids_json,
      permission_mode, created_at, updated_at
    ) values ('channel-1', ?, 'Legacy channel', null, ?, '{}', ?, 1, ?, null, ?, ?)`
  ).run(type, sessionId ?? null, JSON.stringify(config), activeChatIds ? JSON.stringify(activeChatIds) : null, now.toISOString(), now.toISOString())
}

function legacyChannel(config: Record<string, string>) {
  return {
    id: 'channel-1', type: 'telegram', name: 'Legacy channel', workspace: {}, config, isActive: true,
    createdAt: now.toISOString(), updatedAt: now.toISOString()
  }
}

function createVaultFake(input: {
  onPutReserved?: () => void
  failDelete?: boolean
  failArchiveDelete?: boolean
  dynamicProviderFingerprint?: boolean
  providerInitiallyPresent?: boolean
  archiveInitiallyPresent?: boolean
} = {}): ChannelCredentialVault {
  const provider: ChannelCredentialMigrationReservation = {
    credentialRef: 'channel-migration:channel-1:provider', sourceFingerprint: 'provider', fingerprintKeyId: 'key', migrationPermit: 'permit'
  }
  const archive: ChannelCredentialMigrationReservation = {
    credentialRef: 'channel-migration-archive:channel-1:archive', sourceFingerprint: 'archive', fingerprintKeyId: 'key', migrationPermit: 'permit-archive'
  }
  const credentials = new Set<string>(input.providerInitiallyPresent === false ? [] : [provider.credentialRef])
  const archives = new Set<string>(input.archiveInitiallyPresent === false ? [] : [archive.credentialRef])
  return {
    put: vi.fn(async () => ({ credentialRef: 'unused', revision: 1, maskedFields: {} })),
    get: vi.fn(async () => null), has: vi.fn(async () => false),
    rotate: vi.fn(async () => ({ credentialRef: 'unused', revision: 1, maskedFields: {} })), delete: vi.fn(async (ref) => {
      if (input.failDelete) throw new Error('delete failed')
      credentials.delete(ref)
    }),
    prepareMigration: vi.fn(async (request) => input.dynamicProviderFingerprint
      ? { ...provider, sourceFingerprint: request.value.bot_token ?? 'provider' }
      : provider),
    putReserved: vi.fn(async (request) => {
      input.onPutReserved?.(); credentials.add(request.credentialRef)
      return { credentialRef: request.credentialRef, revision: 1, maskedFields: {} }
    }),
    inspectReserved: vi.fn(async (request) => credentials.has(request.credentialRef) ? { credentialRef: request.credentialRef, revision: 1, maskedFields: {} } : null),
    deleteReservedIfRevision: vi.fn(async (request) => credentials.delete(request.credentialRef)),
    deleteIfRevision: vi.fn(async (request) => credentials.delete(request.credentialRef)),
    prepareArchiveMigration: vi.fn(async () => archive),
    putReservedArchive: vi.fn(async (request) => { archives.add(request.credentialRef) }),
    inspectReservedArchive: vi.fn(async (request) => archives.has(request.credentialRef)),
    deleteReservedArchive: vi.fn(async (request) => {
      if (input.failArchiveDelete) throw new Error('archive delete failed')
      archives.delete(request.credentialRef)
    })
  }
}
