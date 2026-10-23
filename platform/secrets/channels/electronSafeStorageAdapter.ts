import type { SafeStorageAdapter } from './channelCredentialContracts'
import {
  isElectronSafeStorageAvailable,
  type ElectronSafeStorageAvailabilitySource
} from '../electronSafeStorageAvailability'

type ElectronSafeStorage = ElectronSafeStorageAvailabilitySource & {
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

/** Reject Electron's documented plaintext Linux backend without probing that Linux-only API elsewhere. */
export function createElectronSafeStorageAdapter(
  safeStorage: ElectronSafeStorage,
  platform: NodeJS.Platform = process.platform
): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => {
      return isElectronSafeStorageAvailable(safeStorage, platform)
    },
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(Buffer.from(value))
  }
}
