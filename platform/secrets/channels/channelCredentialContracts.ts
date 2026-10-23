import type { AgentChannelType } from '../../ai/agent-platform/schemas/channelSchemas'

export type ChannelCredentialRef = string
export type ChannelCredentialMigrationPurpose = 'provider-credential' | 'legacy-discovery-archive'

export type ChannelCredentialSafeView = {
  credentialRef: ChannelCredentialRef
  revision: number
  maskedFields: Record<string, string>
}

/** Main-process-only attribution for a normal credential rotation. Never return this through safe DTOs. */
export type ChannelCredentialMutationIdentity = {
  channelId: string
  operationId: string
  mutationEpoch: number
}

export type ChannelCredentialMutationReceipt = ChannelCredentialMutationIdentity & {
  credentialRef: ChannelCredentialRef
  revision: number
}

export type ChannelCredentialPutInput = {
  channelId: string
  type: AgentChannelType
  value: Record<string, string>
}

export type ChannelCredentialMigrationReservation = {
  credentialRef: ChannelCredentialRef
  sourceFingerprint: string
  fingerprintKeyId: string
  migrationPermit: string
}

export type ChannelCredentialArchiveMigrationInput = {
  channelId: string
  type: AgentChannelType
  candidates: string[]
  expectedFingerprintKeyId?: string
}

export type ChannelCredentialArchiveReservedPutInput = Omit<ChannelCredentialArchiveMigrationInput, 'expectedFingerprintKeyId'> &
  ChannelCredentialMigrationReservation

export type ChannelCredentialArchiveReservedInspection = Omit<ChannelCredentialMigrationReservation, 'migrationPermit'> & {
  channelId: string
  type: AgentChannelType
  migrationPermit: string
}

export type ChannelCredentialReservedPutInput = ChannelCredentialPutInput & ChannelCredentialMigrationReservation

export type ChannelCredentialReservedInspection = Omit<ChannelCredentialMigrationReservation, 'migrationPermit'> & {
  channelId: string
  type: AgentChannelType
  migrationPermit: string
}

export type ChannelCredentialReservedDelete = ChannelCredentialReservedInspection & {
  expectedRevision: number
}

export type ChannelCredentialReservedCleanupClaim = {
  revision: number
  cleanupToken: string
}

export type ChannelCredentialVault = {
  put: (input: ChannelCredentialPutInput) => Promise<ChannelCredentialSafeView>
  get: (credentialRef: ChannelCredentialRef) => Promise<Record<string, string> | null>
  /** Main-process recovery may inspect a known ref, but never receives credential values. */
  inspectSafe?: (credentialRef: ChannelCredentialRef) => Promise<ChannelCredentialSafeView | null>
  has: (credentialRef: ChannelCredentialRef) => Promise<boolean>
  rotate: (credentialRef: ChannelCredentialRef, value: Record<string, string>) => Promise<ChannelCredentialSafeView>
  rotateIfRevision?: (
    credentialRef: ChannelCredentialRef,
    expectedRevision: number,
    value: Record<string, string>,
    mutation: ChannelCredentialMutationIdentity
  ) => Promise<ChannelCredentialSafeView>
  /** Recovery-only receipt for proving which mutation advanced a normal credential revision. */
  inspectMutationReceipt?: (credentialRef: ChannelCredentialRef) => Promise<ChannelCredentialMutationReceipt | null>
  delete: (credentialRef: ChannelCredentialRef) => Promise<void>
  prepareMigration: (input: ChannelCredentialPutInput & { expectedFingerprintKeyId?: string }) => Promise<ChannelCredentialMigrationReservation>
  putReserved: (input: ChannelCredentialReservedPutInput) => Promise<ChannelCredentialSafeView>
  inspectReserved: (input: ChannelCredentialReservedInspection) => Promise<ChannelCredentialSafeView | null>
  /** Claims a reserved ref for cleanup; a same-value later put atomically adopts and revokes the claim. */
  claimReservedCleanup?: (input: ChannelCredentialReservedInspection) => Promise<ChannelCredentialReservedCleanupClaim | null>
  /** Removes only a still-claimed reserved ref, preventing a stale cleanup from deleting a later adoption. */
  deleteReservedIfCleanupClaim?: (input: ChannelCredentialReservedDelete & { cleanupToken: string }) => Promise<boolean>
  /** Deletes only the exact permit-bound reserved value at the observed revision. */
  deleteReservedIfRevision?: (input: ChannelCredentialReservedDelete) => Promise<boolean>
  /** Deletes a normal known credential only when no later rotation has changed its revision. */
  deleteIfRevision?: (input: { channelId: string; credentialRef: ChannelCredentialRef; expectedRevision: number }) => Promise<boolean>
  prepareArchiveMigration: (input: ChannelCredentialArchiveMigrationInput) => Promise<ChannelCredentialMigrationReservation>
  putReservedArchive: (input: ChannelCredentialArchiveReservedPutInput) => Promise<void>
  inspectReservedArchive: (input: ChannelCredentialArchiveReservedInspection) => Promise<boolean>
  deleteReservedArchive: (input: ChannelCredentialArchiveReservedInspection) => Promise<void>
}

export type ChannelPayloadEncryption = {
  ciphertext: Uint8Array
  keyRef: string
  keyRevision: number
}

export type ChannelPayloadDecryptionInput = ChannelPayloadEncryption & {
  channelId: string
}

export type ChannelPayloadCipher = {
  encrypt: (channelId: string, payload: Uint8Array) => Promise<ChannelPayloadEncryption>
  decrypt: (input: ChannelPayloadDecryptionInput) => Promise<Uint8Array>
  keyedHash: (channelId: string, value: Uint8Array) => Promise<string>
  rotate: (channelId: string) => Promise<{ keyRef: string; keyRevision: number }>
  revoke: (channelId: string, keyRef: string) => Promise<void>
  /** Deletes only the journaled payload keys plus this Channel's hash/state records after encrypted work is purged. */
  destroy?: (channelId: string, knownKeyRefs?: readonly string[]) => Promise<void>
}

export type SafeStorageAdapter = {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Uint8Array
  decryptString: (value: Uint8Array) => string
}

// This storage boundary only accepts encrypted safeStorage blobs, never JSON credentials or keys.
export type ChannelSecretBlobStore = {
  read: (ref: string) => Promise<Uint8Array | null>
  write: (ref: string, encryptedBlob: Uint8Array) => Promise<void>
  delete: (ref: string) => Promise<void>
}
