import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import type { AnalysisRun, EvidenceSnapshot, EventGroup } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisSnapshotHash } from '../analysis/analysisHash'
import { createMarketAnalysisRepository } from './marketAnalysisRepository'

const asOf = '2026-11-06T10:00:00.000Z'

function group(id = 'mi-eg-retry', mergeKey = 'US.CPI|retry'): EventGroup {
  return {
    id, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey,
    firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-11-06T11:00:00.000Z',
    eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null,
    supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
  }
}

function snapshot(id: string, eventGroupId: string): EvidenceSnapshot {
  const facts = [{ factId: 'fact-A', domain: 'macro' as const, subject: 'US CPI', metric: 'actual', value: '3.2', unit: '%', sourceId: 'source-fed', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-A' }]
  const evidenceRefs = [{ evidenceRefId: 'ev-A', sourceId: 'source-fed', sourceLabel: '官方', itemId: null, occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: createHash('sha256').update('ev-A').digest('hex') }]
  return {
    id, schemaVersion: 1, eventGroupId, asOf, dataCutoff: asOf,
    snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts, missingDomains: [], caveats: [], evidenceRefs }),
    profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs,
    sourceHealth: [{ sourceId: 'source-fed', status: 'healthy', asOf }], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1'
  }
}

function run(id: string, eventGroupId: string, snapshotId: string, triggerKey = 'signal.open-interest.oi-liquidation-proxy'): AnalysisRun {
  return {
    id, schemaVersion: 1, eventGroupId, snapshotId, snapshotHash: snapshot('mi-es-retry', eventGroupId).snapshotHash,
    analysisPhase: 'initial', triggerKey, idempotencyKey: `key-${id}`, status: 'queued', attempt: 1,
    retryOfRunId: null, modelProviderId: 'provider', modelId: 'model', policyVersion: 'policy.v1',
    promptVersion: 'prompt.v1', skillVersion: 'skill.v1', outputSchemaVersion: 1, jobRunId: null, traceId: null,
    failureCode: null, failureDetailCode: null, validationMode: null, queuedAt: asOf, startedAt: null, completedAt: null
  }
}

function repositoryWithRuns(runs: readonly AnalysisRun[]) {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  const groupIds = [...new Set(runs.map(value => value.eventGroupId))]
  for (const id of groupIds) {
    repository.appendEventGroup(group(id, `US.CPI|${id}`))
    repository.appendSnapshot(snapshot(`mi-es-${id}`, id))
  }
  for (const value of runs) repository.enqueueRun(value)
  return repository
}

describe('the transport-retry columns', () => {
  it('claims a run once, asks the same key once per UTC day, and keeps the claim after a crash', () => {
    const repository = repositoryWithRuns([run('mi-ar-r1', 'mi-eg-retry', 'mi-es-mi-eg-retry')])
    expect(repository.retry.usedOn('signal.open-interest.oi-liquidation-proxy', asOf)).toBeNull()

    // Claimed before the second call; a crash between claim and call still spends the chance.
    expect(repository.retry.claim('mi-ar-r1', '2026-11-06T23:30:00.000Z')).toBe(true)
    expect(repository.retry.usedOn('signal.open-interest.oi-liquidation-proxy', '2026-11-06T23:59:00.000Z')).toBe('2026-11-06T23:30:00.000Z')
    // The same run cannot claim twice, and another key is still free.
    expect(repository.retry.claim('mi-ar-r1', '2026-11-06T23:31:00.000Z')).toBe(false)
    expect(repository.retry.usedOn('schedule.asia.open', '2026-11-06T23:59:00.000Z')).toBeNull()
    repository.close()
  })

  it('opens a new chance at UTC midnight and not a moment earlier', () => {
    const repository = repositoryWithRuns([
      run('mi-ar-r1', 'mi-eg-retry', 'mi-es-mi-eg-retry'),
      run('mi-ar-r2', 'mi-eg-retry', 'mi-es-mi-eg-retry', 'signal.etf.net-outflow')
    ])
    const triggerKey = 'signal.open-interest.oi-liquidation-proxy'
    repository.retry.claim('mi-ar-r1', '2026-11-06T23:59:59.999Z')
    expect(repository.retry.usedOn(triggerKey, '2026-11-06T23:59:59.999Z')).not.toBeNull()
    // The next UTC day is a new chance; the reader's time zone never enters this decision.
    expect(repository.retry.usedOn(triggerKey, '2026-11-07T00:00:00.000Z')).toBeNull()
    expect(repository.retry.claim('mi-ar-r1', '2026-11-07T00:00:00.000Z')).toBe(false)
    repository.close()
  })

  it('refuses a time with an offset instead of reading it as another day', () => {
    const repository = repositoryWithRuns([run('mi-ar-r1', 'mi-eg-retry', 'mi-es-mi-eg-retry')])
    const triggerKey = 'signal.open-interest.oi-liquidation-proxy'
    // `slice(0, 10)` would read this as 2026-11-06 and allow a second retry; the store parses the
    // instant and refuses the non-canonical shape instead of silently changing the day.
    expect(() => repository.retry.usedOn(triggerKey, '2026-11-06T20:00:00+08:00')).toThrowError('analysis-retry-time-invalid')
    expect(() => repository.retry.claim('mi-ar-r1', '2026-11-06T20:00:00+08:00')).toThrowError('analysis-retry-time-invalid')
    expect(() => repository.retry.usedOn(triggerKey, '2026-02-31T00:00:00.000Z')).toThrowError('analysis-retry-time-invalid')
    repository.close()
  })

  it('records only for a claimed run and counts cancelled as spent', () => {
    const repository = repositoryWithRuns([
      run('mi-ar-r1', 'mi-eg-retry', 'mi-es-mi-eg-retry'),
      run('mi-ar-r2', 'mi-eg-other', 'mi-es-mi-eg-other', 'signal.etf.net-outflow')
    ])
    expect(repository.retry.record('mi-ar-r1', 'succeeded')).toBe(false)
    expect(repository.retry.claim('mi-ar-r1', asOf)).toBe(true)
    expect(repository.retry.claim('mi-ar-r2', asOf)).toBe(true)
    expect(repository.retry.record('mi-ar-r1', 'cancelled')).toBe(true)
    expect(repository.retry.record('mi-ar-r2', 'succeeded')).toBe(true)

    const usage = repository.retry.usage('2026-11-01T00:00:00.000Z')
    // A cancelled retry is a spent chance, not a missing result: it must not read as still available.
    expect(usage).toMatchObject({ attempts: 2, succeeded: 1, failed: 0, cancelled: 1, unfinished: 0, groupsWithMoreThanOneRetry: 0 })
    expect(usage.byTrigger).toEqual([
      { triggerKey: 'signal.etf.net-outflow', attempts: 1, succeeded: 1 },
      { triggerKey: 'signal.open-interest.oi-liquidation-proxy', attempts: 1, succeeded: 0 }
    ])
    repository.close()
  })

  it('reads a week of attempts back without a second tally', () => {
    const repository = repositoryWithRuns([
      run('mi-ar-r1', 'mi-eg-retry', 'mi-es-mi-eg-retry'),
      run('mi-ar-r2', 'mi-eg-retry', 'mi-es-mi-eg-retry', 'signal.etf.net-outflow'),
      run('mi-ar-r3', 'mi-eg-other', 'mi-es-mi-eg-other'),
      run('mi-ar-r4', 'mi-eg-old', 'mi-es-mi-eg-old', 'signal.positioning.leverage')
    ])
    repository.retry.claim('mi-ar-r1', '2026-11-06T10:00:00.000Z')
    repository.retry.record('mi-ar-r1', 'succeeded')
    repository.retry.claim('mi-ar-r2', '2026-11-06T11:00:00.000Z')
    repository.retry.record('mi-ar-r2', 'failed')
    repository.retry.claim('mi-ar-r3', '2026-11-06T12:00:00.000Z')
    repository.retry.record('mi-ar-r3', 'succeeded')
    // A run outside the window is not in the week's numbers.
    expect(repository.retry.claim('mi-ar-r4', '2026-10-01T12:00:00.000Z')).toBe(true)

    const usage = repository.retry.usage('2026-11-01T00:00:00.000Z')
    // Two claims share one event group — the §4.1 shape the reversal condition watches.
    expect(usage).toMatchObject({ attempts: 3, succeeded: 2, failed: 1, cancelled: 0, unfinished: 0, groupsWithMoreThanOneRetry: 1 })
    expect(usage.byTrigger.map(row => [row.triggerKey, row.attempts, row.succeeded])).toEqual([
      ['signal.open-interest.oi-liquidation-proxy', 2, 2],
      ['signal.etf.net-outflow', 1, 0]
    ])
    repository.close()
  })

  it('shows the retry on the run projection the run log already reads', () => {
    const repository = repositoryWithRuns([run('mi-ar-r1', 'mi-eg-retry', 'mi-es-mi-eg-retry')])
    expect(repository.getRun('mi-ar-r1')).not.toHaveProperty('retryUsedAt')
    repository.retry.claim('mi-ar-r1', asOf)
    repository.retry.record('mi-ar-r1', 'failed')
    expect(repository.getRun('mi-ar-r1')).toMatchObject({ retryUsedAt: asOf, retryResult: 'failed' })
    expect(repository.listRuns()[0]).toMatchObject({ retryUsedAt: asOf, retryResult: 'failed' })
    repository.close()
  })

  it('adds both columns and the index to a database created before them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mi-retry-columns-'))
    const filePath = join(directory, 'analysis.sqlite')
    try {
      createMarketAnalysisRepository({ filePath }).close()
      const legacy = new DatabaseSync(filePath)
      legacy.exec('drop index idx_mi_analysis_run_retry; alter table mi_analysis_runs drop column retry_used_at; alter table mi_analysis_runs drop column retry_result;')
      legacy.close()

      createMarketAnalysisRepository({ filePath }).close()
      const upgraded = new DatabaseSync(filePath)
      const columns = (upgraded.prepare('pragma table_info(mi_analysis_runs)').all() as Array<{ name: string }>).map(row => row.name)
      expect(columns).toEqual(expect.arrayContaining(['retry_used_at', 'retry_result']))
      const index = upgraded.prepare("select name from sqlite_schema where type='index' and name='idx_mi_analysis_run_retry'").get()
      expect(index).toBeDefined()
      upgraded.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
