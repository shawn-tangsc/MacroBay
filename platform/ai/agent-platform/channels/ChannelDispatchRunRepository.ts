import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'

export type ChannelDispatchRunStatus = 'started' | 'completed' | 'failed' | 'interrupted'

export type ChannelDispatchRun = {
  dispatchId: string
  channelId: string
  workItemId: string
  conversationId: string
  status: ChannelDispatchRunStatus
  /** 失败码（闭集）；成功与未结束时为 null。 */
  errorCode: string | null
  /** 脱敏截断后的一句原始说明，只给排查用。 */
  errorDetail: string | null
  startedAt: string
  finishedAt: string | null
}

export type ChannelDispatchResult = {
  textCiphertext: Uint8Array
  textKeyRef: string
  textKeyRevision: number
  status: 'pending' | 'delivered' | 'failed'
}

/**
 * Durable execution ledger. `started` is written before the Agent call; recovery must not call the
 * Agent again for a started dispatch.
 */
export class ChannelDispatchRunRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  start(input: {
    dispatchId: string
    channelId: string
    workItemId: string
    conversationId: string
    now?: Date
  }): boolean {
    const now = (input.now ?? new Date()).toISOString()
    return this.database.connection.prepare(
      `insert or ignore into channel_dispatch_runs(
         dispatch_id, channel_id, work_item_id, conversation_id, status, started_at, finished_at, updated_at
       ) values (?, ?, ?, ?, 'started', ?, null, ?)`
    ).run(input.dispatchId, input.channelId, input.workItemId, input.conversationId, now, now).changes === 1
  }

  get(dispatchId: string): ChannelDispatchRun | null {
    const row = this.database.connection.prepare(
      `select dispatch_id, channel_id, work_item_id, conversation_id, status, started_at, finished_at,
              error_code, error_detail
       from channel_dispatch_runs where dispatch_id = ?`
    ).get(dispatchId) as {
      dispatch_id: string; channel_id: string; work_item_id: string; conversation_id: string
      status: ChannelDispatchRunStatus; started_at: string; finished_at: string | null
      error_code: string | null; error_detail: string | null
    } | undefined
    return row ? {
      dispatchId: row.dispatch_id,
      channelId: row.channel_id,
      workItemId: row.work_item_id,
      conversationId: row.conversation_id,
      status: row.status,
      errorCode: row.error_code ?? null,
      errorDetail: row.error_detail ?? null,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    } : null
  }

  /** Writes the encrypted final text and marks the run completed in one transaction. */
  complete(input: {
    dispatchId: string
    channelId: string
    conversationId: string
    textCiphertext: Uint8Array
    textKeyRef: string
    textKeyRevision: number
    now?: Date
  }): void {
    const now = (input.now ?? new Date()).toISOString()
    this.database.transact(() => {
      this.database.connection.prepare(
        `insert into channel_dispatch_results(
           dispatch_id, channel_id, conversation_id, text_ciphertext, text_key_ref, text_key_revision,
           status, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         on conflict(dispatch_id) do update set
           text_ciphertext = excluded.text_ciphertext,
           text_key_ref = excluded.text_key_ref,
           text_key_revision = excluded.text_key_revision,
           status = case when channel_dispatch_results.status = 'delivered' then 'delivered' else 'pending' end,
           updated_at = excluded.updated_at`
      ).run(input.dispatchId, input.channelId, input.conversationId, input.textCiphertext, input.textKeyRef, input.textKeyRevision, now, now)
      this.database.connection.prepare(
        `update channel_dispatch_runs set status = 'completed', finished_at = ?, updated_at = ?
         where dispatch_id = ? and status = 'started'`
      ).run(now, now, input.dispatchId)
    })
  }

  /** 失败必须带原因：`code` 进闭集给界面翻人话，`detail` 脱敏截断只给排查。 */
  fail(
    dispatchId: string,
    status: 'failed' | 'interrupted' = 'failed',
    now = new Date(),
    reason: { code?: string; detail?: string } = {}
  ): void {
    const iso = now.toISOString()
    this.database.connection.prepare(
      `update channel_dispatch_runs set status = ?, finished_at = ?, updated_at = ?,
         error_code = coalesce(?, error_code), error_detail = coalesce(?, error_detail)
       where dispatch_id = ? and status = 'started'`
    ).run(status, iso, iso, reason.code ?? null, sanitizeDetail(reason.detail), dispatchId)
  }

  getResult(dispatchId: string): ChannelDispatchResult | null {
    const row = this.database.connection.prepare(
      `select text_ciphertext, text_key_ref, text_key_revision, status
       from channel_dispatch_results where dispatch_id = ?`
    ).get(dispatchId) as {
      text_ciphertext: Uint8Array; text_key_ref: string; text_key_revision: number
      status: 'pending' | 'delivered' | 'failed'
    } | undefined
    return row ? {
      textCiphertext: row.text_ciphertext,
      textKeyRef: row.text_key_ref,
      textKeyRevision: row.text_key_revision,
      status: row.status
    } : null
  }

  markResult(dispatchId: string, status: 'delivered' | 'failed', now = new Date()): void {
    this.database.connection.prepare(
      'update channel_dispatch_results set status = ?, updated_at = ? where dispatch_id = ?'
    ).run(status, now.toISOString(), dispatchId)
  }
}

/** 只留一行、最多 200 字：可能含内部路径之类的信息，进库前先收窄。 */
function sanitizeDetail(detail: string | undefined): string | null {
  if (typeof detail !== 'string') return null
  const cleaned = detail.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, 200) : null
}
