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
