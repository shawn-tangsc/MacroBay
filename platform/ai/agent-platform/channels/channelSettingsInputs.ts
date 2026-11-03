/**
 * 频道设置三项的入参校验（需求 v7 六字段）。纯函数：不写库、不看通道状态。
 *
 * 三条语义写死在这里，别处只许引用：
 * - `workspace` 缺省＝系统默认目录；
 * - `allowedChatIds` 缺省／空数组＝**允许所有会话**（与旧「默认拒绝」相反）；
 * - `permissionMode` 缺省／`null`＝**继承助手**，不落 `'default'`——那是助手级默认值，
 *   落成它就和「显式选了 default」分不开了，而这两件事在界面上是两个选项。
 */
import type { ChannelWorkspaceOverride } from './ChannelManagementContracts'
import type { AgentPermissionMode } from '../schemas/agentSchemas'

export const CHANNEL_ALLOWED_CHAT_IDS_MAX = 200
export const CHANNEL_ALLOWED_CHAT_ID_MAX_LENGTH = 64

const PERMISSION_MODES: readonly AgentPermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan']

export function assertManagedChannelType(value: unknown): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' {
  if (value === undefined || value === 'telegram') return 'telegram'
  if (value === 'slack') return 'slack'
  if (value === 'feishu') return 'feishu'
  if (value === 'qq') return 'qq'
  if (value === 'discord') return 'discord'
  if (value === 'wechat') return 'wechat'
  throw new Error('channel-input-invalid')
}

export function parseWorkspace(value: unknown): ChannelWorkspaceOverride {
  if (value === undefined) return { type: 'system' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('channel-input-invalid')
  const workspace = value as Record<string, unknown>
  if (workspace.type === 'system') return { type: 'system' }
  if (workspace.type === 'user' && typeof workspace.workspaceId === 'string') {
    const workspaceId = workspace.workspaceId.trim()
    if (workspaceId.length > 0 && workspaceId.length <= 128) return { type: 'user', workspaceId }
  }
  throw new Error('channel-input-invalid')
}

/** 传 `undefined`＝这次不改（更新时）；传 `[]`＝显式允许所有。 */
export function parseAllowedChatIds(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('channel-input-invalid')
  if (value.length > CHANNEL_ALLOWED_CHAT_IDS_MAX) throw new Error('channel-input-invalid')
  const ids: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error('channel-input-invalid')
    const id = entry.trim()
    if (id.length === 0 || id.length > CHANNEL_ALLOWED_CHAT_ID_MAX_LENGTH) throw new Error('channel-input-invalid')
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/** 传 `null` 是「继承」这个明确选择，不是缺省值；传 `undefined` 才是「这次不改」。 */
export function parsePermissionMode(value: unknown): AgentPermissionMode | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)) {
    return value as AgentPermissionMode
  }
  throw new Error('channel-input-invalid')
}
