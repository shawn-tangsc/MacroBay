import {
  createEncryptedChannelCredentialVault,
  type EncryptedChannelCredentialVault
} from './encryptedChannelCredentialVault'
import { createElectronSafeStorageAdapter } from './electronSafeStorageAdapter'
import { createEncryptedChannelSecretBlobStore } from './encryptedChannelSecretBlobStore'

type ElectronSafeStorage = {
  isEncryptionAvailable: () => boolean
  getSelectedStorageBackend?: () => string
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

/** Main-process composition only; it deliberately exposes no renderer or IPC surface. */
export function createElectronChannelCredentialVault(input: {
  directory: string
  safeStorage: ElectronSafeStorage
  platform?: NodeJS.Platform
}): EncryptedChannelCredentialVault {
  return createEncryptedChannelCredentialVault({
    safeStorage: createElectronSafeStorageAdapter(input.safeStorage, input.platform ?? process.platform),
    storage: createEncryptedChannelSecretBlobStore(input.directory)
  })
}
