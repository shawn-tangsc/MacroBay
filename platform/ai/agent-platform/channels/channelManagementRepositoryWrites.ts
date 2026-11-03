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
