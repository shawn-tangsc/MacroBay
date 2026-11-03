/**
 * 入站放行的判定与允许列表读取（需求 v7：留空＝允许所有）。
 *
 * 单独成文件有两个原因：`ChannelInboundRepository` 贴着「只减不增」的体积基线；这三段都是
 * 「读一行 + 判一次」的纯查询，放进独立文件后可以单独验证。
 *
 * 三条口径：
 * - 允许列表非空 → **只放行列表里的会话**（列表与入站用同一个 keyedHash，能逐字比）；
 * - 列表为空但有显式策略行 → **沿用旧判定**，老数据行为不变；
 * - 两者都没有 → **允许所有**（旧行为是默认拒绝，这次反转是有意的）。
 */
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { ChannelConversationKind } from './channelContracts'

/** 坏 JSON 或坏形状一律当空：方向是「放行」，不是把读者静默拦死。 */
export function readChannelAllowList(database: AgentPlatformDatabase, channelId: string): string[] {
  const row = database.connection.prepare('select active_chat_ids_json from agent_channels where id = ?').get(channelId) as { active_chat_ids_json: string | null } | undefined
  if (!row || row.active_chat_ids_json === null) return []
  try {
    const parsed = JSON.parse(row.active_chat_ids_json) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
  } catch {
    return []
  }
}

export function channelHasAnyAllowPolicy(database: AgentPlatformDatabase, channelId: string): boolean {
  return Boolean(database.connection.prepare('select 1 from channel_allow_policies where channel_id = ? limit 1').get(channelId))
}

export function isAllowedByPolicy(
  database: AgentPlatformDatabase,
  channelId: string,
  userHash: string,
  conversationHash: string,
  kind: ChannelConversationKind
): boolean {
  const row = database.connection.prepare(
    `select 1 from channel_allow_policies
     where channel_id = ? and (
       (subject_type = 'user' and subject_key_hash = ? and (conversation_kind is null or conversation_kind = ?))
       or (subject_type = 'conversation' and subject_key_hash = ? and (conversation_kind is null or conversation_kind = ?))
     ) limit 1`
  ).get(channelId, userHash, kind, conversationHash, kind)
  return Boolean(row)
}
