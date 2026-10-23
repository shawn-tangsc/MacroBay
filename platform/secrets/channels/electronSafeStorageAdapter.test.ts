import { describe, expect, it, vi } from 'vitest'

import { createElectronSafeStorageAdapter } from './electronSafeStorageAdapter'

describe('Electron safeStorage adapter', () => {
  it('rejects Electron basic_text storage rather than treating it as a secure fallback', () => {
    const adapter = createElectronSafeStorageAdapter({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => Buffer.from(value).toString('utf8')
    }, 'linux')

    expect(adapter.isEncryptionAvailable()).toBe(false)
  })

  it.each(['darwin', 'win32'] as const)('uses Electron encryption availability without calling the Linux selector on %s', (platform) => {
    const getSelectedStorageBackend = vi.fn(() => {
      throw new Error('linux-only selector must not run')
    })
    const adapter = createElectronSafeStorageAdapter({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => Buffer.from(value).toString('utf8')
    }, platform)

    expect(adapter.isEncryptionAvailable()).toBe(true)
    expect(getSelectedStorageBackend).not.toHaveBeenCalled()
  })

  it('fails closed on an unsupported platform without calling the Linux selector', () => {
    const getSelectedStorageBackend = vi.fn(() => 'gnome_libsecret')
    const adapter = createElectronSafeStorageAdapter({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => Buffer.from(value).toString('utf8')
    }, 'freebsd' as NodeJS.Platform)

    expect(adapter.isEncryptionAvailable()).toBe(false)
    expect(getSelectedStorageBackend).not.toHaveBeenCalled()
  })
})
