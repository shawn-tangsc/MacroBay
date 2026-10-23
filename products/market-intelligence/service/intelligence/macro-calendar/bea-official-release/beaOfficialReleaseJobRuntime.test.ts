import { describe, expect, it, vi } from 'vitest'

import { beaOfficialReleaseJobPolicy, createBeaOfficialReleaseJobRuntime } from './beaOfficialReleaseJobRuntime'

type Handler = (payload: unknown, context: { jobRunId: string; signal: AbortSignal }) => Promise<void>

function harness(options: { enabled?: boolean; startupError?: Error } = {}) {
  const handlers = new Map<string, Handler>()
  const registerHandler = vi.fn((id: string, handler: Handler) => handlers.set(id, handler))
  const setSchedule = vi.fn()
  const removeSchedule = vi.fn()
  const enqueueDefinition = vi.fn(async () => {
    if (options.startupError) throw options.startupError
    return { id: 'startup-run' }
  })
  const refresh = vi.fn(async () => ({ state: 'unchanged' as const }))
  const runtime = createBeaOfficialReleaseJobRuntime({
    jobRuntime: { registerHandler, setSchedule, removeSchedule, enqueueDefinition },
    profiles: { list: vi.fn(async () => [{ providerId: 'macro-calendar-bea', enabled: options.enabled ?? true }]) },
    refresh: { refresh }
  })
  return { runtime, handlers, registerHandler, setSchedule, removeSchedule, enqueueDefinition, refresh }
}

describe('BEA official-release job runtime', () => {
  it('registers one product-owned interval and startup definition when enabled', async () => {
    const fixture = harness()
    await fixture.runtime.initialize()
    expect(fixture.registerHandler).toHaveBeenCalledWith(beaOfficialReleaseJobPolicy.handlerId, expect.any(Function))
    expect(fixture.setSchedule).toHaveBeenCalledWith(expect.objectContaining({
      id: beaOfficialReleaseJobPolicy.definitionId,
      owner: 'product',
      productId: 'market-intelligence',
      handlerId: beaOfficialReleaseJobPolicy.handlerId,
      trigger: { kind: 'interval', intervalMs: beaOfficialReleaseJobPolicy.schedulerIntervalMs, anchor: 'lastComplete' }
    }))
    expect(fixture.enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({
      id: beaOfficialReleaseJobPolicy.definitionId,
      trigger: { kind: 'startup' }
    }))
  })

  it('contains startup enqueue failures without exposing dependency details', async () => {
    const fixture = harness({ startupError: new Error('https://secret.invalid/?token=raw') })
    await expect(fixture.runtime.initialize()).resolves.toBeUndefined()
    expect(fixture.setSchedule).toHaveBeenCalledOnce()
  })

  it('contains profile failures and does not enqueue a duplicate startup run', async () => {
    const fixture = harness()
    await fixture.runtime.initialize()
    await fixture.runtime.initialize()
    expect(fixture.enqueueDefinition).toHaveBeenCalledOnce()

    const profiles = { list: vi.fn(async () => { throw new Error('profile /private/path') }) }
    const runtime = createBeaOfficialReleaseJobRuntime({
      jobRuntime: { registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn(), enqueueDefinition: vi.fn() },
      profiles,
      refresh: { refresh: vi.fn() }
    })
    await expect(runtime.initialize()).resolves.toBeUndefined()
  })

  it('disposal aborts and waits for an active handler before resolving', async () => {
    const fixture = harness()
    await fixture.runtime.initialize()
    const handler = fixture.handlers.get(beaOfficialReleaseJobPolicy.handlerId)!
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    fixture.refresh.mockImplementation(async (_input, signal) => {
      await Promise.race([pending, new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))])
      return { state: 'unchanged' as const }
    })
    const controller = new AbortController()
    const running = handler({}, { jobRunId: 'run-1', signal: controller.signal })
    await vi.waitFor(() => expect(fixture.refresh).toHaveBeenCalledOnce())
    let disposed = false
    const disposing = fixture.runtime.dispose().then(() => { disposed = true })
    await disposing
    expect(disposed).toBe(true)
    expect(fixture.removeSchedule).toHaveBeenCalledWith(beaOfficialReleaseJobPolicy.definitionId)
    release()
    await running
  })
})
