import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { createAgentChangeLog } from './changeLog'

const directories: string[] = []

function createLog() {
  const directory = mkdtempSync(join(tmpdir(), 'mi-change-log-'))
  directories.push(directory)
  return createAgentChangeLog(join(directory, 'agent-change-log.sqlite'))
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('agent change log', () => {
  it('stores a safe before/after snapshot and reads it back', () => {
    const log = createLog()
    const row = log.append({
      traceId: 'trace-1',
      agentId: 'crypto-market-analyst',
      agentSessionId: 'session-1',
      domain: 'source-config',
      action: 'set-enabled',
      sourceId: 'coingecko-trending',
      before: { enabled: false },
      after: { enabled: true },
      changeSummary: 'enabled false -> true',
      outcome: 'applied',
      configurationChanged: true,
      revisionBefore: 'aaaaaaaaaaaa',
      revisionAfter: 'bbbbbbbbbbbb',
      createdAt: '2026-10-24T00:00:00.000Z'
    })

    expect(row.id).toEqual(expect.any(String))
    expect(log.listRecent({ sourceId: 'coingecko-trending' })).toEqual([row])
  })

  it('drops undefined fields instead of storing them', () => {
    const log = createLog()
    log.append({
      traceId: 'trace-2',
      agentId: 'crypto-market-analyst',
      agentSessionId: 'session-2',
      domain: 'source-config',
      action: 'save-profile',
      before: { collectionPreset: 'balanced', monitoredSymbols: undefined },
      changeSummary: 'no-op',
      outcome: 'unchanged',
      configurationChanged: false,
      revisionBefore: 'aaaaaaaaaaaa',
      revisionAfter: 'aaaaaaaaaaaa',
      createdAt: '2026-10-24T00:00:00.000Z'
    })

    const [row] = log.listRecent()
    expect(row?.before).toEqual({ collectionPreset: 'balanced' })
  })

  it('refuses to persist a credential-shaped value', () => {
    const log = createLog()
    expect(() =>
      log.append({
        traceId: 'trace-3',
        agentId: 'crypto-market-analyst',
        agentSessionId: 'session-3',
        domain: 'source-config',
        action: 'save-profile',
        before: { apiKey: 'sk-test-value' },
        changeSummary: 'bad',
        outcome: 'applied',
        configurationChanged: true,
        revisionBefore: 'aaaaaaaaaaaa',
        revisionAfter: 'aaaaaaaaaaaa',
        createdAt: '2026-10-24T00:00:00.000Z'
      })
    ).toThrow()
    expect(log.listRecent()).toEqual([])
  })
})

describe('agent change log schema migration', () => {
  it('adds the outcome columns to an existing v1 database and keeps its rows readable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mi-change-log-migration-'))
    directories.push(directory)
    const filePath = join(directory, 'agent-change-log.sqlite')
    const legacy = new DatabaseSync(filePath)
    legacy.exec(`
      create table intelligence_agent_change_log (
        id text primary key,
        trace_id text not null,
        agent_id text not null,
        agent_session_id text not null,
        domain text not null,
        action text not null,
        source_id text,
        before_json text,
        after_json text,
        change_summary text not null,
        revision_before text not null,
        revision_after text not null,
        created_at text not null
      );
      insert into intelligence_agent_change_log values (
        'row-1', 'trace-old', 'agent-1', 'session-1', 'source-config', 'set-enabled',
        'coingecko-trending', '{"enabled":false}', '{"enabled":true}',
        'set-enabled coingecko-trending: enabled false -> true',
        'aaaa', 'bbbb', '2026-10-01T00:00:00.000Z'
      );
    `)
    legacy.close()

    const log = createAgentChangeLog(filePath)
    const [oldRow] = log.listRecent({})
    // Backfill, not observation: a v1 row never carried an outcome.
    expect(oldRow).toMatchObject({
      action: 'set-enabled',
      before: { enabled: false },
      after: { enabled: true },
      outcome: 'applied',
      configurationChanged: true
    })

    log.append({
      traceId: 'trace-new',
      agentId: 'agent-1',
      agentSessionId: 'session-1',
      domain: 'operations',
      action: 'run-now',
      changeSummary: 'run-now coingecko-trending: no configuration change',
      outcome: 'unchanged',
      configurationChanged: false,
      revisionBefore: 'cccc',
      revisionAfter: 'cccc',
      createdAt: '2026-10-02T00:00:00.000Z'
    })
    expect(log.listRecent({ traceId: 'trace-new' })[0]).toMatchObject({
      outcome: 'unchanged',
      configurationChanged: false
    })
    log.close()
  })
})
