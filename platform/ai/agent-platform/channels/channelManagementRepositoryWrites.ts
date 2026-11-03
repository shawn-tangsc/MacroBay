/**
 * 频道行的两处写入（新建 / 编辑），从仓储里抽出来只为守住那份「只减不增」的体积基线。
 *
 * 三项覆盖（工作目录、允许的会话 ID、权限模式）都存在 `agent_channels` 这一行：
 * 空允许列表写 `null`（＝允许所有）；权限模式 `null` 就是继承，绝不写助手级默认值 `'default'`。
 */
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { AgentPermissionMode } from '../schemas/agentSchemas'
import type { ChannelWorkspaceOverride } from './ChannelManagementContracts'
import { managedChannelSql } from './ChannelManagementPredicates'

export type ManagedChannelCreateInput = {
  id: string
  type?: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'
  name: string
  agentId: string
  now: string
  workspace?: ChannelWorkspaceOverride
  allowedChatIds?: readonly string[]
  permissionMode?: AgentPermissionMode | null
}

export type ManagedChannelUpdateInput = {
  name: string
  agentId: string
  now: string
  workspace?: ChannelWorkspaceOverride
  allowedChatIds?: readonly string[]
  permissionMode?: AgentPermissionMode | null
}

const MANAGED_CHANNEL_SQL = managedChannelSql()

export function insertManagedChannel(database: AgentPlatformDatabase, input: ManagedChannelCreateInput): boolean {

  return database.connection
    .prepare(
      `insert into agent_channels (
        id, adapter_key, name, agent_id, public_config_json, requested_enabled, lifecycle_state,
        workspace_json, active_chat_ids_json, permission_mode, created_at, updated_at
      ) select ?, ?, ?, ?, ?, 0, 'credential-missing', ?, ?, ?, ?, ?
        where not exists (select 1 from channel_management_tombstones where channel_id = ?)`
    )
    .run(
      input.id,
      input.type === 'feishu' ? 'lark' : (input.type ?? 'telegram'),
      input.name,
      input.agentId,
      input.type === 'feishu' ? '{"domain":"lark"}' : '{}',
      // 空允许列表存 null（= 允许所有），不存 '[]'：两种写法同义，落库只留一种。
      JSON.stringify(input.workspace ?? { type: 'system' }),
      input.allowedChatIds === undefined || input.allowedChatIds.length === 0 ? null : JSON.stringify(input.allowedChatIds),
      input.permissionMode ?? null,
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
               workspace_json = coalesce(?, workspace_json),
               active_chat_ids_json = case when ? then ? else active_chat_ids_json end,
               permission_mode = case when ? then ? else permission_mode end
           where id = ? and ${MANAGED_CHANNEL_SQL} and lifecycle_state not in ('deleting')`
        )
        .run(
          input.name,
          input.agentId,
          input.now,
          input.workspace === undefined ? null : JSON.stringify(input.workspace),
          input.allowedChatIds === undefined ? 0 : 1,
          input.allowedChatIds === undefined || input.allowedChatIds.length === 0 ? null : JSON.stringify(input.allowedChatIds),
          input.permissionMode === undefined ? 0 : 1,
          input.permissionMode ?? null,
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
