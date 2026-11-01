import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createSyncAuditStore, syncAuditPolicy } from './syncAuditStore'

const directories: string[] = []
const store = () => {
  const directory = mkdtempSync(join(tmpdir(), 'mi-sync-audit-'))
  directories.push(directory)
  return createSyncAuditStore(join(directory, 'sync-audit.sqlite'))
}

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe('sync audit store', () => {
  it('lists newest first and keeps the failure code', () => {
    const audit = store()
    audit.append({ at: '2026-10-30T08:00:00.000Z', actor: 'user', action: 'configure', target: 'policy-path-market', outcome: 'succeeded' })
    audit.append({ at: '2026-10-30T09:00:00.000Z', actor: 'user', action: 'refresh', target: 'macro-calendar-fed', outcome: 'failed', failureCode: 'provider-disabled', detail: 'boom' })
    expect(audit.list({ since: '2026-10-30T00:00:00.000Z', limit: 10 })).toEqual([
      expect.objectContaining({ at: '2026-10-30T09:00:00.000Z', action: 'refresh', failureCode: 'provider-disabled' }),
      expect.objectContaining({ at: '2026-10-30T08:00:00.000Z', action: 'configure' })
    ])
    audit.close()
  })

  it('drops rows older than the retention window on the next write', () => {
    const audit = store()
    const old = new Date(Date.parse('2026-09-01T00:00:00.000Z')).toISOString()
    audit.append({ at: old, actor: 'user', action: 'test', target: 'macro-calendar-fed', outcome: 'succeeded' })
    audit.append({ at: '2026-10-30T09:00:00.000Z', actor: 'user', action: 'test', target: 'macro-calendar-fed', outcome: 'succeeded' })
    expect(audit.list({ since: '2026-01-01T00:00:00.000Z', limit: 10 })).toHaveLength(1)
    expect(syncAuditPolicy.retentionDays).toBe(30)
    audit.close()
  })

  it('truncates a long detail instead of storing a response body', () => {
    const audit = store()
    audit.append({ at: '2026-10-30T09:00:00.000Z', actor: 'user', action: 'import', target: 'macro-calendar-bls', outcome: 'failed', detail: 'x'.repeat(400) })
    expect((audit.list({ since: '2026-10-30T00:00:00.000Z', limit: 1 })[0]?.detail ?? '').length).toBeLessThanOrEqual(200)
    audit.close()
  })
})
