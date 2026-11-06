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
import { channelRuntimeLifecycleCodes, type ChannelRuntimeLifecycleCode } from './channelRuntimeLifecycle'

/** 每个频道保留的失败/异常行数。 */
export const CHANNEL_RUNTIME_AUDIT_KEEP = 500
/** 每个频道保留的起停行数：状态变化很稀，单独留一个额度，避免被失败洪峰挤掉。 */
export const CHANNEL_RUNTIME_LIFECYCLE_KEEP = 100

/** 类型化的写入口：入站/生命周期码走这里，别处不要直接拼 SQL。 */
export function recordRuntimeAudit(
  database: AgentPlatformDatabase,
  channelId: string,
  generation: number | null,
  code: ChannelInboundAuditCode | ChannelRuntimeLifecycleCode,
  now: Date
): void {
  appendRuntimeAudit(database, channelId, generation, code, now)
}

/**
 * 低层写入：面板读的那张表 + 同一事务里的 500 行裁剪。
 * 只给「已经确认过的码」用（入站码、生命周期码、镜像过来的运行时失败码）。
 */
export function appendRuntimeAudit(
  database: AgentPlatformDatabase,
  channelId: string,
  generation: number | null,
  code: string,
  now: Date
): void {
  database.transact(() => {
    database.connection.prepare(
      'insert into channel_runtime_audits (id, channel_id, generation, code, created_at) values (?, ?, ?, ?, ?)'
    ).run(randomUUID(), channelId, generation, code, now.toISOString())
    // 起停行单独一个额度：失败码一阵爆发时，不能把「什么时候起过/停过」挤掉——
    // 那正是读者翻日志要找的东西。失败类仍按 500 行裁，起停各留最近 100 条。
    const lifecycle = channelRuntimeLifecycleCodes.map((code) => `'${code}'`).join(',')
    database.connection.prepare(
      `delete from channel_runtime_audits
       where channel_id = ?
         and code not in (${lifecycle})
         and id not in (
           select id from channel_runtime_audits
           where channel_id = ? and code not in (${lifecycle})
           order by created_at desc, id asc
           limit ${CHANNEL_RUNTIME_AUDIT_KEEP}
         )`
    ).run(channelId, channelId)
    database.connection.prepare(
      `delete from channel_runtime_audits
       where channel_id = ?
         and code in (${lifecycle})
         and id not in (
           select id from channel_runtime_audits
           where channel_id = ? and code in (${lifecycle})
           order by created_at desc, id asc
           limit ${CHANNEL_RUNTIME_LIFECYCLE_KEEP}
         )`
    ).run(channelId, channelId)
  })
}
