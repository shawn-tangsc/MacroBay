import { webcrypto } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChannelSecureHandoff } from '@platform/ai/agent-platform/channels/ChannelSecureHandoff'
import { encryptChannelHandoff } from './secureCredentialHandoff'

describe('renderer Channel credential handoff', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('interoperates with the main-process P-256 handoff while keeping the credential out of the IPC shape', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const main = new ChannelSecureHandoff()
    const begin = await main.begin({ channelId: 'channel-a', purpose: 'credential', senderId: 1 })
    const encrypted = await encryptChannelHandoff(begin, 'channel-a', 'credential', { bot_token: 'test-value' })

    expect(JSON.stringify(encrypted)).not.toContain('test-value')
    const plaintext = await main.consume({ ...encrypted, channelId: 'channel-a', purpose: 'credential', senderId: 1 })
    expect(plaintext.byteLength).toBeGreaterThan(0)
    plaintext.fill(0)
  })

  it('binds renderer ciphertext to the requested handoff purpose through AES-GCM AAD', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const main = new ChannelSecureHandoff()
    const begin = await main.begin({ channelId: 'channel-a', purpose: 'credential', senderId: 1 })
    const encrypted = await encryptChannelHandoff(begin, 'channel-a', 'credential', { bot_token: 'test-value' })

    await expect(main.consume({ ...encrypted, channelId: 'channel-a', purpose: 'policy', senderId: 1 })).rejects.toThrow('channel-handoff-invalid')
  })
})
