/** 凭据掩码用例的最小替身：只实现投影用到的 get(ref)。 */
export class FakeCipher {
  async encrypt() { return { ciphertext: new Uint8Array([1]), keyRef: 'payload-key', keyRevision: 1 } }
  async decrypt() { return new Uint8Array() }
  async keyedHash() { return 'opaque' }
  async rotate() { return { keyRef: 'payload-key', keyRevision: 1 } }
  async revoke() { return undefined }
  async destroy() { return undefined }
}

export type FakeVaultKinds = 'secret'

export function makeVault(secret: Record<string, string>) {
  return { get: async (_ref: string) => secret } as never
}
