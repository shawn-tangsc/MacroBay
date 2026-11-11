import type { CredentialCleanupRef } from './ChannelManagementRepository'

/**
 * 凭据日志与清理意图的**形状校验**（从 `ChannelManagementRepository` 抽出来，纯粹为体积门禁）。
 *
 * 这里回答的是同一个问题：**这一串引用能不能证明「它属于这条频道、且形状是它自称的那种东西」**。
 * 三种引用各有出处：
 * - `channel-migration:<id>:<fingerprint>`：预留/迁入的凭据（`prepareMigration` → `putReserved` → `settleReserved` 全程用它）；
 * - `channel-migration-archive:<id>:<fingerprint>`：迁出后归档的那一份；
 * - `channel-payload-key:<id>:<uuid>`：C03 报文加密用的键。
 *
 * 校验宁严不宽：形状不对一律 `null`，由调用方当成「引用损坏」处理——把坏引用当成有效引用，
 * 删除时就会漏掉一份真实存在的凭据。
 */
export function parsePayloadKeyRefs(value: string, channelId: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    const refs = parsed.filter((ref) => isPayloadKeyRefForChannel(ref, channelId))
    return refs.length === parsed.length ? [...new Set(refs)] : null
  } catch {
    return null
  }
}

export function parseCredentialCleanupRefs(value: string, channelId: string): CredentialCleanupRef[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    const refs = parsed.filter((ref) => isValidCredentialCleanupRef(ref, channelId))
    return refs.length === parsed.length ? refs : null
  } catch {
    return null
  }
}

function isValidCredentialCleanupRef(value: unknown, channelId: string): value is CredentialCleanupRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as CredentialCleanupRef
  if (ref.purpose === 'rotate') return isProviderRefForChannel(ref.ref, channelId) &&
    typeof ref.expectedRevision === 'number' && Number.isSafeInteger(ref.expectedRevision) && ref.expectedRevision > 0
  return ref.purpose === 'provision' && isBase64Url(ref.fingerprint, 512) &&
    isOpaqueJournalValue(ref.keyId, 256) && isBase64Url(ref.permit, 512) &&
    typeof ref.fingerprint === 'string' && ref.ref === providerRef(channelId, ref.fingerprint) &&
    (ref.expectedRevision === null ||
      (typeof ref.expectedRevision === 'number' && Number.isSafeInteger(ref.expectedRevision) && ref.expectedRevision > 0))
}

export function isPayloadKeyRefForChannel(value: unknown, channelId: string): value is string {
  const prefix = `channel-payload-key:${channelId}:`
  return typeof value === 'string' && value.startsWith(prefix) && /^[0-9a-f-]{36}$/i.test(value.slice(prefix.length))
}

export function isValidPendingCredentialOperation(value: {
  purpose: 'provision' | 'rotate'; credential_ref: string | null; source_fingerprint: string | null; fingerprint_key_id: string | null; operation_permit: string | null; expected_revision: number | null
}, channelId: string): boolean {
  if (value.purpose === 'rotate') return typeof value.credential_ref === 'string' && isProviderRefForChannel(value.credential_ref, channelId) &&
    typeof value.expected_revision === 'number' && Number.isSafeInteger(value.expected_revision) && value.expected_revision > 0
  return isBase64Url(value.source_fingerprint, 512) && isOpaqueJournalValue(value.fingerprint_key_id, 256) &&
    isBase64Url(value.operation_permit, 512) && typeof value.source_fingerprint === 'string' && value.credential_ref === providerRef(channelId, value.source_fingerprint)
}





function isOpaqueJournalValue(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\s]/.test(value)
}

function isBase64Url(value: unknown, max: number): value is string {
  return isOpaqueJournalValue(value, max) && /^[A-Za-z0-9_-]+$/.test(value)
}

function providerRef(channelId: string, fingerprint: string): string {
  return `channel-migration:${channelId}:${fingerprint}`
}

function archiveRef(channelId: string, fingerprint: string): string {
  return `channel-migration-archive:${channelId}:${fingerprint}`
}

export function isProviderRefForChannel(value: string, channelId: string): boolean {
  const prefix = `channel-migration:${channelId}:`
  const fingerprint = value.startsWith(prefix) ? value.slice(prefix.length) : ''
  return isBase64Url(fingerprint, 512)
}
