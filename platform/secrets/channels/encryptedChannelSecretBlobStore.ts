import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ChannelSecretBlobStore } from './channelCredentialContracts'

const safeReference = /^[A-Za-z0-9:_-]{1,240}$/

/** File persistence accepts ciphertext only; encryption remains owned by the vault. */
export function createEncryptedChannelSecretBlobStore(directory: string): ChannelSecretBlobStore {
  return {
    async read(ref) {
      const filePath = blobPath(directory, ref)
      try {
        return Uint8Array.from(Buffer.from(await readFile(filePath, 'utf8'), 'base64'))
      } catch (error) {
        if (isMissingFile(error)) return null
        throw error
      }
    },
    async write(ref, encryptedBlob) {
      const filePath = blobPath(directory, ref)
      await mkdir(directory, { recursive: true })
      await writeFile(filePath, Buffer.from(encryptedBlob).toString('base64'), 'utf8')
    },
    async delete(ref) {
      await rm(blobPath(directory, ref), { force: true })
    }
  }
}

function blobPath(directory: string, ref: string): string {
  if (!safeReference.test(ref)) throw new Error('Invalid channel secret reference.')
  return join(directory, `${Buffer.from(ref, 'utf8').toString('base64url')}.blob`)
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
