import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { managedChannelSql } from './ChannelManagementPredicates'
import type {
  ChannelConversationSafeView,
  ChannelDeliveryAttemptSafeView,
  ChannelDeliveryAuditSafeView,
  ChannelManagementAuditView,
  ChannelManagementSafeView,
  ChannelManagementState,
  ChannelPolicySafeView,
  ChannelRuntimeSafeView
} from './ChannelManagementContracts'

type ChannelRow = {
  id: string
  type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'
  name: string
  agent_id: string
  credential_revision: number | null
  credential_health: 'configured' | 'missing' | 'unavailable'
  requested_enabled: number
  migration_state: string
  created_at: string
  updated_at: string
}

const MANAGED_CHANNEL_SQL = managedChannelSql()

/** Safe projections only: provider keys, cipher material, refs and session IDs never leave this repository. */
export class ChannelManagementQueryRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  get(id: string): ChannelManagementSafeView | null {
    const row = this.database.connection.prepare(
      `select id, type, name, agent_id, credential_revision, credential_health, requested_enabled, migration_state, created_at, updated_at
       from agent_channels where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state <> 'legacy'
         and not exists (select 1 from channel_management_tombstones where channel_id = agent_channels.id)`
    ).get(id) as ChannelRow | undefined
    return row ? toSafeView(row) : null
  }

  list(): ChannelManagementSafeView[] {
    return (this.database.connection.prepare(
      `select id, type, name, agent_id, credential_revision, credential_health, requested_enabled, migration_state, created_at, updated_at
       from agent_channels where ${MANAGED_CHANNEL_SQL} and migration_state <> 'legacy'
         and not exists (select 1 from channel_management_tombstones where channel_id = agent_channels.id)
       order by updated_at desc, id asc`
    ).all() as ChannelRow[]).map(toSafeView)
  }

  audits(channelId: string, limit: number, offset: number): ChannelManagementAuditView[] {
    return (this.database.connection.prepare(
      `select id, channel_id, actor_id, action, code, created_at from channel_management_audits
       where channel_id = ? order by created_at desc, id desc limit ? offset ?`
    ).all(channelId, limit, offset) as Array<{ id: string; channel_id: string; actor_id: string; action: string; code: string | null; created_at: string }>).map((row) => ({
      id: row.id, channelId: row.channel_id, actorId: row.actor_id, action: row.action, code: row.code, createdAt: row.created_at
    }))
  }

  runtime(channelId: string): ChannelRuntimeSafeView {
    const row = this.database.connection.prepare(
      `select generation, lifecycle_state, updated_at from channel_runtime_generations where channel_id = ?`
    ).get(channelId) as { generation: number; lifecycle_state: 'active' | 'inactive' | 'deleted'; updated_at: string } | undefined
    return row
      ? { channelId, generation: row.generation, lifecycle: row.lifecycle_state, updatedAt: row.updated_at }
      : { channelId, generation: 0, lifecycle: 'missing', updatedAt: null }
  }

  /**
   * One row per channel/conversation binding. Channels without conversations still produce one row
   * with a null session so the settings surface can render them.
   */
  runtimeRows(): Array<{
    channelId: string
    type: ChannelRow['type']
    agentId: string
    requestedEnabled: boolean
    migrationState: string
    generation: number
    lifecycleState: 'active' | 'inactive' | 'deleted' | null
    sessionId: string | null
  }> {
    const rows = this.database.connection.prepare(
      `select c.id, c.type, c.agent_id, c.requested_enabled, c.migration_state,
              g.generation, g.lifecycle_state, v.agent_session_id
       from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       left join channel_conversations v on v.channel_id = c.id
       where ${MANAGED_CHANNEL_SQL} and c.migration_state <> 'legacy'
         and not exists (select 1 from channel_management_tombstones t where t.channel_id = c.id)
       order by c.updated_at desc, c.id asc, v.created_at asc`
    ).all() as Array<{
      id: string
      type: ChannelRow['type']
      agent_id: string
      requested_enabled: number
      migration_state: string
      generation: number | null
      lifecycle_state: 'active' | 'inactive' | 'deleted' | null
      agent_session_id: string | null
    }>
    return rows.map((row) => ({
      channelId: row.id,
      type: row.type,
      agentId: row.agent_id,
      requestedEnabled: row.requested_enabled === 1,
      migrationState: row.migration_state,
      generation: row.generation ?? 0,
      lifecycleState: row.lifecycle_state,
      sessionId: row.agent_session_id
    }))
  }

  deliveryAttempts(channelId: string, limit: number, offset: number): ChannelDeliveryAttemptSafeView[] {
    return (this.database.connection.prepare(
      `select id, source_type, status, stable_error_code, created_at, updated_at, completed_at
       from channel_delivery_attempts where channel_id = ? and exists (
         select 1 from agent_channels where id = channel_delivery_attempts.channel_id
           and ${MANAGED_CHANNEL_SQL} and type <> 'wechat'
       ) order by created_at desc, id desc limit ? offset ?`
    ).all(channelId, limit, offset) as Array<{
      id: string; source_type: ChannelDeliveryAttemptSafeView['source']; status: ChannelDeliveryAttemptSafeView['status']; stable_error_code: string | null
      created_at: string; updated_at: string; completed_at: string | null
    }>).map((row) => ({
      id: row.id, source: row.source_type, status: row.status, code: row.stable_error_code,
      createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
    }))
  }

  deliveryAudits(channelId: string, limit: number, offset: number): ChannelDeliveryAuditSafeView[] {
    return (this.database.connection.prepare(
      `select id, attempt_id, code, created_at from channel_delivery_audits
       where channel_id = ? and exists (
         select 1 from agent_channels where id = channel_delivery_audits.channel_id
           and ${MANAGED_CHANNEL_SQL} and type <> 'wechat'
       ) order by created_at desc, id desc limit ? offset ?`
    ).all(channelId, limit, offset) as Array<{ id: string; attempt_id: string | null; code: string; created_at: string }>).map((row) => ({
      id: row.id, attemptId: row.attempt_id, code: row.code, createdAt: row.created_at
    }))
  }

  conversations(channelId: string, limit: number): ChannelConversationSafeView[] {
    return (this.database.connection.prepare(
      `select c.id, c.conversation_kind, c.agent_session_id, c.created_at, coalesce(t.enabled, 0) as target_enabled
       from channel_conversations c left join channel_delivery_targets t on t.conversation_id = c.id and t.channel_id = c.channel_id
       where c.channel_id = ? and exists (
         select 1 from agent_channels where id = c.channel_id and ${MANAGED_CHANNEL_SQL} and type <> 'wechat'
       ) order by c.created_at desc, c.id desc limit ?`
    ).all(channelId, limit) as Array<{
      id: string; conversation_kind: ChannelConversationSafeView['kind']; agent_session_id: string | null; target_enabled: number; created_at: string
    }>).map((row) => ({
      id: row.id, kind: row.conversation_kind, hasBoundSession: Boolean(row.agent_session_id), targetEnabled: Boolean(row.target_enabled), createdAt: row.created_at
    }))
  }

  policies(channelId: string, limit: number): ChannelPolicySafeView[] {
    return (this.database.connection.prepare(
      `select id, subject_type, conversation_kind, created_at from channel_allow_policies
       where channel_id = ? and exists (
         select 1 from agent_channels where id = channel_allow_policies.channel_id
           and ${MANAGED_CHANNEL_SQL} and type <> 'wechat'
       ) order by created_at desc, id desc limit ?`
    ).all(channelId, limit) as Array<{
      id: string; subject_type: ChannelPolicySafeView['subjectType']; conversation_kind: ChannelPolicySafeView['conversationKind']; created_at: string
    }>).map((row) => ({ id: row.id, subjectType: row.subject_type, conversationKind: row.conversation_kind, createdAt: row.created_at }))
  }
}

function toSafeView(row: ChannelRow): ChannelManagementSafeView {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    agentId: row.agent_id,
    requestedEnabled: Boolean(row.requested_enabled),
    state: normalizeState(row.migration_state),
    credential: {
      status: row.type === 'wechat' || row.credential_revision === null ? 'missing' : row.credential_health,
      hasCredential: row.type !== 'wechat' && row.credential_revision !== null && row.credential_health === 'configured',
      revision: row.type === 'wechat' ? null : row.credential_revision,
      maskedFields: row.type !== 'wechat' && row.credential_revision !== null && row.credential_health === 'configured'
        ? row.type === 'slack'
          ? { bot_token: '********', app_token: '********' }
          : row.type === 'feishu'
            ? { app_id: '********', app_secret: '********' }
            : row.type === 'qq'
              ? { app_id: '********', client_secret: '********' }
              : row.type === 'discord'
                ? { bot_token: '********' }
                : (row.type as string) === 'wechat'
                  ? {}
            : { bot_token: '********' }
        : {}
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizeState(value: string): ChannelManagementState {
  if (value === 'configuration-ready' || value === 'disabled' || value === 'deleting' || value === 'runtime-ready') return value
  return 'credential-missing'
}
