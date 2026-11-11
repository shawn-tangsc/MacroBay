/**
 * 频道行的两处写入（新建 / 编辑），从仓储里抽出来只为守住那份「只减不增」的体积基线。
 *
 * 只写「这条频道是什么」+「允许哪些会话」：空允许列表写 `null`（＝允许所有）。
 *
 * 工作目录与权限模式两列**保留但一个字都不再写**（2026-11-10 撤掉两个控件）：权限是智能体级的事实，
 * 频道级工作目录会是第二个工作区权威，两样都不该有第二个答案。新建时这两列就是 NULL（读侧按
 * 「系统目录 / 继承助手」解释），编辑时也不碰它们——老行里的历史值原样留着，不会被悄悄改写。
 */
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { managedChannelSql } from './ChannelManagementPredicates'

export type ManagedChannelCreateInput = {
  id: string
  type?: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'
  name: string
  agentId: string
  now: string
  allowedChatIds?: readonly string[]
}

export type ManagedChannelUpdateInput = {
  name: string
  agentId: string
  now: string
  allowedChatIds?: readonly string[]
}

const MANAGED_CHANNEL_SQL = managedChannelSql()

export function insertManagedChannel(database: AgentPlatformDatabase, input: ManagedChannelCreateInput): boolean {

  return database.connection
    .prepare(
      `insert into agent_channels (
        id, adapter_key, name, agent_id, public_config_json, requested_enabled, lifecycle_state,
        active_chat_ids_json, created_at, updated_at
      ) select ?, ?, ?, ?, ?, 0, 'credential-missing', ?, ?, ?
        where not exists (select 1 from channel_management_tombstones where channel_id = ?)`
    )
    .run(
      input.id,
      input.type === 'feishu' ? 'lark' : (input.type ?? 'telegram'),
      input.name,
      input.agentId,
      input.type === 'feishu' ? '{"domain":"lark"}' : '{}',
      // 空允许列表存 null（= 允许所有），不存 '[]'：两种写法同义，落库只留一种。
      input.allowedChatIds === undefined || input.allowedChatIds.length === 0 ? null : JSON.stringify(input.allowedChatIds),
      input.now,
      input.now,
      input.id
    ).changes === 1
}

export function updateManagedChannelRow(
  database: AgentPlatformDatabase,
  id: string,
  input: ManagedChannelUpdateInput,
  hooks: { invalidateLifecycleOwner: (id: string) => void; fence: (id: string, at: string) => void }
): boolean {
    return database.transact(() => {
      hooks.invalidateLifecycleOwner(id)
      const changed = database.connection
        .prepare(
          `update agent_channels
           set name = ?, agent_id = ?, requested_enabled = 0, lifecycle_state = 'disabled', updated_at = ?,
               active_chat_ids_json = case when ? then ? else active_chat_ids_json end
           where id = ? and ${MANAGED_CHANNEL_SQL} and lifecycle_state not in ('deleting')`
        )
        .run(
          input.name,
          input.agentId,
          input.now,
          input.allowedChatIds === undefined ? 0 : 1,
          input.allowedChatIds === undefined || input.allowedChatIds.length === 0 ? null : JSON.stringify(input.allowedChatIds),
          id
        ).changes
      if (changed) hooks.fence(id, input.now)
      return changed === 1
    })
}

/**
 * 凭据恢复写入的两处（体积基线只减不增，所以从仓储里抽在这里）。
 *
 * `settleReservedCredentialMetadata` 只推进 revision 与健康度，**不碰启用意图与生命周期**——
 * 恢复一个用户明确停用的频道时，不能替他把状态改成「已启用」。
 */
export function settleReservedCredentialMetadata(
  database: AgentPlatformDatabase,
  input: { channelId: string; ref: string; expectedRevision: number | null; observedRevision: number; now: string }
): boolean {
  return database.connection.prepare(
    `update agent_channels set credential_revision = ?, credential_health = 'configured',
       migration_error_code = null, updated_at = ?
     where id = ? and ${managedChannelSql()} and credential_ref = ? and lifecycle_state not in ('deleting')
       and ((? is null and credential_revision is null) or credential_revision = ?)`
  ).run(input.observedRevision, input.now, input.channelId, input.ref,
    input.expectedRevision, input.expectedRevision).changes === 1
}

/** 记一次恢复失败并返回累计次数：给「永远好不了的操作」一个上限，而不是无限重试。 */
export function recordCredentialRecoveryFailure(database: AgentPlatformDatabase, id: string): number {
  database.connection.prepare(
    'update channel_management_operations set recovery_attempts = recovery_attempts + 1 where id = ?'
  ).run(id)
  const row = database.connection.prepare(
    'select recovery_attempts from channel_management_operations where id = ?'
  ).get(id) as { recovery_attempts: number } | undefined
  return row?.recovery_attempts ?? 0
}

/** 启动恢复要核对健康度的那些行（有凭据、非微信、不在删除中）。 */
export function listManagedCredentialRows(
  database: AgentPlatformDatabase
): Array<{ channelId: string; ref: string; revision: number }> {
  return database.connection.prepare(
    `select id, credential_ref, credential_revision from agent_channels
     where ${managedChannelSql()} and adapter_key <> 'wechat' and credential_ref is not null and credential_revision is not null
       and lifecycle_state not in ('deleting')`
  ).all().map((row) => ({
    channelId: (row as { id: string }).id,
    ref: (row as { credential_ref: string }).credential_ref,
    revision: (row as { credential_revision: number }).credential_revision
  }))
}

/** 只改健康度这一格；已删除的行不再回写。 */
export function setManagedCredentialHealth(
  database: AgentPlatformDatabase,
  channelId: string,
  health: 'configured' | 'missing' | 'unavailable',
  now: string
): void {
  database.connection.prepare(
    `update agent_channels set credential_health = ?, updated_at = ?
     where id = ? and ${managedChannelSql()} and lifecycle_state not in ('deleting')`
  ).run(health, now, channelId)
}

/**
 * 放弃一条凭据操作，并**连带清掉它自己的生命周期 owner 行**。
 *
 * 为什么必须连带：`beginLifecycleOwner` 要求这个频道没有任何生命周期 owner 行，否则下一次启用/保存
 * 直接被挡（`adapter-runtime-start-failed`）。一条操作都放弃了还留着它的 owner，就是把用户永久锁在门外——
 * 「恢复失败 → 放弃 → 下次还是不能动」正是这么来的。owner token 是一笔调用一个，按 token 删不会误伤别人。
 */
export function abandonCredentialOperation(
  database: AgentPlatformDatabase,
  operationId: string,
  code: string,
  now: string
): void {
  database.transact(() => {
    const row = database.connection.prepare(
      'select channel_id, lifecycle_owner_token from channel_management_operations where id = ?'
    ).get(operationId) as { channel_id: string; lifecycle_owner_token: string | null } | undefined
    database.connection.prepare(
      `update channel_management_operations set state = 'abandoned', operation_permit = null,
         stable_error_code = ?, updated_at = ? where id = ?`
    ).run(code, now, operationId)
    if (!row?.lifecycle_owner_token) return
    database.connection.prepare(
      `delete from channel_telegram_lifecycle_operations
       where channel_id = ? and owner_token = ? and purpose = 'mutation' and generation is null`
    ).run(row.channel_id, row.lifecycle_owner_token)
  })
}

/**
 * 一条凭据操作收口（completed / abandoned）之后，把它自己的生命周期 owner 行一并清掉。
 *
 * 为什么不能只靠 `abandonOperation`：恢复里还有 `completeRevokedOperation` /
 * `completeUnattributedRotation` 等收口路径，它们都不经过 abandon。留着 owner 行的后果是一样的——
 * `beginLifecycleOwner` 要求这个频道没有任何 owner 行，用户下一次启用/保存会直接被挡。
 * 这里用一条幂等的 SQL 收口：只删「这条操作自己的 token 且操作已终结」的那一行。
 */
export function releaseSettledOperationOwner(database: AgentPlatformDatabase, operationId: string): void {
  database.connection.prepare(
    `delete from channel_telegram_lifecycle_operations
     where channel_id = (select channel_id from channel_management_operations where id = ?)
       and owner_token = (select lifecycle_owner_token from channel_management_operations where id = ?)
       and owner_token is not null and purpose = 'mutation' and generation is null
       and exists (
         select 1 from channel_management_operations
         where id = ? and state in ('completed', 'abandoned')
       )`
  ).run(operationId, operationId, operationId)
}
