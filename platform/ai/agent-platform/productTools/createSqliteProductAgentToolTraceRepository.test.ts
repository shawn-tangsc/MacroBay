import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { createSqliteProductAgentToolTraceRepository } from './createSqliteProductAgentToolTraceRepository'

describe('createSqliteProductAgentToolTraceRepository', () => {
  it('inserts terminal traces directly and finalizes running traces', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repository = createSqliteProductAgentToolTraceRepository(database)

    await repository.insert({
      toolCallId: 'trace-failed-1',
      productId: 'market-intelligence',
      toolName: 'get_source_health',
      handlerId: 'market-intelligence.get-source-health',
      schemaVersion: 1,
      agentId: 'agent-1',
      agentSessionId: 'session-1',
      inputHash: 'input-hash',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      status: 'failed',
      errorCode: 'tool-disabled'
    })

    const failed = await repository.get('trace-failed-1')
    expect(failed?.status).toBe('failed')
    expect(failed?.errorCode).toBe('tool-disabled')

    await repository.insert({
      toolCallId: 'trace-running-1',
      productId: 'market-intelligence',
      toolName: 'get_source_health',
      handlerId: 'market-intelligence.get-source-health',
      schemaVersion: 1,
      agentId: 'agent-1',
      agentSessionId: 'session-1',
      inputHash: 'input-hash',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running'
    })

    await repository.finalize({
      toolCallId: 'trace-running-1',
      productId: 'market-intelligence',
      toolName: 'get_source_health',
      handlerId: 'market-intelligence.get-source-health',
      schemaVersion: 1,
      agentId: 'agent-1',
      agentSessionId: 'session-1',
      inputHash: 'input-hash',
      outputHash: 'output-hash',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:02.000Z',
      durationMs: 2000,
      status: 'completed',
      resultSizeBytes: 128
    })

    const completed = await repository.get('trace-running-1')
    expect(completed?.status).toBe('completed')
    expect(completed?.outputHash).toBe('output-hash')
  })
})
