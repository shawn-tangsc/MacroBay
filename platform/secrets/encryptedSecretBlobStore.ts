import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SecretBlobStore, SecretOwnerScope, SecretRef } from './secretVaultTypes'

const safePathSegment = /^[A-Za-z0-9_-]{1,80}$/
const safeSecretRef = /^[A-Za-z0-9:_-]{1,160}$/

type BlobFileOperations = {
  mkdir: typeof mkdir
  lstat: typeof lstat
  readFile: typeof readFile
  rename: typeof rename
  rm: typeof rm
  writeFile: typeof writeFile
}

const defaultBlobFileOperations: BlobFileOperations = { lstat, mkdir, readFile, rename, rm, writeFile }

/** Generic encrypted blob persistence; callers provide only ciphertext bytes. */
export function createEncryptedSecretBlobStore(directory: string, fileOperations: BlobFileOperations = defaultBlobFileOperations): SecretBlobStore {
  return {
    async exists(owner, ref) {
      const filePath = blobPath(directory, owner, ref)
      try {
        return (await fileOperations.lstat(filePath)).isFile()
      } catch (error) {
        if (isMissingFile(error)) return false
        throw error
      }
    },
    async read(owner, ref) {
      const filePath = blobPath(directory, owner, ref)
      try {
        return Uint8Array.from(Buffer.from(await fileOperations.readFile(filePath, 'utf8'), 'base64'))
      } catch (error) {
        if (isMissingFile(error)) return null
        throw error
      }
    },
    async write(owner, ref, encryptedBlob) {
      const filePath = blobPath(directory, owner, ref)
      await fileOperations.mkdir(join(directory, owner.ownerType, owner.ownerId, owner.namespace), { recursive: true })
      const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fileOperations.writeFile(tempPath, Buffer.from(encryptedBlob).toString('base64'), 'utf8')
        await fileOperations.rename(tempPath, filePath)
      } finally {
        await fileOperations.rm(tempPath, { force: true })
      }
    },
    async delete(owner, ref) {
      await fileOperations.rm(blobPath(directory, owner, ref), { force: true })
    }
  }
}

function blobPath(directory: string, owner: SecretOwnerScope, ref: SecretRef): string {
  if (owner.ownerType !== 'platform' && owner.ownerType !== 'product') {
    throw new Error('Invalid secret owner scope.')
  }
  if (!safePathSegment.test(owner.ownerId) || !safePathSegment.test(owner.namespace)) {
    throw new Error('Invalid secret owner scope.')
  }
  if (!safeSecretRef.test(ref)) throw new Error('Invalid secret reference.')
  return join(directory, owner.ownerType, owner.ownerId, owner.namespace, `${Buffer.from(ref, 'utf8').toString('base64url')}.blob`)
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
