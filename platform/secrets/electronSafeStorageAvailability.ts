export type ElectronSafeStorageAvailabilitySource = {
  isEncryptionAvailable: () => boolean
  getSelectedStorageBackend?: () => string
}

export const ElectronSafeStorageAvailabilityPolicy = {
  owner: 'platform/secrets',
  source: 'Electron safeStorage encryption availability, plus the Linux-only selected backend',
  default: 'fail-closed',
  failure: 'false; each secret-store adapter maps unavailability to its own stable error',
  safeLinuxBackends: ['gnome_libsecret', 'gnome_keyring', 'kwallet', 'kwallet5', 'kwallet6'],
  testBoundary: 'generic and Channel Electron safeStorage availability tests'
} as const

const safeLinuxStorageBackends = new Set<string>(ElectronSafeStorageAvailabilityPolicy.safeLinuxBackends)

/** Evaluates Electron's platform-specific secret storage contract without probing Linux-only APIs elsewhere. */
export function isElectronSafeStorageAvailable(
  safeStorage: ElectronSafeStorageAvailabilitySource,
  platform: NodeJS.Platform = process.platform
): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (platform === 'darwin' || platform === 'win32') return true
    if (platform !== 'linux') return false
    const backend = safeStorage.getSelectedStorageBackend?.()
    return typeof backend === 'string' && safeLinuxStorageBackends.has(backend)
  } catch {
    return false
  }
}
