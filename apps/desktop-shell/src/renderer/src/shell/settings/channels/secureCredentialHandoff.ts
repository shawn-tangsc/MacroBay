export type SecureCredentialHandoffBegin = {
  sessionId: string
  mainPublicJwk: JsonWebKey
}

export type SecureCredentialHandoffPayload = {
  sessionId: string
  rendererPublicJwk: JsonWebKey
  iv: Uint8Array
  ciphertext: Uint8Array
}

// Browser-only WebCrypto: sensitive text becomes AES-GCM ciphertext before preload IPC.
export async function encryptChannelHandoff(
  begin: SecureCredentialHandoffBegin,
  channelId: string,
  purpose: 'credential' | 'policy',
  value: Record<string, string>
): Promise<SecureCredentialHandoffPayload> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const mainKey = await crypto.subtle.importKey('jwk', begin.mainPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: mainKey }, pair.privateKey, 256)
  const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const aad = new TextEncoder().encode(`${begin.sessionId}:${channelId}:${purpose}`)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, data))
  return {
    sessionId: begin.sessionId,
    rendererPublicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    iv,
    ciphertext
  }
}

export function clearSensitiveDraft(clear: (value: string) => void): void {
  clear('')
}
