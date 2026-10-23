import { describe, expect, it, vi } from 'vitest'

import {
  createWarmQueryConsumptionPolicy,
  WarmQueryConsumptionError,
  type WarmQueryConsumptionAuditEntry,
  type WarmQueryConsumptionHandleMeta
} from './warmQueryConsumptionPolicy'

type FakeWarmQueryHandle = {
  query: (prompt: string) => AsyncIterable<{ type: 'text'; text: string }>
  close: () => void
}

function createOneShotHandle(): {
  handle: FakeWarmQueryHandle
  queryCalls: string[]
  closeCalls: () => number
} {
  const queryCalls: string[] = []
  let consumed = false
  let closeCount = 0
  const handle: FakeWarmQueryHandle = {
    query(prompt: string) {
      if (consumed) throw new Error('WarmQuery.query() can only be called once')
      consumed = true
      queryCalls.push(prompt)
      return (async function* iterate() {
        yield { type: 'text' as const, text: prompt }
      })()
    },
    close() {
      closeCount += 1
    }
  }
  return { handle, queryCalls, closeCalls: () => closeCount }
}

const executeMeta = (runId = 'run-1'): WarmQueryConsumptionHandleMeta => ({
  origin: 'execute-cache-hit',
  moduleSource: 'claude-agent-sdk',
  platformSessionId: 'session-opaque-1',
  runId
})

const prewarmMeta = (runId = 'run-prewarm'): WarmQueryConsumptionHandleMeta => ({
  origin: 'prewarm',
  moduleSource: 'claude-agent-sdk',
  platformSessionId: 'session-opaque-1',
  runId
})

function createSink(): {
  entries: WarmQueryConsumptionAuditEntry[]
  sink: (entry: WarmQueryConsumptionAuditEntry) => void
} {
  const entries: WarmQueryConsumptionAuditEntry[] = []
  return { entries, sink: (entry) => entries.push(entry) }
}

function expectConsumptionRejection(
  run: () => unknown,
  code: WarmQueryConsumptionError['code'],
  handleSequence?: number
): void {
  let failure: unknown
  try {
    run()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(WarmQueryConsumptionError)
  expect((failure as WarmQueryConsumptionError).code).toBe(code)
  if (handleSequence !== undefined) {
    expect((failure as WarmQueryConsumptionError).handleSequence).toBe(handleSequence)
  }
}

describe('WarmQueryConsumptionPolicy identity fence', () => {
  it('rejects the second claim on the same object identity before the SDK is called twice', () => {
    const { entries, sink } = createSink()
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const { handle, queryCalls } = createOneShotHandle()

    policy.register(handle, prewarmMeta())
    policy.claimThenCreate(handle, executeMeta('run-1'), () => handle.query('first prompt'))

    let failure: unknown
    try {
      policy.claimThenCreate(handle, executeMeta('run-2'), () => handle.query('second prompt'))
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(WarmQueryConsumptionError)
    expect((failure as WarmQueryConsumptionError).code).toBe('warm-query-identity-already-consumed')
    expect(queryCalls).toEqual(['first prompt'])
    expect(entries.filter((entry) => entry.event === 'claim-granted')).toHaveLength(1)
    expect(entries).toContainEqual(
      expect.objectContaining({ event: 'claim-rejected', handleSequence: 1, claimCount: 1 })
    )
  })

  it('claims synchronously so two claims issued in the same tick cannot both win', () => {
    const { entries, sink } = createSink()
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const { handle, queryCalls } = createOneShotHandle()

    policy.register(handle, prewarmMeta())
    const outcomes: string[] = []
    for (const runId of ['run-a', 'run-b']) {
      try {
        policy.claimThenCreate(handle, executeMeta(runId), () => handle.query(runId))
        outcomes.push(`${runId}:claimed`)
      } catch (error) {
        outcomes.push(`${runId}:${(error as WarmQueryConsumptionError).code}`)
      }
    }

    expect(outcomes).toEqual(['run-a:claimed', 'run-b:warm-query-identity-already-consumed'])
    expect(queryCalls).toEqual(['run-a'])
    expect(entries.filter((entry) => entry.event === 'claim-granted')).toHaveLength(1)
  })

  it('fails closed when a startup result re-enters registration with the same object identity', () => {
    const { entries, sink } = createSink()
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const { handle, queryCalls } = createOneShotHandle()

    policy.register(handle, prewarmMeta('run-startup-1'))

    expectConsumptionRejection(
      () => policy.register(handle, executeMeta('run-startup-2')),
      'warm-query-identity-reused-on-register',
      1
    )
    expect(queryCalls).toEqual([])
    expect(entries.filter((entry) => entry.event === 'handle-created')).toHaveLength(1)
    expect(entries.filter((entry) => entry.event === 'claim-granted')).toHaveLength(0)
  })

  it('never re-claims a closed identity and closes idempotently', () => {
    const { entries, sink } = createSink()
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const { handle } = createOneShotHandle()

    policy.register(handle, prewarmMeta())
    policy.claimThenCreate(handle, executeMeta(), () => handle.query('prompt'))
    policy.close(handle, 'consumed')
    policy.close(handle, 'consumed')

    expect(entries.filter((entry) => entry.event === 'handle-closed')).toHaveLength(1)
    expect(entries.filter((entry) => entry.event === 'handle-closed')).toContainEqual(
      expect.objectContaining({ closeReason: 'consumed', handleSequence: 1 })
    )
    expectConsumptionRejection(
      () => policy.claimThenCreate(handle, executeMeta('run-2'), () => handle.query('again')),
      'warm-query-identity-closed',
      1
    )
  })

  it('grants exactly one claim per distinct object identity and numbers handles monotonically', () => {
    const { entries, sink } = createSink()
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const first = createOneShotHandle()
    const second = createOneShotHandle()

    policy.register(first.handle, prewarmMeta())
    policy.register(second.handle, executeMeta('run-2'))
    policy.claimThenCreate(first.handle, executeMeta('run-1'), () => first.handle.query('one'))
    policy.claimThenCreate(second.handle, executeMeta('run-2'), () => second.handle.query('two'))

    expect(first.queryCalls).toEqual(['one'])
    expect(second.queryCalls).toEqual(['two'])
    expect(
      entries.filter((entry) => entry.event === 'handle-created').map((entry) => entry.handleSequence)
    ).toEqual([1, 2])
  })

  it('refuses to claim an object identity the adapter never registered', () => {
    const { entries, sink } = createSink()
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const { handle, queryCalls } = createOneShotHandle()

    expectConsumptionRejection(
      () => policy.claimThenCreate(handle, executeMeta(), () => handle.query('prompt')),
      'warm-query-identity-unregistered'
    )
    expect(queryCalls).toEqual([])
  })

  it('keeps diagnostics free of prompts, credentials, resume tokens, paths and raw stacks', () => {
    const { entries, sink } = createSink()
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const { handle } = createOneShotHandle()

    const sensitive = [
      'PROMPT-FIXTURE-9f3a17',
      'sk-test-KEY-4b1c22',
      'resume-token-fixture-77e0',
      '/Users/fixture-user/.claude/session.jsonl',
      'at warmQuery.query (/Users/fixture-user/.claude/sdk.js:1:1)'
    ]
    const sdkFailure = new Error(`sdk failed for ${sensitive.join(' ')}`)

    policy.register(handle, { ...prewarmMeta(), platformSessionId: 'session-opaque-1' })
    let sdkPropagation: unknown
    try {
      policy.claimThenCreate(handle, executeMeta('run-1'), () => {
        throw sdkFailure
      })
    } catch (error) {
      sdkPropagation = error
    }
    let consumptionFailure: WarmQueryConsumptionError | undefined
    try {
      policy.claimThenCreate(handle, executeMeta('run-2'), () => handle.query(sensitive[0]))
    } catch (error) {
      consumptionFailure = error as WarmQueryConsumptionError
    }

    // The SDK failure is propagated unchanged: no wrapping, no catch-and-retry.
    expect(sdkPropagation).toBe(sdkFailure)

    const auditPayload = JSON.stringify(entries)
    for (const value of sensitive) {
      expect(auditPayload).not.toContain(value)
    }
    expect(auditPayload).not.toContain('/')
    expect(auditPayload).not.toContain('at warmQuery')

    expect(consumptionFailure).toBeInstanceOf(WarmQueryConsumptionError)
    for (const value of sensitive) {
      expect(consumptionFailure?.message).not.toContain(value)
    }
    expect(consumptionFailure?.message).not.toContain('/')
    expect(String(consumptionFailure)).not.toContain('sdk failed')
  })

  it('lets the claim path proceed when the audit sink itself throws', () => {
    const sink = vi.fn(() => {
      throw new Error('audit sink unavailable')
    })
    const policy = createWarmQueryConsumptionPolicy({ auditSink: sink })
    const { handle, queryCalls } = createOneShotHandle()

    policy.register(handle, prewarmMeta())
    const iterable = policy.claimThenCreate(handle, executeMeta(), () => handle.query('prompt'))

    expect(iterable).toBeDefined()
    expect(queryCalls).toEqual(['prompt'])
    expect(sink).toHaveBeenCalled()
  })
})
