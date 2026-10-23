import { randomUUID } from 'node:crypto'

import type { AssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import {
  createDefaultAssistantSettings,
  normalizeAssistantSettings,
  type AssistantEntity,
  type AssistantSettings,
  type AssistantTag,
  type CreateAssistantDto,
  type UpdateAssistantDto
} from '../schemas/assistantSchemas'

type AssistantRow = {
  id: string
  name: string
  prompt: string
  icon: string
  description: string
  settings_json: string
  model_id: string | null
  model_name: string | null
  order_key: string
  created_at: string
  updated_at: string
}

export type AssistantRepository = {
  list: () => AssistantEntity[]
  getById: (id: string) => AssistantEntity | null
  create: (dto: CreateAssistantDto, options?: { modelName?: string | null }) => AssistantEntity
  update: (id: string, dto: UpdateAssistantDto, options?: { modelName?: string | null }) => AssistantEntity
  delete: (id: string) => boolean
  reorder: (orderedIds: string[]) => AssistantEntity[]
}

export function createAssistantRepository(db: AssistantPlatformDatabase): AssistantRepository {
  return {
    list() {
      const rows = db.connection
        .prepare('select * from assistant_entities order by order_key asc, id asc')
        .all() as AssistantRow[]
      return rows.map((row) => hydrateAssistant(db, row))
    },

    getById(id) {
      const row = db.connection
        .prepare('select * from assistant_entities where id = ?')
        .get(id) as AssistantRow | undefined
      return row ? hydrateAssistant(db, row) : null
    },

    create(dto, options) {
      return db.transact(() => {
        const now = new Date().toISOString()
        const id = dto.id?.trim() || randomUUID()
        const orderKey = nextOrderKey(db, 'assistant_entities')
        const settings = normalizeAssistantSettings(dto.settings)
        db.connection
          .prepare(
            `insert into assistant_entities (
              id, name, prompt, icon, description, settings_json, model_id, model_name, order_key, created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            dto.name.trim(),
            dto.prompt?.trim() ?? '',
            dto.icon?.trim() ?? '💬',
            dto.description?.trim() ?? '',
            JSON.stringify(settings),
            dto.modelId ?? null,
            options?.modelName ?? null,
            orderKey,
            now,
            now
          )
        syncAssistantRelations(db, id, {
          mcpServerIds: dto.mcpServerIds ?? [],
          contextSourceIds: dto.contextSourceIds ?? [],
          tags: dto.tags ?? []
        })
        const created = this.getById(id)
        if (!created) throw new Error('Failed to create assistant.')
        return created
      })
    },

    update(id, dto, options) {
      return db.transact(() => {
        const existing = this.getById(id)
        if (!existing) throw new Error(`Assistant not found: ${id}`)
        const now = new Date().toISOString()
        const settings =
          dto.settings === undefined
            ? existing.settings
            : normalizeAssistantSettings({ ...existing.settings, ...dto.settings })
        db.connection
          .prepare(
            `update assistant_entities set
              name = ?, prompt = ?, icon = ?, description = ?, settings_json = ?,
              model_id = ?, model_name = ?, updated_at = ?
             where id = ?`
          )
          .run(
            dto.name?.trim() ?? existing.name,
            dto.prompt !== undefined ? dto.prompt.trim() : existing.prompt,
            dto.icon !== undefined ? dto.icon.trim() : existing.icon,
            dto.description !== undefined ? dto.description.trim() : existing.description,
            JSON.stringify(settings),
            dto.modelId !== undefined ? dto.modelId : existing.modelId,
            options?.modelName !== undefined ? options.modelName : existing.modelName,
            now,
            id
          )
        if (
          dto.mcpServerIds !== undefined ||
          dto.contextSourceIds !== undefined ||
          dto.tags !== undefined
        ) {
          syncAssistantRelations(db, id, {
            mcpServerIds: dto.mcpServerIds ?? existing.mcpServerIds,
            contextSourceIds: dto.contextSourceIds ?? existing.contextSourceIds,
            tags: dto.tags ?? existing.tags
          })
        }
        const updated = this.getById(id)
        if (!updated) throw new Error(`Assistant not found after update: ${id}`)
        return updated
      })
    },

    delete(id) {
      return db.transact(() => {
        const result = db.connection.prepare('delete from assistant_entities where id = ?').run(id)
        return Number(result.changes ?? 0) > 0
      })
    },

    reorder(orderedIds) {
      return db.transact(() => {
        const now = new Date().toISOString()
        orderedIds.forEach((id, index) => {
          db.connection
            .prepare('update assistant_entities set order_key = ?, updated_at = ? where id = ?')
            .run(String(index + 1).padStart(4, '0'), now, id)
        })
        return this.list()
      })
    }
  }
}

function hydrateAssistant(db: AssistantPlatformDatabase, row: AssistantRow): AssistantEntity {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    icon: row.icon,
    description: row.description,
    settings: parseSettings(row.settings_json),
    modelId: row.model_id,
    modelName: row.model_name,
    mcpServerIds: listRelationIds(db, 'assistant_mcp_servers', 'mcp_server_id', row.id),
    contextSourceIds: listRelationIds(db, 'assistant_context_sources', 'context_source_id', row.id),
    tags: listTags(db, row.id),
    orderKey: row.order_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseSettings(raw: string): AssistantSettings {
  try {
    return normalizeAssistantSettings(JSON.parse(raw) as Partial<AssistantSettings>)
  } catch {
    return createDefaultAssistantSettings()
  }
}

function listRelationIds(
  db: AssistantPlatformDatabase,
  table: 'assistant_mcp_servers' | 'assistant_context_sources',
  column: 'mcp_server_id' | 'context_source_id',
  assistantId: string
): string[] {
  const rows = db.connection
    .prepare(`select ${column} as id from ${table} where assistant_id = ? order by position asc`)
    .all(assistantId) as Array<{ id: string }>
  return rows.map((row) => row.id)
}

function listTags(db: AssistantPlatformDatabase, assistantId: string): AssistantTag[] {
  const rows = db.connection
    .prepare(
      'select tag_id as id, tag_name as name from assistant_tags where assistant_id = ? order by position asc'
    )
    .all(assistantId) as AssistantTag[]
  return rows
}

function syncAssistantRelations(
  db: AssistantPlatformDatabase,
  assistantId: string,
  input: {
    mcpServerIds: string[]
    contextSourceIds: string[]
    tags: AssistantTag[]
  }
): void {
  db.connection.prepare('delete from assistant_mcp_servers where assistant_id = ?').run(assistantId)
  db.connection.prepare('delete from assistant_context_sources where assistant_id = ?').run(assistantId)
  db.connection.prepare('delete from assistant_tags where assistant_id = ?').run(assistantId)

  input.mcpServerIds.forEach((mcpServerId, position) => {
    db.connection
      .prepare(
        'insert into assistant_mcp_servers (assistant_id, mcp_server_id, position) values (?, ?, ?)'
      )
      .run(assistantId, mcpServerId, position)
  })
  input.contextSourceIds.forEach((contextSourceId, position) => {
    db.connection
      .prepare(
        'insert into assistant_context_sources (assistant_id, context_source_id, position) values (?, ?, ?)'
      )
      .run(assistantId, contextSourceId, position)
  })
  input.tags.forEach((tag, position) => {
    db.connection
      .prepare(
        'insert into assistant_tags (assistant_id, tag_id, tag_name, position) values (?, ?, ?, ?)'
      )
      .run(assistantId, tag.id, tag.name, position)
  })
}

function nextOrderKey(db: AssistantPlatformDatabase, table: 'assistant_entities' | 'assistant_topics'): string {
  const row = db.connection
    .prepare(`select order_key from ${table} order by order_key desc, id desc limit 1`)
    .get() as { order_key?: string } | undefined
  const current = Number.parseInt(row?.order_key ?? '0', 10)
  return String((Number.isFinite(current) ? current : 0) + 1).padStart(4, '0')
}

export { nextOrderKey }
