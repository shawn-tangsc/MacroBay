import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'

/**
 * 入站消息到达时，把「跟我说话的那个对话」自动记成投递目标。
 *
 * 为什么必须自动：界面上**没有绑定入口**（那一行只有日志/编辑/删除/开关/发送测试消息），
 * 却提示读者「先在频道里绑定一个」——那就是让读者做一件界面上做不到的事（用户 2026-11-04 被卡住）。
 * 跟「留空＝允许所有」同一个思路：能推断的就不要问。
 *
 * 两条边界：
 * - **已有目标时一个字节都不改**：读者可能刻意选了某一个对话，自动绑定不许覆盖；
 * - 写一行 `target-set` 管理审计（`actor=channel-auto-bind`，summary 标 `auto`），
 *   否则读者会看到一条目标凭空出现，查不出是谁加的。
 */
export function autoBindDeliveryTarget(
  database: AgentPlatformDatabase,
  input: { channelId: string; conversationId: string; now?: Date }
): boolean {
  const now = (input.now ?? new Date()).toISOString()
  return database.transact(() => {
    const exists = database.connection.prepare(
      'select 1 as present from channel_delivery_targets where channel_id = ? limit 1'
    ).get(input.channelId)
    if (exists) return false
    const inserted = database.connection.prepare(
      `insert into channel_delivery_targets (id, channel_id, conversation_id, enabled, created_at, updated_at)
       values (?, ?, ?, 1, ?, ?)`
    ).run(randomUUID(), input.channelId, input.conversationId, now, now).changes === 1
    if (!inserted) return false
    database.connection.prepare(
      `insert into channel_management_audits (id, channel_id, actor_id, action, code, summary_json, created_at)
       values (?, ?, 'channel-auto-bind', 'target-set', null, ?, ?)`
    ).run(randomUUID(), input.channelId, JSON.stringify({ auto: 'true' }), now)
    return true
  })
}
