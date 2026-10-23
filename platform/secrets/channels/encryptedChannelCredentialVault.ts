import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import type {
  ChannelCredentialPutInput,
  ChannelCredentialArchiveMigrationInput,
  ChannelCredentialArchiveReservedInspection,
  ChannelCredentialArchiveReservedPutInput,
  ChannelCredentialMigrationReservation,
  ChannelCredentialMutationIdentity,
  ChannelCredentialMutationReceipt,
  ChannelCredentialReservedInspection,
  ChannelCredentialReservedDelete,
  ChannelCredentialReservedCleanupClaim,
  ChannelCredentialReservedPutInput,
  ChannelCredentialSafeView,
  ChannelCredentialVault,
  ChannelPayloadCipher,
  ChannelPayloadDecryptionInput,
  ChannelPayloadEncryption,
  ChannelSecretBlobStore,
  SafeStorageAdapter
} from './channelCredentialContracts'

export type EncryptedChannelCredentialVault = ChannelCredentialVault & {
  payloadCipher: ChannelPayloadCipher
}

type CredentialRecord = ChannelCredentialPutInput & {
  revision: number
  lastMutation?: ChannelCredentialMutationIdentity
}
type ReservedCredentialRecord = CredentialRecord & {
  migrationIdentity: MigrationIdentity
  purpose?: 'legacy-discovery-archive'
  cleanupToken?: string
}
type PayloadKeyRecord = { channelId: string; keyRef: string; revision: number; key: string }
type PayloadKeyState = { currentKeyRef: string | null; currentRevision: number | null; nextRevision: number; knownKeyRefs: string[] }
type PayloadHashKeyRecord = { channelId: string; key: string }
type MigrationFingerprintKey = { keyId: string; key: string }
type MigrationIdentity = Omit<ChannelCredentialMigrationReservation, 'migrationPermit'>

const payloadStatePrefix = 'channel-payload-state:'
const payloadKeyPrefix = 'channel-payload-key:'
const payloadHashKeyPrefix = 'channel-payload-hash-key:'
const payloadDestroyedPrefix = 'channel-payload-destroyed:'
const migrationFingerprintKeyRef = 'channel-migration-fingerprint-key'
const migrationFingerprintKeyMarkerRef = 'channel-migration-fingerprint-key-marker'
const migrationFormatVersion = 'channel-credential-migration-v1'

export class ChannelCredentialVaultError extends Error {
  constructor() {
    super('Channel credential vault is unavailable.')
    this.name = 'ChannelCredentialVaultError'
  }
}

export function createEncryptedChannelCredentialVault(input: {
  safeStorage: SafeStorageAdapter
  storage: ChannelSecretBlobStore
}): EncryptedChannelCredentialVault {
  const vault = new EncryptedChannelCredentialVaultImplementation(input.safeStorage, input.storage)
  return {
    put: (request) => vault.put(request),
    get: (credentialRef) => vault.get(credentialRef),
    inspectSafe: (credentialRef) => vault.inspectSafe(credentialRef),
    has: (credentialRef) => vault.has(credentialRef),
    rotate: (credentialRef, value) => vault.rotate(credentialRef, value),
    rotateIfRevision: (credentialRef, expectedRevision, value, mutation) => vault.rotateIfRevision(credentialRef, expectedRevision, value, mutation),
    inspectMutationReceipt: (credentialRef) => vault.inspectMutationReceipt(credentialRef),
    delete: (credentialRef) => vault.delete(credentialRef),
    prepareMigration: (input) => vault.prepareMigration(input),
    putReserved: (input) => vault.putReserved(input),
    inspectReserved: (input) => vault.inspectReserved(input),
    claimReservedCleanup: (input) => vault.claimReservedCleanup(input),
    deleteReservedIfCleanupClaim: (input) => vault.deleteReservedIfCleanupClaim(input),
    deleteReservedIfRevision: (input) => vault.deleteReservedIfRevision(input),
    deleteIfRevision: (input) => vault.deleteIfRevision(input),
    prepareArchiveMigration: (input) => vault.prepareArchiveMigration(input),
    putReservedArchive: (input) => vault.putReservedArchive(input),
    inspectReservedArchive: (input) => vault.inspectReservedArchive(input),
    deleteReservedArchive: (input) => vault.deleteReservedArchive(input),
    payloadCipher: {
      encrypt: (channelId, payload) => vault.encrypt(channelId, payload),
      decrypt: (request) => vault.decrypt(request),
      keyedHash: (channelId, value) => vault.keyedHash(channelId, value),
      rotate: (channelId) => vault.rotatePayloadKey(channelId),
      revoke: (channelId, keyRef) => vault.revokePayloadKey(channelId, keyRef),
      destroy: (channelId, knownKeyRefs) => vault.destroyChannelPayload(channelId, knownKeyRefs)
    }
  }
}

class EncryptedChannelCredentialVaultImplementation {
  private mutationQueue = Promise.resolve()

  constructor(
    private readonly safeStorage: SafeStorageAdapter,
    private readonly storage: ChannelSecretBlobStore
  ) {}

  async put(input: ChannelCredentialPutInput): Promise<ChannelCredentialSafeView> {
    return this.serializeMutation(async () => {
      const credentialRef = `channel-credential:${input.channelId}:${randomUUID()}`
      const record: CredentialRecord = { ...normalizeCredentialInput(input), revision: 1 }
      await this.writeProtected(credentialRef, record)
      return toSafeView(credentialRef, record)
    })
  }

  async get(credentialRef: string): Promise<Record<string, string> | null> {
    if (isArchiveRef(credentialRef)) throw unavailable()
    const record = await this.readProtected<CredentialRecord>(credentialRef)
    if (record && !isCredentialRecord(record)) throw unavailable()
    return record ? { ...record.value } : null
  }

  async inspectSafe(credentialRef: string): Promise<ChannelCredentialSafeView | null> {
    if (isArchiveRef(credentialRef)) throw unavailable()
    const record = await this.readProtected<CredentialRecord>(credentialRef)
    if (record && (!isCredentialRecord(record) || isReservedCredentialRecord(record))) throw unavailable()
    return record ? toSafeView(credentialRef, record) : null
  }

  async inspectMutationReceipt(credentialRef: string): Promise<ChannelCredentialMutationReceipt | null> {
    if (isArchiveRef(credentialRef)) throw unavailable()
    const record = await this.readProtected<CredentialRecord>(credentialRef)
    if (!record || !isCredentialRecord(record) || isReservedCredentialRecord(record) || !record.lastMutation) return null
    return { credentialRef, revision: record.revision, ...record.lastMutation }
  }

  async has(credentialRef: string): Promise<boolean> {
    if (isArchiveRef(credentialRef)) return false
    return (await this.get(credentialRef)) !== null
  }

  async rotate(credentialRef: string, value: Record<string, string>): Promise<ChannelCredentialSafeView> {
    if (isArchiveRef(credentialRef)) throw unavailable()
    return this.serializeMutation(async () => {
      const current = await this.readCredentialRecord(credentialRef)
      if (!current) throw unavailable()
      if (isReservedCredentialRecord(current)) throw unavailable()
      const record: CredentialRecord = { ...current, value: normalizeStringRecord(value), revision: current.revision + 1 }
      await this.writeProtected(credentialRef, record)
      return toSafeView(credentialRef, record)
    })
  }

  async rotateIfRevision(
    credentialRef: string,
    expectedRevision: number,
    value: Record<string, string>,
    mutation: ChannelCredentialMutationIdentity
  ): Promise<ChannelCredentialSafeView> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || isArchiveRef(credentialRef) || !isMutationIdentity(mutation)) throw unavailable()
    return this.serializeMutation(async () => {
      const current = await this.readCredentialRecord(credentialRef)
      if (!current || isReservedCredentialRecord(current) || current.channelId !== mutation.channelId || current.revision !== expectedRevision) throw unavailable()
      const record: CredentialRecord = {
        ...current,
        value: normalizeStringRecord(value),
        revision: current.revision + 1,
        lastMutation: { ...mutation }
      }
      await this.writeProtected(credentialRef, record)
      return toSafeView(credentialRef, record)
    })
  }

  async delete(credentialRef: string): Promise<void> {
    if (isArchiveRef(credentialRef)) throw unavailable()
    return this.serializeMutation(async () => {
      this.requireAvailable()
      try {
        await this.storage.delete(credentialRef)
      } catch {
        throw unavailable()
      }
    })
  }

  async deleteIfRevision(input: { channelId: string; credentialRef: string; expectedRevision: number }): Promise<boolean> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || isArchiveRef(input.credentialRef)) throw unavailable()
    return this.serializeMutation(async () => {
      const current = await this.readCredentialRecord(input.credentialRef)
      if (!current || current.channelId !== input.channelId || current.revision !== input.expectedRevision) return false
      await this.storage.delete(input.credentialRef)
      return true
    })
  }

  async prepareMigration(
    input: ChannelCredentialPutInput & { expectedFingerprintKeyId?: string }
  ): Promise<ChannelCredentialMigrationReservation> {
    return this.serializeMutation(async () => {
      const normalized = normalizeCredentialInput(input)
      const key = await this.getOrCreateMigrationFingerprintKey(input.expectedFingerprintKeyId)
      if (input.expectedFingerprintKeyId && input.expectedFingerprintKeyId !== key.keyId) throw unavailable()
      const sourceFingerprint = calculateSourceFingerprint(key, normalized)
      const credentialRef = buildReservedCredentialRef(normalized.channelId, sourceFingerprint)
      const identity: MigrationIdentity = { credentialRef, sourceFingerprint, fingerprintKeyId: key.keyId }
      return { ...identity, migrationPermit: signMigrationPermit(key, normalized.channelId, normalized.type, identity) }
    })
  }

  async putReserved(input: ChannelCredentialReservedPutInput): Promise<ChannelCredentialSafeView> {
    return this.serializeMutation(async () => {
      const normalized = normalizeCredentialInput(input)
      const identity = migrationIdentityFrom(input)
      const key = await this.getMigrationFingerprintKey(identity.fingerprintKeyId)
      this.assertMigrationIdentity(key, normalized, identity, input.migrationPermit)
      const existing = await this.readProtected<CredentialRecord | ReservedCredentialRecord>(identity.credentialRef)
      if (existing) {
        this.assertStoredReservedRecord(key, existing, normalized.channelId, normalized.type, identity)
        if (!sameStringRecord(existing.value, normalized.value)) throw unavailable()
        // A repeated provision is an ownership adoption that invalidates stale cleanup work.
        if (existing.cleanupToken) await this.writeProtected(identity.credentialRef, { ...existing, cleanupToken: undefined })
        return toSafeView(identity.credentialRef, existing)
      }
      const record: ReservedCredentialRecord = { ...normalized, revision: 1, migrationIdentity: identity }
      await this.writeProtected(identity.credentialRef, record)
      return toSafeView(identity.credentialRef, record)
    })
  }

  async inspectReserved(input: ChannelCredentialReservedInspection): Promise<ChannelCredentialSafeView | null> {
    const identity = migrationIdentityFrom(input)
    const key = await this.getMigrationFingerprintKey(identity.fingerprintKeyId)
    const normalized = normalizeCredentialInput({ channelId: input.channelId, type: input.type, value: {} })
    if (!verifyMigrationPermit(key, normalized.channelId, normalized.type, identity, input.migrationPermit)) throw unavailable()
    const existing = await this.readProtected<CredentialRecord | ReservedCredentialRecord>(identity.credentialRef)
    if (!existing) return null
    this.assertStoredReservedRecord(key, existing, input.channelId, input.type, identity)
    return toSafeView(identity.credentialRef, existing)
  }

  async deleteReservedIfRevision(input: ChannelCredentialReservedDelete): Promise<boolean> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw unavailable()
    return this.serializeMutation(async () => {
      const identity = migrationIdentityFrom(input)
      const key = await this.getMigrationFingerprintKey(identity.fingerprintKeyId)
      const normalized = normalizeCredentialInput({ channelId: input.channelId, type: input.type, value: {} })
      if (!verifyMigrationPermit(key, normalized.channelId, normalized.type, identity, input.migrationPermit)) throw unavailable()
      const current = await this.readProtected<CredentialRecord | ReservedCredentialRecord>(identity.credentialRef)
      if (!current) return false
      this.assertStoredReservedRecord(key, current, input.channelId, input.type, identity)
      if (current.revision !== input.expectedRevision) return false
      await this.storage.delete(identity.credentialRef)
      return true
    })
  }

  async claimReservedCleanup(input: ChannelCredentialReservedInspection): Promise<ChannelCredentialReservedCleanupClaim | null> {
    return this.serializeMutation(async () => {
      const identity = migrationIdentityFrom(input)
      const key = await this.getMigrationFingerprintKey(identity.fingerprintKeyId)
      const normalized = normalizeCredentialInput({ channelId: input.channelId, type: input.type, value: {} })
      if (!verifyMigrationPermit(key, normalized.channelId, normalized.type, identity, input.migrationPermit)) throw unavailable()
      const current = await this.readProtected<CredentialRecord | ReservedCredentialRecord>(identity.credentialRef)
      if (!current) return null
      this.assertStoredReservedRecord(key, current, input.channelId, input.type, identity)
      const cleanupToken = randomUUID()
      await this.writeProtected(identity.credentialRef, { ...current, cleanupToken })
      return { revision: current.revision, cleanupToken }
    })
  }

  async deleteReservedIfCleanupClaim(input: ChannelCredentialReservedDelete & { cleanupToken: string }): Promise<boolean> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || !input.cleanupToken) throw unavailable()
    return this.serializeMutation(async () => {
      const identity = migrationIdentityFrom(input)
      const key = await this.getMigrationFingerprintKey(identity.fingerprintKeyId)
      const normalized = normalizeCredentialInput({ channelId: input.channelId, type: input.type, value: {} })
      if (!verifyMigrationPermit(key, normalized.channelId, normalized.type, identity, input.migrationPermit)) throw unavailable()
      const current = await this.readProtected<CredentialRecord | ReservedCredentialRecord>(identity.credentialRef)
      if (!current) return false
      this.assertStoredReservedRecord(key, current, input.channelId, input.type, identity)
      if (current.revision !== input.expectedRevision || current.cleanupToken !== input.cleanupToken) return false
      await this.storage.delete(identity.credentialRef)
      return true
    })
  }

  async prepareArchiveMigration(input: ChannelCredentialArchiveMigrationInput): Promise<ChannelCredentialMigrationReservation> {
    return this.serializeMutation(async () => {
      const candidates = normalizeArchiveCandidates(input.candidates)
      const key = await this.getOrCreateMigrationFingerprintKey(input.expectedFingerprintKeyId)
      if (input.expectedFingerprintKeyId && input.expectedFingerprintKeyId !== key.keyId) throw unavailable()
      const value = { candidates: JSON.stringify(candidates) }
      const sourceFingerprint = calculateSourceFingerprint(key, {
        channelId: input.channelId,
        type: input.type,
        value,
        purpose: 'legacy-discovery-archive'
      })
      const credentialRef = buildReservedArchiveRef(input.channelId, sourceFingerprint)
      const identity: MigrationIdentity = { credentialRef, sourceFingerprint, fingerprintKeyId: key.keyId }
      return { ...identity, migrationPermit: signMigrationPermit(key, input.channelId, input.type, identity, 'legacy-discovery-archive') }
    })
  }

  async putReservedArchive(input: ChannelCredentialArchiveReservedPutInput): Promise<void> {
    return this.serializeMutation(async () => {
      const candidates = normalizeArchiveCandidates(input.candidates)
      const identity = migrationIdentityFrom(input)
      if (!isArchiveRef(identity.credentialRef)) throw unavailable()
      const key = await this.getMigrationFingerprintKey(identity.fingerprintKeyId)
      const value = { candidates: JSON.stringify(candidates) }
      const expected = calculateSourceFingerprint(key, {
        channelId: input.channelId,
        type: input.type,
        value,
        purpose: 'legacy-discovery-archive'
      })
      if (identity.sourceFingerprint !== expected || !verifyMigrationPermit(key, input.channelId, input.type, identity, input.migrationPermit, 'legacy-discovery-archive')) throw unavailable()
      const existing = await this.readProtected<ReservedCredentialRecord>(identity.credentialRef)
      if (existing) {
        this.assertStoredReservedRecord(key, existing, input.channelId, input.type, identity, 'legacy-discovery-archive')
        if (!sameStringRecord(existing.value, value)) throw unavailable()
        return
      }
      await this.writeProtected(identity.credentialRef, {
        channelId: input.channelId,
        type: input.type,
        value,
        revision: 1,
        migrationIdentity: identity,
        purpose: 'legacy-discovery-archive'
      })
    })
  }

  async inspectReservedArchive(input: ChannelCredentialArchiveReservedInspection): Promise<boolean> {
    const identity = migrationIdentityFrom(input)
    if (!isArchiveRef(identity.credentialRef)) throw unavailable()
    const key = await this.getMigrationFingerprintKey(identity.fingerprintKeyId)
    if (!verifyMigrationPermit(key, input.channelId, input.type, identity, input.migrationPermit, 'legacy-discovery-archive')) throw unavailable()
    const existing = await this.readProtected<ReservedCredentialRecord>(identity.credentialRef)
    if (!existing) return false
    this.assertStoredReservedRecord(key, existing, input.channelId, input.type, identity, 'legacy-discovery-archive')
    return true
  }

  async deleteReservedArchive(input: ChannelCredentialArchiveReservedInspection): Promise<void> {
    return this.serializeMutation(async () => {
      if (!(await this.inspectReservedArchive(input))) return
      try {
        await this.storage.delete(input.credentialRef)
      } catch {
        throw unavailable()
      }
    })
  }

  async encrypt(channelId: string, payload: Uint8Array): Promise<ChannelPayloadEncryption> {
    return this.serializeMutation(async () => {
      const activeKey = await this.getActivePayloadKey(channelId)
      const key = activeKey ?? (await this.createPayloadKey(channelId))
      try {
        return {
          ciphertext: encryptPayload(Buffer.from(key.key, 'base64'), payload),
          keyRef: key.keyRef,
          keyRevision: key.revision
        }
      } catch {
        throw unavailable()
      }
    })
  }

  async decrypt(input: ChannelPayloadDecryptionInput): Promise<Uint8Array> {
    if (await this.isPayloadDestroyed(input.channelId)) throw unavailable()
    const key = await this.readProtected<PayloadKeyRecord>(payloadKeyStorageRef(input.keyRef))
    if (
      !key ||
      !isPayloadKeyRecord(key) ||
      key.channelId !== input.channelId ||
      key.keyRef !== input.keyRef ||
      key.revision !== input.keyRevision
    ) {
      throw unavailable()
    }
    try {
      return Uint8Array.from(decryptPayload(Buffer.from(key.key, 'base64'), input.ciphertext))
    } catch {
      throw unavailable()
    }
  }

  async keyedHash(channelId: string, value: Uint8Array): Promise<string> {
    return this.serializeMutation(async () => {
      const key = await this.getOrCreatePayloadHashKey(channelId)
      return createHmac('sha256', Buffer.from(key.key, 'base64')).update(value).digest('base64url')
    })
  }

  async rotatePayloadKey(channelId: string): Promise<{ keyRef: string; keyRevision: number }> {
    return this.serializeMutation(async () => {
      const key = await this.createPayloadKey(channelId)
      return { keyRef: key.keyRef, keyRevision: key.revision }
    })
  }

  async revokePayloadKey(channelId: string, keyRef: string): Promise<void> {
    return this.serializeMutation(async () => {
      const key = await this.readPayloadKeyRecord(keyRef)
      if (!key || key.channelId !== channelId || key.keyRef !== keyRef) throw unavailable()
      const state = await this.readPayloadState(channelId)
      try {
        await this.storage.delete(payloadKeyStorageRef(keyRef))
        if (state.currentKeyRef === keyRef) {
          await this.writeProtected(payloadStateStorageRef(channelId), { ...state, currentKeyRef: null, currentRevision: null })
        }
      } catch {
        throw unavailable()
      }
    })
  }

  async destroyChannelPayload(channelId: string, knownKeyRefs: readonly string[] = []): Promise<void> {
    return this.serializeMutation(async () => {
      if (await this.isPayloadDestroyed(channelId)) return
      const state = await this.readPayloadStateIfPresent(channelId)
      try {
        const refs = [...new Set([...knownKeyRefs, ...(state?.knownKeyRefs ?? [])])]
        if (!refs.every((ref) => isOwnedPayloadKeyRef(channelId, ref))) throw unavailable()
        for (const keyRef of refs) await this.storage.delete(payloadKeyStorageRef(keyRef))
        await this.storage.delete(payloadStateStorageRef(channelId))
        await this.storage.delete(payloadHashKeyStorageRef(channelId))
        // This survives key cleanup so an in-flight stale management mutation cannot recreate keys.
        await this.writeProtected(payloadDestroyedStorageRef(channelId), { channelId, deleted: true })
      } catch {
        throw unavailable()
      }
    })
  }

  private async getActivePayloadKey(channelId: string): Promise<PayloadKeyRecord | null> {
    const state = await this.readPayloadState(channelId)
    if (!state?.currentKeyRef || state.currentRevision === null) return null
    const key = await this.readPayloadKeyRecord(state.currentKeyRef)
    if (!key || key.channelId !== channelId || key.revision !== state.currentRevision) throw unavailable()
    return key
  }

  private async createPayloadKey(channelId: string): Promise<PayloadKeyRecord> {
    const state = await this.readPayloadState(channelId)
    const key: PayloadKeyRecord = {
      channelId,
      keyRef: `channel-payload-key:${channelId}:${randomUUID()}`,
      revision: state.nextRevision,
      key: randomBytes(32).toString('base64')
    }
    await this.writeProtected(payloadKeyStorageRef(key.keyRef), key)
    await this.writeProtected(payloadStateStorageRef(channelId), {
      currentKeyRef: key.keyRef,
      currentRevision: key.revision,
      nextRevision: key.revision + 1,
      knownKeyRefs: [...new Set([...state.knownKeyRefs, key.keyRef])]
    })
    return key
  }

  private async getOrCreatePayloadHashKey(channelId: string): Promise<PayloadHashKeyRecord> {
    if (await this.isPayloadDestroyed(channelId)) throw unavailable()
    const ref = payloadHashKeyStorageRef(channelId)
    const existing = await this.readProtected<PayloadHashKeyRecord>(ref)
    if (existing) {
      if (!isPayloadHashKeyRecord(existing) || existing.channelId !== channelId) throw unavailable()
      return existing
    }
    const key: PayloadHashKeyRecord = { channelId, key: randomBytes(32).toString('base64') }
    await this.writeProtected(ref, key)
    return key
  }

  private requireAvailable(): void {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('unavailable')
    } catch {
      throw unavailable()
    }
  }

  private async readProtected<T>(ref: string): Promise<T | null> {
    this.requireAvailable()
    try {
      const encrypted = await this.storage.read(ref)
      if (!encrypted) return null
      return JSON.parse(this.safeStorage.decryptString(encrypted)) as T
    } catch {
      throw unavailable()
    }
  }

  private async writeProtected(ref: string, value: unknown): Promise<void> {
    this.requireAvailable()
    try {
      const encrypted = this.safeStorage.encryptString(JSON.stringify(value))
      await this.storage.write(ref, encrypted)
    } catch {
      throw unavailable()
    }
  }

  private async readCredentialRecord(credentialRef: string): Promise<CredentialRecord | null> {
    const record = await this.readProtected<CredentialRecord>(credentialRef)
    if (record && !isCredentialRecord(record)) throw unavailable()
    return record
  }

  private async getOrCreateMigrationFingerprintKey(expectedKeyId?: string): Promise<MigrationFingerprintKey> {
    const existing = await this.readProtected<MigrationFingerprintKey>(migrationFingerprintKeyRef)
    if (existing) {
      if (!isMigrationFingerprintKey(existing)) throw unavailable()
      return existing
    }
    const marker = await this.readProtected<unknown>(migrationFingerprintKeyMarkerRef)
    if (expectedKeyId || marker !== null) throw unavailable()
    const created: MigrationFingerprintKey = { keyId: `channel-fingerprint-key:${randomUUID()}`, key: randomBytes(32).toString('base64') }
    await this.writeProtected(migrationFingerprintKeyRef, created)
    await this.writeProtected(migrationFingerprintKeyMarkerRef, true)
    return created
  }

  private async getMigrationFingerprintKey(expectedKeyId: string): Promise<MigrationFingerprintKey> {
    const existing = await this.readProtected<MigrationFingerprintKey>(migrationFingerprintKeyRef)
    if (!existing || !isMigrationFingerprintKey(existing) || existing.keyId !== expectedKeyId) throw unavailable()
    return existing
  }

  private assertMigrationIdentity(
    key: MigrationFingerprintKey,
    input: ChannelCredentialPutInput,
    identity: MigrationIdentity,
    permit: string
  ): void {
    if (identity.credentialRef !== buildReservedCredentialRef(input.channelId, identity.sourceFingerprint)) throw unavailable()
    if (identity.sourceFingerprint !== calculateSourceFingerprint(key, input)) throw unavailable()
    if (!verifyMigrationPermit(key, input.channelId, input.type, identity, permit)) throw unavailable()
  }

  private assertStoredReservedRecord(
    key: MigrationFingerprintKey,
    record: CredentialRecord | ReservedCredentialRecord,
    channelId: string,
    type: ChannelCredentialPutInput['type'],
    identity: MigrationIdentity,
    purpose?: 'legacy-discovery-archive'
  ): asserts record is ReservedCredentialRecord {
    if (!isReservedCredentialRecord(record) || !sameMigrationIdentity(record.migrationIdentity, identity)) throw unavailable()
    if (record.channelId !== channelId || record.type !== type) throw unavailable()
    if (record.purpose !== purpose) throw unavailable()
    if (calculateSourceFingerprint(key, { ...record, purpose }) !== identity.sourceFingerprint) throw unavailable()
  }

  private async readPayloadKeyRecord(keyRef: string): Promise<PayloadKeyRecord | null> {
    const key = await this.readProtected<PayloadKeyRecord>(payloadKeyStorageRef(keyRef))
    if (key && !isPayloadKeyRecord(key)) throw unavailable()
    return key
  }

  private async readPayloadState(channelId: string): Promise<PayloadKeyState> {
    if (await this.isPayloadDestroyed(channelId)) throw unavailable()
    const state = await this.readProtected<PayloadKeyState>(payloadStateStorageRef(channelId))
    if (state && !isPayloadKeyState(state)) throw unavailable()
    return state ? { ...state, knownKeyRefs: state.knownKeyRefs ?? (state.currentKeyRef ? [state.currentKeyRef] : []) } : emptyPayloadState()
  }

  private async readPayloadStateIfPresent(channelId: string): Promise<PayloadKeyState | null> {
    if (await this.isPayloadDestroyed(channelId)) return null
    const value = await this.readProtected<PayloadKeyState>(payloadStateStorageRef(channelId))
    if (!value) return null
    if (!isPayloadKeyState(value)) throw unavailable()
    return value
  }

  private async isPayloadDestroyed(channelId: string): Promise<boolean> {
    const marker = await this.readProtected<{ channelId: string; deleted: boolean }>(payloadDestroyedStorageRef(channelId))
    if (!marker) return false
    if (marker.channelId !== channelId || marker.deleted !== true || Object.keys(marker).length !== 2) throw unavailable()
    return true
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

function normalizeCredentialInput(input: ChannelCredentialPutInput): ChannelCredentialPutInput {
  if (!input.channelId || !input.type) throw unavailable()
  return { channelId: input.channelId, type: input.type, value: normalizeStringRecord(input.value) }
}

function normalizeStringRecord(value: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!key || typeof item !== 'string') throw unavailable()
    result[key] = item
  }
  return result
}

function migrationIdentityFrom(input: ChannelCredentialMigrationReservation): MigrationIdentity {
  if (!input.credentialRef || !input.sourceFingerprint || !input.fingerprintKeyId) throw unavailable()
  return {
    credentialRef: input.credentialRef,
    sourceFingerprint: input.sourceFingerprint,
    fingerprintKeyId: input.fingerprintKeyId
  }
}

function calculateSourceFingerprint(key: MigrationFingerprintKey, input: ChannelCredentialPutInput & { purpose?: string }): string {
  return createHmac('sha256', Buffer.from(key.key, 'base64'))
    .update(canonicalMigrationInput(input))
    .digest('base64url')
}

function canonicalMigrationInput(input: ChannelCredentialPutInput & { purpose?: string }): string {
  return JSON.stringify({
    format: migrationFormatVersion,
    channelId: input.channelId,
    type: input.type,
    purpose: input.purpose ?? 'provider-credential',
    value: Object.entries(input.value).sort(([left], [right]) => compareCredentialFieldNames(left, right))
  })
}

function buildReservedCredentialRef(channelId: string, sourceFingerprint: string): string {
  return `channel-migration:${channelId}:${sourceFingerprint}`
}

function signMigrationPermit(
  key: MigrationFingerprintKey,
  channelId: string,
  type: string,
  identity: MigrationIdentity,
  purpose = 'provider-credential'
): string {
  return createHmac('sha256', Buffer.from(key.key, 'base64'))
    .update(JSON.stringify({ format: migrationFormatVersion, channelId, type, purpose, ...identity }))
    .digest('base64url')
}

function verifyMigrationPermit(
  key: MigrationFingerprintKey,
  channelId: string,
  type: string,
  identity: MigrationIdentity,
  permit: string,
  purpose = 'provider-credential'
): boolean {
  try {
    const expected = Buffer.from(signMigrationPermit(key, channelId, type, identity, purpose), 'base64url')
    const received = Buffer.from(permit, 'base64url')
    return received.length === expected.length && timingSafeEqual(received, expected)
  } catch {
    return false
  }
}

function isCredentialRecord(value: unknown): value is CredentialRecord {
    return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as CredentialRecord).channelId === 'string' &&
      typeof (value as CredentialRecord).type === 'string' &&
      Number.isInteger((value as CredentialRecord).revision) &&
      (value as CredentialRecord).revision > 0 &&
      ((value as CredentialRecord).lastMutation === undefined || isMutationIdentity((value as CredentialRecord).lastMutation)) &&
      isStringRecord((value as CredentialRecord).value)
  )
}

function isMutationIdentity(value: unknown): value is ChannelCredentialMutationIdentity {
  return Boolean(
    value && typeof value === 'object' &&
      typeof (value as ChannelCredentialMutationIdentity).channelId === 'string' &&
      (value as ChannelCredentialMutationIdentity).channelId.length > 0 &&
      typeof (value as ChannelCredentialMutationIdentity).operationId === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((value as ChannelCredentialMutationIdentity).operationId) &&
      Number.isSafeInteger((value as ChannelCredentialMutationIdentity).mutationEpoch) &&
      (value as ChannelCredentialMutationIdentity).mutationEpoch > 0
  )
}

function isReservedCredentialRecord(value: unknown): value is ReservedCredentialRecord {
  return isCredentialRecord(value) &&
    'migrationIdentity' in value &&
    isMigrationIdentity(value.migrationIdentity) &&
    (!('purpose' in value) || value.purpose === 'legacy-discovery-archive')
}

function isArchiveRef(value: string): boolean {
  return value.startsWith('channel-migration-archive:')
}

function buildReservedArchiveRef(channelId: string, sourceFingerprint: string): string {
  return `channel-migration-archive:${channelId}:${sourceFingerprint}`
}

function normalizeArchiveCandidates(value: string[]): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) throw unavailable()
  const candidates = [...new Set(value)].sort()
  if (Buffer.byteLength(JSON.stringify(candidates), 'utf8') > 1024 * 1024) throw unavailable()
  return candidates
}

function isMigrationFingerprintKey(value: unknown): value is MigrationFingerprintKey {
  if (!value || typeof value !== 'object') return false
  const key = value as MigrationFingerprintKey
  return isMigrationFingerprintKeyId(key.keyId) && isCanonicalBase64Key(key.key)
}

function isMigrationFingerprintKeyId(value: unknown): value is string {
  return typeof value === 'string' && /^channel-fingerprint-key:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isCanonicalBase64Key(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false
  try {
    const decoded = Buffer.from(value, 'base64')
    return decoded.length === 32 && decoded.toString('base64') === value
  } catch {
    return false
  }
}

function isMigrationIdentity(value: unknown): value is MigrationIdentity {
  return Boolean(
    value && typeof value === 'object' && typeof (value as MigrationIdentity).credentialRef === 'string' &&
      typeof (value as MigrationIdentity).sourceFingerprint === 'string' &&
      typeof (value as MigrationIdentity).fingerprintKeyId === 'string'
  )
}

function sameMigrationIdentity(left: MigrationIdentity, right: MigrationIdentity): boolean {
  return left.credentialRef === right.credentialRef &&
    left.sourceFingerprint === right.sourceFingerprint &&
    left.fingerprintKeyId === right.fingerprintKeyId
}

export function compareCredentialFieldNames(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => compareCredentialFieldNames(leftKey, rightKey))
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => compareCredentialFieldNames(leftKey, rightKey))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function isPayloadKeyRecord(value: unknown): value is PayloadKeyRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PayloadKeyRecord).channelId === 'string' &&
      typeof (value as PayloadKeyRecord).keyRef === 'string' &&
      Number.isInteger((value as PayloadKeyRecord).revision) &&
      (value as PayloadKeyRecord).revision > 0 &&
      typeof (value as PayloadKeyRecord).key === 'string'
  )
}

function isPayloadKeyState(value: unknown): value is PayloadKeyState {
  if (!value || typeof value !== 'object') return false
  const state = value as PayloadKeyState
  return Boolean(
    (state.currentKeyRef === null || typeof state.currentKeyRef === 'string') &&
      (state.currentRevision === null || (Number.isInteger(state.currentRevision) && state.currentRevision > 0)) &&
      Number.isInteger(state.nextRevision) &&
      state.nextRevision > 0 &&
      (state.knownKeyRefs === undefined || (Array.isArray(state.knownKeyRefs) && state.knownKeyRefs.every((ref) => typeof ref === 'string' && ref.length > 0)))
  )
}

function isPayloadHashKeyRecord(value: unknown): value is PayloadHashKeyRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as PayloadHashKeyRecord).channelId === 'string' &&
      isCanonicalBase64Key((value as PayloadHashKeyRecord).key)
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Object.entries(value).every(([key, item]) => Boolean(key) && typeof item === 'string')
  )
}

function toSafeView(credentialRef: string, record: CredentialRecord): ChannelCredentialSafeView {
  return {
    credentialRef,
    revision: record.revision,
    maskedFields: Object.fromEntries(Object.entries(record.value).map(([key, value]) => [key, mask(value)]))
  }
}

function mask(value: string): string {
  return value.length <= 8 ? '*'.repeat(value.length) : `${value.slice(0, 4)}...${value.slice(-4)}`
}

function encryptPayload(key: Uint8Array, payload: Uint8Array): Uint8Array {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  return Buffer.concat([iv, cipher.update(payload), cipher.final(), cipher.getAuthTag()])
}

function decryptPayload(key: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (ciphertext.length < 29) throw new Error('invalid ciphertext')
  const bytes = Buffer.from(ciphertext)
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(-16))
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()])
}

function payloadStateStorageRef(channelId: string): string {
  return `${payloadStatePrefix}${channelId}`
}

function payloadKeyStorageRef(keyRef: string): string {
  return `${payloadKeyPrefix}${keyRef}`
}

function payloadHashKeyStorageRef(channelId: string): string {
  return `${payloadHashKeyPrefix}${channelId}`
}

function payloadDestroyedStorageRef(channelId: string): string {
  return `${payloadDestroyedPrefix}${channelId}`
}

function isOwnedPayloadKeyRef(channelId: string, value: string): boolean {
  const prefix = `channel-payload-key:${channelId}:`
  return value.startsWith(prefix) && /^[0-9a-f-]{36}$/i.test(value.slice(prefix.length))
}

function emptyPayloadState(): PayloadKeyState {
  return { currentKeyRef: null, currentRevision: null, nextRevision: 1, knownKeyRefs: [] }
}

function unavailable(): ChannelCredentialVaultError {
  return new ChannelCredentialVaultError()
}

export type { ChannelSecretBlobStore, SafeStorageAdapter } from './channelCredentialContracts'
