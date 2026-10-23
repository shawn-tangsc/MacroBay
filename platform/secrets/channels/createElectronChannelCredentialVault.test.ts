import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createElectronChannelCredentialVault } from './createElectronChannelCredentialVault'

describe('Electron channel credential vault composition', () => {
  it('composes Electron safeStorage with encrypted blob persistence without exposing a plaintext store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-electron-vault-'))
    const vault = createElectronChannelCredentialVault({
      directory,
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (value) => Buffer.from(`encrypted:${value}`),
        decryptString: (value) => Buffer.from(value).toString('utf8').replace(/^encrypted:/, '')
      }
    })

    const safeView = await vault.put({ channelId: 'channel-1', type: 'telegram', value: { botToken: 'secret-token' } })

    await expect(vault.get(safeView.credentialRef)).resolves.toEqual({ botToken: 'secret-token' })
    await rm(directory, { recursive: true, force: true })
  })
})
