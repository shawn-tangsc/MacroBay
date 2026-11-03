/**
 * 运行审计的写入与保留期（设置页日志面板的「运行异常」读的就是这张表）。
 *
 * 两件事必须原子：写一条、把该频道裁到最近 `CHANNEL_RUNTIME_AUDIT_KEEP` 行。分开写时进程在
 * 中间崩掉，上限就永久失守一次——下一次插入只会再裁一次，多出来的行没人会看，也就没人发现。
 * 排序与索引 `idx_channel_runtime_audits_channel_created` 一致：`(created_at desc, id asc)`；
 * `id` 是 uuid、不保序，按 id 取会删错行。
 */
import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { ChannelInboundAuditCode } from './ChannelInboundRepository'

/** 每个频道保留的行数。 */
export const CHANNEL_RUNTIME_AUDIT_KEEP = 500

export function recordRuntimeAudit(
  database: AgentPlatformDatabase,
  channelId: string,
  generation: number,
  code: ChannelInboundAuditCode,
  now: Date
): void {
  database.transact(() => {
    database.connection.prepare(
      'insert into channel_runtime_audits (id, channel_id, generation, code, created_at) values (?, ?, ?, ?, ?)'
    ).run(randomUUID(), channelId, generation, code, now.toISOString())
    database.connection.prepare(
      `delete from channel_runtime_audits
       where channel_id = ?
         and id not in (
           select id from channel_runtime_audits
           where channel_id = ?
           order by created_at desc, id asc
           limit ${CHANNEL_RUNTIME_AUDIT_KEEP}
         )`
    ).run(channelId, channelId)
  })
}
