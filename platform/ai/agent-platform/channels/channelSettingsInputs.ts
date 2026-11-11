/**
 * 频道设置的入参校验。纯函数：不写库、不看通道状态。
 *
 * 语义写死在这里，别处只许引用：`allowedChatIds` 缺省／空数组＝**允许所有会话**
 * （与旧「默认拒绝」相反）。
 *
 * 工作目录与权限模式不再有入参（2026-11-10 撤掉两个控件）：它们是智能体级的事实，
 * 频道这一层不给第二个答案，`agent_channels` 的那两列只留历史值。
 */
export const CHANNEL_ALLOWED_CHAT_IDS_MAX = 200
export const CHANNEL_ALLOWED_CHAT_ID_MAX_LENGTH = 64

export function assertManagedChannelType(value: unknown): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' {
  if (value === undefined || value === 'telegram') return 'telegram'
  if (value === 'slack') return 'slack'
  if (value === 'feishu') return 'feishu'
  if (value === 'qq') return 'qq'
  if (value === 'discord') return 'discord'
  if (value === 'wechat') return 'wechat'
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

