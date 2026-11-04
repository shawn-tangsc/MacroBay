import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'

/**
 * 会话绑定的两处小查询（从仓储抽出来只为守住那份「只减不增」的体积基线）。
 *
 * 它们回答的都是「绑定」这一件事：这条频道下有几个会话（决定会话名要不要加区分段）、
 * 以及补偿时删掉的「刚建好但没被采纳」的那一条。
 */

export function countChannelConversations(database: AgentPlatformDatabase, channelId: string): number {
  const row = database.connection.prepare(
    'select count(*) as count from channel_conversations where channel_id = ?'
  ).get(channelId) as { count: number }
  return row.count
}

export function deleteUnboundChannelConversation(
  database: AgentPlatformDatabase,
  channelId: string,
  keyHash: string,
  sessionId: string
): boolean {
  return database.connection.prepare(
    `delete from channel_conversations where channel_id = ? and conversation_key_hash = ? and agent_session_id = ?
     and not exists (select 1 from channel_inbound_work_items where conversation_id = channel_conversations.id)`
  ).run(channelId, keyHash, sessionId).changes === 1
}

/**
 * 会话切换/重建的一次性操作占位：同一 (频道, 会话) 同时只允许一笔。
 * 跨进程重启也有效（落库），所以两段并发不会各建一条会话。
 */
export function reserveChannelConversationOperation(
  database: AgentPlatformDatabase,
  input: { channelId: string; keyHash: string; generation: number; agentId: string; now: Date },
  currentAgentId: (channelId: string, generation: number) => string | null
): string | null {
  return database.transact(() => {
    if (currentAgentId(input.channelId, input.generation) !== input.agentId) return null
    // 重启会推进代际：只让同代际的占位挡住这一次。
    database.connection.prepare(
      'delete from channel_conversation_session_operations where channel_id = ? and conversation_key_hash = ? and generation <> ?'
    ).run(input.channelId, input.keyHash, input.generation)
    const operationId = randomUUID()
    const inserted = database.connection.prepare(
      `insert or ignore into channel_conversation_session_operations (
        channel_id, conversation_key_hash, operation_id, generation, agent_id, created_at
      ) values (?, ?, ?, ?, ?, ?)`
    ).run(input.channelId, input.keyHash, operationId, input.generation, input.agentId, input.now.toISOString()).changes === 1
    return inserted ? operationId : null
  })
}

export function releaseChannelConversationOperation(
  database: AgentPlatformDatabase,
  channelId: string,
  keyHash: string,
  operationId: string
): void {
  database.connection.prepare(
    'delete from channel_conversation_session_operations where channel_id = ? and conversation_key_hash = ? and operation_id = ?'
  ).run(channelId, keyHash, operationId)
}
