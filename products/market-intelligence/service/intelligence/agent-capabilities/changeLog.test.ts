import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
        revisionBefore: 'aaaaaaaaaaaa',
        revisionAfter: 'aaaaaaaaaaaa',
        createdAt: '2026-10-24T00:00:00.000Z'
      })
    ).toThrow()
    expect(log.listRecent()).toEqual([])
  })
})
