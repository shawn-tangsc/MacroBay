import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { analysisIoRetentionPolicy, analysisIoCutoffIso } from '../retention/analysisIoRetention'
import { createAnalysisIoStore, migrateAnalysisIo } from './marketAnalysisIoStore'

const day = 24 * 3_600_000
const now = Date.UTC(2026, 10, 6, 12, 0, 0)

function store() {
  const database = new DatabaseSync(':memory:')
  migrateAnalysisIo(database)
  return { database, io: createAnalysisIoStore(database) }
}

const repeatedPrompt = (size: number) => [{ role: 'user', content: 'x'.repeat(size) }]

describe('the analysis call record', () => {
  it('stores the rendered prompt before the call and the answer after it, compressed', () => {
    const { io } = store()
    const prompt = repeatedPrompt(8_000)
    const { id } = io.begin({
      analysisRunId: 'mi-ar-1', callIndex: 1, callKind: 'initial', prompt,
      modelProviderId: 'provider', modelId: 'model', promptVersion: 'prompt.v1', timeoutMs: 240_000, atMs: now
    })
    expect(io.complete({ id, outputStatus: 'answered', output: { ok: true }, atMs: now + 1000 })).toBe(true)

    const [row] = io.readByRunId('mi-ar-1')
    expect(row).toMatchObject({ analysisRunId: 'mi-ar-1', callIndex: 1, callKind: 'initial', outputStatus: 'answered', createdAt: new Date(now).toISOString() })
    expect(row!.prompt).toEqual({ state: 'read', value: prompt })
    expect(row!.output).toEqual({ state: 'read', value: { ok: true } })
    expect(row!.promptBytes).toBeGreaterThan(8_000)
    expect(row!.promptSha256).toMatch(/^[a-f0-9]{64}$/)

    // The occupancy is the compressed bytes actually in the columns, not the decoded length.
    const usage = io.usage()
    expect(usage.rows).toBe(1)
    expect(usage.bytes).toBeGreaterThan(0)
    expect(usage.bytes).toBeLessThan(row!.promptBytes!)
  })

  it('keeps one row per call index, so a repair keeps the answer that was thrown away', () => {
    const { io } = store()
    io.begin({ analysisRunId: 'mi-ar-2', callIndex: 1, callKind: 'initial', prompt: 'first', atMs: now })
    io.begin({ analysisRunId: 'mi-ar-2', callIndex: 2, callKind: 'repair', prompt: 'second', atMs: now + 1000 })
    expect(io.readByRunId('mi-ar-2').map(row => row.callKind)).toEqual(['initial', 'repair'])
    expect(() => io.begin({ analysisRunId: 'mi-ar-2', callIndex: 1, callKind: 'initial', prompt: 'again', atMs: now })).toThrow()
  })

  it('records a call whose answer never arrived without inventing one', () => {
    const { io } = store()
    const { id } = io.begin({ analysisRunId: 'mi-ar-3', callIndex: 3, callKind: 'transport-retry', prompt: 'prompt', atMs: now })
    expect(io.complete({ id, outputStatus: 'transport-error', failureDetailCode: 'upstream-aborted', atMs: now + 55_000 })).toBe(true)
    const [row] = io.readByRunId('mi-ar-3')
    expect(row).toMatchObject({ outputStatus: 'transport-error', failureDetailCode: 'upstream-aborted' })
    expect(row!.output).toEqual({ state: 'absent' })
    expect(row!.prompt.state).toBe('read')
  })

  it('withholds a credential-shaped prompt body but still proves a call happened', () => {
    const { io } = store()
    io.begin({ analysisRunId: 'mi-ar-4', callIndex: 1, callKind: 'initial', prompt: 'sk-secret', withheldReason: 'credential-shape', atMs: now })
    const [row] = io.readByRunId('mi-ar-4')
    expect(row).toMatchObject({ withheldReason: 'credential-shape', promptBytes: expect.any(Number), promptSha256: expect.any(String) })
    expect(row!.prompt).toEqual({ state: 'withheld' })
  })

  it('reports a damaged prompt as unreadable instead of empty, and leaves the row for the age policy', () => {
    const { io, database } = store()
    const { id } = io.begin({ analysisRunId: 'mi-ar-5', callIndex: 1, callKind: 'initial', prompt: 'prompt', atMs: now })
    io.complete({ id, outputStatus: 'answered', output: 'answer', atMs: now })
    database.prepare('update mi_analysis_io set prompt_gzip=? where id=?').run(new Uint8Array([1, 2, 3]), id)

    const [row] = io.readByRunId('mi-ar-5')
    expect(row!.prompt).toEqual({ state: 'corrupt' })
    expect(row!.output).toEqual({ state: 'read', value: 'answer' })
    expect(io.usage().rows).toBe(1)
  })

  it('deletes by age first, and reports the bytes on both sides of the pass', () => {
    const { io } = store()
    io.begin({ analysisRunId: 'mi-ar-old', callIndex: 1, callKind: 'initial', prompt: 'old', atMs: now - 31 * day })
    io.begin({ analysisRunId: 'mi-ar-new', callIndex: 1, callKind: 'initial', prompt: 'new', atMs: now - 29 * day })

    const result = io.retention({ cutoffIso: analysisIoCutoffIso(now) })
    expect(result.deleted).toBe(1)
    expect(result.bytesBefore).toBeGreaterThan(result.bytesAfter)
    expect(result.bytesAfter).toBeGreaterThan(0)
    expect(result.oldestKeptAtMs).toBe(now - 29 * day)
    expect(io.readByRunId('mi-ar-old')).toEqual([])
    expect(io.readByRunId('mi-ar-new')).toHaveLength(1)
  })

  it('deletes the oldest rows until the compressed bytes are back under the ceiling', () => {
    const { io } = store()
    for (let index = 0; index < 5; index += 1) {
      io.begin({ analysisRunId: `mi-ar-${index}`, callIndex: 1, callKind: 'initial', prompt: `${index}-${'y'.repeat(2_000)}`, atMs: now - (5 - index) * 1000 })
    }
    const usageBefore = io.usage()
    expect(usageBefore.bytes).toBeGreaterThan(0)
    const budget = Math.floor(usageBefore.bytes / 3)

    const result = io.retention({ cutoffIso: analysisIoCutoffIso(now), byteBudgetBytes: budget })
    expect(result.bytesBefore).toBe(usageBefore.bytes)
    expect(result.deleted).toBeGreaterThan(0)
    expect(result.bytesAfter).toBeLessThanOrEqual(budget)
    // Oldest first: everything that survives is newer than everything that went.
    const kept = [0, 1, 2, 3, 4].filter(index => io.readByRunId(`mi-ar-${index}`).length > 0)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(5)
    expect(kept).toEqual(Array.from({ length: kept.length }, (_, index) => 5 - kept.length + index))
    expect(io.readByRunId('mi-ar-0')).toEqual([])
  })

  it('reports the same occupancy before and after a pass that had nothing to delete', () => {
    const { io } = store()
    io.begin({ analysisRunId: 'mi-ar-6', callIndex: 1, callKind: 'initial', prompt: 'small', atMs: now })
    const result = io.retention({ cutoffIso: analysisIoCutoffIso(now) })
    // "Nothing was deleted" and "the pass never ran" must stay distinguishable in the ledger.
    expect(result.deleted).toBe(0)
    expect(result.bytesBefore).toBe(result.bytesAfter)
    expect(result.bytesBefore).toBeGreaterThan(0)
  })

  it('refuses a completion that names no row and a status that claims a call is still in flight', () => {
    const { io } = store()
    expect(io.complete({ id: 'mi-io-missing', outputStatus: 'answered', output: 'x' })).toBe(false)
    const { id } = io.begin({ analysisRunId: 'mi-ar-7', callIndex: 1, callKind: 'initial', prompt: 'prompt' })
    expect(() => io.complete({ id, outputStatus: 'inflight' })).toThrowError('analysis-io-output-status-invalid')
    expect(analysisIoRetentionPolicy.byteBudget).toBe(100 * 1024 * 1024)
  })
})
