import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import {
  CHANNEL_RUNTIME_AUDIT_KEEP,
  CHANNEL_RUNTIME_LIFECYCLE_KEEP
} from './channelRuntimeAuditRetention'
import { channelRuntimeLifecycleCodes } from './channelRuntimeLifecycle'

/**
 * 运行审计的**批量裁剪**（B3）：写入时已经按频道裁到上限，这里给定时任务一个可复跑的入口。
 *
 * 与写入时那两刀用同一个口径（`(created_at desc, id asc)`、失败类 500 / 起停类 100），区别只有
 * 「一次处理所有频道」并**回报删了多少**——定时任务要能对账，否则「昨晚清理了没有」只能靠猜。
 *
 * 幂等：没有超量行时删除 0 条、返回 0；连跑两次第二次必为 0。
 */
export type ChannelRuntimeAuditPruneResult = Readonly<{
  removedFailureRows: number
  removedLifecycleRows: number
}>

export function pruneChannelRuntimeAudits(
  database: AgentPlatformDatabase,
  options: Readonly<{
    keep?: number
    lifecycleKeep?: number
  }> = {}
): ChannelRuntimeAuditPruneResult {
  const keep = options.keep ?? CHANNEL_RUNTIME_AUDIT_KEEP
  const lifecycleKeep = options.lifecycleKeep ?? CHANNEL_RUNTIME_LIFECYCLE_KEEP
  const lifecycle = channelRuntimeLifecycleCodes.map((code) => `'${code}'`).join(',')
  let removedFailureRows = 0
  let removedLifecycleRows = 0

  database.transact(() => {
    const channels = database.connection.prepare(
      'select distinct channel_id as channelId from channel_runtime_audits'
    ).all() as Array<{ channelId: string }>

    for (const { channelId } of channels) {
      const before = count(database, channelId, `code not in (${lifecycle})`)
      database.connection.prepare(
        `delete from channel_runtime_audits
         where channel_id = ?
           and code not in (${lifecycle})
           and id not in (
             select id from channel_runtime_audits
             where channel_id = ? and code not in (${lifecycle})
             order by created_at desc, id asc
             limit ${keep}
           )`
      ).run(channelId, channelId)
      removedFailureRows += before - count(database, channelId, `code not in (${lifecycle})`)

      const beforeLifecycle = count(database, channelId, `code in (${lifecycle})`)
      database.connection.prepare(
        `delete from channel_runtime_audits
         where channel_id = ?
           and code in (${lifecycle})
           and id not in (
             select id from channel_runtime_audits
             where channel_id = ? and code in (${lifecycle})
             order by created_at desc, id asc
             limit ${lifecycleKeep}
           )`
      ).run(channelId, channelId)
      removedLifecycleRows += beforeLifecycle - count(database, channelId, `code in (${lifecycle})`)
    }
  })

  return Object.freeze({ removedFailureRows, removedLifecycleRows })
}

function count(database: AgentPlatformDatabase, channelId: string, predicate: string): number {
  const row = database.connection.prepare(
    `select count(*) as count from channel_runtime_audits where channel_id = ? and ${predicate}`
  ).get(channelId) as { count: number }
  return row.count
}
