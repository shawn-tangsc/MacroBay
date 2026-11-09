import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { markIdentitylessAutomationSessionsSuperseded } from './agentSqliteStore'

const at = '2026-11-09T00:00:00.000Z'

describe('identity-less automation sessions become superseded', () => {
  it('marks them once, keeps every other field, and logs the count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-identityless-superseded-'))
    try {
      const db = createAgentPlatformDatabase(join(dir, 'agents.sqlite'))
      // 这条用例只关心迁移 SQL：跳过外键，直接造会话行。
      db.connection.exec('pragma foreign_keys = off;')
      const insert = db.connection.prepare(
        `insert into agent_sessions (id, agent_id, name, workspace_id, order_key, origin, origin_state, created_at, updated_at)
         values (?, 'agent-1', ?, 'w', ?, 'automation', 'current', ?, ?)`
      )
      insert.run('orphan-1', 'run A', '0001', at, at)
      insert.run('orphan-2', 'run B', '0002', at, at)
      db.connection.prepare(
        `insert into agent_sessions (id, agent_id, name, workspace_id, order_key, origin, origin_ref, origin_state, created_at, updated_at)
         values ('identified', 'agent-1', 'run C', 'w', '0003', 'automation', 'run-c', 'current', ?, ?)`
      ).run(at, at)
      db.connection.prepare(
        `insert into agent_sessions (id, agent_id, name, workspace_id, order_key, origin, created_at, updated_at)
         values ('reader', 'agent-1', 'mine', 'w', '0004', 'reader', ?, ?)`
      ).run(at, at)

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      try {
        expect(markIdentitylessAutomationSessionsSuperseded(db)).toBe(2)
        expect(log).toHaveBeenCalledTimes(1)
        expect(String(log.mock.calls[0]?.[0])).toContain('AGENT_IDENTITYLESS_AUTOMATION_SUPERSEDED')

        const rows = db.connection.prepare('select id, origin, origin_ref, origin_state, created_at, updated_at from agent_sessions order by id').all()
        expect(rows).toEqual([
          { id: 'identified', origin: 'automation', origin_ref: 'run-c', origin_state: 'current', created_at: at, updated_at: at },
          { id: 'orphan-1', origin: 'automation', origin_ref: null, origin_state: 'superseded', created_at: at, updated_at: at },
          { id: 'orphan-2', origin: 'automation', origin_ref: null, origin_state: 'superseded', created_at: at, updated_at: at },
          { id: 'reader', origin: 'reader', origin_ref: null, origin_state: 'current', created_at: at, updated_at: at }
        ])

        // 幂等：第二趟 0 条、不再打日志。
        expect(markIdentitylessAutomationSessionsSuperseded(db)).toBe(0)
        expect(log).toHaveBeenCalledTimes(1)
      } finally {
        log.mockRestore()
        db.connection.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
