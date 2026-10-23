import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  ChannelCredentialVaultError,
  compareCredentialFieldNames,
  createEncryptedChannelCredentialVault,
  type ChannelSecretBlobStore,
  type SafeStorageAdapter
} from './encryptedChannelCredentialVault'

const text = new TextEncoder()
const decode = new TextDecoder()

describe('encrypted channel credential vault', () => {
  it('fails closed without persisting credentials or payloads when safe storage is unavailable', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: unavailableSafeStorage,
      storage
    })

    await expect(
      vault.put({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'telegram-secret' } })
    ).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.get('missing')).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.rotate('missing', { botToken: 'rotated-secret' })).rejects.toBeInstanceOf(
      ChannelCredentialVaultError
    )
    await expect(vault.payloadCipher.encrypt('channel-1', text.encode('private payload'))).rejects.toBeInstanceOf(
      ChannelCredentialVaultError
    )

    expect(storage.writeCount).toBe(0)
  })

  it('keeps raw multi-field credentials inside encrypted storage and exposes only an irreversible safe view', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage })
    const rawCredential = { botToken: 'telegram-secret-token', signingSecret: 'signing-secret-value' }

    const safeView = await vault.put({ channelId: 'channel-1', type: 'telegram', value: rawCredential })

    expect(safeView).toMatchObject({ credentialRef: expect.any(String), revision: 1 })
    expect(safeView.maskedFields).toEqual({ botToken: 'tele...oken', signingSecret: 'sign...alue' })
    expect(JSON.stringify(safeView)).not.toContain(rawCredential.botToken)
    expect(JSON.stringify(safeView)).not.toContain(rawCredential.signingSecret)
    expect(await vault.get(safeView.credentialRef)).toEqual(rawCredential)
    expect(JSON.stringify(storage.dump())).not.toContain(rawCredential.botToken)
    expect(JSON.stringify(storage.dump())).not.toContain(rawCredential.signingSecret)
  })

  it('isolates legacy discovery archives from ordinary credential access and rotation', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    const archive = await vault.prepareArchiveMigration({
      channelId: 'channel-1',
      type: 'telegram',
      candidates: ['chat-2', 'chat-1', 'chat-2']
    })

    expect(archive.credentialRef).toMatch(/^channel-migration-archive:/)
    await vault.putReservedArchive({
      channelId: 'channel-1',
      type: 'telegram',
      candidates: ['chat-1', 'chat-2'],
      ...archive
    })
    await expect(vault.inspectReservedArchive({ channelId: 'channel-1', type: 'telegram', ...archive })).resolves.toBe(true)
    await expect(vault.get(archive.credentialRef)).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.has(archive.credentialRef)).resolves.toBe(false)
    await expect(vault.rotate(archive.credentialRef, { bot_token: 'not-allowed' })).rejects.toBeInstanceOf(
      ChannelCredentialVaultError
    )
  })

  it('rotates credentials with a monotonic revision and deletes the old value', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    const first = await vault.put({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'first-secret' } })
    const rotated = await vault.rotate(first.credentialRef, { botToken: 'second-secret' })

    expect(rotated).toMatchObject({ credentialRef: first.credentialRef, revision: 2 })
    await expect(vault.get(first.credentialRef)).resolves.toEqual({ botToken: 'second-secret' })
    expect(rotated.maskedFields.botToken).not.toContain('second-secret')

    await vault.delete(first.credentialRef)
    await expect(vault.has(first.credentialRef)).resolves.toBe(false)
    await expect(vault.get(first.credentialRef)).resolves.toBeNull()
  })

  it('provides only a safe known-ref inspection and rejects stale rotation revisions', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    const inspectSafe = vault.inspectSafe
    if (!inspectSafe) throw new Error('Expected encrypted Channel vault safe inspection.')
    const rotateIfRevision = vault.rotateIfRevision
    if (!rotateIfRevision) throw new Error('Expected encrypted Channel vault revision-aware rotation.')
    const first = await vault.put({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'first-secret' } })
    const safe = await inspectSafe(first.credentialRef)

    expect(safe).toMatchObject({ credentialRef: first.credentialRef, revision: 1 })
    expect(JSON.stringify(safe)).not.toContain('first-secret')
    const mutation = { channelId: 'channel-1', operationId: '7c8d2be0-374e-4ad1-bbad-616d939e1bbd', mutationEpoch: 1 }
    await expect(rotateIfRevision(first.credentialRef, 0, { botToken: 'second-secret' }, mutation)).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(rotateIfRevision(first.credentialRef, 1, { botToken: 'second-secret' }, mutation)).resolves.toMatchObject({ revision: 2 })
    await expect(vault.inspectMutationReceipt!(first.credentialRef)).resolves.toMatchObject({ ...mutation, revision: 2 })
    expect(JSON.stringify(await inspectSafe(first.credentialRef))).not.toContain(mutation.operationId)
    await expect(inspectSafe('channel-migration-archive:forbidden')).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('serializes concurrent credential rotations so every accepted revision is monotonic', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    const credential = await vault.put({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'first-secret' } })

    const [second, third] = await Promise.all([
      vault.rotate(credential.credentialRef, { botToken: 'second-secret' }),
      vault.rotate(credential.credentialRef, { botToken: 'third-secret' })
    ])

    expect([second.revision, third.revision].sort()).toEqual([2, 3])
    await expect(vault.get(credential.credentialRef)).resolves.toEqual({ botToken: 'third-secret' })
  })

  it('fails closed for a malformed encrypted credential blob rather than reporting it as configured', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage })
    await storage.write('malformed', text.encode('{"not":"a credential"}'))

    await expect(vault.has('malformed')).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.get('malformed')).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('fails closed for a decryptable blob with an invalid credential record shape', async () => {
    const storage = createMemoryBlobStore()
    const safeStorage = createSafeStorage()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    await storage.write('malformed', safeStorage.encryptString(JSON.stringify({ value: 'not-a-record' })))

    await expect(vault.has('malformed')).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.get('malformed')).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('uses a payload data key independent from provider credential rotation', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    const credential = await vault.put({
      channelId: 'channel-1',
      type: 'telegram',
      value: { botToken: 'provider-secret' }
    })
    const encrypted = await vault.payloadCipher.encrypt('channel-1', text.encode('secret inbound text'))

    await vault.rotate(credential.credentialRef, { botToken: 'rotated-provider-secret' })

    await expect(
      vault.payloadCipher.decrypt({ channelId: 'channel-1', ...encrypted })
    ).resolves.toEqual(text.encode('secret inbound text'))
    expect(decode.decode(encrypted.ciphertext)).not.toContain('secret inbound text')
  })

  it('derives a stable scoped keyed hash from a Vault-protected key without exposing it', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })

    const first = await vault.payloadCipher.keyedHash('channel-1', text.encode('provider-event-1'))
    const second = await vault.payloadCipher.keyedHash('channel-1', text.encode('provider-event-1'))
    const otherChannel = await vault.payloadCipher.keyedHash('channel-2', text.encode('provider-event-1'))
    await vault.payloadCipher.rotate('channel-1')
    const afterRotation = await vault.payloadCipher.keyedHash('channel-1', text.encode('provider-event-1'))
    const afterRestart = await createEncryptedChannelCredentialVault({ safeStorage, storage })
      .payloadCipher.keyedHash('channel-1', text.encode('provider-event-1'))

    expect(first).toBe(second)
    expect(afterRotation).toBe(first)
    expect(afterRestart).toBe(first)
    expect(otherChannel).not.toBe(first)
    expect(first).not.toContain('provider-event-1')
  })

  it('fails closed for decryptable malformed or cross-channel payload hash keys without replacing them', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const malformed = createEncryptedChannelCredentialVault({ safeStorage, storage })
    await storage.write(
      'channel-payload-hash-key:channel-1',
      safeStorage.encryptString(JSON.stringify({ channelId: 'channel-1', key: 'not-base64' }))
    )
    const beforeMalformedRead = storage.writeCount
    await expect(malformed.payloadCipher.keyedHash('channel-1', text.encode('event'))).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    expect(storage.writeCount).toBe(beforeMalformedRead)

    const canonicalOtherKey = randomBytes(32).toString('base64')
    await storage.write(
      'channel-payload-hash-key:channel-2',
      safeStorage.encryptString(JSON.stringify({ channelId: 'channel-3', key: canonicalOtherKey }))
    )
    const mismatched = createEncryptedChannelCredentialVault({ safeStorage, storage })
    const beforeMismatchRead = storage.writeCount
    await expect(mismatched.payloadCipher.keyedHash('channel-2', text.encode('event'))).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    expect(storage.writeCount).toBe(beforeMismatchRead)
  })

  it('rejects payload key mismatches, tampering, and revoked keys without leaking plaintext', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    const encrypted = await vault.payloadCipher.encrypt('channel-1', text.encode('private payload'))
    const tampered = encrypted.ciphertext.slice()
    tampered[tampered.length - 1] ^= 1

    await expect(
      vault.payloadCipher.decrypt({ channelId: 'channel-2', ...encrypted })
    ).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(
      vault.payloadCipher.decrypt({ channelId: 'channel-1', ...encrypted, ciphertext: tampered })
    ).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(
      vault.payloadCipher.decrypt({ channelId: 'channel-1', ...encrypted, keyRevision: encrypted.keyRevision + 1 })
    ).rejects.toBeInstanceOf(ChannelCredentialVaultError)

    await vault.payloadCipher.revoke('channel-1', encrypted.keyRef)
    await expect(
      vault.payloadCipher.decrypt({ channelId: 'channel-1', ...encrypted })
    ).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('keeps old payload keys decryptable until revocation and gives each rotation a new revision', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    const first = await vault.payloadCipher.encrypt('channel-1', text.encode('first payload'))
    const rotated = await vault.payloadCipher.rotate('channel-1')
    const second = await vault.payloadCipher.encrypt('channel-1', text.encode('second payload'))

    expect(rotated).toEqual({ keyRef: second.keyRef, keyRevision: second.keyRevision })
    expect(second.keyRevision).toBe(first.keyRevision + 1)
    await expect(vault.payloadCipher.decrypt({ channelId: 'channel-1', ...first })).resolves.toEqual(
      text.encode('first payload')
    )
  })

  it('destroys all known payload/hash material and permanently fences a deleted Channel payload namespace', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage })
    const first = await vault.payloadCipher.encrypt('channel-delete', text.encode('private payload'))
    await vault.payloadCipher.rotate('channel-delete')
    const second = await vault.payloadCipher.encrypt('channel-delete', text.encode('later payload'))
    await vault.payloadCipher.keyedHash('channel-delete', text.encode('event'))

    await vault.payloadCipher.destroy?.('channel-delete')

    await expect(vault.payloadCipher.decrypt({ channelId: 'channel-delete', ...first })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.payloadCipher.decrypt({ channelId: 'channel-delete', ...second })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.payloadCipher.encrypt('channel-delete', text.encode('must not recreate'))).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.payloadCipher.keyedHash('channel-delete', text.encode('must not recreate'))).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    expect(JSON.stringify(storage.dump())).not.toContain(first.keyRef)
    expect(JSON.stringify(storage.dump())).not.toContain(second.keyRef)
  })

  it('refuses an other-Channel payload key ref during destroy without deleting it', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage })
    const other = await vault.payloadCipher.encrypt('channel-other', text.encode('other payload'))

    await expect(vault.payloadCipher.destroy!('channel-delete', [other.keyRef])).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.payloadCipher.decrypt({ channelId: 'channel-other', ...other })).resolves.toEqual(text.encode('other payload'))
  })

  it('serializes payload key rotations so revisions cannot collide', async () => {
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: createSafeStorage(),
      storage: createMemoryBlobStore()
    })
    await vault.payloadCipher.encrypt('channel-1', text.encode('initial payload'))

    const [second, third] = await Promise.all([
      vault.payloadCipher.rotate('channel-1'),
      vault.payloadCipher.rotate('channel-1')
    ])

    expect([second.keyRevision, third.keyRevision].sort()).toEqual([2, 3])
  })

  it('fails closed when safe storage encryption throws without writing raw data or error details', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({
      safeStorage: { ...createSafeStorage(), encryptString: () => { throw new Error('/private/path/secret') } },
      storage
    })

    await expect(
      vault.put({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'very-secret' } })
    ).rejects.toThrow('Channel credential vault is unavailable.')
    expect(storage.writeCount).toBe(0)
  })

  it('fails closed on safe storage decryption errors for credential reads, rotations, and payload encryption', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage })
    const credential = await vault.put({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'secret' } })
    await vault.payloadCipher.encrypt('channel-1', text.encode('initial payload'))
    const failingVault = createEncryptedChannelCredentialVault({
      safeStorage: { ...createSafeStorage(), decryptString: () => { throw new Error('/private/keychain/secret') } },
      storage
    })

    await expect(failingVault.get(credential.credentialRef)).rejects.toThrow('Channel credential vault is unavailable.')
    await expect(failingVault.rotate(credential.credentialRef, { botToken: 'rotated' })).rejects.toThrow(
      'Channel credential vault is unavailable.'
    )
    await expect(failingVault.payloadCipher.encrypt('channel-1', text.encode('new payload'))).rejects.toThrow(
      'Channel credential vault is unavailable.'
    )
  })

  it('prepares an opaque migration reservation without writing a provider credential', async () => {
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage })
    const secret = { botToken: 'migration-secret' }

    const reservation = await vault.prepareMigration({ channelId: 'channel-1', type: 'telegram', value: secret })

    expect(reservation).toEqual({
      credentialRef: expect.any(String),
      sourceFingerprint: expect.any(String),
      fingerprintKeyId: expect.any(String),
      migrationPermit: expect.any(String)
    })
    expect(await vault.get(reservation.credentialRef)).toBeNull()
    expect(JSON.stringify(storage.dump())).not.toContain(secret.botToken)
    expect(JSON.stringify(reservation)).not.toContain(secret.botToken)
  })

  it('persists a reserved credential exactly once for an idempotent permit replay', async () => {
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage: createMemoryBlobStore() })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)

    const first = await vault.putReserved({ ...input, ...reservation })
    const replay = await vault.putReserved({ ...input, ...reservation })

    expect(first).toEqual(replay)
    expect(first.revision).toBe(1)
    await expect(vault.inspectReserved({
      channelId: input.channelId,
      type: input.type,
      ...reservation
    })).resolves.toEqual(first)
  })

  it('does not let a cleanup claim delete a later same-value reservation adoption', async () => {
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage: createMemoryBlobStore() })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)
    await vault.putReserved({ ...input, ...reservation })
    const claim = await vault.claimReservedCleanup!({ ...reservation, channelId: input.channelId, type: input.type })
    await vault.putReserved({ ...input, ...reservation })
    await expect(vault.deleteReservedIfCleanupClaim!({ ...reservation, channelId: input.channelId, type: input.type, expectedRevision: claim!.revision, cleanupToken: claim!.cleanupToken })).resolves.toBe(false)
    await expect(vault.inspectReserved({ ...reservation, channelId: input.channelId, type: input.type })).resolves.toMatchObject({ revision: 1 })
  })

  it('rejects ordinary credential rotation for a migration-reserved credential', async () => {
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage: createMemoryBlobStore() })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)
    await vault.putReserved({ ...input, ...reservation })

    await expect(vault.rotate(reservation.credentialRef, { botToken: 'rotated-secret' })).rejects.toBeInstanceOf(
      ChannelCredentialVaultError
    )
  })

  it('rejects inspect for a reserved record whose stored credential value no longer matches its fingerprint', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)
    await vault.putReserved({ ...input, ...reservation })
    const stored = await storage.read(reservation.credentialRef)
    const record = JSON.parse(safeStorage.decryptString(stored!)) as { value: Record<string, string> }
    record.value.botToken = 'tampered-secret'
    await storage.write(reservation.credentialRef, safeStorage.encryptString(JSON.stringify(record)))

    await expect(vault.inspectReserved({ ...reservation, channelId: input.channelId, type: input.type })).rejects.toBeInstanceOf(
      ChannelCredentialVaultError
    )
  })

  it('rejects an idempotent reserved replay when the stored record identity is tampered', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)
    await vault.putReserved({ ...input, ...reservation })
    const stored = await storage.read(reservation.credentialRef)
    const record = JSON.parse(safeStorage.decryptString(stored!)) as { channelId: string }
    record.channelId = 'channel-2'
    await storage.write(reservation.credentialRef, safeStorage.encryptString(JSON.stringify(record)))

    await expect(vault.putReserved({ ...input, ...reservation })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('sorts credential field names by deterministic code units rather than the process locale', () => {
    expect(['z', 'ä', 'a', 'Z'].sort(compareCredentialFieldNames)).toEqual(['Z', 'a', 'z', 'ä'])
  })

  it('keeps the protected fingerprint key and permit stable across a recreated vault', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret', second: 'two' } }
    const firstVault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    const first = await firstVault.prepareMigration(input)
    const restartedVault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    const second = await restartedVault.prepareMigration({
      ...input,
      value: { second: 'two', botToken: 'migration-secret' },
      expectedFingerprintKeyId: first.fingerprintKeyId
    })

    expect(second).toEqual(first)
  })

  it('fails closed for reservation value, identity, key id, or permit mismatches', async () => {
    const vault = createEncryptedChannelCredentialVault({ safeStorage: createSafeStorage(), storage: createMemoryBlobStore() })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)

    await expect(vault.putReserved({ ...input, ...reservation, value: { botToken: 'other-secret' } })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.putReserved({ ...input, ...reservation, channelId: 'channel-2' })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.putReserved({ ...input, ...reservation, fingerprintKeyId: 'wrong-key' })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.putReserved({ ...input, ...reservation, migrationPermit: `${reservation.migrationPermit}tampered` })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(vault.inspectReserved({ ...reservation, channelId: 'channel-1', type: 'slack' })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('fails closed when its protected migration key is missing or damaged', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)
    await storage.delete('channel-migration-fingerprint-key')
    const restartedVault = createEncryptedChannelCredentialVault({ safeStorage, storage })

    await expect(restartedVault.prepareMigration({ ...input, expectedFingerprintKeyId: reservation.fingerprintKeyId })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
    await expect(restartedVault.putReserved({ ...input, ...reservation })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('does not silently replace an initialized migration fingerprint key after it is deleted', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    await vault.prepareMigration({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'migration-secret' } })
    await storage.delete('channel-migration-fingerprint-key')

    await expect(
      createEncryptedChannelCredentialVault({ safeStorage, storage }).prepareMigration({
        channelId: 'channel-2',
        type: 'telegram',
        value: { botToken: 'another-secret' }
      })
    ).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it.each([{}, false])('fails closed instead of rebuilding a missing key when its marker is malformed: %j', async (marker) => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    await vault.prepareMigration({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'migration-secret' } })
    await storage.delete('channel-migration-fingerprint-key')
    await storage.write('channel-migration-fingerprint-key-marker', safeStorage.encryptString(JSON.stringify(marker)))

    await expect(
      createEncryptedChannelCredentialVault({ safeStorage, storage }).prepareMigration({
        channelId: 'channel-2',
        type: 'telegram',
        value: { botToken: 'another-secret' }
      })
    ).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })

  it('fails closed when the protected migration fingerprint key is corrupted', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    await vault.prepareMigration({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'migration-secret' } })
    await storage.write('channel-migration-fingerprint-key', safeStorage.encryptString(JSON.stringify({ keyId: 1, key: null })))

    await expect(
      createEncryptedChannelCredentialVault({ safeStorage, storage }).prepareMigration({
        channelId: 'channel-2',
        type: 'telegram',
        value: { botToken: 'another-secret' }
      })
    ).rejects.toThrow('Channel credential vault is unavailable.')
  })

  it('fails closed when the protected migration fingerprint key is not canonical 32-byte base64', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    await vault.prepareMigration({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'migration-secret' } })
    await storage.write(
      'channel-migration-fingerprint-key',
      safeStorage.encryptString(JSON.stringify({ keyId: 'channel-fingerprint-key:not-a-uuid', key: 'abc' }))
    )

    await expect(
      createEncryptedChannelCredentialVault({ safeStorage, storage }).prepareMigration({
        channelId: 'channel-2',
        type: 'telegram',
        value: { botToken: 'another-secret' }
      })
    ).rejects.toThrow('Channel credential vault is unavailable.')
  })

  it('rejects a migration reservation when a normal credential already occupies its opaque ref', async () => {
    const safeStorage = createSafeStorage()
    const storage = createMemoryBlobStore()
    const vault = createEncryptedChannelCredentialVault({ safeStorage, storage })
    const input = { channelId: 'channel-1', type: 'telegram' as const, value: { botToken: 'migration-secret' } }
    const reservation = await vault.prepareMigration(input)
    await storage.write(reservation.credentialRef, safeStorage.encryptString(JSON.stringify({ ...input, revision: 1 })))

    await expect(vault.putReserved({ ...input, ...reservation })).rejects.toBeInstanceOf(ChannelCredentialVaultError)
  })
})

function createSafeStorage(): SafeStorageAdapter {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.concat([key.subarray(0, 4), Buffer.from(value, 'utf8')]),
    decryptString: (value) => {
      if (!Buffer.from(value).subarray(0, 4).equals(key.subarray(0, 4))) throw new Error('invalid ciphertext')
      return Buffer.from(value).subarray(4).toString('utf8')
    }
  }
}

const unavailableSafeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('unavailable') },
  decryptString: () => { throw new Error('unavailable') }
}

function createMemoryBlobStore(): ChannelSecretBlobStore & { writeCount: number; dump: () => Record<string, string> } {
  const values = new Map<string, Uint8Array>()
  let writeCount = 0
  return {
    get writeCount() { return writeCount },
    dump: () => Object.fromEntries([...values].map(([key, value]) => [key, Buffer.from(value).toString('base64')])),
    async read(ref) { return values.get(ref)?.slice() ?? null },
    async write(ref, value) { writeCount += 1; values.set(ref, value.slice()) },
    async delete(ref) { values.delete(ref) }
  }
}
