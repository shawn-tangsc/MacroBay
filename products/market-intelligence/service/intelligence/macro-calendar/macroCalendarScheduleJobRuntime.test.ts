import { describe, expect, it, vi } from 'vitest'
import { createJobRuntime } from '@platform/jobs'
import { createJobRunSqliteStore } from '@platform/jobs'

import { macroCalendarTransportPolicy } from './macroCalendarPolicy'
import { createMacroCalendarScheduleJobRuntime, macroCalendarScheduleJobPolicy } from './macroCalendarScheduleJobRuntime'

describe('macroCalendarScheduleJobRuntime', () => {
  it('covers the full one-provider transport window plus its bounded completion observation margin', () => {
    const oneProviderTransportWindowMs = macroCalendarTransportPolicy.requestTimeoutMs * macroCalendarTransportPolicy.maxAttempts

    expect(macroCalendarScheduleJobPolicy.manualCompletionBudgetMs).toBe(
      oneProviderTransportWindowMs + macroCalendarScheduleJobPolicy.manualCompletionObservationMarginMs
    )
  })

  it('arms the first last-complete interval after the startup execution with the real job runtime', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'))
    try {
      const jobRuntime = createJobRuntime()
      const collectAndUpdateHealth = vi.fn(async () => ({ state: 'updated' as const }))
      const service = createMacroCalendarScheduleJobRuntime({
        jobRuntime,
        profiles: { list: vi.fn(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]) },
        health: { collectAndUpdateHealth }
      })

      await service.initialize()
      await vi.waitFor(() => expect(collectAndUpdateHealth).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(macroCalendarScheduleJobPolicy.scheduleIntervalMs - 1)
      expect(collectAndUpdateHealth).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() => expect(collectAndUpdateHealth).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs enabled Fed and BEA schedules through the health service with one job attempt and the job signal', async () => {
    const runtime = createHarness(['macro-calendar-fed', 'macro-calendar-bea'])

    await runtime.service.initialize()
    const startup = runtime.handlers.get(macroCalendarScheduleJobPolicy.handlerId)!
    const controller = new AbortController()
    await startup({}, { jobRunId: 'startup-run', signal: controller.signal, log: vi.fn(async () => undefined) })

    expect(runtime.setSchedule).toHaveBeenCalledWith(expect.objectContaining({
      id: macroCalendarScheduleJobPolicy.intervalDefinitionId,
      handlerId: macroCalendarScheduleJobPolicy.handlerId,
      trigger: { kind: 'interval', intervalMs: macroCalendarScheduleJobPolicy.scheduleIntervalMs, anchor: 'lastComplete' },
      retryPolicy: macroCalendarScheduleJobPolicy.jobRetryPolicy
    }))
    expect(runtime.enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({
      id: macroCalendarScheduleJobPolicy.intervalDefinitionId,
      trigger: { kind: 'startup' }
    }))
    expect(runtime.collectAndUpdateHealth).toHaveBeenCalledTimes(2)
    expect(runtime.collectAndUpdateHealth).toHaveBeenNthCalledWith(1, expect.objectContaining({ descriptorId: 'macro-calendar-fed-schedule', runId: 'startup-run', signal: controller.signal }))
    expect(runtime.collectAndUpdateHealth).toHaveBeenNthCalledWith(2, expect.objectContaining({ descriptorId: 'macro-calendar-bea-schedule', runId: 'startup-run', signal: controller.signal }))
  })

  it('does not invoke a disabled provider during scheduled or manual refresh', async () => {
    const runtime = createHarness(['macro-calendar-fed'])
    const handler = runtime.handlers.get(macroCalendarScheduleJobPolicy.handlerId)!

    await handler({}, { jobRunId: 'interval-run', signal: new AbortController().signal, log: vi.fn(async () => undefined) })
    await runtime.service.runProviderNow('macro-calendar-bea')

    expect(runtime.collectAndUpdateHealth).toHaveBeenCalledOnce()
    expect(runtime.collectAndUpdateHealth).toHaveBeenCalledWith(expect.objectContaining({ descriptorId: 'macro-calendar-fed-schedule' }))
    expect(runtime.enqueueDefinition).not.toHaveBeenCalled()
  })

  it('re-reads an enabled profile before enqueueing one provider-scoped manual run', async () => {
    const runtime = createHarness(['macro-calendar-bea'])

    await expect(runtime.service.runProviderNow('macro-calendar-bea')).resolves.toEqual({ state: 'completed', outcome: 'succeeded' })

    expect(runtime.enqueueDefinition).toHaveBeenCalledOnce()
    expect(runtime.enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({
      trigger: { kind: 'manual' }, payload: { providerId: 'macro-calendar-bea' }, retryPolicy: macroCalendarScheduleJobPolicy.jobRetryPolicy
    }))
  })

  it.each([
    ['completed', 'succeeded'],
    ['failed', 'failed'],
    ['cancelled', 'failed']
  ] as const)('maps exact terminal %s status for the accepted run', async (status, outcome) => {
    const runtime = createHarness(['macro-calendar-fed'], undefined, undefined, undefined, status)

    await expect(runtime.service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'completed', outcome })
    expect(runtime.getRun).toHaveBeenCalledWith('manual-run')
  })

  it('returns queued after the bounded deadline and performs one final observation', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createHarness(['macro-calendar-fed'], undefined, undefined, undefined, 'queued')
      const pending = runtime.service.runProviderNow('macro-calendar-fed')
      await vi.advanceTimersByTimeAsync(macroCalendarScheduleJobPolicy.manualCompletionBudgetMs)
      await expect(pending).resolves.toEqual({ state: 'queued' })
      expect(runtime.getRun).toHaveBeenCalled()
      expect(runtime.getRun).toHaveBeenLastCalledWith('manual-run')
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    { label: 'missing id', value: { status: 'queued' } },
    { label: 'foreign id', value: { id: 'foreign', status: 'queued' } },
    { label: 'extension', value: { id: 'manual-run', definitionId: 'wrong', extra: true, status: 'queued' } },
    { label: 'proxy', value: new Proxy({}, { getPrototypeOf() { throw new Error('secret') } }) }
  ])('fails closed for an invalid enqueue result: $label', async ({ value }) => {
    const runtime = createHarness(['macro-calendar-fed'], undefined, undefined, undefined, 'queued', value)
    await expect(runtime.service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'schedule-provider-unavailable' })
    expect(runtime.getRun).not.toHaveBeenCalled()
  })

  it('fails closed for a foreign observation after enqueue was accepted', async () => {
    const runtime = createHarness(['macro-calendar-fed'], undefined, undefined, undefined, 'queued', undefined, { id: 'manual-run', definitionId: 'wrong' })
    await expect(runtime.service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'failed', failureCode: 'schedule-provider-unavailable' })
  })

  it('requires one exact manual descriptor and a five-field healthy result', async () => {
    let enabled = true
    const runtime = createHarness(['macro-calendar-fed'], undefined, undefined, undefined, 'completed', undefined, undefined, () => enabled)
    const handler = runtime.handlers.get(macroCalendarScheduleJobPolicy.handlerId)!
    enabled = false
    await expect(handler({ providerId: 'macro-calendar-fed' }, { jobRunId: 'manual-run', signal: new AbortController().signal, log: vi.fn(async () => undefined) })).rejects.toThrow('Macro calendar schedule run failed.')
    expect(runtime.collectAndUpdateHealth).not.toHaveBeenCalled()
  })

  it('attempts every selected startup descriptor before failing the aggregate job', async () => {
    const runtime = createHarness(['macro-calendar-fed', 'macro-calendar-bea'], undefined, undefined, undefined, 'completed', undefined, undefined, undefined, [
      { providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'updated', healthStatus: 'failed', consecutiveFailures: 1 },
      { providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-schedule', state: 'updated', healthStatus: 'healthy', consecutiveFailures: 0 }
    ])
    const handler = runtime.handlers.get(macroCalendarScheduleJobPolicy.handlerId)!
    await expect(handler({}, { jobRunId: 'startup-run', signal: new AbortController().signal, log: vi.fn(async () => undefined) })).rejects.toThrow('Macro calendar schedule run failed.')
    expect(runtime.collectAndUpdateHealth).toHaveBeenCalledTimes(2)
  })

  it('accepts a SQLite-backed run with legitimate optional own fields', async () => {
    const store = createJobRunSqliteStore(':memory:')
    try {
      const jobRuntime = createJobRuntime({ store })
      const collectAndUpdateHealth = vi.fn(async (input: { descriptorId: string }) => ({
        providerId: input.descriptorId.replace('-schedule', ''), descriptorId: input.descriptorId,
        state: 'updated' as const, healthStatus: 'healthy' as const, consecutiveFailures: 0
      }))
      const service = createMacroCalendarScheduleJobRuntime({
        jobRuntime,
        profiles: { list: vi.fn(async () => [{ providerId: 'macro-calendar-fed', enabled: true }]) },
        health: { collectAndUpdateHealth }
      })

      await expect(service.runProviderNow('macro-calendar-fed')).resolves.toEqual({ state: 'completed', outcome: 'succeeded' })
    } finally {
      store.close()
    }
  })

  it('fails closed for invalid manual provider input and dependency exceptions without leaking or retrying', async () => {
    const runtime = createHarness(['macro-calendar-fed'], new Error('https://secret.example.test/?credential=raw body'))
    const handler = runtime.handlers.get(macroCalendarScheduleJobPolicy.handlerId)!

    await expect(runtime.service.runProviderNow('macro-calendar-bls')).resolves.toEqual({ state: 'skipped', failureCode: 'schedule-provider-unavailable' })
    await expect(handler({}, { jobRunId: 'failure-run', signal: new AbortController().signal, log: vi.fn(async () => undefined) })).rejects.toThrow('Macro calendar schedule run failed.')
    expect(runtime.enqueueDefinition).not.toHaveBeenCalled()
    expect(runtime.collectAndUpdateHealth).toHaveBeenCalledOnce()
  })

  it('contains a profile-read failure during startup initialization without scheduling a run', async () => {
    const runtime = createHarness([], undefined, new Error('https://secret.example.test/?credential=raw body'))

    await expect(runtime.service.initialize()).resolves.toBeUndefined()

    expect(runtime.setSchedule).not.toHaveBeenCalled()
    expect(runtime.enqueueStartup).not.toHaveBeenCalled()
  })

  it('contains a startup enqueue failure without propagating dependency text', async () => {
    const runtime = createHarness(['macro-calendar-fed'], undefined, undefined, new Error('https://secret.example.test/?credential=raw body'))

    await expect(runtime.service.initialize()).resolves.toBeUndefined()

    expect(runtime.enqueueDefinition).toHaveBeenCalledOnce()
  })

  it('does not schedule disabled providers and removes the interval schedule when disposed', async () => {
    const runtime = createHarness([])

    await runtime.service.initialize()
    runtime.service.dispose()

    expect(runtime.setSchedule).not.toHaveBeenCalled()
    expect(runtime.enqueueDefinition).not.toHaveBeenCalled()
    expect(runtime.removeSchedule).toHaveBeenCalledWith(macroCalendarScheduleJobPolicy.intervalDefinitionId)
  })
})

function createHarness(
  enabledProviderIds: string[],
  healthError?: Error,
  profileError?: Error,
  startupError?: Error,
  terminalStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' = 'completed',
  enqueueResult?: unknown,
  observedRun?: unknown,
  enabledOverride?: () => boolean,
  healthResults?: unknown[]
) {
  const handlers = new Map<string, (payload: unknown, context: { jobRunId: string; signal: AbortSignal; log: ReturnType<typeof vi.fn> }) => Promise<void>>()
  const registerHandler = vi.fn((id: string, handler) => handlers.set(id, handler))
  const setSchedule = vi.fn()
  const removeSchedule = vi.fn()
  const enqueueStartup = vi.fn(async () => ({ id: 'startup-run' }))
  const exactRun = (status: typeof terminalStatus, providerId = 'macro-calendar-fed') => ({
    id: 'manual-run', definitionId: `${macroCalendarScheduleJobPolicy.handlerId}.manual.${providerId}`,
    handlerId: macroCalendarScheduleJobPolicy.handlerId, owner: 'product', productId: 'market-intelligence',
    title: 'Refresh macro calendar schedules', status, trigger: { kind: 'manual' }, payload: { providerId },
    concurrencyKey: macroCalendarScheduleJobPolicy.handlerId, attempt: 1, maxAttempts: 1,
    createdAt: '2026-08-04T00:00:00.000Z', logs: [],
    ...(status !== 'queued' ? { startedAt: '2026-08-04T00:00:00.001Z' } : {}),
    ...(['completed', 'failed', 'cancelled'].includes(status) ? { completedAt: '2026-08-04T00:00:00.002Z' } : {})
  })
  const enqueueDefinition = vi.fn(async (definition: { payload?: { providerId?: string } }) => { if (startupError) throw startupError; return enqueueResult ?? exactRun('queued', definition.payload?.providerId ?? 'macro-calendar-fed') })
  const getRun = vi.fn((runId: string) => observedRun ?? exactRun(terminalStatus, enabledProviderIds[0] ?? 'macro-calendar-fed'))
  let healthIndex = 0
  const collectAndUpdateHealth = vi.fn(async (input: { descriptorId: string }) => {
    if (healthError) throw healthError
    const configured = healthResults?.[healthIndex++]
    return configured ?? { providerId: input.descriptorId.replace('-schedule', ''), descriptorId: input.descriptorId, state: 'updated' as const, healthStatus: 'healthy' as const, consecutiveFailures: 0 }
  })
  return {
    service: createMacroCalendarScheduleJobRuntime({
      jobRuntime: { registerHandler, setSchedule, removeSchedule, enqueueStartup, enqueueDefinition, getRun },
      profiles: { list: vi.fn(async () => { if (profileError) throw profileError; return enabledProviderIds.map((providerId) => ({ providerId, enabled: enabledOverride ? enabledOverride() : true })) }) },
      health: { collectAndUpdateHealth }
    }),
    handlers, setSchedule, removeSchedule, enqueueStartup, enqueueDefinition, getRun, collectAndUpdateHealth
  }
}
