import { randomUUID } from 'node:crypto'

import type { AgentChannelType } from '../schemas/channelSchemas'
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import {
  parseLegacyChannelCredentialMigrationSource,
  type LegacyChannelCredentialMigrationSource
} from './channelCredentialMigrationContracts'
import type { ChannelCredentialMigrationReservation, ChannelCredentialVault } from '../../../secrets/channels'

type LegacyChannelRow = {
  id: string
  type: AgentChannelType
  name: string
  agent_id: string | null
  workspace_json: string | null
  config_json: string | null
  session_id: string | null
  is_active: number | null
  active_chat_ids_json: string | null
  permission_mode: string | null
  created_at: string
  updated_at: string
}

type MigrationJournal = ChannelCredentialMigrationReservation & { id: string; state: string }

type LegacyStateFile = { channels?: unknown; [key: string]: unknown }

class MigrationSourceConflictError extends Error {
  constructor(readonly journal: MigrationJournal, readonly purpose: string) {
    super('channel migration source conflict')
  }
}

export type ChannelCredentialMigrationReconcilerOptions = {
  database: AgentPlatformDatabase
  vault: ChannelCredentialVault
  readLegacyState?: () => Promise<unknown>
  writeLegacyState?: (state: unknown) => Promise<void>
  now?: () => Date
}

const genericMigrationError = 'channel-legacy-credential-migration-failed'
const reenrollmentError = 'channel-legacy-credential-reenrollment-required'
const archiveLifetimeMs = 30 * 24 * 60 * 60 * 1000

/** Runs before AgentStore hydration so legacy Channel objects never enter runtime state. */
export class ChannelCredentialMigrationReconciler {
  constructor(private readonly options: ChannelCredentialMigrationReconcilerOptions) {}

  async reconcile(): Promise<void> {
    const blockedChannelIds = await this.reconcileJournals()
    await this.reconcileLegacyRows(blockedChannelIds)
    await this.reconcileStateEntry()
    await this.reconcileFallback()
    await this.cleanupExpiredArchives()
  }

  /** Called only after the store has durably persisted fallback non-Channel state. */
  completeFallbackHydration(): void {
    if (this.isFallbackOverwriteConfirmed()) this.setFallbackScrubState('completed', true)
  }

  private async reconcileLegacyRows(blockedChannelIds: ReadonlySet<string>): Promise<void> {
    const rows = this.options.database.connection.prepare(
      `select id, type, name, agent_id, workspace_json, config_json, session_id, is_active,
              active_chat_ids_json, permission_mode, created_at, updated_at
       from agent_channels where migration_state = 'legacy' order by id asc`
    ).all() as LegacyChannelRow[]
    for (const row of rows) {
      if (!blockedChannelIds.has(row.id)) await this.reconcileSource(row, toLegacySource(row))
    }
  }

  private async reconcileJournals(): Promise<Set<string>> {
    const blockedChannelIds = new Set<string>()
    const journals = this.options.database.connection.prepare(
      `select id, channel_id, purpose, source_fingerprint, fingerprint_key_id, credential_ref, migration_permit, state
       from channel_credential_migrations
       where state in ('reserved', 'vault-written', 'legacy-scrubbed', 'needs-cleanup')
       order by updated_at asc, id asc`
    ).all() as Array<{
      id: string; channel_id: string; purpose: string; source_fingerprint: string; fingerprint_key_id: string
      credential_ref: string; migration_permit: string; state: string
    }>
    for (const journal of journals) {
      if (this.isTombstoned(journal.channel_id)) continue
      const row = this.options.database.connection.prepare(
        `select id, type, name, agent_id, workspace_json, config_json, session_id, is_active,
                active_chat_ids_json, permission_mode, created_at, updated_at from agent_channels where id = ?`
      ).get(journal.channel_id) as LegacyChannelRow | undefined
      if (!row) continue
      const migration: MigrationJournal = {
        id: journal.id,
        credentialRef: journal.credential_ref,
        sourceFingerprint: journal.source_fingerprint,
        fingerprintKeyId: journal.fingerprint_key_id,
        migrationPermit: journal.migration_permit,
        state: journal.state
      }
      if (journal.state === 'needs-cleanup') {
        await this.retryCleanup(row, journal.purpose, migration)
        const state = this.options.database.connection.prepare(
          'select state from channel_credential_migrations where id = ?'
        ).get(journal.id) as { state?: string } | undefined
        if (state?.state === 'needs-cleanup') blockedChannelIds.add(row.id)
        continue
      }
      if (journal.state === 'reserved' && row.config_json !== null) {
        // The source is still present, so the normal replay path can reuse this committed permit.
        continue
      }
      try {
        if (!(await this.inspectJournal(row, journal.purpose, migration))) {
          this.deferKnownRefInspectionFailure(row, journal.id, journal.purpose)
          continue
        }
        if (this.isRowScrubbed(row)) {
          if (journal.purpose === 'provider-credential') {
            await this.finalizeMigratableChannel(row)
          } else if (this.hasProviderJournal(row.id)) {
            await this.finalizeMigratableChannel(row)
          } else {
            // Reenrollment archives never confer a runnable Channel state.
            this.completeArchiveOnly(journal.id)
          }
        } else if (journal.state === 'legacy-scrubbed') {
          const errorCode = journal.purpose === 'legacy-discovery-archive' && row.type === 'wechat'
            ? reenrollmentError
            : genericMigrationError
          this.quarantineCommittedMetadata(row, errorCode)
          if (!this.hasScrubbedLegacyFields(row.id)) {
            throw new Error('channel migration scrub recovery failed')
          }
        } else if (journal.state === 'reserved') {
          this.setJournalState(journal.id, 'vault-written', null)
        }
      } catch (error) {
        this.deferCommittedMetadataRecovery(row, journal.id, journal.purpose)
        if (!this.hasScrubbedLegacyFields(row.id)) throw error
      }
    }
    return blockedChannelIds
  }

  private async reconcileStateEntry(): Promise<void> {
    const row = this.options.database.connection.prepare(
      "select value_json from agent_platform_state_entries where key = 'channels'"
    ).get() as { value_json?: string } | undefined
    if (!row?.value_json) return

    let channels: unknown
    try {
      channels = JSON.parse(row.value_json)
    } catch {
      this.options.database.transact(() => {
        this.options.database.connection.prepare("delete from agent_platform_state_entries where key = 'channels'").run()
      })
      return
    }

    if (!Array.isArray(channels)) {
      this.options.database.transact(() => {
        this.options.database.connection.prepare("delete from agent_platform_state_entries where key = 'channels'").run()
      })
      return
    }

    for (const item of channels) {
      const rowSource = toLegacyStateEntryRow(item)
      if (!rowSource) continue
      await this.reconcileSource(rowSource, toLegacySource(rowSource))
    }
    this.options.database.transact(() => {
      this.options.database.connection.prepare("delete from agent_platform_state_entries where key = 'channels'").run()
    })
  }

  private async reconcileFallback(): Promise<void> {
    if (!this.options.readLegacyState || !this.options.writeLegacyState) return
    const scrubPending = this.getFallbackScrubState() === 'pending'
    const legacy = await this.options.readLegacyState() as LegacyStateFile
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return
    const hasChannelsKey = Object.prototype.hasOwnProperty.call(legacy, 'channels')
    const hasTombstonedChannel = hasChannelsKey && containsTombstonedFallbackId(legacy.channels, (id) => this.isTombstoned(id))

    // Existing SQLite state normally prevents a second migration scan, but a deleted
    // identity still requires an overwrite so a fallback token cannot survive there.
    if (this.hasPersistedState() && !scrubPending && !hasTombstonedChannel) return

    if (!hasChannelsKey && !scrubPending) return

    if (scrubPending) {
      try {
        await this.options.writeLegacyState({ ...legacy, channels: [] })
        this.setFallbackScrubState('pending', true)
      } catch {
        this.setFallbackScrubState('pending', false)
      }
      return
    }

    if (Array.isArray(legacy.channels)) {
      for (const item of legacy.channels) {
        const rowSource = toLegacyStateEntryRow(item)
        if (!rowSource) continue
        await this.reconcileSource(rowSource, toLegacySource(rowSource))
      }
    }

    // Persist the intent before overwrite so a later startup can retry without hydrating this file.
    this.setFallbackScrubState('pending', false)
    try {
      await this.options.writeLegacyState({ ...legacy, channels: [] })
      this.setFallbackScrubState('pending', true)
    } catch {
      // The pending marker is the only durable recovery data; it contains no source content.
    }
  }

  private hasPersistedState(): boolean {
    const row = this.options.database.connection.prepare(
      "select 1 as present from agent_platform_state_entries limit 1"
    ).get() as { present?: number } | undefined
    if (row?.present) return true
    const tables = ['agent_entities', 'agent_sessions', 'agent_workspaces', 'agent_channels']
    return tables.some((table) => Boolean(this.options.database.connection.prepare(`select 1 as present from ${table} limit 1`).get()))
  }

  private getFallbackScrubState(): string | null {
    const row = this.options.database.connection.prepare(
      "select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'"
    ).get() as { value_json?: string } | undefined
    if (!row?.value_json) return null
    try {
      return (JSON.parse(row.value_json) as { state?: string }).state ?? null
    } catch {
      return null
    }
  }

  private isFallbackOverwriteConfirmed(): boolean {
    const row = this.options.database.connection.prepare(
      "select value_json from agent_platform_state_entries where key = 'channel-fallback-scrub'"
    ).get() as { value_json?: string } | undefined
    if (!row?.value_json) return false
    try {
      return (JSON.parse(row.value_json) as { overwriteConfirmed?: boolean }).overwriteConfirmed === true
    } catch {
      return false
    }
  }

  private setFallbackScrubState(state: 'pending' | 'completed', overwriteConfirmed: boolean): void {
    this.options.database.connection.prepare(
      `insert into agent_platform_state_entries (key, value_json, updated_at) values ('channel-fallback-scrub', ?, ?)
       on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(JSON.stringify({ state, overwriteConfirmed }), this.now())
  }

  private async reconcileSource(row: LegacyChannelRow, source: LegacyChannelCredentialMigrationSource): Promise<void> {
    if (this.isTombstoned(row.id)) {
      this.scrubTombstonedSource(row)
      return
    }
    let credential: MigrationJournal | null = null
    let archive: MigrationJournal | null = null
    let metadataCommitted = false
    let parsed: ReturnType<typeof parseLegacyChannelCredentialMigrationSource>
    try {
      parsed = parseLegacyChannelCredentialMigrationSource(source)
    } catch {
      this.quarantineSafely(row, genericMigrationError)
      return
    }

    if (parsed.kind === 'requires-reenrollment') {
      await this.quarantineForReenrollment(row, parsed.legacyDiscoveredConversationCandidates, parsed.legacySessionState)
      return
    }

    try {
      credential = await this.reserveProvider(row.id, row.type, parsed.secrets)
      await this.options.vault.putReserved({
        channelId: row.id,
        type: row.type,
        value: parsed.secrets,
        ...credential
      })
      const safeCredential = await this.options.vault.inspectReserved({ channelId: row.id, type: row.type, ...credential })
      if (!safeCredential) throw new Error('missing reserved credential')
      this.setJournalState(credential.id, 'vault-written', null)

      archive = parsed.legacyDiscoveredConversationCandidates.length > 0
        ? await this.reserveArchive(row.id, row.type, parsed.legacyDiscoveredConversationCandidates)
        : null
      if (archive) {
        await this.options.vault.putReservedArchive({
          channelId: row.id,
          type: row.type,
          candidates: parsed.legacyDiscoveredConversationCandidates,
          ...archive
        })
        if (!(await this.options.vault.inspectReservedArchive({ channelId: row.id, type: row.type, ...archive }))) {
          throw new Error('missing reserved archive')
        }
        this.setJournalState(archive.id, 'vault-written', null)
      }

      const reservedCredential = credential
      const reservedArchive = archive
      if (!reservedCredential) throw new Error('missing reserved credential')
      this.options.database.transact(() => {
        const now = this.now()
        this.upsertLegacyRow(row)
        this.options.database.connection.prepare(
          `update agent_channels set public_config_json = ?, credential_ref = ?, credential_revision = ?,
             requested_enabled = ?, migration_state = 'legacy-scrubbed', migration_error_code = null,
             legacy_session_state = ?, config_json = null, session_id = null, is_active = 0,
             active_chat_ids_json = null, permission_mode = null, updated_at = ? where id = ?`
        ).run(
          JSON.stringify(parsed.publicConfig), safeCredential.credentialRef, safeCredential.revision,
          row.is_active === 1 ? 1 : 0, parsed.legacySessionState, now, row.id
        )
        if (reservedArchive) {
          this.options.database.connection.prepare(
            `insert into channel_legacy_discovery_archives (
              channel_id, archive_ref, candidate_count, state, expires_at, created_at, updated_at
            ) values (?, ?, ?, 'pending-manual-review', ?, ?, ?)
            on conflict(channel_id) do update set archive_ref = excluded.archive_ref, candidate_count = excluded.candidate_count,
              state = excluded.state, expires_at = excluded.expires_at, updated_at = excluded.updated_at`
          ).run(row.id, reservedArchive.credentialRef, parsed.legacyDiscoveredConversationCandidates.length, this.expiresAt(), now, now)
        }
        this.setJournalState(reservedCredential.id, 'legacy-scrubbed', null)
        if (reservedArchive) this.setJournalState(reservedArchive.id, 'legacy-scrubbed', null)
      })
      metadataCommitted = true

      if (!this.hasScrubbedLegacyFields(row.id)) {
        this.quarantineCommittedMetadata(row, genericMigrationError)
        if (!this.hasScrubbedLegacyFields(row.id)) throw new Error('channel migration scrub postcheck failed')
        return
      }
      await this.finalizeMigratableChannel(row)
    } catch (error) {
      // A committed metadata transaction owns these known Vault refs. Leave its
      // legacy-scrubbed journal for restart reconciliation instead of deleting it.
      if (metadataCommitted) {
        // A trigger or I/O fault that defeats the scrub leaves no safe runtime
        // state. Stop startup rather than continuing with legacy fields present.
        if (!this.hasScrubbedLegacyFields(row.id)) throw error
        return
      }
      if (error instanceof MigrationSourceConflictError) {
        await this.handleSourceConflict(row, error)
        return
      }
      this.quarantineSafely(row, genericMigrationError)
      if (credential) {
        this.setJournalState(credential.id, 'needs-cleanup', genericMigrationError)
        await this.cleanupUnreferencedProviderCredential(row.id, credential)
      }
      if (archive) {
        this.setJournalState(archive.id, 'needs-cleanup', genericMigrationError)
        await this.cleanupUnreferencedArchive(row.id, row.type, archive)
      }
    }
  }

  private async reserveProvider(channelId: string, type: AgentChannelType, value: Record<string, string>): Promise<MigrationJournal> {
    const reservation = await this.options.vault.prepareMigration({ channelId, type, value })
    return this.reserveJournal(channelId, 'provider-credential', reservation)
  }

  private async reserveArchive(channelId: string, type: AgentChannelType, candidates: string[]): Promise<MigrationJournal> {
    const reservation = await this.options.vault.prepareArchiveMigration({ channelId, type, candidates })
    return this.reserveJournal(channelId, 'legacy-discovery-archive', reservation)
  }

  private reserveJournal(channelId: string, purpose: string, reservation: ChannelCredentialMigrationReservation): MigrationJournal {
    const conflicting = this.options.database.connection.prepare(
      `select id, credential_ref, source_fingerprint, fingerprint_key_id, migration_permit, state
       from channel_credential_migrations where channel_id = ? and purpose = ? limit 1`
    ).get(channelId, purpose) as {
      id: string; credential_ref: string; source_fingerprint: string; fingerprint_key_id: string; migration_permit: string; state: string
    } | undefined
    if (conflicting && conflicting.source_fingerprint !== reservation.sourceFingerprint) {
      throw new MigrationSourceConflictError({
        id: conflicting.id,
        credentialRef: conflicting.credential_ref,
        sourceFingerprint: conflicting.source_fingerprint,
        fingerprintKeyId: conflicting.fingerprint_key_id,
        migrationPermit: conflicting.migration_permit,
        state: conflicting.state
      }, purpose)
    }
    const existing = this.options.database.connection.prepare(
      `select id, credential_ref, source_fingerprint, fingerprint_key_id, migration_permit, state
       from channel_credential_migrations where channel_id = ? and purpose = ? and source_fingerprint = ?`
    ).get(channelId, purpose, reservation.sourceFingerprint) as {
      id: string; credential_ref: string; source_fingerprint: string; fingerprint_key_id: string; migration_permit: string; state: string
    } | undefined
    if (existing) {
      if (existing.credential_ref !== reservation.credentialRef || existing.fingerprint_key_id !== reservation.fingerprintKeyId || existing.migration_permit !== reservation.migrationPermit) {
        throw new Error('migration journal mismatch')
      }
      return {
        id: existing.id,
        credentialRef: existing.credential_ref,
        sourceFingerprint: existing.source_fingerprint,
        fingerprintKeyId: existing.fingerprint_key_id,
        migrationPermit: existing.migration_permit,
        state: existing.state
      }
    }
    const now = this.now()
    const id = randomUUID()
    this.options.database.transact(() => {
      this.options.database.connection.prepare(
        `insert into channel_credential_migrations (
          id, channel_id, purpose, source_fingerprint, fingerprint_key_id, credential_ref, migration_permit,
          state, attempt_count, last_error_code, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 'reserved', 0, null, ?, ?)`
      ).run(id, channelId, purpose, reservation.sourceFingerprint, reservation.fingerprintKeyId, reservation.credentialRef, reservation.migrationPermit, now, now)
    })
    return { id, ...reservation, state: 'reserved' }
  }

  private quarantine(row: LegacyChannelRow, errorCode: string, legacySessionState: 'legacy-unmapped' | null = null): void {
    this.options.database.transact(() => {
      this.upsertLegacyRow(row)
      this.options.database.connection.prepare(
        `update agent_channels set public_config_json = null, credential_ref = null, credential_revision = null,
           requested_enabled = 0, migration_state = 'quarantined', migration_error_code = ?, legacy_session_state = ?,
           config_json = null, session_id = null, is_active = 0, active_chat_ids_json = null, permission_mode = null,
           updated_at = ? where id = ?`
      ).run(errorCode, legacySessionState, this.now(), row.id)
    })
  }

  private async quarantineForReenrollment(
    row: LegacyChannelRow,
    candidates: string[],
    legacySessionState: 'legacy-unmapped' | null
  ): Promise<void> {
    if (candidates.length === 0) {
      this.quarantineSafely(row, reenrollmentError, legacySessionState)
      return
    }
    let archive: MigrationJournal | null = null
    let metadataCommitted = false
    try {
      const reservedArchive = await this.reserveArchive(row.id, row.type, candidates)
      archive = reservedArchive
      await this.options.vault.putReservedArchive({ channelId: row.id, type: row.type, candidates, ...reservedArchive })
      if (!(await this.options.vault.inspectReservedArchive({ channelId: row.id, type: row.type, ...reservedArchive }))) {
        throw new Error('missing reenrollment archive')
      }
      this.options.database.transact(() => {
        this.upsertLegacyRow(row)
        const now = this.now()
        this.options.database.connection.prepare(
          `update agent_channels set public_config_json = null, credential_ref = null, credential_revision = null,
             requested_enabled = 0, migration_state = 'quarantined', migration_error_code = ?, legacy_session_state = ?,
             config_json = null, session_id = null, is_active = 0, active_chat_ids_json = null, permission_mode = null,
             updated_at = ? where id = ?`
        ).run(reenrollmentError, legacySessionState, now, row.id)
        this.options.database.connection.prepare(
          `insert into channel_legacy_discovery_archives (
            channel_id, archive_ref, candidate_count, state, expires_at, created_at, updated_at
          ) values (?, ?, ?, 'pending-manual-review', ?, ?, ?)`
        ).run(row.id, reservedArchive.credentialRef, candidates.length, this.expiresAt(), now, now)
        this.setJournalState(reservedArchive.id, 'legacy-scrubbed', null)
      })
      metadataCommitted = true
      if (!this.hasScrubbedLegacyFields(row.id)) {
        this.quarantineCommittedMetadata(row, reenrollmentError)
        if (!this.hasScrubbedLegacyFields(row.id)) throw new Error('channel reenrollment scrub postcheck failed')
        return
      }
      this.completeArchiveOnly(archive.id)
    } catch (error) {
      if (metadataCommitted) {
        if (!this.hasScrubbedLegacyFields(row.id)) throw error
        return
      }
      if (error instanceof MigrationSourceConflictError) {
        await this.handleSourceConflict(row, error)
        return
      }
      this.quarantineSafely(row, reenrollmentError, legacySessionState)
      if (archive) {
        this.setJournalState(archive.id, 'needs-cleanup', reenrollmentError)
        await this.cleanupUnreferencedArchive(row.id, row.type, archive)
      }
    }
  }

  private upsertLegacyRow(row: LegacyChannelRow): void {
    if (this.isTombstoned(row.id)) return
    this.options.database.connection.prepare(
      `insert into agent_channels (
        id, type, name, agent_id, workspace_json, config_json, session_id, is_active, active_chat_ids_json,
        permission_mode, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do nothing`
    ).run(row.id, row.type, row.name, row.agent_id, row.workspace_json, row.config_json, row.session_id,
      row.is_active, row.active_chat_ids_json, row.permission_mode, row.created_at, row.updated_at)
  }

  private isTombstoned(channelId: string): boolean {
    return Boolean(this.options.database.connection.prepare(
      'select 1 from channel_management_tombstones where channel_id = ?'
    ).get(channelId))
  }

  /** A deleted ID must not be revived, but any legacy row still carrying secrets is scrubbed in place. */
  private scrubTombstonedSource(row: LegacyChannelRow): void {
    this.options.database.transact(() => {
      this.options.database.connection.prepare(
        `update agent_channels set public_config_json = null, credential_ref = null, credential_revision = null,
           requested_enabled = 0, migration_state = 'quarantined', migration_error_code = ?,
           config_json = null, session_id = null, is_active = 0, active_chat_ids_json = null, permission_mode = null,
           updated_at = ? where id = ?`
      ).run('channel-deleted', this.now(), row.id)
    })
  }

  private setJournalState(id: string, state: string, errorCode: string | null): void {
    this.options.database.connection.prepare(
      'update channel_credential_migrations set state = ?, last_error_code = ?, attempt_count = attempt_count + 1, updated_at = ? where id = ?'
    ).run(state, errorCode, this.now(), id)
  }

  private deferCommittedMetadataRecovery(row: LegacyChannelRow, journalId: string, purpose: string): void {
    const errorCode = purpose === 'legacy-discovery-archive' && row.type === 'wechat'
      ? reenrollmentError
      : genericMigrationError
    if (this.isRowScrubbed(row)) {
      // The journal still owns the only known ref. The row remains non-runnable
      // until a later restart can inspect and finish it; never clear that ref.
      this.setJournalState(journalId, 'legacy-scrubbed', errorCode)
      this.quarantineCommittedMetadata(row, errorCode)
      this.assertScrubbedOrThrow(row.id)
      return
    }
    this.setJournalState(journalId, 'needs-cleanup', errorCode)
    this.quarantine(row, errorCode)
    this.assertScrubbedOrThrow(row.id)
  }

  private deferKnownRefInspectionFailure(row: LegacyChannelRow, journalId: string, purpose: string): void {
    const errorCode = purpose === 'legacy-discovery-archive' && row.type === 'wechat'
      ? reenrollmentError
      : genericMigrationError
    this.setJournalState(journalId, 'legacy-scrubbed', errorCode)
    this.quarantineCommittedMetadata(row, errorCode)
    this.assertScrubbedOrThrow(row.id)
  }

  private async handleSourceConflict(row: LegacyChannelRow, conflict: MigrationSourceConflictError): Promise<void> {
    if (this.hasJournalMetadataReference(row.id, conflict)) {
      // Do not orphan a committed credential just because a second legacy source
      // claims the same Channel id with different secret material.
      this.quarantineCommittedMetadata(row, genericMigrationError)
      return
    }

    this.quarantineSafely(row, genericMigrationError)
    this.setJournalState(conflict.journal.id, 'needs-cleanup', genericMigrationError)
    await this.retryCleanup(row, conflict.purpose, conflict.journal)
  }

  private quarantineCommittedMetadata(row: LegacyChannelRow, errorCode: string): void {
    this.options.database.connection.prepare(
      `update agent_channels set requested_enabled = 0, migration_state = 'quarantined', migration_error_code = ?,
         config_json = null, session_id = null, is_active = 0, active_chat_ids_json = null, permission_mode = null,
         updated_at = ? where id = ?`
    ).run(errorCode, this.now(), row.id)
  }

  private quarantineSafely(
    row: LegacyChannelRow,
    errorCode: string,
    legacySessionState: 'legacy-unmapped' | null = null
  ): void {
    if (this.hasAnyMetadataReference(row.id)) {
      this.quarantineCommittedMetadata(row, errorCode)
      return
    }
    this.quarantine(row, errorCode, legacySessionState)
  }

  private hasJournalMetadataReference(channelId: string, journal: MigrationSourceConflictError): boolean {
    if (journal.purpose === 'provider-credential') {
      const row = this.options.database.connection.prepare(
        'select 1 as present from agent_channels where id = ? and credential_ref = ?'
      ).get(channelId, journal.journal.credentialRef)
      return Boolean(row)
    }
    const archive = this.options.database.connection.prepare(
      'select 1 as present from channel_legacy_discovery_archives where channel_id = ? and archive_ref = ?'
    ).get(channelId, journal.journal.credentialRef)
    return Boolean(archive)
  }

  private hasAnyMetadataReference(channelId: string): boolean {
    const credential = this.options.database.connection.prepare(
      'select 1 as present from agent_channels where id = ? and credential_ref is not null'
    ).get(channelId)
    if (credential) return true
    return Boolean(this.options.database.connection.prepare(
      'select 1 as present from channel_legacy_discovery_archives where channel_id = ?'
    ).get(channelId))
  }

  private hasScrubbedLegacyFields(channelId: string): boolean {
    const row = this.options.database.connection.prepare(
      'select config_json, session_id, active_chat_ids_json, permission_mode from agent_channels where id = ?'
    ).get(channelId) as Record<string, unknown> | undefined
    if (!row) return false
    return Object.values(row).every((value) => value === null)
  }

  private assertScrubbedOrThrow(channelId: string): void {
    if (!this.hasScrubbedLegacyFields(channelId)) {
      throw new Error('channel migration scrub recovery failed')
    }
  }

  private hasProviderJournal(channelId: string): boolean {
    return Boolean(this.options.database.connection.prepare(
      "select 1 as present from channel_credential_migrations where channel_id = ? and purpose = 'provider-credential'"
    ).get(channelId))
  }

  private async finalizeMigratableChannel(row: LegacyChannelRow): Promise<void> {
    if (!this.hasScrubbedLegacyFields(row.id)) {
      this.quarantineCommittedMetadata(row, genericMigrationError)
      return
    }
    const journals = this.listChannelJournals(row.id)
    for (const journal of journals) {
      if (!(await this.inspectJournal(row, journal.purpose, journal))) {
        this.deferKnownRefInspectionFailure(row, journal.id, journal.purpose)
        return
      }
    }
    this.options.database.transact(() => {
      for (const journal of journals) this.setJournalState(journal.id, 'completed', null)
      this.options.database.connection.prepare(
        "update agent_channels set migration_state = 'completed', migration_error_code = null where id = ?"
      ).run(row.id)
    })
  }

  private completeArchiveOnly(journalId: string): void {
    this.options.database.transact(() => this.setJournalState(journalId, 'completed', null))
  }

  private listChannelJournals(channelId: string): Array<MigrationJournal & { purpose: string }> {
    return this.options.database.connection.prepare(
      `select id, purpose, credential_ref, source_fingerprint, fingerprint_key_id, migration_permit, state
       from channel_credential_migrations where channel_id = ?
       and purpose in ('provider-credential', 'legacy-discovery-archive')`
    ).all(channelId).map((row) => {
      const value = row as {
        id: string; purpose: string; credential_ref: string; source_fingerprint: string
        fingerprint_key_id: string; migration_permit: string; state: string
      }
      return {
        id: value.id,
        purpose: value.purpose,
        credentialRef: value.credential_ref,
        sourceFingerprint: value.source_fingerprint,
        fingerprintKeyId: value.fingerprint_key_id,
        migrationPermit: value.migration_permit,
        state: value.state
      }
    })
  }

  private async inspectJournal(
    row: LegacyChannelRow,
    purpose: string,
    journal: MigrationJournal
  ): Promise<boolean> {
    if (purpose === 'provider-credential') {
      return Boolean(await this.options.vault.inspectReserved({ channelId: row.id, type: row.type, ...journal }))
    }
    return this.options.vault.inspectReservedArchive({ channelId: row.id, type: row.type, ...journal })
  }

  private async cleanupUnreferencedProviderCredential(channelId: string, credential: MigrationJournal): Promise<void> {
    const referenced = this.options.database.connection.prepare(
      'select 1 as present from agent_channels where id = ? and credential_ref = ?'
    ).get(channelId, credential.credentialRef)
    if (referenced) return
    try {
      await this.options.vault.delete(credential.credentialRef)
      this.setJournalState(credential.id, 'cleanup-completed', null)
    } catch {
      this.setJournalState(credential.id, 'needs-cleanup', genericMigrationError)
    }
  }

  private async cleanupUnreferencedArchive(channelId: string, type: AgentChannelType, archive: MigrationJournal): Promise<void> {
    const referenced = this.options.database.connection.prepare(
      'select 1 as present from channel_legacy_discovery_archives where channel_id = ? and archive_ref = ?'
    ).get(channelId, archive.credentialRef)
    if (referenced) return
    try {
      await this.options.vault.deleteReservedArchive({ channelId, type, ...archive })
      this.setJournalState(archive.id, 'cleanup-completed', null)
    } catch {
      this.setJournalState(archive.id, 'needs-cleanup', genericMigrationError)
    }
  }

  private async retryCleanup(row: LegacyChannelRow, purpose: string, migration: MigrationJournal): Promise<void> {
    if (purpose === 'provider-credential') {
      await this.cleanupUnreferencedProviderCredential(row.id, migration)
      return
    }
    if (purpose === 'legacy-discovery-archive') {
      await this.cleanupUnreferencedArchive(row.id, row.type, migration)
    }
  }

  private isRowScrubbed(row: LegacyChannelRow): boolean {
    return row.config_json === null &&
      row.session_id === null &&
      row.active_chat_ids_json === null &&
      row.permission_mode === null
  }

  private async cleanupExpiredArchives(): Promise<void> {
    const archives = this.options.database.connection.prepare(
      "select channel_id, archive_ref from channel_legacy_discovery_archives where expires_at <= ? and state = 'pending-manual-review'"
    ).all(this.now()) as Array<{ channel_id: string; archive_ref: string }>
    for (const archive of archives) {
      const journal = this.options.database.connection.prepare(
        `select source_fingerprint, fingerprint_key_id, migration_permit from channel_credential_migrations
         where credential_ref = ? and purpose = 'legacy-discovery-archive'`
      ).get(archive.archive_ref) as { source_fingerprint: string; fingerprint_key_id: string; migration_permit: string } | undefined
      if (!journal) continue
      try {
        await this.options.vault.deleteReservedArchive({
          channelId: archive.channel_id,
          type: (this.options.database.connection.prepare('select type from agent_channels where id = ?').get(archive.channel_id) as { type?: AgentChannelType } | undefined)?.type ?? 'telegram',
          credentialRef: archive.archive_ref,
          sourceFingerprint: journal.source_fingerprint,
          fingerprintKeyId: journal.fingerprint_key_id,
          migrationPermit: journal.migration_permit
        })
        this.options.database.connection.prepare(
          "update channel_legacy_discovery_archives set state = 'deleted', updated_at = ? where channel_id = ?"
        ).run(this.now(), archive.channel_id)
      } catch {
        // Keep the known reference for a later retry; do not enumerate the Vault.
      }
    }
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString()
  }

  private expiresAt(): string {
    return new Date((this.options.now?.() ?? new Date()).getTime() + archiveLifetimeMs).toISOString()
  }
}

function containsTombstonedFallbackId(value: unknown, isTombstoned: (id: string) => boolean): boolean {
  if (Array.isArray(value)) return value.some((item) => containsTombstonedFallbackId(item, isTombstoned))
  if (!value || typeof value !== 'object') return false
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 && isTombstoned(id)
}

function toLegacySource(row: LegacyChannelRow): LegacyChannelCredentialMigrationSource {
  return {
    type: row.type,
    config: parseJson(row.config_json),
    activeChatIds: parseJson(row.active_chat_ids_json),
    sessionId: row.session_id
  }
}

function toLegacyStateEntryRow(value: unknown): LegacyChannelRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const channel = value as Record<string, unknown>
  if (!isChannelType(channel.type) || typeof channel.id !== 'string' || !channel.id || typeof channel.name !== 'string') return null
  const now = new Date().toISOString()
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    agent_id: typeof channel.agentId === 'string' ? channel.agentId : null,
    workspace_json: JSON.stringify(channel.workspace ?? {}),
    config_json: JSON.stringify(channel.config) ?? null,
    session_id: typeof channel.sessionId === 'string' ? channel.sessionId : null,
    is_active: channel.isActive === true ? 1 : 0,
    active_chat_ids_json: channel.activeChatIds === undefined ? null : JSON.stringify(channel.activeChatIds) ?? null,
    permission_mode: typeof channel.permissionMode === 'string' ? channel.permissionMode : null,
    created_at: typeof channel.createdAt === 'string' ? channel.createdAt : now,
    updated_at: typeof channel.updatedAt === 'string' ? channel.updatedAt : now
  }
}

function parseJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function isChannelType(value: unknown): value is AgentChannelType {
  return value === 'telegram' || value === 'slack' || value === 'feishu' || value === 'qq' || value === 'discord' || value === 'wechat'
}
