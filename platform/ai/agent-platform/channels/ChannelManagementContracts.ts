import type { AgentChannelType } from '../schemas/channelSchemas'

export type ChannelManagementCatalogEntry = {
  type: AgentChannelType
  status: 'planned' | 'blocked' | 'supported'
  reason: 'release-a-pending' | 'adapter-blocked' | 'evidence-complete'
}

export type ChannelManagementState = 'configuration-ready' | 'credential-missing' | 'deleting' | 'disabled' | 'runtime-ready'

export type ChannelManagementSafeView = {
  id: string
  type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'
  name: string
  agentId: string
  requestedEnabled: boolean
  state: ChannelManagementState
  credential: {
    status: 'configured' | 'missing' | 'unavailable'
    hasCredential: boolean
    revision: number | null
    maskedFields: Record<string, string>
  }
  createdAt: string
  updatedAt: string
}

export type ChannelManagementAuditView = {
  id: string
  channelId: string
  actorId: string
  action: string
  code: string | null
  createdAt: string
}

export type ChannelPolicySafeView = {
  id: string
  subjectType: 'user' | 'conversation'
  conversationKind: 'direct' | 'group' | 'channel' | null
  createdAt: string
}

export type ChannelConversationSafeView = {
  id: string
  kind: 'direct' | 'group' | 'channel'
  hasBoundSession: boolean
  targetEnabled: boolean
  createdAt: string
}

export type ChannelRuntimeSafeView = {
  channelId: string
  generation: number
  lifecycle: 'active' | 'inactive' | 'deleted' | 'missing'
  updatedAt: string | null
}

export type ChannelDeliveryAttemptSafeView = {
  id: string
  source: 'inbound-reply' | 'task-result' | 'agent-notify'
  status: 'pending' | 'sending' | 'delivered' | 'failed' | 'unknown-after-send' | 'skipped'
  code: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type ChannelDeliveryAuditSafeView = {
  id: string
  attemptId: string | null
  code: string
  createdAt: string
}

export type ChannelManagementResult = {
  ok: boolean
  code: ChannelManagementCode
  channel?: ChannelManagementSafeView
}

export type ChannelManagementCode =
  | 'adapter-not-supported'
  | 'adapter-runtime-start-failed'
  | 'channel-agent-missing'
  | 'channel-credential-invalid'
  | 'channel-credential-missing'
  | 'channel-credential-unavailable'
  | 'channel-delete-pending'
  | 'channel-management-metadata-failed'
  | 'channel-not-found'
  | 'channel-policy-invalid'
  | 'policy-created'
  | 'policy-deleted'
  | 'target-updated'
  | 'configuration-ready'
  | 'runtime-ready'
  | 'restarted'
  | 'deleted'
  | 'disabled'
  | 'updated'

export type SecureHandoffBegin = {
  sessionId: string
  mainPublicJwk: JsonWebKey
  expiresAt: number
}

export type SecureHandoffSubmit = {
  sessionId: string
  rendererPublicJwk: JsonWebKey
  iv: Uint8Array
  ciphertext: Uint8Array
}

export function assertTelegramSecret(value: unknown): { bot_token: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record.bot_token !== 'string') throw invalidInput()

  const token = record.bot_token.trim()
  if (!token || token.length > 512 || !/^[\x21-\x7e]+$/.test(token)) throw invalidInput()
  return { bot_token: token }
}

export function assertSlackSecret(value: unknown): { bot_token: string; app_token: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.bot_token !== 'string' || typeof record.app_token !== 'string') throw invalidInput()
  const botToken = record.bot_token.trim()
  const appToken = record.app_token.trim()
  if (!isSlackToken(botToken, 'xoxb-') || !isSlackToken(appToken, 'xapp-')) throw invalidInput()
  return { bot_token: botToken, app_token: appToken }
}

export function assertLarkSecret(value: unknown): { app_id: string; app_secret: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.app_id !== 'string' || typeof record.app_secret !== 'string') throw invalidInput()
  const appId = record.app_id.trim()
  const appSecret = record.app_secret.trim()
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(appId) || !/^[\x21-\x7e]{16,512}$/.test(appSecret)) throw invalidInput()
  return { app_id: appId, app_secret: appSecret }
}

export function assertQqSecret(value: unknown): { app_id: string; client_secret: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 2 || typeof record.app_id !== 'string' || typeof record.client_secret !== 'string') throw invalidInput()
  const appId = record.app_id.trim()
  const secret = record.client_secret.trim()
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(appId) || !/^[\x21-\x7e]{16,512}$/.test(secret)) throw invalidInput()
  return { app_id: appId, client_secret: secret }
}

/** Discord Release E accepts exactly one bot token; client credentials and OAuth material are out of scope. */
export function assertDiscordSecret(value: unknown): { bot_token: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1 || typeof record.bot_token !== 'string') throw invalidInput()
  const token = record.bot_token.trim()
  if (token.length < 24 || token.length > 512 || !/^[\x21-\x7e]+$/.test(token)) throw invalidInput()
  return { bot_token: token }
}

export function assertIdentifier(value: unknown, max = 128): string {
  if (typeof value !== 'string') throw invalidInput()
  const normalized = value.trim()
  if (!normalized || normalized.length > max || /[\u0000-\u001f]/.test(normalized)) throw invalidInput()
  return normalized
}

export function assertBoundedInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw invalidInput()
  return value
}

export function assertBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalidInput()
  return value
}

export function assertSenderId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw invalidInput()
  return value
}

function invalidInput(): Error {
  return new Error('channel-input-invalid')
}

function isSlackToken(value: string, prefix: string): boolean {
  return value.length <= 512 && new RegExp(`^${prefix}[A-Za-z0-9-]{10,}$`).test(value)
}
