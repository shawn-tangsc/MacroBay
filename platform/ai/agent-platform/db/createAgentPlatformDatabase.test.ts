import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from './createAgentPlatformDatabase'

const FTS_TABLE = 'agent_session_messages_fts'
const DROP_MIGRATION_ID = '0046_drop_agent_session_messages_fts'

/**
 * 0046 的用途是删掉老用户库里的孤儿 FTS 表。没有这条用例，这个迁移本身就和它想
 * 消灭的东西同类风险：改动是否成立只能靠读代码判断。
 */
describe('0046 drops the orphan FTS table', () => {
  it('removes the index and every trace of it while leaving messages intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-platform-fts-'))
    const path = join(dir, 'agents.sqlite')
    try {
      // 1. 先建一个「已经跑完全部迁移」的库，再把旧库里的 FTS 表和一条索引记录补回去。
      const first = createAgentPlatformDatabase(path)
      first.connection.exec(`
        create virtual table if not exists ${FTS_TABLE}
          using fts5(message_id UNINDEXED, session_id UNINDEXED, searchable_text);
      `)
      first.connection
        .prepare(`insert into ${FTS_TABLE} (message_id, session_id, searchable_text) values (?, ?, ?)`)
        .run('message-1', 'session-1', 'breakout invalidation')
      first.connection
        .prepare(
          `insert into agent_workspaces (id, name, path, type, order_key, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('workspace-1', 'Workspace', '/tmp/workspace', 'user', 'workspace-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      first.connection
        .prepare(
          `insert into agent_sessions (id, agent_id, name, workspace_id, order_key, created_at, updated_at)
           values (?, null, ?, ?, ?, ?, ?)`
        )
        .run('session-1', 'Session', 'workspace-1', 'session-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      first.connection
        .prepare(
          `insert into agent_session_messages
             (id, session_id, role, data_json, searchable_text, status, created_at, updated_at)
           values (?, ?, 'user', '{"parts":[]}', ?, 'success', ?, ?)`
        )
        .run('message-1', 'session-1', 'breakout invalidation', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z')
      // 把这条迁移标记为未执行，模拟「老库还没跑过 0046」。
      first.connection.prepare('delete from agent_platform_migrations where id = ?').run(DROP_MIGRATION_ID)
      first.connection.close()

      // 2. 重新打开：迁移链会执行 0046。
      const second = createAgentPlatformDatabase(path)
      const leftovers = second.connection
        .prepare(`select name from sqlite_master where name like '%fts%'`)
        .all() as Array<{ name: string }>
      const messages = second.connection
        .prepare('select id, searchable_text from agent_session_messages order by id')
        .all() as Array<{ id: string; searchable_text: string }>
      const applied = second.connection
        .prepare('select id from agent_platform_migrations where id = ?')
        .get(DROP_MIGRATION_ID) as { id?: string } | undefined
      second.connection.close()

      expect(leftovers).toEqual([])
      expect(messages).toEqual([{ id: 'message-1', searchable_text: 'breakout invalidation' }])
      expect(applied?.id).toBe(DROP_MIGRATION_ID)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * 0049 修的是「已执行过的迁移被改过」造成的列名错位：本地先用 allowed_chat_ids_json 跑过 0048，
 * 库把 0048 记成已执行，随后代码改成 active_chat_ids_json 才提交。老库于是永远缺这一列，
 * 启动读 channel 直接 no such column。这条用例把那个库的样子造出来，再验证只靠新迁移就能修好。
 */
describe('0049 repairs the channel allowed-chat-ids column after 0048 was edited', () => {
  it('renames the legacy column and keeps the stored ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-platform-channel-col-'))
    const path = join(dir, 'agents.sqlite')
    try {
      const first = createAgentPlatformDatabase(path)
      first.connection
        .prepare(
          `insert into agent_channels
             (id, adapter_key, name, agent_id, public_config_json, requested_enabled, lifecycle_state, created_at, updated_at)
           values (?, ?, ?, null, '{}', 1, 'enabled', ?, ?)`
        )
        .run('channel-a', 'telegram', 'Channel A', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      first.connection
        .prepare('update agent_channels set active_chat_ids_json = ? where id = ?')
        .run(JSON.stringify(['conversation-a']), 'channel-a')
      // 造出老库的样子：列名是旧的那一个，而 0048 仍记成已执行。
      first.connection.exec('alter table agent_channels rename column active_chat_ids_json to allowed_chat_ids_json')
      first.connection.prepare('delete from agent_platform_migrations where id = ?').run('0049_channel_allowed_chat_ids_repair')
      first.connection.close()

      const second = createAgentPlatformDatabase(path)
      const columns = second.connection.prepare('pragma table_info(agent_channels)').all() as Array<{ name: string }>
      const names = columns.map((column) => column.name)
      expect(names).toContain('active_chat_ids_json')
      expect(names).not.toContain('allowed_chat_ids_json')
      const row = second.connection
        .prepare('select active_chat_ids_json from agent_channels where id = ?')
        .get('channel-a') as { active_chat_ids_json: string | null }
      expect(row.active_chat_ids_json).toBe(JSON.stringify(['conversation-a']))
      second.connection.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves a database that already has the current column untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-platform-channel-col-fresh-'))
    const path = join(dir, 'agents.sqlite')
    try {
      const first = createAgentPlatformDatabase(path)
      first.connection.close()
      const second = createAgentPlatformDatabase(path)
      const names = (second.connection.prepare('pragma table_info(agent_channels)').all() as Array<{ name: string }>).map(
        (column) => column.name
      )
      expect(names).toContain('active_chat_ids_json')
      second.connection.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * 0047 的判据不是「列加上了」，而是「老库升级之后，读者自己的会话一条没少、一条没错位」。
 * 所以这条用例**先造出升级前的库**（没有这两列、迁移记录也未写），插几条老会话，再让迁移跑。
 */
describe('0047 adds the session origin columns to an existing database', () => {
  it('gives every existing session the reader origin and keeps the default list unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-platform-origin-'))
    const path = join(dir, 'agents.sqlite')
    try {
      // 1. 建库并写入老会话。
      const first = createAgentPlatformDatabase(path)
      first.connection
        .prepare(
          `insert into agent_workspaces (id, name, path, type, order_key, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run('workspace-1', 'Workspace', '/tmp/workspace', 'user', 'workspace-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      const insertSession = first.connection.prepare(
        `insert into agent_sessions (id, agent_id, name, workspace_id, order_key, created_at, updated_at)
         values (?, null, ?, ?, ?, ?, ?)`
      )
      for (const [id, name, orderKey] of [
        ['session-a', 'First', '2026-01-01T00:00:00.000Z-0001'],
        ['session-b', 'Second', '2026-01-02T00:00:00.000Z-0002'],
        ['session-c', 'Third', '2026-01-03T00:00:00.000Z-0003']
      ] as const) {
        insertSession.run(id, name, 'workspace-1', orderKey, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      }
      // 2. 造出「升级前」的形状：两列不存在、0047 未记录。
      first.connection.exec('alter table agent_sessions drop column origin_group; alter table agent_sessions drop column origin;')
      first.connection.prepare('delete from agent_platform_migrations where id = ?').run('0047_agent_session_origin')
      const beforeColumns = (first.connection.prepare('pragma table_info(agent_sessions)').all() as Array<{ name: string }>)
        .map((column) => column.name)
      expect(beforeColumns).not.toContain('origin')
      first.connection.close()

      // 3. 重新打开：迁移链执行 0047。
      const second = createAgentPlatformDatabase(path)
      const columns = (second.connection.prepare('pragma table_info(agent_sessions)').all() as Array<{ name: string }>)
        .map((column) => column.name)
      const rows = second.connection
        .prepare('select id, origin, origin_group from agent_sessions order by id')
        .all() as Array<{ id: string; origin: string; origin_group: string | null }>
      const defaultList = second.connection
        .prepare("select id from agent_sessions where origin = 'reader' order by order_key asc, id asc")
        .all() as Array<{ id: string }>
      const applied = second.connection
        .prepare('select id from agent_platform_migrations where id = ?')
        .get('0047_agent_session_origin') as { id?: string } | undefined
      second.connection.close()

      expect(columns).toContain('origin')
      expect(columns).toContain('origin_group')
      // 存量全落「读者发起」，且分组为空——不是被回填成某个产品名。
      expect(rows).toEqual([
        { id: 'session-a', origin: 'reader', origin_group: null },
        { id: 'session-b', origin: 'reader', origin_group: null },
        { id: 'session-c', origin: 'reader', origin_group: null }
      ])
      // 默认列表逐条不变：还是那三条，顺序也还是那条 order_key 顺序。
      expect(defaultList.map((row) => row.id)).toEqual(['session-a', 'session-b', 'session-c'])
      expect(applied?.id).toBe('0047_agent_session_origin')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
