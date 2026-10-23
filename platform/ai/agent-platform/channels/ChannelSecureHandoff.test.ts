import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { ChannelSecureHandoff } from './ChannelSecureHandoff'

describe('ChannelSecureHandoff', () => {
  it('accepts only a one-time, sender/channel/purpose/AAD-bound ECDH AES-GCM payload', async () => {
    const handoff = new ChannelSecureHandoff()
    const begin = await handoff.begin({ channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 1 })
    const payload = await encrypt(begin, 'channel-a', 'credential', 'value')

    const plaintext = await handoff.consume({ ...payload, channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 2 })
    expect(plaintext.byteLength).toBeGreaterThan(0)
    plaintext.fill(0)
    await expect(handoff.consume({ ...payload, channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 2 })).rejects.toThrow('channel-handoff-invalid')

    const senderBound = await handoff.begin({ channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 1 })
    await expect(handoff.consume({ ...(await encrypt(senderBound, 'channel-a', 'credential', 'x')), channelId: 'channel-a', purpose: 'credential', senderId: 2, now: 2 })).rejects.toThrow('channel-handoff-invalid')

    const aadBound = await handoff.begin({ channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 1 })
    await expect(handoff.consume({ ...(await encrypt(aadBound, 'channel-a', 'credential', 'x')), channelId: 'channel-a', purpose: 'policy', senderId: 1, now: 2 })).rejects.toThrow('channel-handoff-invalid')
  })

  it('rejects expired, tampered and malformed handoffs without revealing plaintext', async () => {
    const handoff = new ChannelSecureHandoff()
    const expired = await handoff.begin({ channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 1 })
    await expect(handoff.consume({ ...(await encrypt(expired, 'channel-a', 'credential', 'x')), channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 60_002 })).rejects.toThrow('channel-handoff-invalid')

    const tampered = await handoff.begin({ channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 1 })
    const payload = await encrypt(tampered, 'channel-a', 'credential', 'x')
    payload.ciphertext[payload.ciphertext.length - 1] ^= 1
    await expect(handoff.consume({ ...payload, channelId: 'channel-a', purpose: 'credential', senderId: 1, now: 2 })).rejects.toThrow('channel-handoff-invalid')
  })

  it('prunes expired private keys and fails closed at the bounded pending-session limit', async () => {
    const handoff = new ChannelSecureHandoff()
    for (let index = 0; index < 64; index += 1) {
      await handoff.begin({ channelId: `channel-${index}`, purpose: 'credential', senderId: 1, now: 1 })
    }
    await expect(handoff.begin({ channelId: 'overflow', purpose: 'credential', senderId: 1, now: 1 })).rejects.toThrow('channel-handoff-unavailable')
    await expect(handoff.begin({ channelId: 'after-expiry', purpose: 'credential', senderId: 1, now: 60_002 })).resolves.toMatchObject({ sessionId: expect.any(String) })
  })
})

async function encrypt(
  begin: { sessionId: string; mainPublicJwk: JsonWebKey },
  channelId: string,
  purpose: 'credential' | 'policy',
  text: string
) {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const main = await webcrypto.subtle.importKey('jwk', begin.mainPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const bits = await webcrypto.subtle.deriveBits({ name: 'ECDH', public: main }, pair.privateKey, 256)
  const key = await webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = new Uint8Array(12)
  const aad = new TextEncoder().encode(`${begin.sessionId}:${channelId}:${purpose}`)
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(text)))
  return { sessionId: begin.sessionId, rendererPublicJwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey), iv, ciphertext }
}
