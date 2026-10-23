export type SecretOwnerScope = {
  ownerType: 'platform' | 'product'
  ownerId: string
  namespace: string
}

export type SecretRef = string

export type SecretMetadata = {
  ref: SecretRef
  owner: SecretOwnerScope
  revision: number
  hasSecret: boolean
  preview: string
  createdAt: string
  updatedAt: string
}

export type SecretVault = {
  put(input: { owner: SecretOwnerScope; ref?: SecretRef; value: string }): Promise<SecretMetadata>
  get(ref: SecretRef, owner: SecretOwnerScope): Promise<string | null>
  rotate(ref: SecretRef, owner: SecretOwnerScope, value: string, expectedRevision?: number): Promise<SecretMetadata>
  delete(ref: SecretRef, owner: SecretOwnerScope): Promise<void>
  exists(ref: SecretRef, owner: SecretOwnerScope): Promise<boolean>
  has(ref: SecretRef, owner: SecretOwnerScope): Promise<boolean>
  inspect(ref: SecretRef, owner: SecretOwnerScope): Promise<SecretMetadata | null>
}

export type SecretVaultErrorCode =
  | 'secret-vault-unavailable'
  | 'secret-vault-unsafe-owner'
  | 'secret-vault-unsafe-ref'
  | 'secret-vault-ref-conflict'
  | 'secret-vault-secret-not-found'
  | 'secret-vault-revision-conflict'
  | 'secret-vault-record-invalid'

export class SecretVaultError extends Error {
  constructor(readonly code: SecretVaultErrorCode) {
    super(code)
    this.name = 'SecretVaultError'
  }
}

export type SecretVaultSafeStorage = {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Uint8Array
  decryptString: (value: Uint8Array) => string
}

export type SecretBlobStore = {
  exists: (owner: SecretOwnerScope, ref: SecretRef) => Promise<boolean>
  read: (owner: SecretOwnerScope, ref: SecretRef) => Promise<Uint8Array | null>
  write: (owner: SecretOwnerScope, ref: SecretRef, encryptedBlob: Uint8Array) => Promise<void>
  delete: (owner: SecretOwnerScope, ref: SecretRef) => Promise<void>
}
