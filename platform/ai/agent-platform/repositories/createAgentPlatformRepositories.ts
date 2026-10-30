import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentChannelEntity } from '../schemas/channelSchemas'
import { stripQuietRuntimeControlParts } from '../schemas/messageDataHelpers'
import type { McpRuntimeStatus, McpServerEntity } from '../schemas/mcpServerSchemas'
import type {
  AgentSessionMessagesListQuery,
  AgentSessionEntity,
  AgentSessionMessageEntity,
  ListAgentSessionsQuery
} from '../schemas/sessionSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { ScheduledTaskEntity, TaskDeliveryAttemptEntity, TaskRunLogEntity } from '../schemas/taskSchemas'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type {
  AgentChannelTaskSubscription,
  AgentProductToolPackageBinding,
  AgentSessionPin,
  AgentSkillBinding
} from '../store/agentStore'
import type { ProductAgentToolCallTrace } from '../productTools/productAgentToolSchemas'
import type { McpToolsByServerId } from '../tools/agentToolCatalog'
import { normalizeSessionAllowedTools } from '../tools/sessionAllowedTools'
import type { CursorPaginationResponse } from '../store/agentStore'
import type { TaskMutationAuditEntity } from '../runtime/tasks/taskAutomationContracts'

type MessageSearchResult = {
  messageId: string
  sessionId: string
  role: AgentSessionMessageEntity['role']
  snippet: string
  createdAt: string
}

type PlatformStateCollectionsSnapshot = {
  mcpServers: McpServerEntity[]
  mcpToolsByServerId: McpToolsByServerId
  mcpRuntimeStatusByServerId: Record<string, McpRuntimeStatus>
  channels: AgentChannelEntity[]
  skills: InstalledSkill[]
  agentSkills: AgentSkillBinding[]
  agentProductToolPackages?: AgentProductToolPackageBinding[]
  tasks: ScheduledTaskEntity[]
  taskRunLogs: TaskRunLogEntity[]
  channelTaskSubscriptions: AgentChannelTaskSubscription[]
  activeAgentId: string | null
  activeSessionId: string | null
}

type ActiveSelectionSnapshot = {
  activeAgentId: string | null
  activeSessionId: string | null
}

const migratedPlatformStateEntryKeys = [
  'mcpServers',
  'mcpToolsByServerId',
  'mcpRuntimeStatusByServerId',
  'channels',
  'skills',
  'agentSkills',
  'tasks',
  'taskRunLogs',
  'channelTaskSubscriptions'
] as const

type AgentRepositoryListOptions = {
  search?: string
  limit?: number
  offset?: number
  sortBy?: 'orderKey' | 'createdAt' | 'updatedAt' | 'name'
  sortOrder?: 'asc' | 'desc'
}

type AgentEntityRow = {
  id: string
  type: AgentEntity['type']
  name: string
  description: string | null
  instructions: string | null
  model: string | null
  model_name: string | null
  plan_model: string | null
  small_model: string | null
  mcps_json: string
  disabled_tools_json: string
  configuration_json: string | null
  order_key: string
  created_at: string
  updated_at: string
}

type WorkspaceRow = {
  id: string
  name: string
  path: string
  type: AgentWorkspaceEntity['type']
  order_key: string
  created_at: string
  updated_at: string
}

type SessionRow = {
  id: string
  agent_id: string | null
  name: string
  description: string | null
  workspace_id: string
  trace_id: string | null
  order_key: string
  allowed_tools_json: string
  created_at: string
  updated_at: string
}

type MessageRow = {
  id: string
  session_id: string
  role: AgentSessionMessageEntity['role']
  data_json: string
  searchable_text: string
  status: AgentSessionMessageEntity['status']
  model_id: string | null
  model_snapshot_json: string | null
  stats_json: string | null
  runtime_resume_token: string | null
  created_at: string
  updated_at: string
}

type TaskRow = {
  id: string
  agent_id: string
  name: string
  prompt: string
  trigger_json: string
  catch_up_policy_json: string | null
  timeout_minutes: number
  workspace_json: string
  channel_ids_json: string | null
  next_run: string | null
  last_run: string | null
  enabled: number
  status: ScheduledTaskEntity['status']
  revision: number | null
  pause_reason: ScheduledTaskEntity['pauseReason'] | null
  failure_reset_at: string | null
  provenance_json: string | null
  created_at: string
  updated_at: string
}

type TaskRunLogRow = {
  id: string
  schedule_id: string
  session_id: string | null
  started_at: string
  duration_ms: number
  status: TaskRunLogEntity['status']
  result: string | null
  error: string | null
  agent_id: string | null
  task_name_snapshot: string | null
  terminal_reason: TaskRunLogEntity['terminalReason']
  result_preview: string | null
  result_hash: string | null
  result_char_count: number | null
  usage_json: string | null
  delivery_summary_json: string | null
}

type TaskDeliveryAttemptRow = {
  id: string
  run_log_id: string
  task_id: string
  agent_id: string
  task_name_snapshot: string
  channel_id: string
  target_hash: string | null
  status: TaskDeliveryAttemptEntity['status']
  attempt_number: number
  started_at: string
  completed_at: string | null
  error_code: string | null
}

type TaskMutationAuditRow = {
  id: string
  task_id: string | null
  agent_id: string
  task_name_snapshot: string | null
  action: TaskMutationAuditEntity['action']
  actor_json: string
  request_hash: string
  result_revision: number | null
  created_at: string
  outcome: TaskMutationAuditEntity['outcome']
  error_code: string | null
}

type ChannelRow = {
  id: string
  type: AgentChannelEntity['type']
  name: string
  agent_id: string | null
  session_id: string | null
  workspace_json: string
  config_json: string
  is_active: number
  active_chat_ids_json: string | null
  permission_mode: string | null
  created_at: string
  updated_at: string
}

type ChannelTaskSubscriptionRow = {
  channel_id: string
  task_id: string
}

type McpServerRow = {
  id: string
  name: string
  type: McpServerEntity['type'] | null
  is_active: number
  sort_order: number | null
  install_source: McpServerEntity['installSource'] | null
  metadata_json: string
  created_at: string | null
  updated_at: string | null
}

type McpToolRow = {
  server_id: string
  tool_id: string
  name: string
  description: string | null
  input_schema_json: string | null
  sort_index: number
}

type McpRuntimeStatusRow = {
  server_id: string
  state: McpRuntimeStatus['state']
  message: string | null
  last_checked_at: number
}

type SkillRow = {
  id: string
  name: string
  description: string | null
  folder_name: string
  source: string
  source_url: string | null
  namespace: string | null
  author: string | null
  source_tags_json: string
  content_hash: string
  is_enabled: number
  sort_index: number
  created_at: string
  updated_at: string
}

type AgentSkillBindingRow = {
  agent_id: string
  skill_id: string
  is_enabled: number
}

export function createAgentPlatformRepositories(database: AgentPlatformDatabase) {
  const db = database.connection

  const agents = {
    replaceAll(entities: readonly AgentEntity[]): void {
      database.transact(() => {
        db.prepare('delete from agent_entities').run()
        for (const entity of entities) {
          agents.upsert(entity)
        }
      })
    },
    upsert(entity: AgentEntity): void {
      db.prepare(
        `insert into agent_entities (
          id, type, name, description, instructions, model, model_name, plan_model, small_model,
          mcps_json, disabled_tools_json, configuration_json, order_key, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          type = excluded.type,
          name = excluded.name,
          description = excluded.description,
          instructions = excluded.instructions,
          model = excluded.model,
          model_name = excluded.model_name,
          plan_model = excluded.plan_model,
          small_model = excluded.small_model,
          mcps_json = excluded.mcps_json,
          disabled_tools_json = excluded.disabled_tools_json,
          configuration_json = excluded.configuration_json,
          order_key = excluded.order_key,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      ).run(
        entity.id,
        entity.type,
        entity.name,
        entity.description ?? null,
        entity.instructions ?? null,
        entity.model ?? null,
        entity.modelName ?? null,
        entity.planModel ?? null,
        entity.smallModel ?? null,
        JSON.stringify(entity.mcps ?? []),
        JSON.stringify(entity.disabledTools ?? []),
        entity.configuration ? JSON.stringify(entity.configuration) : null,
        entity.orderKey,
        entity.createdAt,
        entity.updatedAt
      )
    },
    listAll(): AgentEntity[] {
      return db
        .prepare(
          `select
             id, type, name, description, instructions, model, model_name, plan_model, small_model,
             mcps_json, disabled_tools_json, configuration_json, order_key, created_at, updated_at
           from agent_entities
           order by order_key asc, id asc`
        )
        .all()
        .map((row) => mapAgentEntity(row as AgentEntityRow))
    },
    get(id: string): AgentEntity | null {
      const row = db
        .prepare(
          `select
             id, type, name, description, instructions, model, model_name, plan_model, small_model,
             mcps_json, disabled_tools_json, configuration_json, order_key, created_at, updated_at
           from agent_entities
           where id = ?`
        )
        .get(id) as AgentEntityRow | undefined
      return row ? mapAgentEntity(row) : null
    },
    list(options: AgentRepositoryListOptions = {}): { agents: AgentEntity[]; total: number } {
      const params: Array<string | number> = []
      const where: string[] = []
      const search = options.search?.trim().toLowerCase()
      if (search) {
        where.push("(lower(name) like ? escape '\\' or lower(coalesce(description, '')) like ? escape '\\')")
        const pattern = `%${escapeSqlLike(search)}%`
        params.push(pattern, pattern)
      }

      const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : ''
      const totalRow = db.prepare(`select count(*) as total from agent_entities ${whereSql}`).get(...params) as
        | { total?: number }
        | undefined
      const offset = Math.max(0, options.offset ?? 0)
      const limit = options.limit === undefined ? undefined : Math.max(0, options.limit)
      const orderBy = buildAgentOrderBy(options.sortBy, options.sortOrder)
      const rows = (
        limit === undefined
          ? db
              .prepare(
                `select
                   id, type, name, description, instructions, model, model_name, plan_model, small_model,
                   mcps_json, disabled_tools_json, configuration_json, order_key, created_at, updated_at
                 from agent_entities
                 ${whereSql}
                 order by ${orderBy}, id asc
                 limit -1 offset ?`
              )
              .all(...params, offset)
          : db
              .prepare(
                `select
                   id, type, name, description, instructions, model, model_name, plan_model, small_model,
                   mcps_json, disabled_tools_json, configuration_json, order_key, created_at, updated_at
                 from agent_entities
                 ${whereSql}
                 order by ${orderBy}, id asc
                 limit ? offset ?`
              )
              .all(...params, limit, offset)
      ) as AgentEntityRow[]
      return {
        agents: rows.map(mapAgentEntity),
        total: totalRow?.total ?? 0
      }
    }
  }

  const workspaces = {
    replaceAll(entities: readonly AgentWorkspaceEntity[]): void {
      database.transact(() => {
        db.prepare('delete from agent_workspaces').run()
        for (const entity of entities) {
          workspaces.upsert(entity)
        }
      })
    },
    upsert(entity: AgentWorkspaceEntity): void {
      db.prepare(
        `insert into agent_workspaces (id, name, path, type, order_key, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           name = excluded.name,
           path = excluded.path,
           type = excluded.type,
           order_key = excluded.order_key,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      ).run(entity.id, entity.name, entity.path, entity.type, entity.orderKey, entity.createdAt, entity.updatedAt)
    },
    listAll(): AgentWorkspaceEntity[] {
      return db
        .prepare(
          `select id, name, path, type, order_key, created_at, updated_at
           from agent_workspaces
           order by order_key asc, id asc`
        )
        .all()
        .map((row) => mapWorkspaceEntity(row as WorkspaceRow))
    },
    list(options: { includeSystem?: boolean } = {}): AgentWorkspaceEntity[] {
      return db
        .prepare(
          `select id, name, path, type, order_key, created_at, updated_at
           from agent_workspaces
           ${options.includeSystem ? '' : 'where type = ?'}
           order by order_key asc, id asc`
        )
        .all(...(options.includeSystem ? [] : ['user']))
        .map((row) => mapWorkspaceEntity(row as WorkspaceRow))
    },
    getById(id: string, options: { includeSystem?: boolean } = {}): AgentWorkspaceEntity | null {
      const row = db
        .prepare(
          `select id, name, path, type, order_key, created_at, updated_at
           from agent_workspaces
           where id = ?
           ${options.includeSystem ? '' : 'and type = ?'}`
        )
        .get(...(options.includeSystem ? [id] : [id, 'user'])) as WorkspaceRow | undefined
      return row ? mapWorkspaceEntity(row) : null
    },
    findByPath(path: string): AgentWorkspaceEntity | null {
      const row = db
        .prepare(
          `select id, name, path, type, order_key, created_at, updated_at
           from agent_workspaces
           where path = ?
           order by order_key asc, id asc
           limit 1`
        )
        .get(path) as WorkspaceRow | undefined
      return row ? mapWorkspaceEntity(row) : null
    }
  }

  const sessions = {
    replaceAll(entities: readonly AgentSessionEntity[]): void {
      database.transact(() => {
        db.prepare('delete from agent_sessions').run()
        for (const entity of entities) {
          sessions.upsert(entity)
        }
      })
    },
    upsert(entity: AgentSessionEntity): void {
      db.prepare(
        `insert into agent_sessions (id, agent_id, name, description, workspace_id, trace_id, order_key, allowed_tools_json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           agent_id = excluded.agent_id,
           name = excluded.name,
           description = excluded.description,
           workspace_id = excluded.workspace_id,
           trace_id = excluded.trace_id,
           order_key = excluded.order_key,
           allowed_tools_json = excluded.allowed_tools_json,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      ).run(
        entity.id,
        entity.agentId,
        entity.name,
        entity.description ?? null,
        entity.workspaceId,
        entity.traceId ?? null,
        entity.orderKey,
        JSON.stringify(normalizeSessionAllowedTools(entity.allowedTools)),
        entity.createdAt,
        entity.updatedAt
      )
    },
    listAll(workspacesById: ReadonlyMap<string, AgentWorkspaceEntity>): AgentSessionEntity[] {
      return db
        .prepare(
          `select id, agent_id, name, description, workspace_id, trace_id, order_key, allowed_tools_json, created_at, updated_at
           from agent_sessions
           order by order_key asc, id asc`
        )
        .all()
        .flatMap((row) => {
          const session = row as SessionRow
          const workspace = workspacesById.get(session.workspace_id)
          if (!workspace) return []
          return [mapSessionEntity(session, workspace)]
        })
    },
    listByCursor(query: ListAgentSessionsQuery = {}): CursorPaginationResponse<Pick<AgentSessionEntity, 'id'>> {
      const limit = Math.max(1, Math.min(query.limit ?? 50, 200))
      const cursor = decodeSessionCursor(query.cursor)
      const params: Array<string | null | number> = []
      const where: string[] = []

      if (query.agentId !== undefined) {
        where.push('agent_id = ?')
        params.push(query.agentId)
      }
      if (cursor) {
        if (cursor.kind === 'pin') {
          where.push(
            `(
              (p.session_id is not null and (p.sort_index > ? or (p.sort_index = ? and s.id > ?)))
              or p.session_id is null
            )`
          )
          params.push(cursor.pinIndex, cursor.pinIndex, cursor.id)
        } else {
          where.push(
            `(
              p.session_id is null
              and (s.order_key > ? or (s.order_key = ? and s.id > ?))
            )`
          )
          params.push(cursor.orderKey, cursor.orderKey, cursor.id)
        }
      }

      const rows = db
        .prepare(
          `select
             s.id,
             s.order_key,
             p.sort_index
           from agent_sessions s
           left join (
             select session_id, row_number() over (order by created_at asc, id asc) - 1 as sort_index
             from agent_session_pins
           ) p on p.session_id = s.id
           ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
           order by
             case when p.session_id is not null then 0 else 1 end asc,
             p.sort_index asc,
             s.order_key asc,
             s.id asc
           limit ?`
        )
        .all(...params, limit + 1) as Array<{ id: string; order_key: string; sort_index: number | null }>
      const items = rows.slice(0, limit).map((row) => ({ id: row.id }))
      const tail = rows[limit - 1]
      return {
        items,
        nextCursor:
          rows.length > limit && tail
            ? tail.sort_index === null
              ? encodeSessionCursor(tail.order_key, tail.id)
              : encodePinnedSessionCursor(tail.sort_index, tail.id)
            : undefined
      }
    }
  }

  const sessionPins = {
    replaceAll(pins: readonly AgentSessionPin[]): void {
      database.transact(() => {
        db.prepare('delete from agent_session_pins').run()
        const statement = db.prepare('insert into agent_session_pins (id, session_id, created_at) values (?, ?, ?)')
        for (const pin of pins) {
          statement.run(pin.id, pin.sessionId, pin.createdAt)
        }
      })
    },
    list(): AgentSessionPin[] {
      return db
        .prepare('select id, session_id, created_at from agent_session_pins order by created_at desc, id desc')
        .all()
        .map((row) => {
          const pin = row as { id: string; session_id: string; created_at: string }
          return {
            id: pin.id,
            sessionId: pin.session_id,
            createdAt: pin.created_at
          }
        })
    }
  }

  const messages = {
    replaceAll(entities: readonly AgentSessionMessageEntity[]): void {
      database.transact(() => {
        db.prepare('delete from agent_session_messages_fts').run()
        db.prepare('delete from agent_session_messages').run()
        for (const entity of entities) {
          messages.upsert(entity)
        }
      })
    },
    upsert(entity: AgentSessionMessageEntity): void {
      db.prepare(
        `insert into agent_session_messages (
          id, session_id, role, data_json, searchable_text, status, model_id, model_snapshot_json, stats_json,
          runtime_resume_token, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          session_id = excluded.session_id,
          role = excluded.role,
          data_json = excluded.data_json,
          searchable_text = excluded.searchable_text,
          status = excluded.status,
          model_id = excluded.model_id,
          model_snapshot_json = excluded.model_snapshot_json,
          stats_json = excluded.stats_json,
          runtime_resume_token = excluded.runtime_resume_token,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      ).run(
        entity.id,
        entity.sessionId,
        entity.role,
        JSON.stringify(entity.data),
        entity.searchableText,
        entity.status,
        entity.modelId ?? null,
        entity.modelSnapshot ? JSON.stringify(entity.modelSnapshot) : null,
        entity.stats ? JSON.stringify(entity.stats) : null,
        entity.runtimeResumeToken ?? null,
        entity.createdAt,
        entity.updatedAt
      )

      db.prepare('delete from agent_session_messages_fts where message_id = ?').run(entity.id)
      db.prepare('insert into agent_session_messages_fts (message_id, session_id, searchable_text) values (?, ?, ?)').run(
        entity.id,
        entity.sessionId,
        entity.searchableText
      )
    },
    listAll(): AgentSessionMessageEntity[] {
      return db
        .prepare(
          `select
             id, session_id, role, data_json, searchable_text, status, model_id, model_snapshot_json, stats_json,
             runtime_resume_token, created_at, updated_at
           from agent_session_messages
           order by created_at asc, id asc`
        )
        .all()
        .map((row) => mapMessageEntity(row as MessageRow))
    },
    listByCursor(sessionId: string, query: AgentSessionMessagesListQuery = {}): CursorPaginationResponse<Pick<AgentSessionMessageEntity, 'id'>> {
      const limit = Math.max(1, Math.min(query.limit ?? 50, 200))
      const cursor = decodeMessageCursor(query.cursor)
      const params: string[] = [sessionId]
      const where = ['session_id = ?']

      if (cursor) {
        where.push('(created_at < ? or (created_at = ? and id < ?))')
        params.push(cursor.createdAt, cursor.createdAt, cursor.id)
      }

      const rows = db
        .prepare(
          `select id, created_at
           from agent_session_messages
           where ${where.join(' and ')}
           order by created_at desc, id desc
           limit ?`
        )
        .all(...params, limit + 1) as Array<{ id: string; created_at: string }>
      const items = rows.slice(0, limit).map((row) => ({ id: row.id }))
      const tail = rows[limit - 1]
      return {
        items,
        nextCursor: rows.length > limit && tail ? encodeMessageCursor(tail.created_at, tail.id) : undefined
      }
    },
    search(query: {
      q: string
      limit?: number
      sessionId?: string
      cursor?: string
      createdAtFrom?: string
    }): { items: MessageSearchResult[]; nextCursor?: string } {
      const limit = Math.max(1, Math.min(query.limit ?? 50, 200))
      const cursor = decodeMessageCursor(query.cursor)
      const params: Array<string | number> = [query.q]
      const where = ['f.searchable_text match ?']
      if (query.sessionId) {
        where.push('m.session_id = ?')
        params.push(query.sessionId)
      }
      if (query.createdAtFrom) {
        where.push('m.created_at >= ?')
        params.push(query.createdAtFrom)
      }
      if (cursor) {
        where.push('(m.created_at < ? or (m.created_at = ? and m.id < ?))')
        params.push(cursor.createdAt, cursor.createdAt, cursor.id)
      }

      const rows = db
        .prepare(
          `select m.id as message_id, m.session_id, m.role, m.searchable_text, m.created_at
           from agent_session_messages_fts f
           join agent_session_messages m on m.id = f.message_id
           where ${where.join(' and ')}
           order by m.created_at desc, m.id desc
           limit ?`
        )
        .all(...params, limit + 1) as Array<{
          message_id: string
          session_id: string
          role: AgentSessionMessageEntity['role']
          searchable_text: string
          created_at: string
        }>

      const items = rows.slice(0, limit)
      const tail = items[limit - 1]
      return {
        items: items.map((row) => ({
          messageId: row.message_id,
          sessionId: row.session_id,
          role: row.role,
          snippet: row.searchable_text,
          createdAt: row.created_at
        })),
        nextCursor: rows.length > limit && tail ? encodeMessageCursor(tail.created_at, tail.message_id) : undefined
      }
    }
  }

  const mcpServers = {
    replaceAll(entities: readonly McpServerEntity[]): void {
      database.transact(() => {
        db.prepare('delete from agent_mcp_runtime_status').run()
        db.prepare('delete from agent_mcp_tools').run()
        db.prepare('delete from agent_mcp_servers').run()
        for (const entity of entities) {
          mcpServers.upsert(entity)
        }
      })
    },
    upsert(entity: McpServerEntity): void {
      db.prepare(
        `insert into agent_mcp_servers (
          id, name, type, is_active, sort_order, install_source, metadata_json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          type = excluded.type,
          is_active = excluded.is_active,
          sort_order = excluded.sort_order,
          install_source = excluded.install_source,
          metadata_json = excluded.metadata_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      ).run(
        entity.id,
        entity.name,
        entity.type ?? null,
        entity.isActive ? 1 : 0,
        entity.sortOrder ?? null,
        entity.installSource ?? null,
        JSON.stringify(entity),
        entity.createdAt ?? null,
        entity.updatedAt ?? null
      )
    },
    listAll(): McpServerEntity[] {
      return db
        .prepare(
          `select id, name, type, is_active, sort_order, install_source, metadata_json, created_at, updated_at
           from agent_mcp_servers
           order by coalesce(sort_order, 0) asc, name asc, id asc`
        )
        .all()
        .map((row) => mapMcpServerEntity(row as McpServerRow))
    },
    delete(serverId: string): void {
      db.prepare('delete from agent_mcp_servers where id = ?').run(serverId)
    }
  }

  const mcpTools = {
    replaceAll(toolsByServerId: McpToolsByServerId): void {
      database.transact(() => {
        db.prepare('delete from agent_mcp_tools').run()
        for (const [serverId, tools] of Object.entries(toolsByServerId)) {
          mcpTools.replaceForServer(serverId, tools)
        }
      })
    },
    replaceForServer(serverId: string, tools: ReadonlyArray<McpToolsByServerId[string][number]>): void {
      database.transact(() => {
        db.prepare('delete from agent_mcp_tools where server_id = ?').run(serverId)
        if (!hasMcpServer(db, serverId)) return
        const statement = db.prepare(
          `insert into agent_mcp_tools (server_id, tool_id, name, description, input_schema_json, sort_index)
           values (?, ?, ?, ?, ?, ?)
           on conflict(server_id, tool_id) do update set
             name = excluded.name,
             description = excluded.description,
             input_schema_json = excluded.input_schema_json,
             sort_index = excluded.sort_index`
        )
        tools.forEach((tool, index) => {
          const toolId = tool.id?.trim() || tool.name
          statement.run(
            serverId,
            toolId,
            tool.name,
            tool.description ?? null,
            tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
            index
          )
        })
      })
    },
    listAll(): McpToolsByServerId {
      const rows = db
        .prepare(
          `select server_id, tool_id, name, description, input_schema_json, sort_index
           from agent_mcp_tools
           order by server_id asc, sort_index asc, tool_id asc`
        )
        .all() as McpToolRow[]
      const toolsByServerId: McpToolsByServerId = {}
      for (const row of rows) {
        toolsByServerId[row.server_id] = [...(toolsByServerId[row.server_id] ?? []), mapMcpTool(row)]
      }
      return toolsByServerId
    }
  }

  const mcpRuntimeStatus = {
    replaceAll(statusByServerId: Record<string, McpRuntimeStatus>): void {
      database.transact(() => {
        db.prepare('delete from agent_mcp_runtime_status').run()
        for (const [serverId, status] of Object.entries(statusByServerId)) {
          mcpRuntimeStatus.set(serverId, status)
        }
      })
    },
    set(serverId: string, status: McpRuntimeStatus): void {
      if (!hasMcpServer(db, serverId)) return
      db.prepare(
        `insert into agent_mcp_runtime_status (server_id, state, message, last_checked_at)
         values (?, ?, ?, ?)
         on conflict(server_id) do update set
           state = excluded.state,
           message = excluded.message,
           last_checked_at = excluded.last_checked_at`
      ).run(serverId, status.state, status.message ?? null, status.lastCheckedAt)
    },
    listAll(): Record<string, McpRuntimeStatus> {
      const rows = db
        .prepare(
          `select server_id, state, message, last_checked_at
           from agent_mcp_runtime_status
           order by server_id asc`
        )
        .all() as McpRuntimeStatusRow[]
      return Object.fromEntries(rows.map((row) => [row.server_id, mapMcpRuntimeStatus(row)]))
    }
  }

  const skills = {
    replaceAll(entities: readonly InstalledSkill[]): void {
      database.transact(() => {
        db.prepare('delete from agent_skills').run()
        for (const [index, entity] of entities.entries()) {
          skills.upsert(entity, { sortIndex: index })
        }
      })
    },
    upsert(entity: InstalledSkill, options: { sortIndex?: number } = {}): void {
      db.prepare(
        `insert into agent_skills (
          id, name, description, folder_name, source, source_url, namespace, author,
          source_tags_json, content_hash, is_enabled, sort_index, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          description = excluded.description,
          folder_name = excluded.folder_name,
          source = excluded.source,
          source_url = excluded.source_url,
          namespace = excluded.namespace,
          author = excluded.author,
          source_tags_json = excluded.source_tags_json,
          content_hash = excluded.content_hash,
          is_enabled = excluded.is_enabled,
          sort_index = excluded.sort_index,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      ).run(
        entity.id,
        entity.name,
        entity.description ?? null,
        entity.folderName,
        entity.source,
        entity.sourceUrl ?? null,
        entity.namespace ?? null,
        entity.author ?? null,
        JSON.stringify(entity.sourceTags ?? []),
        entity.contentHash,
        entity.isEnabled ? 1 : 0,
        resolveSkillSortIndex(db, entity.id, options.sortIndex),
        entity.createdAt,
        entity.updatedAt
      )
    },
    listAll(): InstalledSkill[] {
      return db
        .prepare(
          `select
             id, name, description, folder_name, source, source_url, namespace, author,
             source_tags_json, content_hash, is_enabled, sort_index, created_at, updated_at
           from agent_skills
           order by sort_index asc, id asc`
        )
        .all()
        .map((row) => mapInstalledSkill(row as SkillRow))
    },
    list(query: { agentId?: string; search?: string } = {}): InstalledSkill[] {
      const params: string[] = []
      const where: string[] = []
      const search = query.search?.trim().toLowerCase()
      if (search) {
        where.push(
          `(lower(name) like ? escape '\\'
            or lower(coalesce(description, '')) like ? escape '\\'
            or lower(folder_name) like ? escape '\\'
            or lower(source_tags_json) like ? escape '\\')`
        )
        const pattern = `%${escapeSqlLike(search)}%`
        params.push(pattern, pattern, pattern, pattern)
      }
      const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : ''
      const rows = db
        .prepare(
          `select
             id, name, description, folder_name, source, source_url, namespace, author,
             source_tags_json, content_hash, is_enabled, sort_index, created_at, updated_at
           from agent_skills
           ${whereSql}
           order by sort_index asc, id asc`
        )
        .all(...params)
        .map((row) => mapInstalledSkill(row as SkillRow))

      if (!query.agentId) return rows

      const enabledBySkillId = new Map(
        agentSkills.listByAgentId(query.agentId).map((binding) => [binding.skillId, binding.isEnabled])
      )
      return rows.map((skill) => ({
        ...skill,
        isEnabled: enabledBySkillId.get(skill.id) ?? false
      }))
    },
    get(id: string): InstalledSkill | null {
      const row = db
        .prepare(
          `select
             id, name, description, folder_name, source, source_url, namespace, author,
             source_tags_json, content_hash, is_enabled, sort_index, created_at, updated_at
           from agent_skills
           where id = ?`
        )
        .get(id) as SkillRow | undefined
      return row ? mapInstalledSkill(row) : null
    },
    getByFolderName(folderName: string): InstalledSkill | null {
      const row = db
        .prepare(
          `select
             id, name, description, folder_name, source, source_url, namespace, author,
             source_tags_json, content_hash, is_enabled, sort_index, created_at, updated_at
           from agent_skills
           where folder_name = ?`
        )
        .get(folderName) as SkillRow | undefined
      return row ? mapInstalledSkill(row) : null
    },
    delete(id: string): void {
      db.prepare('delete from agent_skills where id = ?').run(id)
    }
  }

  const agentSkills = {
    replaceAll(bindings: readonly AgentSkillBinding[]): void {
      database.transact(() => {
        db.prepare('delete from agent_skill_bindings').run()
        for (const binding of bindings) {
          agentSkills.upsert(binding)
        }
      })
    },
    replaceForAgent(agentId: string, bindings: readonly AgentSkillBinding[]): void {
      database.transact(() => {
        db.prepare('delete from agent_skill_bindings where agent_id = ?').run(agentId)
        for (const binding of bindings) {
          if (binding.agentId === agentId) {
            agentSkills.upsert(binding)
          }
        }
      })
    },
    upsert(binding: AgentSkillBinding): void {
      if (!hasSkill(db, binding.skillId)) return
      db.prepare(
        `insert into agent_skill_bindings (agent_id, skill_id, is_enabled)
         values (?, ?, ?)
         on conflict(agent_id, skill_id) do update set
           is_enabled = excluded.is_enabled`
      ).run(binding.agentId, binding.skillId, binding.isEnabled ? 1 : 0)
    },
    listAll(): AgentSkillBinding[] {
      return db
        .prepare(
          `select agent_id, skill_id, is_enabled
           from agent_skill_bindings
           order by agent_id asc, skill_id asc`
        )
        .all()
        .map((row) => mapAgentSkillBinding(row as AgentSkillBindingRow))
    },
    listByAgentId(agentId: string): AgentSkillBinding[] {
      return db
        .prepare(
          `select agent_id, skill_id, is_enabled
           from agent_skill_bindings
           where agent_id = ?
           order by skill_id asc`
        )
        .all(agentId)
        .map((row) => mapAgentSkillBinding(row as AgentSkillBindingRow))
    }
  }

  const stateEntries = {
    get<T>(key: string): T | null {
      const row = db
        .prepare('select value_json from agent_platform_state_entries where key = ?')
        .get(key) as { value_json?: string } | undefined
      if (!row?.value_json) return null
      return JSON.parse(row.value_json) as T
    },
    set<T>(key: string, value: T): void {
      setStateEntry(db, key, value)
    },
    delete(key: string): void {
      db.prepare('delete from agent_platform_state_entries where key = ?').run(key)
    },
    replacePlatformStateCollections(input: PlatformStateCollectionsSnapshot): void {
      database.transact(() => {
        setStateEntry(db, 'agents', [])
        setStateEntry(db, 'sessions', [])
        setStateEntry(db, 'workspaces', [])
        setStateEntry(db, 'messages', [])
        setStateEntry(db, 'mcpServers', input.mcpServers)
        setStateEntry(db, 'mcpToolsByServerId', input.mcpToolsByServerId)
        setStateEntry(db, 'mcpRuntimeStatusByServerId', input.mcpRuntimeStatusByServerId)
        // C03 no longer accepts Channel entities in generic state snapshots.
        db.prepare("delete from agent_platform_state_entries where key = 'channels'").run()
        setStateEntry(db, 'skills', input.skills)
        setStateEntry(db, 'agentSkills', input.agentSkills)
        setStateEntry(db, 'tasks', input.tasks)
        setStateEntry(db, 'taskRunLogs', input.taskRunLogs)
        setStateEntry(db, 'channelTaskSubscriptions', input.channelTaskSubscriptions)
        setStateEntry(db, 'activeSelection', {
          activeAgentId: input.activeAgentId,
          activeSessionId: input.activeSessionId
        })
      })
    },
    clearMigratedPlatformStateCollections(): void {
      const statement = db.prepare('delete from agent_platform_state_entries where key = ?')
      for (const key of migratedPlatformStateEntryKeys) {
        statement.run(key)
      }
    }
  }

  const tasks = {
    replaceAll(entities: readonly ScheduledTaskEntity[]): void {
      database.transact(() => {
        db.prepare('delete from agent_tasks').run()
        for (const entity of entities) {
          tasks.upsert(entity)
        }
      })
    },
    upsert(entity: ScheduledTaskEntity): void {
      db.prepare(
        `insert into agent_tasks (
          id, agent_id, name, prompt, trigger_json, catch_up_policy_json, timeout_minutes, workspace_json,
          channel_ids_json, next_run, last_run, enabled, status, revision, pause_reason, failure_reset_at, provenance_json,
          created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          agent_id = excluded.agent_id,
          name = excluded.name,
          prompt = excluded.prompt,
          trigger_json = excluded.trigger_json,
          catch_up_policy_json = excluded.catch_up_policy_json,
          timeout_minutes = excluded.timeout_minutes,
          workspace_json = excluded.workspace_json,
          channel_ids_json = excluded.channel_ids_json,
          next_run = excluded.next_run,
          last_run = excluded.last_run,
          enabled = excluded.enabled,
          status = excluded.status,
          revision = excluded.revision,
          pause_reason = excluded.pause_reason,
          failure_reset_at = excluded.failure_reset_at,
          provenance_json = excluded.provenance_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      ).run(
        entity.id,
        entity.agentId,
        entity.name,
        entity.prompt,
        JSON.stringify(entity.trigger),
        entity.catchUpPolicy ? JSON.stringify(entity.catchUpPolicy) : null,
        entity.timeoutMinutes,
        JSON.stringify(entity.workspace),
        entity.channelIds ? JSON.stringify(entity.channelIds) : null,
        entity.nextRun ?? null,
        entity.lastRun ?? null,
        entity.enabled ? 1 : 0,
        entity.status,
        entity.revision ?? 1,
        entity.pauseReason ?? null,
        entity.failureResetAt ?? null,
        entity.provenance ? JSON.stringify(entity.provenance) : null,
        entity.createdAt,
        entity.updatedAt
      )
    },
    listAll(): ScheduledTaskEntity[] {
      return db
        .prepare(
          `select
             id, agent_id, name, prompt, trigger_json, catch_up_policy_json, timeout_minutes, workspace_json,
             channel_ids_json, next_run, last_run, enabled, status, revision, pause_reason, failure_reset_at, provenance_json,
             created_at, updated_at
           from agent_tasks
           order by created_at asc, id asc`
        )
        .all()
        .map((row) => mapTaskEntity(row as TaskRow))
    },
    get(id: string): ScheduledTaskEntity | null {
      const row = db
        .prepare(
          `select
             id, agent_id, name, prompt, trigger_json, catch_up_policy_json, timeout_minutes, workspace_json,
             channel_ids_json, next_run, last_run, enabled, status, revision, pause_reason, failure_reset_at, provenance_json,
             created_at, updated_at
           from agent_tasks
           where id = ?`
        )
        .get(id) as TaskRow | undefined
      return row ? mapTaskEntity(row) : null
    },
    list(
      agentId: string,
      options: { limit?: number; offset?: number; includeHeartbeat?: boolean } = {}
    ): { tasks: ScheduledTaskEntity[]; total: number } {
      const params: Array<string | number> = [agentId]
      const where = ['agent_id = ?']
      if (!options.includeHeartbeat) {
        where.push('name <> ?')
        params.push('heartbeat')
      }
      const whereSql = where.join(' and ')
      const totalRow = db
        .prepare(`select count(*) as total from agent_tasks where ${whereSql}`)
        .get(...params) as { total?: number } | undefined
      const offset = Math.max(0, options.offset ?? 0)
      const limit = options.limit === undefined ? undefined : Math.max(0, options.limit)
      const rows = (
        limit === undefined
          ? db
              .prepare(
                `select
                   id, agent_id, name, prompt, trigger_json, catch_up_policy_json, timeout_minutes, workspace_json,
                   channel_ids_json, next_run, last_run, enabled, status, revision, pause_reason, failure_reset_at, provenance_json,
                   created_at, updated_at
                 from agent_tasks
                 where ${whereSql}
                 order by created_at desc, id asc
                 limit -1 offset ?`
              )
              .all(...params, offset)
          : db
              .prepare(
                `select
                   id, agent_id, name, prompt, trigger_json, catch_up_policy_json, timeout_minutes, workspace_json,
                   channel_ids_json, next_run, last_run, enabled, status, revision, pause_reason, failure_reset_at, provenance_json,
                   created_at, updated_at
                 from agent_tasks
                 where ${whereSql}
                 order by created_at desc, id asc
                 limit ? offset ?`
              )
              .all(...params, limit, offset)
      ) as TaskRow[]
      return {
        tasks: rows.map(mapTaskEntity),
        total: totalRow?.total ?? 0
      }
    },
    listPage(options: {
      agentId?: string
      status?: ScheduledTaskEntity['status']
      cursor?: string
      limit?: number
    } = {}): { tasks: ScheduledTaskEntity[]; total: number; nextCursor?: string } {
      const filters: string[] = []
      const params: string[] = []
      if (options.agentId) {
        filters.push('agent_id = ?')
        params.push(options.agentId)
      }
      if (options.status) {
        filters.push('status = ?')
        params.push(options.status)
      }
      const filterWhereSql = filters.length > 0 ? `where ${filters.join(' and ')}` : ''
      const totalRow = db.prepare(`select count(*) as total from agent_tasks ${filterWhereSql}`).get(...params) as
        | { total?: number }
        | undefined
      const where = [...filters]
      const pageParams = [...params]
      const cursor = decodeTaskPageCursor(options.cursor)
      if (cursor) {
        if (cursor.nextRun === null) {
          where.push("next_run is null and (created_at < ? or (created_at = ? and id > ?))")
          pageParams.push(cursor.createdAt, cursor.createdAt, cursor.id)
        } else {
          where.push(
            "(next_run is null or next_run > ? or (next_run = ? and (created_at < ? or (created_at = ? and id > ?))))"
          )
          pageParams.push(cursor.nextRun, cursor.nextRun, cursor.createdAt, cursor.createdAt, cursor.id)
        }
      }
      const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : ''
      const { limit } = normalizePage(options)
      const rows = (db
        .prepare(
          `select
             id, agent_id, name, prompt, trigger_json, catch_up_policy_json, timeout_minutes, workspace_json,
             channel_ids_json, next_run, last_run, enabled, status, revision, pause_reason, failure_reset_at, provenance_json,
             created_at, updated_at
           from agent_tasks
           ${whereSql}
           order by next_run asc nulls last, created_at desc, id asc
           limit ?`
        )
        .all(...pageParams, limit + 1) as TaskRow[])
      const pageRows = rows.slice(0, limit)
      const tail = pageRows.at(-1)
      return {
        tasks: pageRows.map(mapTaskEntity),
        total: totalRow?.total ?? 0,
        nextCursor: rows.length > limit && tail ? encodeTaskPageCursor(tail.next_run, tail.created_at, tail.id) : undefined
      }
    },
    delete(id: string): void {
      database.transact(() => {
        db.prepare('delete from agent_channel_task_subscriptions where task_id = ?').run(id)
        db.prepare('delete from agent_tasks where id = ?').run(id)
      })
    }
  }

  const taskRunLogs = {
    replaceAll(entities: readonly TaskRunLogEntity[]): void {
      database.transact(() => {
        for (const entity of entities) {
          taskRunLogs.upsert(entity)
        }
      })
    },
    upsert(entity: TaskRunLogEntity): void {
      db.prepare(
        `insert into agent_task_run_logs (
          id, schedule_id, session_id, started_at, duration_ms, status, result, error,
          agent_id, task_name_snapshot, terminal_reason, result_preview, result_hash, result_char_count,
          usage_json, delivery_summary_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          schedule_id = agent_task_run_logs.schedule_id,
          session_id = excluded.session_id,
          started_at = excluded.started_at,
          duration_ms = excluded.duration_ms,
          status = excluded.status,
          result = excluded.result,
          error = excluded.error,
          agent_id = coalesce(agent_task_run_logs.agent_id, excluded.agent_id),
          task_name_snapshot = coalesce(agent_task_run_logs.task_name_snapshot, excluded.task_name_snapshot),
          terminal_reason = excluded.terminal_reason,
          result_preview = excluded.result_preview,
          result_hash = excluded.result_hash,
          result_char_count = excluded.result_char_count,
          usage_json = excluded.usage_json,
          delivery_summary_json = excluded.delivery_summary_json`
      ).run(
        entity.id,
        entity.scheduleId,
        entity.sessionId ?? null,
        entity.startedAt,
        entity.durationMs,
        entity.status,
        entity.result ?? null,
        entity.error ?? null,
        entity.agentId ?? null,
        entity.taskNameSnapshot ?? null,
        entity.terminalReason ?? null,
        entity.resultPreview ?? null,
        entity.resultHash ?? null,
        entity.resultCharCount ?? null,
        entity.usage ? JSON.stringify(entity.usage) : null,
        entity.deliverySummary ? JSON.stringify(entity.deliverySummary) : null
      )
    },
    get(id: string): TaskRunLogEntity | null {
      const row = db
        .prepare(
          `select id, schedule_id, session_id, started_at, duration_ms, status, result, error,
                  agent_id, task_name_snapshot, terminal_reason, result_preview, result_hash, result_char_count,
                  usage_json, delivery_summary_json
           from agent_task_run_logs
           where id = ?`
        )
        .get(id) as TaskRunLogRow | undefined
      return row ? mapTaskRunLogEntity(row) : null
    },
    getOwnerForTask(taskId: string): string | null {
      const row = db
        .prepare(`select count(*) as total, count(agent_id) as owned_total, count(distinct agent_id) as owner_count, min(agent_id) as owner_id
                  from agent_task_run_logs where schedule_id = ?`)
        .get(taskId) as { total: number; owned_total: number; owner_count: number; owner_id: string | null } | undefined
      return row && row.total > 0 && row.owned_total === row.total && row.owner_count === 1 ? row.owner_id : null
    },
    patch(id: string, patch: Partial<TaskRunLogEntity>): TaskRunLogEntity | null {
      const current = taskRunLogs.get(id)
      if (!current) return null
      taskRunLogs.upsert({ ...current, ...patch, id: current.id })
      return taskRunLogs.get(id)
    },
    listAll(): TaskRunLogEntity[] {
      return db
        .prepare(
          `select id, schedule_id, session_id, started_at, duration_ms, status, result, error,
                  agent_id, task_name_snapshot, terminal_reason, result_preview, result_hash, result_char_count,
                  usage_json, delivery_summary_json
           from agent_task_run_logs
           order by started_at asc, id asc`
        )
        .all()
        .map((row) => mapTaskRunLogEntity(row as TaskRunLogRow))
    },
    list(taskId: string, options: { limit?: number; offset?: number } = {}): { logs: TaskRunLogEntity[]; total: number } {
      const totalRow = db
        .prepare('select count(*) as total from agent_task_run_logs where schedule_id = ?')
        .get(taskId) as { total?: number } | undefined
      const { limit, offset } = normalizePage(options)
      const rows = db
        .prepare(
          `select id, schedule_id, session_id, started_at, duration_ms, status, result, error,
                  agent_id, task_name_snapshot, terminal_reason, result_preview, result_hash, result_char_count,
                  usage_json, delivery_summary_json
           from agent_task_run_logs
           where schedule_id = ?
           order by started_at desc, id asc
           limit ? offset ?`
        )
        .all(taskId, limit, offset) as TaskRunLogRow[]
      return {
        logs: rows.map(mapTaskRunLogEntity),
        total: totalRow?.total ?? 0
      }
    },
    replaceAllForTasks(taskIds: readonly string[], entities: readonly TaskRunLogEntity[]): void {
      if (taskIds.length === 0) return
      database.transact(() => {
        for (const entity of entities) {
          if (taskIds.includes(entity.scheduleId)) taskRunLogs.upsert(entity)
        }
      })
    },
    deleteOlderThan(cutoff: string, limit: number): { deletedRuns: number; deletedAttempts: number } {
      const batchLimit = Math.max(1, Math.min(limit, 500))
      return database.transact(() => {
        const ids = db.prepare(
          `select id from agent_task_run_logs
           where started_at < ?
           order by started_at asc, id asc
           limit ?`
        ).all(cutoff, batchLimit).map((row) => (row as { id: string }).id)
        if (ids.length === 0) return { deletedRuns: 0, deletedAttempts: 0 }
        const placeholders = ids.map(() => '?').join(', ')
        const deletedAttempts = Number(db.prepare(
          `delete from agent_task_delivery_attempts where run_log_id in (${placeholders})`
        ).run(...ids).changes)
        const deletedRuns = Number(db.prepare(
          `delete from agent_task_run_logs where id in (${placeholders})`
        ).run(...ids).changes)
        return { deletedRuns, deletedAttempts }
      })
    }
  }

  const taskDeliveryAttempts = {
    insertPending(entity: TaskDeliveryAttemptEntity): void {
      if (entity.status !== 'pending') {
        throw new Error('Task delivery attempts must be inserted as pending.')
      }
      db.prepare(
        `insert into agent_task_delivery_attempts (
          id, run_log_id, task_id, agent_id, task_name_snapshot, channel_id, target_hash, status,
          attempt_number, started_at, completed_at, error_code
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entity.id,
        entity.runLogId,
        entity.taskId,
        entity.agentId,
        entity.taskNameSnapshot,
        entity.channelId,
        entity.targetHash,
        entity.status,
        entity.attemptNumber,
        entity.startedAt,
        null,
        null
      )
    },
    get(runLogId: string, attemptId: string): TaskDeliveryAttemptEntity | null {
      const row = db
        .prepare(
          `select id, run_log_id, task_id, agent_id, task_name_snapshot, channel_id, target_hash, status,
                  attempt_number, started_at, completed_at, error_code
           from agent_task_delivery_attempts
           where run_log_id = ? and id = ?`
        )
        .get(runLogId, attemptId) as TaskDeliveryAttemptRow | undefined
      return row ? mapTaskDeliveryAttemptEntity(row) : null
    },
    summarizeByRun(runLogId: string): {
      delivered: number
      failed: number
      skipped: number
      unknown: number
    } {
      const row = db
        .prepare(
          `select
             coalesce(sum(case when status = 'delivered' then 1 else 0 end), 0) as delivered,
             coalesce(sum(case when status = 'failed' then 1 else 0 end), 0) as failed,
             coalesce(sum(case when status in ('skipped-channel-inactive', 'skipped-no-active-target') then 1 else 0 end), 0) as skipped,
             coalesce(sum(case when status = 'unknown-after-restart' then 1 else 0 end), 0) as unknown
           from agent_task_delivery_attempts
           where run_log_id = ?`
        )
        .get(runLogId) as Partial<{ delivered: number; failed: number; skipped: number; unknown: number }> | undefined
      return {
        delivered: row?.delivered ?? 0,
        failed: row?.failed ?? 0,
        skipped: row?.skipped ?? 0,
        unknown: row?.unknown ?? 0
      }
    },
    nextAttemptNumber(runLogId: string, channelId: string, targetHash: string | null): number {
      const row = db
        .prepare(
          `select coalesce(max(attempt_number), 0) + 1 as attempt_number
           from agent_task_delivery_attempts
           where run_log_id = ? and channel_id = ? and target_hash is ?`
        )
        .get(runLogId, channelId, targetHash) as { attempt_number?: number } | undefined
      return row?.attempt_number ?? 1
    },
    createPendingWithNextAttemptNumber(
      input: Omit<TaskDeliveryAttemptEntity, 'attemptNumber'>
    ): TaskDeliveryAttemptEntity {
      if (input.status !== 'pending') {
        throw new Error('Task delivery attempts must be inserted as pending.')
      }
      return database.transact(() => {
        const attempt: TaskDeliveryAttemptEntity = {
          ...input,
          attemptNumber: taskDeliveryAttempts.nextAttemptNumber(
            input.runLogId,
            input.channelId,
            input.targetHash
          )
        }
        taskDeliveryAttempts.insertPending(attempt)
        return attempt
      })
    },
    finalize(input: Pick<TaskDeliveryAttemptEntity, 'id' | 'status' | 'completedAt' | 'errorCode'>): boolean {
      if (input.status === 'pending' || input.status === 'unknown-after-restart') {
        throw new Error('Task delivery attempts can only finalize to a terminal delivery status.')
      }
      const result = db.prepare(
        `update agent_task_delivery_attempts
         set status = ?, completed_at = ?, error_code = ?
         where id = ? and status = 'pending'`
      ).run(input.status, input.completedAt ?? null, input.errorCode ?? null, input.id)
      return Number(result.changes) === 1
    },
    listByRun(runLogId: string, options: { limit?: number; offset?: number } = {}): { attempts: TaskDeliveryAttemptEntity[]; total: number } {
      const totalRow = db
        .prepare('select count(*) as total from agent_task_delivery_attempts where run_log_id = ?')
        .get(runLogId) as { total?: number } | undefined
      const { limit, offset } = normalizePage(options)
      const rows = db
        .prepare(
          `select id, run_log_id, task_id, agent_id, task_name_snapshot, channel_id, target_hash, status,
                  attempt_number, started_at, completed_at, error_code
           from agent_task_delivery_attempts
           where run_log_id = ?
           order by started_at desc, id asc
           limit ? offset ?`
        )
        .all(runLogId, limit, offset)
        .map((row) => mapTaskDeliveryAttemptEntity(row as TaskDeliveryAttemptRow))
      return { attempts: rows, total: totalRow?.total ?? 0 }
    },
    markStalePendingUnknown(cutoff: string): number {
      const result = db
        .prepare(
          `update agent_task_delivery_attempts
           set status = 'unknown-after-restart', completed_at = ?
           where status = 'pending' and started_at < ?`
        )
        .run(cutoff, cutoff)
      return Number(result.changes)
    },
    deleteOlderThan(cutoff: string, limit: number): number {
      const batchLimit = Math.max(1, Math.min(limit, 500))
      const ids = db.prepare(
        `select attempt.id from agent_task_delivery_attempts attempt
         join agent_task_run_logs run on run.id = attempt.run_log_id
         where run.started_at < ?
         order by run.started_at asc, attempt.id asc
         limit ?`
      ).all(cutoff, batchLimit).map((row) => (row as { id: string }).id)
      if (ids.length === 0) return 0
      const placeholders = ids.map(() => '?').join(', ')
      return Number(db.prepare(
        `delete from agent_task_delivery_attempts where id in (${placeholders})`
      ).run(...ids).changes)
    }
  }

  const taskMutationAudits = {
    insert(entity: TaskMutationAuditEntity): void {
      db.prepare(
        `insert into agent_task_mutation_audits (
          id, task_id, agent_id, task_name_snapshot, action, actor_json, request_hash,
          result_revision, created_at, outcome, error_code
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        entity.id,
        entity.taskId,
        entity.agentId,
        entity.taskNameSnapshot,
        entity.action,
        JSON.stringify(entity.actor),
        entity.requestHash,
        entity.resultRevision,
        entity.createdAt,
        entity.outcome,
        entity.errorCode
      )
    },
    listByTask(taskId: string, options: { limit?: number; offset?: number } = {}): { audits: TaskMutationAuditEntity[]; total: number } {
      return listTaskMutationAudits('task_id = ?', [taskId], options)
    },
    listByAgent(agentId: string, options: { limit?: number; offset?: number } = {}): { audits: TaskMutationAuditEntity[]; total: number } {
      return listTaskMutationAudits('agent_id = ?', [agentId], options)
    },
    deleteOlderThan(cutoff: string, limit: number): number {
      const batchLimit = Math.max(1, Math.min(limit, 500))
      const ids = db.prepare(
        `select id from agent_task_mutation_audits
         where created_at < ?
         order by created_at asc, id asc
         limit ?`
      ).all(cutoff, batchLimit).map((row) => (row as { id: string }).id)
      if (ids.length === 0) return 0
      const placeholders = ids.map(() => '?').join(', ')
      return Number(db.prepare(
        `delete from agent_task_mutation_audits where id in (${placeholders})`
      ).run(...ids).changes)
    }
  }

  const taskAutomationMaintenance = {
    get<T>(key: string): T | null {
      const row = db.prepare('select value_json from agent_task_automation_maintenance where key = ?').get(key) as
        | { value_json?: string }
        | undefined
      return row?.value_json ? (JSON.parse(row.value_json) as T) : null
    },
    set<T>(key: string, value: T, updatedAt: string): void {
      db.prepare(
        `insert into agent_task_automation_maintenance (key, value_json, updated_at)
         values (?, ?, ?)
         on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at`
      ).run(key, JSON.stringify(value), updatedAt)
    }
  }

  function listTaskMutationAudits(
    where: string,
    params: readonly string[],
    options: { limit?: number; offset?: number }
  ): { audits: TaskMutationAuditEntity[]; total: number } {
    const totalRow = db.prepare(`select count(*) as total from agent_task_mutation_audits where ${where}`).get(...params) as
      | { total?: number }
      | undefined
    const { limit, offset } = normalizePage(options)
    const audits = db
      .prepare(
        `select id, task_id, agent_id, task_name_snapshot, action, actor_json, request_hash,
                result_revision, created_at, outcome, error_code
         from agent_task_mutation_audits
         where ${where}
         order by created_at desc, id asc
         limit ? offset ?`
      )
      .all(...params, limit, offset)
      .map((row) => mapTaskMutationAuditEntity(row as TaskMutationAuditRow))
    return { audits, total: totalRow?.total ?? 0 }
  }

  const channels = {
    replaceAll(entities: readonly AgentChannelEntity[]): void {
      void entities
      throw new Error('channel-legacy-write-rejected')
    },
    upsert(entity: AgentChannelEntity): void {
      void entity
      throw new Error('channel-legacy-write-rejected')
    },
    listAll(): AgentChannelEntity[] {
      return db
        .prepare(
          `select
             id, case when adapter_key = 'lark' then 'feishu' else adapter_key end as type,
             name, agent_id, null as session_id, '{"type":"system"}' as workspace_json,
             public_config_json as config_json,
             case when lifecycle_state = 'enabled' then 1 else 0 end as is_active,
             null as active_chat_ids_json, null as permission_mode, created_at, updated_at
           from agent_channels
           where lifecycle_state = 'enabled'
           order by updated_at desc, id asc`
        )
        .all()
        .map((row) => mapChannelEntity(row as ChannelRow))
    },
    list(query: { agentId?: string; type?: AgentChannelEntity['type'] } = {}): AgentChannelEntity[] {
      const params: string[] = []
      const where: string[] = []
      if (query.agentId !== undefined) {
        where.push('agent_id = ?')
        params.push(query.agentId)
      }
      if (query.type !== undefined) {
        where.push('adapter_key = ?')
        params.push(query.type === 'feishu' ? 'lark' : query.type)
      }
      return db
        .prepare(
          `select
             id, case when adapter_key = 'lark' then 'feishu' else adapter_key end as type,
             name, agent_id, null as session_id, '{"type":"system"}' as workspace_json,
             public_config_json as config_json,
             case when lifecycle_state = 'enabled' then 1 else 0 end as is_active,
             null as active_chat_ids_json, null as permission_mode, created_at, updated_at
           from agent_channels
           ${where.length > 0 ? `where ${where.join(' and ')} and lifecycle_state = 'enabled'` : "where lifecycle_state = 'enabled'"}
           order by updated_at desc, id asc`
        )
        .all(...params)
        .map((row) => mapChannelEntity(row as ChannelRow))
    },
    findBySessionId(sessionId: string): AgentChannelEntity | null {
      const row = db
        .prepare(
          `select
             c.id, case when c.adapter_key = 'lark' then 'feishu' else c.adapter_key end as type,
             c.name, c.agent_id, null as session_id, '{"type":"system"}' as workspace_json,
             c.public_config_json as config_json,
             case when c.lifecycle_state = 'enabled' then 1 else 0 end as is_active,
             null as active_chat_ids_json, null as permission_mode, c.created_at, c.updated_at
           from agent_channels c
           join channel_conversations v on v.channel_id = c.id
           where v.agent_session_id = ? and c.lifecycle_state = 'enabled'
           order by c.updated_at desc, c.id asc
           limit 1`
        )
        .get(sessionId) as ChannelRow | undefined
      return row ? mapChannelEntity(row) : null
    },
    delete(id: string): void {
      database.transact(() => {
        const hasSubscription = db
          .prepare('select 1 from agent_channel_task_subscriptions where channel_id = ? limit 1')
          .get(id)
        const hasTaskReference = tasks.listAll().some((task) => task.channelIds?.includes(id))
        if (hasSubscription || hasTaskReference) {
          throw new Error(`channel-task-subscriptions-exist:${id}`)
        }
        db.prepare('delete from agent_channels where id = ?').run(id)
      })
    }
  }

  const channelTaskSubscriptions = {
    replaceAll(entities: readonly AgentChannelTaskSubscription[]): void {
      database.transact(() => {
        db.prepare('delete from agent_channel_task_subscriptions').run()
        for (const entity of entities) {
          channelTaskSubscriptions.upsert(entity)
        }
      })
    },
    upsert(entity: AgentChannelTaskSubscription): void {
      db.prepare(
        `insert into agent_channel_task_subscriptions (channel_id, task_id)
         values (?, ?)
         on conflict(channel_id, task_id) do nothing`
      ).run(entity.channelId, entity.taskId)
    },
    replaceForTask(taskId: string, channelIds: readonly string[]): void {
      database.transact(() => {
        db.prepare('delete from agent_channel_task_subscriptions where task_id = ?').run(taskId)
        for (const channelId of channelIds) {
          channelTaskSubscriptions.upsert({ channelId, taskId })
        }
      })
    },
    listAll(): AgentChannelTaskSubscription[] {
      return db
        .prepare(
          `select channel_id, task_id
           from agent_channel_task_subscriptions
           order by channel_id asc, task_id asc`
        )
        .all()
        .map((row) => mapChannelTaskSubscription(row as ChannelTaskSubscriptionRow))
    },
    listByTaskId(taskId: string): AgentChannelTaskSubscription[] {
      return db
        .prepare(
          `select channel_id, task_id
           from agent_channel_task_subscriptions
           where task_id = ?
           order by channel_id asc, task_id asc`
        )
        .all(taskId)
        .map((row) => mapChannelTaskSubscription(row as ChannelTaskSubscriptionRow))
    },
    listByChannelId(channelId: string): AgentChannelTaskSubscription[] {
      return db
        .prepare(
          `select channel_id, task_id
           from agent_channel_task_subscriptions
           where channel_id = ?
           order by channel_id asc, task_id asc`
        )
        .all(channelId)
        .map((row) => mapChannelTaskSubscription(row as ChannelTaskSubscriptionRow))
    }
  }

  const productToolPackageBindings = {
    replaceAll(bindings: readonly AgentProductToolPackageBinding[]): void {
      database.transact(() => {
        db.prepare('delete from agent_product_tool_package_bindings').run()
        for (const binding of bindings) {
          productToolPackageBindings.upsert(binding)
        }
      })
    },
    upsert(binding: AgentProductToolPackageBinding): void {
      db.prepare(
        `insert into agent_product_tool_package_bindings (
          agent_id, product_id, permission_mode, updated_at
        ) values (?, ?, ?, ?)
        on conflict(agent_id, product_id) do update set
          permission_mode = excluded.permission_mode,
          updated_at = excluded.updated_at`
      ).run(binding.agentId, binding.productId, binding.permissionMode, binding.updatedAt)
    },
    listAll(): AgentProductToolPackageBinding[] {
      return db
        .prepare(
          `select agent_id, product_id, permission_mode, updated_at
           from agent_product_tool_package_bindings
           order by agent_id asc, product_id asc`
        )
        .all()
        .map((row) => ({
          agentId: String((row as { agent_id: string }).agent_id),
          productId: String((row as { product_id: string }).product_id),
          permissionMode: (row as { permission_mode: AgentProductToolPackageBinding['permissionMode'] }).permission_mode,
          updatedAt: String((row as { updated_at: string }).updated_at)
        }))
    }
  }

  const productToolTraces = {
    insert(trace: ProductAgentToolCallTrace): void {
      db.prepare(
        `insert into agent_product_tool_call_traces (
          tool_call_id, product_id, tool_name, handler_id, schema_version, consumer_product_id,
          agent_id, agent_session_id, as_of, input_hash, output_hash, started_at, completed_at,
          duration_ms, status, error_code, result_size_bytes
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        trace.toolCallId,
        trace.productId,
        trace.toolName,
        trace.handlerId,
        trace.schemaVersion,
        trace.consumerProductId ?? null,
        trace.agentId,
        trace.agentSessionId,
        trace.asOf ?? null,
        trace.inputHash,
        trace.outputHash ?? null,
        trace.startedAt,
        trace.completedAt ?? null,
        trace.durationMs ?? null,
        trace.status,
        trace.errorCode ?? null,
        trace.resultSizeBytes ?? null
      )
    },
    finalize(trace: ProductAgentToolCallTrace): void {
      db.prepare(
        `update agent_product_tool_call_traces
         set output_hash = ?, completed_at = ?, duration_ms = ?, status = ?, error_code = ?, result_size_bytes = ?, as_of = ?
         where tool_call_id = ?`
      ).run(
        trace.outputHash ?? null,
        trace.completedAt ?? null,
        trace.durationMs ?? null,
        trace.status,
        trace.errorCode ?? null,
        trace.resultSizeBytes ?? null,
        trace.asOf ?? null,
        trace.toolCallId
      )
    },
    get(toolCallId: string): ProductAgentToolCallTrace | null {
      const row = db
        .prepare(
          `select tool_call_id, product_id, tool_name, handler_id, schema_version, consumer_product_id,
                  agent_id, agent_session_id, as_of, input_hash, output_hash, started_at, completed_at,
                  duration_ms, status, error_code, result_size_bytes
           from agent_product_tool_call_traces
           where tool_call_id = ?`
        )
        .get(toolCallId) as Record<string, unknown> | undefined
      return row ? mapProductToolTraceRow(row) : null
    },
    listPage(query: {
      agentSessionId?: string
      productId?: string
      consumerProductId?: string
      cursor?: string
      limit?: number
    }): { items: ProductAgentToolCallTrace[]; nextCursor?: string } {
      const params: unknown[] = []
      const where: string[] = []
      if (query.agentSessionId) {
        where.push('agent_session_id = ?')
        params.push(query.agentSessionId)
      }
      if (query.productId) {
        where.push('product_id = ?')
        params.push(query.productId)
      }
      if (query.consumerProductId) {
        where.push('consumer_product_id = ?')
        params.push(query.consumerProductId)
      }
      const limit = Math.max(1, Math.min(query.limit ?? 50, 200))
      if (query.cursor) {
        where.push('started_at < (select started_at from agent_product_tool_call_traces where tool_call_id = ?)')
        params.push(query.cursor)
      }
      const whereClause = where.length > 0 ? `where ${where.join(' and ')}` : ''
      const queryParams = [...params, limit + 1] as Array<string | number>
      const rows = db
        .prepare(
          `select tool_call_id, product_id, tool_name, handler_id, schema_version, consumer_product_id,
                  agent_id, agent_session_id, as_of, input_hash, output_hash, started_at, completed_at,
                  duration_ms, status, error_code, result_size_bytes
           from agent_product_tool_call_traces
           ${whereClause}
           order by started_at desc, tool_call_id desc
           limit ?`
        )
        .all(...queryParams) as Record<string, unknown>[]
      const items = rows.slice(0, limit).map((row) => mapProductToolTraceRow(row))
      const nextCursor = rows.length > limit ? items.at(-1)?.toolCallId : undefined
      return { items, nextCursor }
    }
  }

  const activeSelection = {
    get(): ActiveSelectionSnapshot | null {
      const row = db.prepare('select active_agent_id, active_session_id from agent_active_selection where id = 1').get() as
        | { active_agent_id: string | null; active_session_id: string | null }
        | undefined
      if (!row) return null
      return {
        activeAgentId: row.active_agent_id,
        activeSessionId: row.active_session_id
      }
    },
    set(selection: ActiveSelectionSnapshot): void {
      db.prepare(
        `insert into agent_active_selection (id, active_agent_id, active_session_id, updated_at)
         values (1, ?, ?, ?)
         on conflict(id) do update set
           active_agent_id = excluded.active_agent_id,
           active_session_id = excluded.active_session_id,
           updated_at = excluded.updated_at`
      ).run(selection.activeAgentId, selection.activeSessionId, new Date().toISOString())
    }
  }

  return {
    agents,
    workspaces,
    sessions,
    sessionPins,
    messages,
    mcpServers,
    mcpTools,
    mcpRuntimeStatus,
    skills,
    agentSkills,
    productToolPackageBindings,
    productToolTraces,
    tasks,
    taskRunLogs,
    taskDeliveryAttempts,
    taskMutationAudits,
    taskAutomationMaintenance,
    channels,
    channelTaskSubscriptions,
    activeSelection,
    stateEntries,
    replaceAllState(
      input: {
        agents: AgentEntity[]
        workspaces: AgentWorkspaceEntity[]
        sessions: AgentSessionEntity[]
        sessionPins: AgentSessionPin[]
        messages: AgentSessionMessageEntity[]
        platformStateCollections: PlatformStateCollectionsSnapshot
      },
      options: { skipSkillRows?: boolean; writeTaskDefinitions?: boolean; writeTaskRunLogs?: boolean; writeChannels?: boolean } = {}
    ): void {
      if (options.writeChannels) throw new Error('channel-legacy-write-rejected')
      database.transact(() => {
        db.prepare('delete from agent_session_pins').run()
        db.prepare('delete from agent_session_messages_fts').run()
        db.prepare('delete from agent_session_messages').run()
        db.prepare('delete from agent_sessions').run()
        db.prepare('delete from agent_workspaces').run()
        db.prepare('delete from agent_entities').run()
        db.prepare('delete from agent_mcp_runtime_status').run()
        db.prepare('delete from agent_mcp_tools').run()
        db.prepare('delete from agent_mcp_servers').run()
        if (!options.skipSkillRows) {
          db.prepare('delete from agent_skill_bindings').run()
          db.prepare('delete from agent_skills').run()
        }
        if (options.writeTaskDefinitions) {
          db.prepare('delete from agent_tasks').run()
          db.prepare('delete from agent_channel_task_subscriptions').run()
        }

        for (const entity of input.agents) agents.upsert(entity)
        for (const entity of input.workspaces) workspaces.upsert(entity)
        for (const entity of input.sessions) sessions.upsert(entity)
        for (const entity of input.messages) messages.upsert(entity)
        for (const entity of input.platformStateCollections.mcpServers) mcpServers.upsert(entity)
        for (const [serverId, tools] of Object.entries(input.platformStateCollections.mcpToolsByServerId)) {
          mcpTools.replaceForServer(serverId, tools)
        }
        for (const [serverId, status] of Object.entries(input.platformStateCollections.mcpRuntimeStatusByServerId)) {
          mcpRuntimeStatus.set(serverId, status)
        }
        if (!options.skipSkillRows) {
          for (const [index, entity] of input.platformStateCollections.skills.entries()) {
            skills.upsert(entity, { sortIndex: index })
          }
          for (const binding of input.platformStateCollections.agentSkills) {
            agentSkills.upsert(binding)
          }
        }
        productToolPackageBindings.replaceAll(input.platformStateCollections.agentProductToolPackages ?? [])
        if (options.writeTaskDefinitions) {
          for (const entity of input.platformStateCollections.tasks) tasks.upsert(entity)
        }
        if (options.writeTaskRunLogs) {
          for (const entity of input.platformStateCollections.taskRunLogs) taskRunLogs.upsert(entity)
        }
        if (options.writeTaskDefinitions) {
          for (const entity of input.platformStateCollections.channelTaskSubscriptions) {
            channelTaskSubscriptions.upsert(entity)
          }
        }
        activeSelection.set({
          activeAgentId: input.platformStateCollections.activeAgentId,
          activeSessionId: input.platformStateCollections.activeSessionId
        })

        const sessionPinStatement = db.prepare(
          'insert into agent_session_pins (id, session_id, created_at) values (?, ?, ?)'
        )
        for (const pin of input.sessionPins) {
          sessionPinStatement.run(pin.id, pin.sessionId, pin.createdAt)
        }

        stateEntries.clearMigratedPlatformStateCollections()
        stateEntries.set('activeSelection', {
          activeAgentId: input.platformStateCollections.activeAgentId,
          activeSessionId: input.platformStateCollections.activeSessionId
        })
      })
    }
  }
}

function encodeSessionCursor(orderKey: string, id: string): string {
  return `${orderKey}:${id}`
}

function encodePinnedSessionCursor(pinIndex: number, id: string): string {
  return `pin:${String(pinIndex).padStart(6, '0')}:${id}`
}

function decodeSessionCursor(raw: string | undefined):
  | { kind: 'pin'; pinIndex: number; id: string }
  | { kind: 'session'; orderKey: string; id: string }
  | null {
  if (!raw) return null
  const separatorIndex = raw.lastIndexOf(':')
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return null
  const key = raw.slice(0, separatorIndex)
  const id = raw.slice(separatorIndex + 1)
  if (key.startsWith('pin:')) {
    const pinIndex = Number(key.slice('pin:'.length))
    return Number.isFinite(pinIndex) ? { kind: 'pin', pinIndex, id } : null
  }
  return { kind: 'session', orderKey: key, id }
}

function encodeMessageCursor(createdAt: string, id: string): string {
  return `${messageCreatedAtMs(createdAt)}:${id}`
}

function decodeMessageCursor(raw: string | undefined): { createdAt: string; id: string } | null {
  if (!raw) return null
  const separatorIndex = raw.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return null
  const createdAtMs = Number(raw.slice(0, separatorIndex))
  if (!Number.isFinite(createdAtMs)) return null
  return {
    createdAt: new Date(createdAtMs).toISOString(),
    id: raw.slice(separatorIndex + 1)
  }
}

function encodeTaskPageCursor(nextRun: string | null, createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ nextRun, createdAt, id }), 'utf8').toString('base64url')
}

function decodeTaskPageCursor(raw: string | undefined): { nextRun: string | null; createdAt: string; id: string } | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<{
      nextRun: string | null
      createdAt: string
      id: string
    }>
    if ((typeof parsed.nextRun !== 'string' && parsed.nextRun !== null) || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
      return null
    }
    return { nextRun: parsed.nextRun, createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    return null
  }
}

function messageCreatedAtMs(createdAt: string): number {
  const parsed = Date.parse(createdAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

function buildAgentOrderBy(
  sortBy: AgentRepositoryListOptions['sortBy'],
  sortOrder: AgentRepositoryListOptions['sortOrder']
): string {
  const by = sortBy ?? 'orderKey'
  const direction = sortOrder ?? (by === 'orderKey' || by === 'name' ? 'asc' : 'desc')
  const column =
    by === 'name'
      ? 'lower(name)'
      : by === 'createdAt'
        ? 'created_at'
        : by === 'updatedAt'
          ? 'updated_at'
          : 'order_key'
  return `${column} ${direction === 'asc' ? 'asc' : 'desc'}`
}

function hasMcpServer(db: AgentPlatformDatabase['connection'], serverId: string): boolean {
  const row = db.prepare('select id from agent_mcp_servers where id = ?').get(serverId) as { id?: string } | undefined
  return typeof row?.id === 'string' && row.id.length > 0
}

function hasSkill(db: AgentPlatformDatabase['connection'], skillId: string): boolean {
  const row = db.prepare('select id from agent_skills where id = ?').get(skillId) as { id?: string } | undefined
  return typeof row?.id === 'string' && row.id.length > 0
}

function resolveSkillSortIndex(
  db: AgentPlatformDatabase['connection'],
  skillId: string,
  sortIndex?: number
): number {
  if (typeof sortIndex === 'number' && Number.isFinite(sortIndex)) {
    return Math.max(0, Math.trunc(sortIndex))
  }
  const existing = db
    .prepare('select sort_index from agent_skills where id = ?')
    .get(skillId) as { sort_index?: number } | undefined
  if (typeof existing?.sort_index === 'number' && Number.isFinite(existing.sort_index)) {
    return existing.sort_index
  }
  const next = db.prepare('select coalesce(max(sort_index), -1) + 1 as next_sort_index from agent_skills').get() as
    | { next_sort_index?: number }
    | undefined
  return typeof next?.next_sort_index === 'number' && Number.isFinite(next.next_sort_index) ? next.next_sort_index : 0
}

function setStateEntry<T>(db: AgentPlatformDatabase['connection'], key: string, value: T): void {
  db.prepare(
    `insert into agent_platform_state_entries (key, value_json, updated_at)
     values (?, ?, ?)
     on conflict(key) do update set
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), new Date().toISOString())
}

function mapAgentEntity(row: AgentEntityRow): AgentEntity {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    description: row.description ?? undefined,
    instructions: row.instructions ?? undefined,
    model: row.model,
    modelName: row.model_name,
    planModel: row.plan_model ?? undefined,
    smallModel: row.small_model ?? undefined,
    mcps: JSON.parse(row.mcps_json) as string[],
    disabledTools: JSON.parse(row.disabled_tools_json) as string[],
    configuration: row.configuration_json ? (JSON.parse(row.configuration_json) as AgentEntity['configuration']) : undefined,
    orderKey: row.order_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapWorkspaceEntity(row: WorkspaceRow): AgentWorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    type: row.type,
    orderKey: row.order_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapSessionEntity(row: SessionRow, workspace: AgentWorkspaceEntity): AgentSessionEntity {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description ?? undefined,
    workspaceId: row.workspace_id,
    workspace,
    traceId: row.trace_id ?? undefined,
    orderKey: row.order_key,
    allowedTools: parseAllowedTools(row.allowed_tools_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 旧行 / 脏 JSON 一律读成空数组：绝不能因为一行坏数据让会话打不开。 */
function parseAllowedTools(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? normalizeSessionAllowedTools(parsed.filter((entry): entry is string => typeof entry === 'string'))
      : []
  } catch {
    return []
  }
}

function mapMessageEntity(row: MessageRow): AgentSessionMessageEntity {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    data: stripQuietRuntimeControlParts(JSON.parse(row.data_json) as AgentSessionMessageEntity['data']),
    searchableText: row.searchable_text,
    status: row.status,
    modelId: row.model_id,
    modelSnapshot: row.model_snapshot_json
      ? (JSON.parse(row.model_snapshot_json) as AgentSessionMessageEntity['modelSnapshot'])
      : null,
    stats: row.stats_json ? (JSON.parse(row.stats_json) as AgentSessionMessageEntity['stats']) : null,
    runtimeResumeToken: row.runtime_resume_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapTaskEntity(row: TaskRow): ScheduledTaskEntity {
  const entity: ScheduledTaskEntity = {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    prompt: row.prompt,
    trigger: JSON.parse(row.trigger_json) as ScheduledTaskEntity['trigger'],
    timeoutMinutes: row.timeout_minutes,
    workspace: JSON.parse(row.workspace_json) as ScheduledTaskEntity['workspace'],
    enabled: row.enabled === 1,
    status: row.status,
    revision: row.revision ?? 1,
    pauseReason: row.pause_reason ?? null,
    failureResetAt: row.failure_reset_at ?? null,
    provenance: row.provenance_json
      ? (JSON.parse(row.provenance_json) as ScheduledTaskEntity['provenance'])
      : { createdBy: 'legacy' },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.catch_up_policy_json) {
    entity.catchUpPolicy = JSON.parse(row.catch_up_policy_json) as ScheduledTaskEntity['catchUpPolicy']
  }
  if (row.channel_ids_json) {
    entity.channelIds = JSON.parse(row.channel_ids_json) as string[]
  }
  if (row.next_run !== null) entity.nextRun = row.next_run
  if (row.last_run !== null) entity.lastRun = row.last_run
  return entity
}

function mapTaskRunLogEntity(row: TaskRunLogRow): TaskRunLogEntity {
  const entity: TaskRunLogEntity = {
    id: row.id,
    scheduleId: row.schedule_id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    status: row.status,
    result: row.result,
    error: row.error
  }
  if (row.agent_id !== null) entity.agentId = row.agent_id
  if (row.task_name_snapshot !== null) entity.taskNameSnapshot = row.task_name_snapshot
  if (row.terminal_reason !== null) entity.terminalReason = row.terminal_reason
  // Migration 0010 projects legacy result into the durable preview read model.
  if (row.result_preview !== null) entity.resultPreview = row.result_preview
  if (row.result_hash !== null) entity.resultHash = row.result_hash
  if (row.result_char_count !== null) entity.resultCharCount = row.result_char_count
  if (row.usage_json) entity.usage = JSON.parse(row.usage_json) as TaskRunLogEntity['usage']
  if (row.delivery_summary_json) {
    entity.deliverySummary = JSON.parse(row.delivery_summary_json) as TaskRunLogEntity['deliverySummary']
  }
  return entity
}

function mapTaskDeliveryAttemptEntity(row: TaskDeliveryAttemptRow): TaskDeliveryAttemptEntity {
  return {
    id: row.id,
    runLogId: row.run_log_id,
    taskId: row.task_id,
    agentId: row.agent_id,
    taskNameSnapshot: row.task_name_snapshot,
    channelId: row.channel_id,
    targetHash: row.target_hash,
    status: row.status,
    attemptNumber: row.attempt_number,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code
  }
}

function mapTaskMutationAuditEntity(row: TaskMutationAuditRow): TaskMutationAuditEntity {
  return {
    id: row.id,
    taskId: row.task_id,
    agentId: row.agent_id,
    taskNameSnapshot: row.task_name_snapshot,
    action: row.action,
    actor: JSON.parse(row.actor_json) as TaskMutationAuditEntity['actor'],
    requestHash: row.request_hash,
    resultRevision: row.result_revision,
    createdAt: row.created_at,
    outcome: row.outcome,
    errorCode: row.error_code
  }
}

function normalizePage(options: { limit?: number; offset?: number }): { limit: number; offset: number } {
  return {
    limit: Math.min(100, Math.max(1, options.limit ?? 50)),
    offset: Math.max(0, options.offset ?? 0)
  }
}

function mapMcpServerEntity(row: McpServerRow): McpServerEntity {
  const metadata = JSON.parse(row.metadata_json) as Partial<McpServerEntity>
  return {
    ...metadata,
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    ...(row.type !== null ? { type: row.type } : {}),
    ...(row.sort_order !== null ? { sortOrder: row.sort_order } : {}),
    ...(row.install_source !== null ? { installSource: row.install_source } : {}),
    ...(row.created_at !== null ? { createdAt: row.created_at } : {}),
    ...(row.updated_at !== null ? { updatedAt: row.updated_at } : {})
  }
}

function mapMcpTool(row: McpToolRow): McpToolsByServerId[string][number] {
  return {
    id: row.tool_id,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.input_schema_json !== null ? { inputSchema: JSON.parse(row.input_schema_json) as Record<string, unknown> } : {})
  }
}

function mapMcpRuntimeStatus(row: McpRuntimeStatusRow): McpRuntimeStatus {
  return {
    state: row.state,
    ...(row.message !== null ? { message: row.message } : {}),
    lastCheckedAt: row.last_checked_at
  }
}

function mapInstalledSkill(row: SkillRow): InstalledSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    folderName: row.folder_name,
    source: row.source,
    sourceUrl: row.source_url,
    namespace: row.namespace,
    author: row.author,
    sourceTags: JSON.parse(row.source_tags_json) as string[],
    contentHash: row.content_hash,
    isEnabled: row.is_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapAgentSkillBinding(row: AgentSkillBindingRow): AgentSkillBinding {
  return {
    agentId: row.agent_id,
    skillId: row.skill_id,
    isEnabled: row.is_enabled === 1
  }
}

function mapChannelEntity(row: ChannelRow): AgentChannelEntity {
  const entity: AgentChannelEntity = {
    id: row.id,
    type: row.type,
    name: row.name,
    workspace: JSON.parse(row.workspace_json) as AgentChannelEntity['workspace'],
    config: JSON.parse(row.config_json) as AgentChannelEntity['config'],
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } as AgentChannelEntity
  if (row.agent_id !== null) entity.agentId = row.agent_id
  if (row.session_id !== null) entity.sessionId = row.session_id
  if (row.active_chat_ids_json !== null) {
    entity.activeChatIds = JSON.parse(row.active_chat_ids_json) as string[]
  }
  if (row.permission_mode !== null) {
    entity.permissionMode = row.permission_mode as AgentChannelEntity['permissionMode']
  }
  return entity
}

function mapChannelTaskSubscription(row: ChannelTaskSubscriptionRow): AgentChannelTaskSubscription {
  return {
    channelId: row.channel_id,
    taskId: row.task_id
  }
}

function mapProductToolTraceRow(row: Record<string, unknown>): ProductAgentToolCallTrace {
  return {
    toolCallId: String(row.tool_call_id),
    productId: String(row.product_id),
    toolName: String(row.tool_name),
    handlerId: String(row.handler_id),
    schemaVersion: Number(row.schema_version),
    consumerProductId: row.consumer_product_id ? String(row.consumer_product_id) : undefined,
    agentId: String(row.agent_id),
    agentSessionId: String(row.agent_session_id),
    asOf: row.as_of ? String(row.as_of) : undefined,
    inputHash: String(row.input_hash),
    outputHash: row.output_hash ? String(row.output_hash) : undefined,
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    status: row.status as ProductAgentToolCallTrace['status'],
    errorCode: row.error_code ? (String(row.error_code) as ProductAgentToolCallTrace['errorCode']) : undefined,
    resultSizeBytes: row.result_size_bytes == null ? undefined : Number(row.result_size_bytes)
  }
}
