import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { managedChannelSql } from './ChannelManagementPredicates'

/**
 * 单频道不变量：**同一时间只允许一条频道处于启用状态**（契约 v2.20 §5.3）。
 *
 * 为什么要有它：投递一律取「唯一启用的频道」。以前系统允许同时启用多条，于是投递侧只能
 * 在「有 N 条同时启用」时停下来报错——那是把我们自己放进去的状态变成读者的麻烦。
 * 现在改成**启用新的自动停用旧的**，读者不需要手动关，也不需要确认。
 *
 * 边界（写在这里免得下一个人误读）：不变量只在**启用入口**与**启动对账**两处生效。
 * 直连 `repository.start(...)`（测试与恢复路径的底层调用）绕开入口时，库里仍可能被造成多条启用；
 * 所以启动时必须对账一次，而不是假设数据天然干净。
 */
export type DisplacedChannel = { id: string; adapter: string }

/**
 * 停用除 `keepId` 之外所有已启用频道。**不自己开事务**：调用方（启用事务）已经在事务里，
 * 这一步必须与「把这一条置为 enabled」原子完成，否则中途失败会剩下「零条启用」。
 */
export function disableOtherEnabledChannelsInTransaction(
  database: AgentPlatformDatabase,
  keepId: string,
  now: string
): DisplacedChannel[] {
  const rows = database.connection.prepare(
    `select id, adapter_key from agent_channels
     where ${managedChannelSql()} and lifecycle_state = 'enabled' and requested_enabled = 1 and id <> ?`
  ).all(keepId) as Array<{ id: string; adapter_key: string }>
  if (rows.length === 0) return []
  database.connection.prepare(
    `update agent_channels set requested_enabled = 0, lifecycle_state = 'disabled', updated_at = ?
     where ${managedChannelSql()} and lifecycle_state = 'enabled' and id <> ?`
  ).run(now, keepId)
  // 占用行跟着一起删：它是「谁正在操作」的锁，频道已经被挤出运行，锁留着只会让它再也启不起来。
  const placeholders = rows.map(() => '?').join(', ')
  database.connection.prepare(
    `delete from channel_telegram_lifecycle_operations where channel_id in (${placeholders})`
  ).run(...rows.map((row) => row.id))
  return rows.map((row) => ({ id: row.id, adapter: row.adapter_key }))
}

/**
 * 启动对账：历史数据里可能已经有多条启用（旧版本没有不变量、或绕过入口直连写库）。
 * 保留**最近启用**的那条，其余停用，并告诉调用方是谁被停了（调用方负责停运行时与写审计）。
 */
export function reconcileSingleEnabledChannel(
  database: AgentPlatformDatabase,
  now: string
): { kept: DisplacedChannel | null; disabled: DisplacedChannel[] } {
  return database.transact(() => {
    // 「最近启用」优先看运行代际的更新时间（启用这一步会写它），没有代际时退回频道行时间。
    const rows = database.connection.prepare(
      `select c.id, c.adapter_key, coalesce(g.updated_at, c.updated_at) as activated_at
       from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       where ${managedChannelSql('c')} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
       order by activated_at desc, c.id asc`
    ).all() as Array<{ id: string; adapter_key: string; activated_at: string }>
    if (rows.length <= 1) {
      return { kept: rows[0] ? { id: rows[0].id, adapter: rows[0].adapter_key } : null, disabled: [] }
    }
    const disabled = disableOtherEnabledChannelsInTransaction(database, rows[0].id, now)
    return { kept: { id: rows[0].id, adapter: rows[0].adapter_key }, disabled }
  })
}
