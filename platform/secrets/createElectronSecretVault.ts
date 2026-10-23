import { randomUUID } from 'node:crypto'

import { createEncryptedSecretBlobStore } from './encryptedSecretBlobStore'
import {
  ElectronSafeStorageAvailabilityPolicy,
  isElectronSafeStorageAvailable,
  type ElectronSafeStorageAvailabilitySource
} from './electronSafeStorageAvailability'
import {
  SecretVaultError,
  type SecretBlobStore,
  type SecretMetadata,
  type SecretOwnerScope,
  type SecretRef,
  type SecretVault,
  type SecretVaultSafeStorage
} from './secretVaultTypes'

export {
  SecretVaultError,
  type SecretBlobStore,
  type SecretMetadata,
  type SecretOwnerScope,
  type SecretRef,
  type SecretVault,
  type SecretVaultSafeStorage
} from './secretVaultTypes'

type ElectronSafeStorage = ElectronSafeStorageAvailabilitySource & {
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

export const GenericSecretVaultAvailabilityPolicy = {
  owner: 'platform/secrets/createElectronSecretVault',
  source: ElectronSafeStorageAvailabilityPolicy,
  default: 'fail-closed',
  failure: 'secret-vault-unavailable',
  testBoundary: 'secretVault Electron safeStorage availability tests'
} as const

export const GenericSecretCiphertextPresencePolicy = {
  owner: 'platform/secrets',
  source: 'owner-scoped final ciphertext blob metadata',
  default: 'false for missing, temporary, symlink, or non-regular files',
  failure: 'secret-vault-record-invalid',
  testBoundary: 'secretVault ciphertext presence tests'
} as const

type SecretRecord = {
  formatVersion: 1
  binding: {
    owner: SecretOwnerScope
    ref: SecretRef
    revision: number
  }
  metadata: SecretMetadata
  value: string
}

const encryptedSecretBlobFormatVersion = 1
const safePathSegment = /^[A-Za-z0-9_-]{1,80}$/
const safeSecretRef = /^[A-Za-z0-9:_-]{1,160}$/
const secretPreview = 'secret-set'

export function createElectronSecretVault(input: {
  directory: string
  safeStorage: ElectronSafeStorage
  platform?: NodeJS.Platform
  now?: () => Date
}): SecretVault {
  return createSecretVault({
    safeStorage: createElectronSecretVaultSafeStorage(input.safeStorage, input.platform ?? process.platform),
    storage: createEncryptedSecretBlobStore(input.directory),
    now: input.now
  })
}

export function createSecretVault(input: {
  safeStorage: SecretVaultSafeStorage
  storage: SecretBlobStore
  now?: () => Date
}): SecretVault {
  const now = input.now ?? (() => new Date())
  return {
    async put({ owner, ref, value }) {
      assertAvailable(input.safeStorage)
      assertOwner(owner)
      const secretRef = ref ?? randomUUID()
      assertRef(secretRef)
      const existing = await readRecord(input, owner, secretRef)
      if (existing) throw new SecretVaultError('secret-vault-ref-conflict')
      const timestamp = now().toISOString()
      const metadata: SecretMetadata = {
        ref: secretRef,
        owner: copyOwner(owner),
        revision: 1,
        hasSecret: true,
        preview: secretPreview,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      await writeRecord(input, owner, secretRef, createRecord(owner, secretRef, metadata, value))
      return metadata
    },
    async get(ref, owner) {
      assertAvailable(input.safeStorage)
      assertOwner(owner)
      assertRef(ref)
      return (await readRecord(input, owner, ref))?.value ?? null
    },
    async rotate(ref, owner, value, expectedRevision) {
      assertAvailable(input.safeStorage)
      assertOwner(owner)
      assertRef(ref)
      const existing = await readRecord(input, owner, ref)
      if (!existing) throw new SecretVaultError('secret-vault-secret-not-found')
      if (expectedRevision !== undefined && existing.metadata.revision !== expectedRevision) {
        throw new SecretVaultError('secret-vault-revision-conflict')
      }
      const metadata: SecretMetadata = {
        ...existing.metadata,
        revision: existing.metadata.revision + 1,
        updatedAt: now().toISOString()
      }
      await writeRecord(input, owner, ref, createRecord(owner, ref, metadata, value))
      return metadata
    },
    async delete(ref, owner) {
      assertAvailable(input.safeStorage)
      assertOwner(owner)
      assertRef(ref)
      await input.storage.delete(owner, ref)
    },
    async exists(ref, owner) {
      assertAvailable(input.safeStorage)
      assertOwner(owner)
      assertRef(ref)
      return readCiphertextPresence(input.storage, owner, ref)
    },
    async has(ref, owner) {
      assertAvailable(input.safeStorage)
      assertOwner(owner)
      assertRef(ref)
      return (await readRecord(input, owner, ref)) !== null
    },
    async inspect(ref, owner) {
      assertAvailable(input.safeStorage)
      assertOwner(owner)
      assertRef(ref)
      return (await readRecord(input, owner, ref))?.metadata ?? null
    }
  }
}

function createElectronSecretVaultSafeStorage(
  safeStorage: ElectronSafeStorage,
  platform: NodeJS.Platform
): SecretVaultSafeStorage {
  return {
    isEncryptionAvailable: () => {
      return isElectronSafeStorageAvailable(safeStorage, platform)
    },
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(Buffer.from(value))
  }
}

async function readRecord(
  input: { safeStorage: SecretVaultSafeStorage; storage: SecretBlobStore },
  owner: SecretOwnerScope,
  ref: SecretRef
): Promise<SecretRecord | null> {
  const encrypted = await readBlob(input.storage, owner, ref)
  if (!encrypted) return null
  try {
    return parseRecord(JSON.parse(input.safeStorage.decryptString(encrypted)), owner, ref)
  } catch {
    throw new SecretVaultError('secret-vault-record-invalid')
  }
}

async function writeRecord(
  input: { safeStorage: SecretVaultSafeStorage; storage: SecretBlobStore },
  owner: SecretOwnerScope,
  ref: SecretRef,
  record: SecretRecord
): Promise<void> {
  try {
    await input.storage.write(owner, ref, input.safeStorage.encryptString(JSON.stringify(record)))
  } catch (error) {
    if (error instanceof SecretVaultError) throw error
    throw new SecretVaultError('secret-vault-unavailable')
  }
}

async function readBlob(storage: SecretBlobStore, owner: SecretOwnerScope, ref: SecretRef): Promise<Uint8Array | null> {
  try {
    return await storage.read(owner, ref)
  } catch (error) {
    if (error instanceof SecretVaultError) throw error
    throw new SecretVaultError('secret-vault-record-invalid')
  }
}

async function readCiphertextPresence(storage: SecretBlobStore, owner: SecretOwnerScope, ref: SecretRef): Promise<boolean> {
  try {
    return await storage.exists(owner, ref)
  } catch (error) {
    if (error instanceof SecretVaultError) throw error
    throw new SecretVaultError(GenericSecretCiphertextPresencePolicy.failure)
  }
}

function parseRecord(value: unknown, owner: SecretOwnerScope, ref: SecretRef): SecretRecord {
  if (!value || typeof value !== 'object' || !('formatVersion' in value) || !('binding' in value) || !('metadata' in value) || !('value' in value)) {
    throw new SecretVaultError('secret-vault-record-invalid')
  }
  const record = value as SecretRecord
  if (
    record.formatVersion !== encryptedSecretBlobFormatVersion ||
    !record.binding ||
    !sameOwner(record.binding.owner, owner) ||
    record.binding.ref !== ref ||
    !Number.isInteger(record.binding.revision) ||
    record.binding.revision < 1 ||
    !record.metadata ||
    typeof record.value !== 'string'
  ) {
    throw new SecretVaultError('secret-vault-record-invalid')
  }
  if (!safeSecretRef.test(record.metadata.ref)) throw new SecretVaultError('secret-vault-record-invalid')
  if (
    record.metadata.ref !== ref ||
    !sameOwner(record.metadata.owner, owner) ||
    record.metadata.revision !== record.binding.revision ||
    record.metadata.ref !== record.binding.ref ||
    !sameOwner(record.metadata.owner, record.binding.owner)
  ) {
    throw new SecretVaultError('secret-vault-record-invalid')
  }
  if (
    !Number.isInteger(record.metadata.revision) ||
    record.metadata.revision < 1 ||
    record.metadata.hasSecret !== true ||
    record.metadata.preview !== secretPreview ||
    !isIsoDate(record.metadata.createdAt) ||
    !isIsoDate(record.metadata.updatedAt)
  ) {
    throw new SecretVaultError('secret-vault-record-invalid')
  }
  return record
}

function createRecord(owner: SecretOwnerScope, ref: SecretRef, metadata: SecretMetadata, value: string): SecretRecord {
  return {
    formatVersion: encryptedSecretBlobFormatVersion,
    binding: {
      owner: copyOwner(owner),
      ref,
      revision: metadata.revision
    },
    metadata,
    value
  }
}

function sameOwner(left: SecretOwnerScope, right: SecretOwnerScope): boolean {
  return Boolean(left && left.ownerType === right.ownerType && left.ownerId === right.ownerId && left.namespace === right.namespace)
}

function assertAvailable(safeStorage: SecretVaultSafeStorage): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new SecretVaultError('secret-vault-unavailable')
  } catch (error) {
    if (error instanceof SecretVaultError) throw error
    throw new SecretVaultError('secret-vault-unavailable')
  }
}

function assertOwner(owner: SecretOwnerScope): void {
  if (!owner || (owner.ownerType !== 'platform' && owner.ownerType !== 'product')) {
    throw new SecretVaultError('secret-vault-unsafe-owner')
  }
  if (!safePathSegment.test(owner.ownerId) || !safePathSegment.test(owner.namespace)) {
    throw new SecretVaultError('secret-vault-unsafe-owner')
  }
}

function assertRef(ref: SecretRef): void {
  if (!safeSecretRef.test(ref)) throw new SecretVaultError('secret-vault-unsafe-ref')
}

function copyOwner(owner: SecretOwnerScope): SecretOwnerScope {
  return {
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    namespace: owner.namespace
  }
}

function isIsoDate(value: string): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
}
