import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  createElectronSecretVault,
  createSecretVault,
  type SecretOwnerScope,
  type SecretVaultSafeStorage
} from './createElectronSecretVault'
import { createEncryptedSecretBlobStore } from './encryptedSecretBlobStore'

const owner: SecretOwnerScope = {
  ownerType: 'platform',
  ownerId: 'owner-a',
  namespace: 'primary'
}

const otherOwner: SecretOwnerScope = {
  ownerType: 'product',
  ownerId: 'owner-b',
  namespace: 'primary'
}

const primarySecretFixture = 'fixture-secret-value-1234567890'
const rotatedSecretFixture = 'fixture-rotated-secret-1234567890'

describe('generic platform secret vault', () => {
  it('fails closed when encryption is unavailable', async () => {
    const vault = createSecretVault({
      safeStorage: unavailableSafeStorage(),
      storage: createMemoryBlobStore()
    })

    await expect(vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })).rejects.toMatchObject({
      code: 'secret-vault-unavailable'
    })
    await expect(vault.rotate('primary-secret', owner, rotatedSecretFixture)).rejects.toMatchObject({
      code: 'secret-vault-unavailable'
    })
    await expect(vault.delete('primary-secret', owner)).rejects.toMatchObject({
      code: 'secret-vault-unavailable'
    })
    await expect(vault.exists('primary-secret', owner)).rejects.toMatchObject({
      code: 'secret-vault-unavailable'
    })
  })

  it('normalizes availability backend failures to stable vault errors', async () => {
    const vault = createSecretVault({
      safeStorage: {
        isEncryptionAvailable: () => {
          throw new Error(`backend failed for ${primarySecretFixture}`)
        },
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => Buffer.from(value).toString('utf8')
      },
      storage: createMemoryBlobStore()
    })

    let thrown: unknown
    try {
      await vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'secret-vault-unavailable' })
    expect(String((thrown as Error).message)).not.toContain(primarySecretFixture)
    expect(JSON.stringify(thrown)).not.toContain(primarySecretFixture)
  })

  it('fails closed when Electron reports the basic_text backend', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-basic-text-'))
    const vault = createElectronSecretVault({
      directory,
      platform: 'linux',
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'basic_text',
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => Buffer.from(value).toString('utf8')
      }
    })

    await expect(vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })).rejects.toMatchObject({
      code: 'secret-vault-unavailable'
    })
    await expect(vault.exists('primary-secret', owner)).rejects.toMatchObject({
      code: 'secret-vault-unavailable'
    })

    await rm(directory, { recursive: true, force: true })
  })

  it.each([
    { label: 'a missing backend selector', getSelectedStorageBackend: undefined },
    { label: 'a throwing backend selector', getSelectedStorageBackend: () => { throw new Error('fixture-backend-selector-failed') } },
    { label: 'an empty backend', getSelectedStorageBackend: () => '' },
    { label: 'an unknown backend', getSelectedStorageBackend: () => 'fixture-unknown-backend' }
  ])('fails closed when Electron reports $label', async ({ getSelectedStorageBackend }) => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-unknown-backend-'))
    const vault = createElectronSecretVault({
      directory,
      platform: 'linux',
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => Buffer.from(value).toString('utf8')
      }
    })

    try {
      await expect(vault.exists('primary-secret', owner)).rejects.toMatchObject({
        code: 'secret-vault-unavailable'
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('allows ciphertext presence checks only for an explicitly safe Electron backend', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-safe-backend-'))
    const vault = createElectronSecretVault({
      directory,
      platform: 'linux',
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => Buffer.from(value).toString('utf8')
      }
    })

    try {
      await expect(vault.exists('primary-secret', owner)).resolves.toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    { platform: 'darwin' as NodeJS.Platform, encryptionAvailable: true, available: true },
    { platform: 'darwin' as NodeJS.Platform, encryptionAvailable: false, available: false },
    { platform: 'win32' as NodeJS.Platform, encryptionAvailable: true, available: true },
    { platform: 'win32' as NodeJS.Platform, encryptionAvailable: false, available: false }
  ])('uses only Electron encryption availability on $platform', async ({ platform, encryptionAvailable, available }) => {
    const directory = await mkdtemp(join(tmpdir(), `generic-vault-${platform}-availability-`))
    const getSelectedStorageBackend = vi.fn(() => {
      throw new Error('linux-only selector must not run')
    })
    const vault = createElectronSecretVault({
      directory,
      platform,
      safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        getSelectedStorageBackend,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => Buffer.from(value).toString('utf8')
      }
    })

    try {
      if (available) {
        await expect(vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })).resolves.toMatchObject({
          hasSecret: true
        })
        await expect(vault.get('primary-secret', owner)).resolves.toBe(primarySecretFixture)
      } else {
        await expect(vault.exists('primary-secret', owner)).rejects.toMatchObject({ code: 'secret-vault-unavailable' })
      }
      expect(getSelectedStorageBackend).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails closed on an unsupported platform without probing the Linux backend selector', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-unsupported-platform-'))
    const getSelectedStorageBackend = vi.fn(() => 'gnome_libsecret')
    const vault = createElectronSecretVault({
      directory,
      platform: 'freebsd' as NodeJS.Platform,
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => Buffer.from(value).toString('utf8')
      }
    })

    try {
      await expect(vault.exists('primary-secret', owner)).rejects.toMatchObject({ code: 'secret-vault-unavailable' })
      expect(getSelectedStorageBackend).not.toHaveBeenCalled()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not expose raw secret values when encryption fails', async () => {
    const vault = createSecretVault({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: () => {
          throw new Error(`backend failed for ${primarySecretFixture}`)
        },
        decryptString: () => ''
      },
      storage: createMemoryBlobStore()
    })

    let thrown: unknown
    try {
      await vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'secret-vault-unavailable' })
    expect(String((thrown as Error).message)).not.toContain(primarySecretFixture)
    expect(JSON.stringify(thrown)).not.toContain(primarySecretFixture)
  })

  it('keeps fixture plaintext out of blob files and serialized metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-ciphertext-'))
    const vault = createSecretVault({
      safeStorage: createSafeStorage(),
      storage: createEncryptedSecretBlobStore(directory),
      now: fixedClock(['2026-01-01T00:00:00.000Z'])
    })

    const metadata = await vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })
    const serializedMetadata = JSON.stringify(metadata)
    const persisted = await readAllFiles(directory)

    expect(serializedMetadata).not.toContain(primarySecretFixture)
    expect(metadata.preview).toBe('secret-set')
    expect(metadata.preview).not.toContain(primarySecretFixture)
    expect(persisted.join('\n')).not.toContain(primarySecretFixture)
    await expect(vault.get(metadata.ref, owner)).resolves.toBe(primarySecretFixture)

    await rm(directory, { recursive: true, force: true })
  })

  it('does not let a different owner read or delete another owner scoped ref', async () => {
    const vault = createSecretVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore(),
      now: fixedClock(['2026-01-01T00:00:00.000Z'])
    })
    const metadata = await vault.put({ owner, ref: 'shared-ref', value: primarySecretFixture })

    await expect(vault.get(metadata.ref, otherOwner)).resolves.toBeNull()
    await expect(vault.inspect(metadata.ref, otherOwner)).resolves.toBeNull()
    await expect(vault.has(metadata.ref, otherOwner)).resolves.toBe(false)
    await vault.delete(metadata.ref, otherOwner)

    await expect(vault.get(metadata.ref, owner)).resolves.toBe(primarySecretFixture)
  })

  it('rejects put with an existing ref so callers use revision-checked rotate', async () => {
    const vault = createSecretVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })

    await vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })

    await expect(vault.put({ owner, ref: 'primary-secret', value: rotatedSecretFixture })).rejects.toMatchObject({
      code: 'secret-vault-ref-conflict'
    })
    await expect(vault.get('primary-secret', owner)).resolves.toBe(primarySecretFixture)
  })

  it('rejects unsafe refs and owner components before deriving blob paths', async () => {
    const vault = createSecretVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })

    await expect(vault.put({ owner, ref: '../plaintext.json', value: primarySecretFixture })).rejects.toMatchObject({
      code: 'secret-vault-unsafe-ref'
    })
    await expect(vault.get('safe-ref', { ...owner, ownerId: '../owner' })).rejects.toMatchObject({
      code: 'secret-vault-unsafe-owner'
    })
  })

  it('rejects invalid blob-store owner types at the file boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-invalid-owner-'))
    const storage = createEncryptedSecretBlobStore(directory)

    await expect(
      storage.write({ ...owner, ownerType: 'other' as SecretOwnerScope['ownerType'] }, 'primary-secret', new Uint8Array([1]))
    ).rejects.toThrow('Invalid secret owner scope.')

    await rm(directory, { recursive: true, force: true })
  })

  it('rejects decrypted records whose metadata does not match the requested owner and ref', async () => {
    const storage = createMemoryBlobStore()
    const safeStorage = createSafeStorage()
    const vault = createSecretVault({ safeStorage, storage })
    await storage.write(
      owner,
      'primary-secret',
      safeStorage.encryptString(
        JSON.stringify(
          createSecretEnvelope({
            metadata: {
              ref: 'primary-secret',
              owner: otherOwner,
              revision: 1,
              hasSecret: true,
              preview: 'secret-set',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          })
        )
      )
    )

    await expect(vault.get('primary-secret', owner)).rejects.toMatchObject({ code: 'secret-vault-record-invalid' })
  })

  it('rejects decrypted records with unsafe metadata fields', async () => {
    const storage = createMemoryBlobStore()
    const safeStorage = createSafeStorage()
    const vault = createSecretVault({ safeStorage, storage })
    await storage.write(
      owner,
      'primary-secret',
      safeStorage.encryptString(
        JSON.stringify(
          createSecretEnvelope({
            metadata: {
              ref: 'primary-secret',
              owner,
              revision: 0,
              hasSecret: false,
              preview: primarySecretFixture,
              createdAt: 'not-a-date',
              updatedAt: 'not-a-date'
            }
          })
        )
      )
    )

    await expect(vault.inspect('primary-secret', owner)).rejects.toMatchObject({ code: 'secret-vault-record-invalid' })
  })

  it('persists a versioned encrypted envelope with owner, ref, and revision binding', async () => {
    const storage = createMemoryBlobStore()
    const safeStorage = createSafeStorage()
    const vault = createSecretVault({ safeStorage, storage, now: fixedClock(['2026-01-01T00:00:00.000Z']) })

    await vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })

    const encrypted = await storage.read(owner, 'primary-secret')
    const envelope = JSON.parse(safeStorage.decryptString(encrypted!))
    expect(envelope).toMatchObject({
      formatVersion: 1,
      binding: { owner, ref: 'primary-secret', revision: 1 }
    })
  })

  it.each([
    { label: 'an unsupported format version', envelope: createSecretEnvelope({ formatVersion: 2 }) },
    { label: 'a swapped owner binding', envelope: createSecretEnvelope({ binding: { owner: otherOwner, ref: 'primary-secret', revision: 1 } }) },
    { label: 'a swapped ref binding', envelope: createSecretEnvelope({ binding: { owner, ref: 'secondary-secret', revision: 1 } }) },
    { label: 'a swapped revision binding', envelope: createSecretEnvelope({ binding: { owner, ref: 'primary-secret', revision: 2 } }) }
  ])('fails closed for $label without exposing the secret', async ({ envelope }) => {
    const storage = createMemoryBlobStore()
    const safeStorage = createSafeStorage()
    const vault = createSecretVault({ safeStorage, storage })
    await storage.write(owner, 'primary-secret', safeStorage.encryptString(JSON.stringify(envelope)))

    let thrown: unknown
    try {
      await vault.get('primary-secret', owner)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'secret-vault-record-invalid' })
    expect(String((thrown as Error).message)).not.toContain(primarySecretFixture)
    expect(JSON.stringify(thrown)).not.toContain(primarySecretFixture)
  })

  it.each([
    {
      label: 'an undecryptable blob',
      safeStorage: {
        ...createSafeStorage(),
        decryptString: () => {
          throw new Error(`fixture-decrypt-failure-${primarySecretFixture}`)
        }
      },
      blob: Uint8Array.from([1, 2, 3])
    },
    {
      label: 'a malformed decrypted blob',
      safeStorage: createSafeStorage(),
      blob: createSafeStorage().encryptString('{')
    }
  ])('fails closed for $label without exposing the secret', async ({ safeStorage, blob }) => {
    const storage = createMemoryBlobStore()
    const vault = createSecretVault({ safeStorage, storage })
    await storage.write(owner, 'primary-secret', blob)

    let thrown: unknown
    try {
      await vault.get('primary-secret', owner)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'secret-vault-record-invalid' })
    expect(String((thrown as Error).message)).not.toContain(primarySecretFixture)
    expect(JSON.stringify(thrown)).not.toContain(primarySecretFixture)
  })

  it.each(['write', 'rename'] as const)('keeps the previous official ciphertext readable when temp-to-rename %s is interrupted', async (stage) => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-interrupted-write-'))
    const stableStorage = createEncryptedSecretBlobStore(directory)
    const previousCiphertext = createSafeStorage().encryptString(JSON.stringify(createSecretEnvelope()))
    const replacementCiphertext = createSafeStorage().encryptString(JSON.stringify(createSecretEnvelope({ value: rotatedSecretFixture })))
    await stableStorage.write(owner, 'primary-secret', previousCiphertext)
    const faultingStorage = createEncryptedSecretBlobStore(directory, {
      lstat,
      mkdir,
      readFile,
      rename: stage === 'rename' ? async () => Promise.reject(new Error('fixture-rename-interrupted')) : rename,
      rm,
      writeFile: stage === 'write' ? async () => Promise.reject(new Error('fixture-write-interrupted')) : writeFile
    })

    try {
      await expect(faultingStorage.write(owner, 'primary-secret', replacementCiphertext)).rejects.toThrow(`fixture-${stage}-interrupted`)
      await expect(stableStorage.read(owner, 'primary-secret')).resolves.toEqual(Uint8Array.from(previousCiphertext))

      if (stage === 'rename') {
        const fileNames = await listFileNames(directory)
        expect(fileNames.some((name) => name.endsWith('.tmp'))).toBe(false)
        await expect(stableStorage.read(owner, 'primary-secret')).resolves.toEqual(Uint8Array.from(previousCiphertext))
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('does not read a leftover temporary ciphertext as the official blob', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-temp-blob-'))
    const storage = createEncryptedSecretBlobStore(directory)
    const officialCiphertext = createSafeStorage().encryptString(JSON.stringify(createSecretEnvelope()))
    const temporaryCiphertext = createSafeStorage().encryptString(JSON.stringify(createSecretEnvelope({ value: rotatedSecretFixture })))
    await storage.write(owner, 'primary-secret', officialCiphertext)
    const official = await findOfficialBlobFile(directory)
    await writeFile(`${official}.fixture.tmp`, Buffer.from(temporaryCiphertext).toString('base64'), 'utf8')

    try {
      await expect(storage.read(owner, 'primary-secret')).resolves.toEqual(Uint8Array.from(officialCiphertext))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('checks only an official final ciphertext blob without decrypting, reading, or parsing it', async () => {
    const storage = createPresenceTrackingBlobStore()
    const decryptString = vi.fn((value: Uint8Array) => Buffer.from(value).toString('utf8'))
    const jsonParse = vi.spyOn(JSON, 'parse')
    const vault = createSecretVault({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString
      },
      storage
    })
    storage.finalRefs.add(memoryKey(owner, 'primary-secret'))

    await expect(vault.exists('primary-secret', owner)).resolves.toBe(true)

    expect(storage.read).not.toHaveBeenCalled()
    expect(decryptString).not.toHaveBeenCalled()
    expect(jsonParse).not.toHaveBeenCalled()
  })

  it('recognizes only final regular ciphertext files as present', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'generic-vault-presence-final-only-'))
    const storage = createEncryptedSecretBlobStore(directory)
    const finalCiphertext = Uint8Array.from([1, 2, 3])
    await storage.write(owner, 'primary-secret', finalCiphertext)
    const finalPath = await findOfficialBlobFile(directory)

    try {
      await expect(storage.exists(owner, 'primary-secret')).resolves.toBe(true)
      await expect(storage.exists(owner, 'missing-secret')).resolves.toBe(false)

      await writeFile(`${finalPath}.fixture.tmp`, Buffer.from(finalCiphertext).toString('base64'), 'utf8')
      await expect(storage.exists(owner, 'primary-secret')).resolves.toBe(true)

      const temporaryOnlyRef = 'temporary-only-secret'
      const temporaryOnlyPath = finalPath.replace(/[^/]+$/, `${Buffer.from(temporaryOnlyRef).toString('base64url')}.blob.fixture.tmp`)
      await writeFile(temporaryOnlyPath, Buffer.from(finalCiphertext).toString('base64'), 'utf8')
      await expect(storage.exists(owner, temporaryOnlyRef)).resolves.toBe(false)

      const directoryRef = 'directory-secret'
      const directoryPath = finalPath.replace(/[^/]+$/, `${Buffer.from(directoryRef).toString('base64url')}.blob`)
      await mkdir(directoryPath)
      await expect(storage.exists(owner, directoryRef)).resolves.toBe(false)

      const symlinkRef = 'symlink-secret'
      const symlinkPath = finalPath.replace(/[^/]+$/, `${Buffer.from(symlinkRef).toString('base64url')}.blob`)
      await symlink(finalPath, symlinkPath)
      await expect(storage.exists(owner, symlinkRef)).resolves.toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects unsafe owner and ref before a ciphertext presence check can reach storage', async () => {
    const storage = createPresenceTrackingBlobStore()
    const vault = createSecretVault({ safeStorage: createSafeStorage(), storage })

    await expect(vault.exists('../unsafe-ref', owner)).rejects.toMatchObject({ code: 'secret-vault-unsafe-ref' })
    await expect(vault.exists('primary-secret', { ...owner, ownerId: '../unsafe-owner' })).rejects.toMatchObject({
      code: 'secret-vault-unsafe-owner'
    })
    expect(storage.exists).not.toHaveBeenCalled()
  })

  it('normalizes ciphertext presence I/O failures to a typed fail-closed error', async () => {
    const storage = createPresenceTrackingBlobStore()
    storage.exists.mockRejectedValueOnce(new Error('fixture-presence-io-failure'))
    const vault = createSecretVault({ safeStorage: createSafeStorage(), storage })

    await expect(vault.exists('primary-secret', owner)).rejects.toMatchObject({
      code: 'secret-vault-record-invalid'
    })
  })

  it('keeps has and inspect on the decrypting integrity-validation path', async () => {
    const storage = createPresenceTrackingBlobStore()
    const decryptString = vi.fn((value: Uint8Array) => Buffer.from(value).toString('utf8'))
    const vault = createSecretVault({
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString
      },
      storage
    })
    await vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })

    await expect(vault.has('primary-secret', owner)).resolves.toBe(true)
    await expect(vault.inspect('primary-secret', owner)).resolves.toMatchObject({ ref: 'primary-secret' })

    expect(storage.read).toHaveBeenCalledTimes(3)
    expect(storage.exists).not.toHaveBeenCalled()
    expect(decryptString).toHaveBeenCalledTimes(2)
  })

  it('supports put, get, inspect, has, rotate, and delete with deterministic revisions', async () => {
    const vault = createSecretVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore(),
      now: fixedClock(['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'])
    })

    const initial = await vault.put({ owner, ref: 'primary-secret', value: primarySecretFixture })

    expect(initial).toMatchObject({
      ref: 'primary-secret',
      owner,
      revision: 1,
      hasSecret: true,
      preview: 'secret-set',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    await expect(vault.has(initial.ref, owner)).resolves.toBe(true)
    await expect(vault.get(initial.ref, owner)).resolves.toBe(primarySecretFixture)
    await expect(vault.inspect(initial.ref, owner)).resolves.toEqual(initial)

    const rotated = await vault.rotate(initial.ref, owner, rotatedSecretFixture, 1)
    expect(rotated).toMatchObject({
      ref: initial.ref,
      revision: 2,
      createdAt: initial.createdAt,
      updatedAt: '2026-01-01T00:01:00.000Z'
    })
    await expect(vault.get(initial.ref, owner)).resolves.toBe(rotatedSecretFixture)
    await expect(vault.rotate(initial.ref, owner, primarySecretFixture, 1)).rejects.toMatchObject({
      code: 'secret-vault-revision-conflict'
    })

    await vault.delete(initial.ref, owner)

    await expect(vault.has(initial.ref, owner)).resolves.toBe(false)
    await expect(vault.get(initial.ref, owner)).resolves.toBeNull()
    await expect(vault.inspect(initial.ref, owner)).resolves.toBeNull()
  })
})

function createSafeStorage(): SecretVaultSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (value) => {
      const encoded = Buffer.from(value).toString('utf8').replace(/^encrypted:/, '')
      return Buffer.from(encoded, 'base64').toString('utf8')
    }
  }
}

function unavailableSafeStorage(): SecretVaultSafeStorage {
  return {
    isEncryptionAvailable: () => false,
    encryptString: (value) => Buffer.from(value),
    decryptString: (value) => Buffer.from(value).toString('utf8')
  }
}

function fixedClock(values: string[]): () => Date {
  let index = 0
  return () => new Date(values[Math.min(index++, values.length - 1)])
}

function createMemoryBlobStore() {
  const blobs = new Map<string, Uint8Array>()
  return {
    async exists(ownerScope: SecretOwnerScope, ref: string): Promise<boolean> {
      return blobs.has(memoryKey(ownerScope, ref))
    },
    async read(ownerScope: SecretOwnerScope, ref: string): Promise<Uint8Array | null> {
      return blobs.get(memoryKey(ownerScope, ref)) ?? null
    },
    async write(ownerScope: SecretOwnerScope, ref: string, encryptedBlob: Uint8Array): Promise<void> {
      blobs.set(memoryKey(ownerScope, ref), encryptedBlob)
    },
    async delete(ownerScope: SecretOwnerScope, ref: string): Promise<void> {
      blobs.delete(memoryKey(ownerScope, ref))
    }
  }
}

function createPresenceTrackingBlobStore() {
  const blobs = new Map<string, Uint8Array>()
  const finalRefs = new Set<string>()
  return {
    finalRefs,
    read: vi.fn(async (ownerScope: SecretOwnerScope, ref: string): Promise<Uint8Array | null> => {
      return blobs.get(memoryKey(ownerScope, ref)) ?? null
    }),
    exists: vi.fn(async (ownerScope: SecretOwnerScope, ref: string): Promise<boolean> => {
      return finalRefs.has(memoryKey(ownerScope, ref))
    }),
    async write(ownerScope: SecretOwnerScope, ref: string, encryptedBlob: Uint8Array): Promise<void> {
      const key = memoryKey(ownerScope, ref)
      blobs.set(key, encryptedBlob)
      finalRefs.add(key)
    },
    async delete(ownerScope: SecretOwnerScope, ref: string): Promise<void> {
      const key = memoryKey(ownerScope, ref)
      blobs.delete(key)
      finalRefs.delete(key)
    }
  }
}

function memoryKey(ownerScope: SecretOwnerScope, ref: string): string {
  return `${ownerScope.ownerType}:${ownerScope.ownerId}:${ownerScope.namespace}:${ref}`
}

function createSecretEnvelope(input: {
  formatVersion?: number
  binding?: { owner: SecretOwnerScope; ref: string; revision: number }
  metadata?: {
    ref: string
    owner: SecretOwnerScope
    revision: number
    hasSecret: boolean
    preview: string
    createdAt: string
    updatedAt: string
  }
  value?: string
} = {}) {
  const metadata = input.metadata ?? {
    ref: 'primary-secret',
    owner,
    revision: 1,
    hasSecret: true,
    preview: 'secret-set',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  return {
    formatVersion: input.formatVersion ?? 1,
    binding: input.binding ?? { owner: metadata.owner, ref: metadata.ref, revision: metadata.revision },
    metadata,
    value: input.value ?? primarySecretFixture
  }
}

async function listFileNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
}

async function findOfficialBlobFile(directory: string): Promise<string> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const blob = entries.find((entry) => entry.isFile() && entry.name.endsWith('.blob'))
  if (!blob) throw new Error('fixture official blob missing')
  return join(blob.parentPath, blob.name)
}

async function readAllFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile())
  return Promise.all(files.map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')))
}
