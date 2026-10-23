import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEncryptedChannelSecretBlobStore } from './encryptedChannelSecretBlobStore'

describe('encrypted channel secret blob store', () => {
  it('persists opaque encrypted blobs and not caller plaintext', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-vault-'))
    const store = createEncryptedChannelSecretBlobStore(directory)
    const secret = 'provider-secret-never-on-disk'

    await store.write('credential:1', new TextEncoder().encode('opaque-encrypted-blob'))

    const contents = await readFile(join(directory, 'Y3JlZGVudGlhbDox.blob'), 'utf8')
    expect(contents).toContain('b3BhcXVlLWVuY3J5cHRlZC1ibG9i')
    expect(contents).not.toContain(secret)
    await expect(store.read('credential:1')).resolves.toEqual(new TextEncoder().encode('opaque-encrypted-blob'))

    await rm(directory, { recursive: true, force: true })
  })

  it('fails invalid refs instead of deriving a traversal path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-vault-'))
    const store = createEncryptedChannelSecretBlobStore(directory)

    await expect(store.write('../plaintext.json', new Uint8Array())).rejects.toThrow('Invalid channel secret reference.')

    await rm(directory, { recursive: true, force: true })
  })

  it('keeps distinct valid references in distinct ciphertext files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-vault-'))
    const store = createEncryptedChannelSecretBlobStore(directory)

    await store.write('key:one', new Uint8Array([1]))
    await store.write('key_one', new Uint8Array([2]))

    await expect(store.read('key:one')).resolves.toEqual(new Uint8Array([1]))
    await expect(store.read('key_one')).resolves.toEqual(new Uint8Array([2]))
    await rm(directory, { recursive: true, force: true })
  })
})
