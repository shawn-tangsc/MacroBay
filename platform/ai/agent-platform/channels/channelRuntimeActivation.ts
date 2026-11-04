import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { supportedChannelSql } from './ChannelManagementPredicates'
import type { TelegramLifecycleOwner } from './ChannelManagementRepository'
import { disableOtherEnabledChannelsInTransaction, type DisplacedChannel } from './singleEnabledChannel'

/**
 * 启用的最后一跳：把生命周期 owner 落成一条代际记录，通道才算真的「起来了」。
 *
 * 为什么单独成文件：这里的判定条件多（适配器是否支持、状态、凭据健康、助手是否存在、有没有未收口的
 * 凭据操作），失败时**必须能说清是哪一条**——以前它只返回 null，上层拿「助手不在了」当兜底，
 * 用户明明能从列表里看到那个助手，却被告知「助手不在了，刷新之后重选一个」。
 *
 * 另一个坑写在下面这条注释里：支持判定里的「取证放行」是**进程内状态**，SQL 片段必须在查询时
 * 再拼一次，不能在模块加载时算死。
 */

export type EnableBlockReason =
  | 'channel-not-found'
  | 'adapter-not-supported'
  | 'channel-runtime-owner-conflict'
  | 'channel-credential-missing'
  | 'channel-credential-unavailable'
  | 'channel-credential-mutation-incomplete'
  | 'channel-agent-missing'

/** 与 `activateOwnedRuntime` 同一条 UPDATE 的判定条件，逐条问「是不是这一条挡住的」。 */
export function explainEnableBlock(
  database: AgentPlatformDatabase,
  channelId: string,
  owner: TelegramLifecycleOwner
): EnableBlockReason | null {
  const one = (sql: string, ...params: Array<string | number>): boolean =>
    Boolean(database.connection.prepare(sql).get(...params))

  if (!one('select 1 from agent_channels where id = ?', channelId)) return 'channel-not-found'
  if (
    !one(
      'select 1 from channel_telegram_lifecycle_operations where channel_id = ? and owner_token = ? and purpose = ? and generation is null',
      channelId, owner.token, owner.purpose
    ) || owner.purpose === 'mutation'
  ) return 'channel-runtime-owner-conflict'
  // 支持判定里含进程内的取证放行（`setChannelAcceptanceOverride`），所以这段 SQL 每次都要重新拼：
  // 算死的常量会让「自检通过 → 只启用这一条」永远不生效，用户看到的就是一个说不出理由的失败。
  if (!one(`select 1 from agent_channels where id = ? and ${supportedChannelSql()}`, channelId)) return 'adapter-not-supported'
  const states = owner.purpose === 'enable' ? "('ready', 'disabled')" : "('enabled')"
  if (!one(`select 1 from agent_channels where id = ? and lifecycle_state in ${states}`, channelId)) return 'channel-runtime-owner-conflict'
  if (!one('select 1 from agent_channels where id = ? and credential_ref is not null and credential_revision is not null', channelId)) {
    return 'channel-credential-missing'
  }
  if (!one("select 1 from agent_channels where id = ? and credential_health = 'configured'", channelId)) {
    return 'channel-credential-unavailable'
  }
  if (!one('select 1 from agent_entities a where a.id = (select agent_id from agent_channels where id = ?)', channelId)) {
    // 只有这一条才允许说「助手不在了」——助手真的从列表里消失了。
    return 'channel-agent-missing'
  }
  if (one(
    `select 1 from channel_management_operations o where o.channel_id = ?
       and o.purpose in ('provision', 'rotate') and o.state in ('reserved', 'needs-recovery')`,
    channelId
  )) return 'channel-credential-mutation-incomplete'
  return null
}

/** 与 `activateOwnedRuntime` 完全相同的写入；单独放在这里只为让它跑的时候才拼「支持判定」那段 SQL。 */
export function activateOwnedChannelRuntime(
  database: AgentPlatformDatabase,
  channelId: string,
  owner: TelegramLifecycleOwner,
  now: string
): { owner: TelegramLifecycleOwner; displaced: DisplacedChannel[] } | null {
  return database.transact(() => {
    const current = database.connection.prepare(
      'select 1 from channel_telegram_lifecycle_operations where channel_id = ? and owner_token = ? and purpose = ? and generation is null'
    ).get(channelId, owner.token, owner.purpose)
    if (!current) return null
    if (owner.purpose === 'mutation') return null
    const states = owner.purpose === 'enable' ? "('ready', 'disabled')" : "('enabled')"
    // 单频道不变量：同一时间只允许一条启用。启用新的就把旧的自动停用（读者不用手动关、也不用确认），
    // 与「这一条置为 enabled」在同一个事务里完成——中途失败不该留下一片停用。
    const displaced = disableOtherEnabledChannelsInTransaction(database, channelId, now)
    const changed = database.connection.prepare(
      `update agent_channels set requested_enabled = 1, lifecycle_state = 'enabled', updated_at = ?
       where id = ? and ${supportedChannelSql()} and lifecycle_state in ${states}
         and credential_ref is not null and credential_revision is not null and credential_health = 'configured'
         and exists (select 1 from agent_entities a where a.id = agent_channels.agent_id)
         and not exists (select 1 from channel_management_operations o where o.channel_id = agent_channels.id
           and o.purpose in ('provision', 'rotate') and o.state in ('reserved', 'needs-recovery'))`
    ).run(now, channelId).changes
    if (changed !== 1) return null
    const prior = database.connection.prepare('select generation from channel_runtime_generations where channel_id = ?').get(channelId) as { generation: number } | undefined
    const generation = (prior?.generation ?? 0) + 1
    database.connection.prepare(
      `insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,?, 'active',?)
       on conflict(channel_id) do update set generation=excluded.generation,lifecycle_state='active',updated_at=excluded.updated_at`
    ).run(channelId, generation, now)
    const owned = database.connection.prepare(
      'update channel_telegram_lifecycle_operations set generation = ?, updated_at = ? where channel_id = ? and owner_token = ? and purpose = ? and generation is null'
    ).run(generation, now, channelId, owner.token, owner.purpose).changes
    return owned === 1 ? { owner: { ...owner, generation }, displaced } : null
  })
}
