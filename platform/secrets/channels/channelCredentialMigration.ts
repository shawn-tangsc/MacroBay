import type { ChannelCredentialMigrationReservation, ChannelCredentialPutInput } from './channelCredentialContracts'
import { createHmac, timingSafeEqual } from 'node:crypto'

import { unavailable } from './channelCredentialVaultError'

/**
 * 凭据迁移身份：指纹、预留 ref、permit 的签名与校验（纯函数，没有存储）。
 *
 * 为什么单独一个文件：抽出来守住 vault 的体积基线，也让「同一个值必然算出同一个 ref」这条
 * 恢复时依赖的性质只在一处实现。vault 只负责存储与状态机。
 *
 * 一条硬性质：`credentialRef = channel-migration:<channelId>:<f(channelId, type, value)>`。
 * 恢复路径用 `get(ref)` 取回值、`prepareMigration` 重算 permit 时依赖的正是它——同一把值必得同一个 ref，
 * 所以「历史日志里的 permit 已经不可用」不等于「这条记录无法收口」。
 */
export type MigrationFingerprintKey = { keyId: string; key: string }
export type MigrationIdentity = Omit<ChannelCredentialMigrationReservation, 'migrationPermit'>

const migrationFormatVersion = 'channel-credential-migration-v1'

export class ChannelCredentialVaultError extends Error {
  constructor() {
    super('Channel credential vault is unavailable.')
    this.name = 'ChannelCredentialVaultError'
  }
}

export function migrationIdentityFrom(input: ChannelCredentialMigrationReservation): MigrationIdentity {
  if (!input.credentialRef || !input.sourceFingerprint || !input.fingerprintKeyId) throw unavailable()
  return {
    credentialRef: input.credentialRef,
    sourceFingerprint: input.sourceFingerprint,
    fingerprintKeyId: input.fingerprintKeyId
  }
}

export function calculateSourceFingerprint(key: MigrationFingerprintKey, input: ChannelCredentialPutInput & { purpose?: string }): string {
  return createHmac('sha256', Buffer.from(key.key, 'base64'))
    .update(canonicalMigrationInput(input))
    .digest('base64url')
}

export function canonicalMigrationInput(input: ChannelCredentialPutInput & { purpose?: string }): string {
  return JSON.stringify({
    format: migrationFormatVersion,
    channelId: input.channelId,
    type: input.type,
    purpose: input.purpose ?? 'provider-credential',
    value: Object.entries(input.value).sort(([left], [right]) => compareCredentialFieldNames(left, right))
  })
}

export function buildReservedCredentialRef(channelId: string, sourceFingerprint: string): string {
  return `channel-migration:${channelId}:${sourceFingerprint}`
}

export function signMigrationPermit(
  key: MigrationFingerprintKey,
  channelId: string,
  type: string,
  identity: MigrationIdentity,
  purpose = 'provider-credential'
): string {
  return createHmac('sha256', Buffer.from(key.key, 'base64'))
    .update(JSON.stringify({ format: migrationFormatVersion, channelId, type, purpose, ...identity }))
    .digest('base64url')
}

export function verifyMigrationPermit(
  key: MigrationFingerprintKey,
  channelId: string,
  type: string,
  identity: MigrationIdentity,
  permit: string,
  purpose = 'provider-credential'
): boolean {
  try {
    const expected = Buffer.from(signMigrationPermit(key, channelId, type, identity, purpose), 'base64url')
    const received = Buffer.from(permit, 'base64url')
    return received.length === expected.length && timingSafeEqual(received, expected)
  } catch {
    return false
  }
}

export function isArchiveRef(value: string): boolean {
  return value.startsWith('channel-migration-archive:')
}

export function buildReservedArchiveRef(channelId: string, sourceFingerprint: string): string {
  return `channel-migration-archive:${channelId}:${sourceFingerprint}`
}

export function normalizeArchiveCandidates(value: string[]): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) throw unavailable()
  const candidates = [...new Set(value)].sort()
  if (Buffer.byteLength(JSON.stringify(candidates), 'utf8') > 1024 * 1024) throw unavailable()
  return candidates
}

export function isMigrationFingerprintKey(value: unknown): value is MigrationFingerprintKey {
  if (!value || typeof value !== 'object') return false
  const key = value as MigrationFingerprintKey
  return isMigrationFingerprintKeyId(key.keyId) && isCanonicalBase64Key(key.key)
}

export function isMigrationFingerprintKeyId(value: unknown): value is string {
  return typeof value === 'string' && /^channel-fingerprint-key:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function isCanonicalBase64Key(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false
  try {
    const decoded = Buffer.from(value, 'base64')
    return decoded.length === 32 && decoded.toString('base64') === value
  } catch {
    return false
  }
}

export function isMigrationIdentity(value: unknown): value is MigrationIdentity {
  return Boolean(
    value && typeof value === 'object' && typeof (value as MigrationIdentity).credentialRef === 'string' &&
      typeof (value as MigrationIdentity).sourceFingerprint === 'string' &&
      typeof (value as MigrationIdentity).fingerprintKeyId === 'string'
  )
}

export function sameMigrationIdentity(left: MigrationIdentity, right: MigrationIdentity): boolean {
  return left.credentialRef === right.credentialRef &&
    left.sourceFingerprint === right.sourceFingerprint &&
    left.fingerprintKeyId === right.fingerprintKeyId
}

export function compareCredentialFieldNames(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

