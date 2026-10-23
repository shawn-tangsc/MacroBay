import { randomUUID, webcrypto } from 'node:crypto'

import type { SecureHandoffBegin, SecureHandoffSubmit } from './ChannelManagementContracts'

type Pending = { channelId: string; purpose: 'credential' | 'policy'; senderId: number; expiresAt: number; privateKey: CryptoKey }
const handoffTtlMs = 60_000
const maxPendingHandoffs = 64

// One-time ECDH handoff keeps the renderer from ever sending a credential as IPC plaintext.
export class ChannelSecureHandoff {
  private readonly pending = new Map<string, Pending>()

  async begin(input: { channelId: string; purpose: 'credential' | 'policy'; senderId: number; now?: number }): Promise<SecureHandoffBegin> {
    const now = input.now ?? Date.now()
    this.prune(now)
    if (this.pending.size >= maxPendingHandoffs) throw new Error('channel-handoff-unavailable')
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    const sessionId = randomUUID(); const expiresAt = now + handoffTtlMs
    this.pending.set(sessionId, { channelId: input.channelId, purpose: input.purpose, senderId: input.senderId, expiresAt, privateKey: pair.privateKey as unknown as CryptoKey })
    return { sessionId, mainPublicJwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey), expiresAt }
  }

  async consume(input: SecureHandoffSubmit & { channelId: string; purpose: 'credential' | 'policy'; senderId: number; now?: number }): Promise<Uint8Array> {
    this.prune(input.now ?? Date.now())
    const pending = this.pending.get(input.sessionId)
    this.pending.delete(input.sessionId)
    if (!pending || pending.channelId !== input.channelId || pending.purpose !== input.purpose || pending.senderId !== input.senderId || pending.expiresAt < (input.now ?? Date.now())) throw new Error('channel-handoff-invalid')
    if (input.iv.byteLength !== 12 || input.ciphertext.byteLength < 17 || input.ciphertext.byteLength > 2048) throw new Error('channel-handoff-invalid')
    try {
      const peer = await webcrypto.subtle.importKey('jwk', input.rendererPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      const bits = await webcrypto.subtle.deriveBits({ name: 'ECDH', public: peer }, pending.privateKey as unknown as Parameters<typeof webcrypto.subtle.deriveBits>[1], 256)
      const key = await webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt'])
      const aad = new TextEncoder().encode(`${input.sessionId}:${input.channelId}:${input.purpose}`)
      return new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: input.iv, additionalData: aad }, key, input.ciphertext))
    } catch { throw new Error('channel-handoff-invalid') }
  }

  private prune(now: number): void {
    for (const [sessionId, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(sessionId)
    }
  }
}
