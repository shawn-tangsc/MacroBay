import type { AgentChannelType } from '../schemas/channelSchemas'
import type { AgentPermissionMode } from '../schemas/agentSchemas'

export type ChannelManagementCatalogEntry = {
  type: AgentChannelType
  status: 'planned' | 'blocked' | 'supported'
  reason: 'release-a-pending' | 'adapter-blocked' | 'evidence-complete'
  implemented: boolean
  credentialFields: readonly string[]
}

export type ChannelManagementState = 'configuration-ready' | 'credential-missing' | 'deleting' | 'disabled' | 'runtime-ready'

/**
 * 通道级的三项覆盖（需求 v7 六字段）。都存 `agent_channels` 同一行：
 * 管理服务写、旧读模型读同一行，不存在两处各存一份。
 */
export type ChannelWorkspaceOverride =
  | { type: 'system' }
  | { type: 'user'; workspaceId: string }

export type ChannelManagementSafeView = {
  id: string
  type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'
  name: string
  agentId: string
  /** 系统默认目录，或读者指定的一个工作区。 */
  workspace: ChannelWorkspaceOverride
  /** 允许的会话 ID。**空数组＝允许所有会话**（界面必须同时显示风险提示）。 */
  allowedChatIds: readonly string[]
  /** `null`＝继承助手；不落 `'default'`——那是助手级默认值，两者必须分得开。 */
  permissionMode: AgentPermissionMode | null
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
  /** 创建时算好的会话名（`Telegram · 贾维斯`）；读不到时说 `null`，界面回退到平台名，**不许编**。 */
  sessionTitle: string | null
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
  source: 'inbound-reply' | 'task-result' | 'agent-notify' | 'notification'
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
  /**
   * 通道自己给的一句话（已脱敏截断，例如 `Bad Request: chat not found`）。
   * **只是补充说明**：主句永远是 `code` 翻出来的人话，界面必须把它放在正文之后，不许拿它当原因。
   */
  detail: string | null
  createdAt: string
}

/**
 * 为什么这个通道现在不能投递。闭集，四种码对应四个不同的用户动作：
 * 去启用适配器 / 去存凭据 / 去请求启用 / 去绑定目标。
 *
 * 这里给码不给句子：可见文案归 i18n，平台层出中文句子会让英文界面再翻一次，
 * 同一句人话就有了两个出处。
 */
export type ChannelDeliveryBlockReason =
  | 'adapter-not-supported'
  | 'credential-missing'
  | 'not-enabled'
  | 'no-enabled-target'

/**
 * 通知设置页「发送到通道」一行要的只读投影：不缓存、不带凭据、不给配置入口。
 *
 * 目标三档是刻意的：0 个是未绑定，1 个显示它，多个只报数量——替读者挑一个会话
 * 等于把「绑定目标」这件事从通道页搬到了通知页。
 */
export type ChannelDeliveryTargetView = {
  id: string
  name: string
  deliverable: boolean
  reason: ChannelDeliveryBlockReason | null
  target:
    | { kind: 'unbound' }
    | { kind: 'bound'; conversationKind: ChannelConversationSafeView['kind'] }
    | { kind: 'ambiguous'; count: number }
}

/**
 * 运行审计的只读一行：谁在什么时候被什么原因挡下。
 *
 * `generation` **不在这里**：它是内部代际账，读者看不懂也用不上，返回给渲染层只会多一个
 * 能被截图带出去的内部字段。
 */
export type ChannelRuntimeAuditSafeView = {
  id: string
  code: string
  createdAt: string
}

/** keyset 游标：`createdAt|id`，不用下标。索引就是 `(channel_id, created_at desc, id asc)`。 */
export type ChannelRuntimeAuditCursor = { createdAt: string; id: string }

export type ChannelRuntimeAuditPage = {
  rows: readonly ChannelRuntimeAuditSafeView[]
  nextCursor: ChannelRuntimeAuditCursor | null
}

export type ChannelManagementResult = {
  ok: boolean
  code: ChannelManagementCode
  channel?: ChannelManagementSafeView
  /** 只有 `channel-smoke-failed` 带：失败的具体码（`telegram-conflict` 这类），给界面说人话。 */
  reason?: string
}

export type ChannelManagementCode =
  | 'adapter-not-supported'
  | 'adapter-runtime-start-failed'
  | 'channel-agent-missing'
  /** 启用最后一跳没落成：owner/代际/状态被别处改动抢走，与「助手不在了」是两件事。 */
  | 'channel-runtime-owner-conflict'
  | 'channel-credential-invalid'
  | 'channel-credential-missing'
  /** 上次更换没走完：库里的 revision 已经不是这次读到的那一版，重新打开编辑保存一次即可继续。 */
  | 'channel-credential-mutation-incomplete'
  | 'channel-credential-unavailable'
  /** 用户点启用时现场自检没通过：凭据/网络/限流/被别人占用，`reason` 给具体码。 */
  | 'channel-smoke-failed'
  /**
   * Discord 启动失败的三条**细码**：它们各自对应一个不同的修法，不许再并进
   * `adapter-runtime-start-failed`（那个总桶只说明「没起来」，读者据此只能一遍遍换 Token）。
   */
  | 'discord-auth-rejected'
  | 'discord-credential-missing'
  | 'discord-credential-rejected'
  | 'discord-gateway-endpoint-blocked'
  | 'discord-intents-disallowed'
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

/**
 * 会作为**结果码**返回、且可能被读者看到的那一组（成功码见 `CHANNEL_SUCCESS_CODES`）。
 *
 * 为什么把这份清单放在平台侧：界面那张「码 → 人话」的表用它做**键的类型**，
 * 少一个就编译不过——比人工核对可靠。上一版就是漏了 `channel-runtime-owner-conflict` 等新码，
 * 用户看到的成了「暂时说不出具体原因」。
 */
export const CHANNEL_FAILURE_CODES = [
  'adapter-not-supported',
  'adapter-runtime-start-failed',
  'channel-agent-missing',
  'channel-credential-invalid',
  'channel-credential-missing',
  'channel-credential-mutation-incomplete',
  'channel-credential-mutation-unattributed',
  'channel-credential-recovery-exhausted',
  'channel-credential-unavailable',
  'channel-delete-pending',
  'channel-management-metadata-failed',
  'channel-management-recovery-pending',
  'channel-not-found',
  'channel-policy-invalid',
  'channel-runtime-generation-stale',
  'channel-runtime-owner-conflict',
  'channel-runtime-owner-lost',
  'channel-runtime-owner-missing',
  // 「打开这条频道的会话」两种打不开：没绑定会话 / 会话侧没有选中能力。
  'conversation-session-missing',
  'session-selection-unavailable',
  'channel-smoke-failed',
  'discord-auth-rejected',
  'discord-credential-missing',
  'discord-credential-rejected',
  'discord-gateway-endpoint-blocked',
  'discord-intents-disallowed',
  'discord-network-unavailable',
  'lark-connect-failed',
  'lark-network-unavailable',
  'lark-provider-rejected',
  'lark-proxy-unresolved',
  'lark-rate-limited',
  'qq-network-unavailable',
  'qq-provider-rejected',
  'qq-rate-limited',
  'discord-provider-rejected',
  'discord-rate-limited',
  'slack-network-unavailable',
  'slack-provider-rejected',
  'slack-rate-limited',
  'telegram-conflict',
  'telegram-credential-missing',
  'telegram-network-unavailable',
  'telegram-provider-rejected',
  'telegram-proxy-unavailable',
  'telegram-rate-limited',
  'telegram-runtime-start-failed'
] as const

export type ChannelFailureCode = (typeof CHANNEL_FAILURE_CODES)[number]

/** 运行时给的原因是不是本仓认识的失败码：认识才允许它直接当审计码，别把拼错的字符串写进库。 */
export function isChannelFailureCode(value: string): value is ChannelFailureCode {
  return (CHANNEL_FAILURE_CODES as readonly string[]).includes(value)
}

/** 成功码：它们不进「失败原因」表，界面也不该把它们当失败说。 */
export const CHANNEL_SUCCESS_CODES = [
  'configuration-ready',
  'runtime-ready',
  'restarted',
  'deleted',
  'disabled',
  'updated',
  'policy-created',
  'policy-deleted',
  'target-updated',
  'channel-credential-settled',
  'channel-runtime-started'
] as const

/**
 * 编译期闸门：`ChannelManagementCode` 里每新增一个码，必须落进「失败码」或「成功码」之一。
 *
 * 少了这条，新码会静默走到界面的兜底句（「暂时说不出具体原因」）——用户就是这么被糊了几次。
 */
type ChannelCodeNotClassified = Exclude<
  ChannelManagementCode,
  (typeof CHANNEL_FAILURE_CODES)[number] | (typeof CHANNEL_SUCCESS_CODES)[number]
>
export const channelCodesAllClassified: ChannelCodeNotClassified extends never ? true : never = true
