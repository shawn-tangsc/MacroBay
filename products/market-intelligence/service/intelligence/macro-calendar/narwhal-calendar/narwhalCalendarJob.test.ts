import { describe, expect, it, vi } from 'vitest'

import {
  createNarwhalCalendarJobHandler, narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy
} from './narwhalCalendarJob'

const runtimeWith = (result: unknown) => ({
  run: vi.fn(async () => result)
} as unknown as Parameters<typeof createNarwhalCalendarJobHandler>[0]['runtime'])
/** 测试里显式声明「全开」：生产靠默认放行不正常，所以这里不省略。 */
const openGate = async () => ({ visibility: 'visible', enabled: true })

const succeeded = { collector: { state: 'completed', pages: 1, releases: 5 }, firstPublishedCaptured: 9 }

describe('narwhal calendar jobs', () => {
  it('tick sweeps only UTC today so a fresh release shows up within the half hour', async () => {
    const runtime = runtimeWith(succeeded)
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T23:30:00Z'), mode: 'tick', readSourceGate: openGate })
    const outcome = await handler()
    expect(runtime.run).toHaveBeenCalledWith({ startDate: '2026-11-13', endDate: '2026-11-13', countries: ['USA', 'DEU', 'GBR', 'JPN'] })
    expect(outcome).toMatchObject({ state: 'succeeded', releases: 5 })
  })

  it('sweep covers the next 30 days — future schedule, not history', async () => {
    const runtime = runtimeWith(succeeded)
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T00:00:00Z'), mode: 'sweep', readSourceGate: openGate })
    await handler()
    expect(runtime.run).toHaveBeenCalledWith({ startDate: '2026-11-13', endDate: '2026-12-12', countries: ['USA', 'DEU', 'GBR', 'JPN'] })
  })

  it('keeps both definitions: 30-minute tick and daily sweep', () => {
    expect(narwhalCalendarTickPolicy.intervalMs).toBe(30 * 60 * 1_000)
    expect(narwhalCalendarSweepPolicy.intervalMs).toBe(24 * 60 * 60 * 1_000)
    expect(narwhalCalendarTickPolicy.definitionId).not.toBe(narwhalCalendarSweepPolicy.definitionId)
  })

  it('reports the collector failure code instead of pretending the sweep ran', async () => {
    const runtime = runtimeWith({ collector: { state: 'failed', failureCode: 'credential-not-configured', pagesRead: 0 }, firstPublishedCaptured: 0 })
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T00:00:00Z'), mode: 'tick', readSourceGate: openGate })
    expect(await handler()).toMatchObject({ state: 'failed', failureCode: 'credential-not-configured' })
  })
})

describe('采集前的门：读者没打开就不采', () => {
  const handler = (gate: () => Promise<{ visibility: string; enabled: boolean } | undefined>) => {
    const run = vi.fn(async () => ({ collector: { state: 'completed', pages: 1, releases: 3 }, firstPublishedCaptured: 0 }))
    return {
      run,
      job: createNarwhalCalendarJobHandler({ runtime: { run } as never, now: () => Date.parse('2026-11-13T10:30:00.000Z'),
        mode: 'tick', readSourceGate: gate })
    }
  }

  it('源还锁着（pending）→ skipped，一个请求都不发', async () => {
    const { run, job } = handler(async () => ({ visibility: 'pending', enabled: true }))
    await expect(job()).resolves.toMatchObject({ state: 'skipped', reason: 'source-pending' })
    expect(run).not.toHaveBeenCalled()
  })

  it('读者把源关掉 → skipped，一个请求都不发', async () => {
    const { run, job } = handler(async () => ({ visibility: 'visible', enabled: false }))
    await expect(job()).resolves.toMatchObject({ state: 'skipped', reason: 'reader-disabled' })
    expect(run).not.toHaveBeenCalled()
  })

  it('已解锁且读者开着 → 照常采', async () => {
    const { run, job } = handler(async () => ({ visibility: 'visible', enabled: true }))
    await expect(job()).resolves.toMatchObject({ state: 'succeeded' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('读不到源状态 → fail-closed，不采（宁可空一轮，也不绕过读者）', async () => {
    const { run, job } = handler(async () => undefined)
    await expect(job()).resolves.toMatchObject({ state: 'skipped', reason: 'gate-missing' })
    expect(run).not.toHaveBeenCalled()
  })

  it('门根本没注入 → 也不采（生产漏接时不许静默放行）', async () => {
    const run = vi.fn()
    const job = createNarwhalCalendarJobHandler({ runtime: { run } as never,
      now: () => Date.parse('2026-11-13T10:30:00.000Z'), mode: 'tick' })
    await expect(job()).resolves.toMatchObject({ state: 'skipped', reason: 'gate-missing' })
    expect(run).not.toHaveBeenCalled()
  })
})
