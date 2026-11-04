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

export type ChannelConversationRow = {
  id: string
  channelId: string
  keyCiphertext: Uint8Array
  keyRef: string
  keyRevision: number
  keyHash: string
  kind: string
  sessionId: string | null
  sessionTitle: string | null
}

export function readChannelConversation(
  database: AgentPlatformDatabase,
  channelId: string,
  keyHash: string
): ChannelConversationRow | null {
  const row = database.connection.prepare(
    `select id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision,
            conversation_key_hash, conversation_kind, agent_session_id, session_title
     from channel_conversations where channel_id = ? and conversation_key_hash = ?`
  ).get(channelId, keyHash) as {
    id: string; channel_id: string; conversation_key_ciphertext: Uint8Array; conversation_key_ref: string
    conversation_key_revision: number; conversation_key_hash: string; conversation_kind: string
    agent_session_id: string | null; session_title: string | null
  } | undefined
  return row
    ? {
      id: row.id, channelId: row.channel_id, keyCiphertext: row.conversation_key_ciphertext,
      keyRef: row.conversation_key_ref, keyRevision: row.conversation_key_revision,
      keyHash: row.conversation_key_hash, kind: row.conversation_kind,
      sessionId: row.agent_session_id, sessionTitle: row.session_title
    }
    : null
}

/** 建会话绑定；唯一约束保证同一 (频道, 会话) 只有一行——重复时返回已有那行，`created=false`。 */
export function insertChannelConversation(
  database: AgentPlatformDatabase,
  record: ChannelConversationRow,
  generation: number,
  agentId: string,
  currentAgentId: (channelId: string, generation: number) => string | null,
  now: Date
): { record: ChannelConversationRow; created: boolean } | null {
  try {
    return database.transact(() => {
      if (currentAgentId(record.channelId, generation) !== agentId) return null
      database.connection.prepare(
        `insert into channel_conversations (
          id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision,
          conversation_key_hash, conversation_kind, agent_session_id, session_title, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        record.id, record.channelId, record.keyCiphertext, record.keyRef, record.keyRevision, record.keyHash,
        record.kind, record.sessionId, record.sessionTitle, now.toISOString(), now.toISOString()
      )
      return { record, created: true }
    })
  } catch {
    const existing = readChannelConversation(database, record.channelId, record.keyHash)
    if (!existing) throw new Error('Channel conversation persistence failed.')
    return { record: existing, created: false }
  }
}

/** `/new` 换会话：只改这一行的 session 与名字，旧的 Agent 会话留在存储里当历史。 */
export function replaceChannelConversationSession(
  database: AgentPlatformDatabase,
  input: { channelId: string; keyHash: string; sessionId: string; generation: number; agentId: string; sessionTitle?: string; now: Date },
  currentAgentId: (channelId: string, generation: number) => string | null
): boolean {
  return database.transact(() => {
    if (currentAgentId(input.channelId, input.generation) !== input.agentId) return false
    return database.connection.prepare(
      `update channel_conversations set agent_session_id = ?, session_title = ?, updated_at = ?
       where channel_id = ? and conversation_key_hash = ?`
    ).run(input.sessionId, input.sessionTitle ?? null, input.now.toISOString(), input.channelId, input.keyHash).changes === 1
  })
}

/**
 * 每次入站刷新这一行的「最近活跃」时间。**只动 updated_at**：键、会话、名字都由别的路径管。
 *
 * 为什么必须有：这行以前只在建会话 / `/new` 时写，于是 22:38 明明有消息、库里还停在 19:16 ——
 * 「数据自己说谎」比没有这个字段更糟。目前没有消费者按它排序，先修准。
 */
export function touchChannelConversation(
  database: AgentPlatformDatabase,
  input: { channelId: string; conversationId: string; now: Date }
): boolean {
  return database.connection.prepare(
    'update channel_conversations set updated_at = ? where id = ? and channel_id = ?'
  ).run(input.now.toISOString(), input.conversationId, input.channelId).changes === 1
}

/**
 * 给「还没名字」的老会话补一个名字。
 *
 * 为什么要补：会话名是这次才落库的，迁移之前建的会话行 `session_title` 是空的，
 * 投递回执只能回退成平台名。**只补空值**——已有名字（不管是谁写的）一个字节都不动。
 */
export function fillChannelConversationTitle(
  database: AgentPlatformDatabase,
  input: { channelId: string; keyHash: string; title: string }
): boolean {
  if (!input.title.trim()) return false
  return database.connection.prepare(
    `update channel_conversations set session_title = ?, updated_at = updated_at
     where channel_id = ? and conversation_key_hash = ? and (session_title is null or session_title = '')`
  ).run(input.title, input.channelId, input.keyHash).changes === 1
}

/** 按 dispatch id 找到它属于哪个对话：同会话排队要用它当键，admit 之前就要拿到。 */
export function findDispatchConversation(database: AgentPlatformDatabase, dispatchId: string): string | null {
  const row = database.connection.prepare(
    'select conversation_id from channel_inbound_work_items where dispatch_id = ?'
  ).get(dispatchId) as { conversation_id: string } | undefined
  return row?.conversation_id ?? null
}

/** 一条运行时审计（`channel-conversation-switched` 这类），走同一张表与同一套裁剪。 */
export function recordConversationSwitchedAudit(database: AgentPlatformDatabase, channelId: string, generation: number, now: Date): void {
  database.connection.prepare(
    `insert into channel_runtime_audits(id, channel_id, generation, code, created_at) values(?, ?, ?, 'channel-conversation-switched', ?)`
  ).run(randomUUID(), channelId, generation, now.toISOString())
}
