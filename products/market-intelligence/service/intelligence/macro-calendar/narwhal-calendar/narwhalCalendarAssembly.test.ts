import { describe, expect, it, vi } from 'vitest'

import { createNarwhalCalendarAssembly, narwhalCalendarCredentialRef } from './narwhalCalendarAssembly'
import { narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy } from './narwhalCalendarJob'

const repository = { upsertReleaseRow: vi.fn(), recordFirstPublished: vi.fn(() => true) } as never

const assemblyFor = (options: Readonly<{ apiKey?: string; readerEnabled?: () => boolean | undefined; fetchImpl?: typeof fetch }> = {}) => {
  const jobRuntime = { registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn(), enqueueDefinition: vi.fn(), listRuns: vi.fn(() => []) }
  const assembly = createNarwhalCalendarAssembly({
    readSourceGate: async () => ({ visibility: 'visible', enabled: true }),
    jobRuntime,
    repository,
    fetchImpl: options.fetchImpl ?? (vi.fn() as unknown as typeof fetch),
    getCredential: async ref => (ref === narwhalCalendarCredentialRef && options.apiKey !== undefined ? { apiKey: options.apiKey } : null),
    now: () => Date.parse('2026-11-13T00:00:00Z'),
    sleep: async () => undefined,
    ...(options.readerEnabled === undefined ? {} : { readerEnabled: options.readerEnabled })
  })
  return { assembly, jobRuntime }
}

describe('narwhal calendar assembly', () => {
  it('registers both jobs only after the credential is loaded', async () => {
    const { assembly, jobRuntime } = assemblyFor({ apiKey: 'k' })
    await assembly.initialize()
    expect(jobRuntime.setSchedule.mock.calls.map(call => (call[0] as { id: string }).id))
      .toEqual([narwhalCalendarTickPolicy.definitionId, narwhalCalendarSweepPolicy.definitionId])
  })

  it('registers nothing when the credential read returns nothing — a read failure is not a key error', async () => {
    const { assembly, jobRuntime } = assemblyFor({})
    await assembly.initialize()
    expect(jobRuntime.setSchedule).not.toHaveBeenCalled()
    expect(jobRuntime.removeSchedule).toHaveBeenCalledTimes(2)
  })

  /**
   * 启动那一刻凭据存储还没就绪（或这次读失败）：作业先不排（fail-closed），但**必须自愈**——
   * 晚到的凭据要在同一次启动里把两条定义排上，而不是等下一次重启。
   * 这条用例在「去掉启动重试」时必红。
   */
  it('schedules both jobs once a late credential arrives, without waiting for the next restart', async () => {
    vi.useFakeTimers()
    try {
      let credential: string | undefined
      const jobRuntime = { registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn(), enqueueDefinition: vi.fn(), listRuns: vi.fn(() => []) }
      const logs: string[] = []
      const assembly = createNarwhalCalendarAssembly({
        readSourceGate: async () => ({ visibility: 'visible', enabled: true }),
        jobRuntime,
        repository,
        fetchImpl: vi.fn() as unknown as typeof fetch,
        // 第一次读抛错（存储未就绪），之后可用。
        getCredential: async () => {
          if (credential === undefined) throw new Error('credential store not ready')
          return { apiKey: credential }
        },
        now: () => Date.parse('2026-11-13T00:00:00Z'),
        log: event => { logs.push(event) },
        retryPolicy: { intervalMs: 1_000, attempts: 3 }
      })
      await assembly.initialize()
      // 启动时读失败：不排，且**留下原因**（读不到 ≠ 没配）。
      expect(jobRuntime.setSchedule).not.toHaveBeenCalled()
      expect(assembly.credentialState()).toBe('unreadable')
      expect(logs).toContain('credential-unreadable')

      credential = 'k'
      await vi.advanceTimersByTimeAsync(1_000)
      expect(jobRuntime.setSchedule.mock.calls.map(call => (call[0] as { id: string }).id))
        .toEqual([narwhalCalendarTickPolicy.definitionId, narwhalCalendarSweepPolicy.definitionId])
      expect(assembly.credentialState()).toBe('ready')
      expect(logs).toContain('schedule-recovered')
      assembly.dispose()
    } finally { vi.useRealTimers() }
  })

  // 「没有凭据」是读者的选择：安静，但也要有一条可查的记录，不能与「读失败」混成一片安静。
  it('records "no credential" separately from "unreadable" after the retries are spent', async () => {
    vi.useFakeTimers()
    try {
      const logs: string[] = []
      const jobRuntime = { registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn(), enqueueDefinition: vi.fn(), listRuns: vi.fn(() => []) }
      const assembly = createNarwhalCalendarAssembly({
        readSourceGate: async () => ({ visibility: 'visible', enabled: true }),
        jobRuntime, repository, fetchImpl: vi.fn() as unknown as typeof fetch,
        getCredential: async () => null,
        now: () => Date.parse('2026-11-13T00:00:00Z'),
        log: event => { logs.push(event) },
        retryPolicy: { intervalMs: 1_000, attempts: 2 }
      })
      await assembly.initialize()
      expect(assembly.credentialState()).toBe('absent')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(logs).toContain('credential-absent')
      expect(logs).not.toContain('credential-unreadable')
      expect(jobRuntime.setSchedule).not.toHaveBeenCalled()
      assembly.dispose()
    } finally { vi.useRealTimers() }
  })

  it('turns the source off when the reader switch says so (after unlock)', async () => {
    let readerOn = true
    const { assembly, jobRuntime } = assemblyFor({ apiKey: 'k', readerEnabled: () => readerOn })
    await assembly.initialize()
    expect(jobRuntime.setSchedule).toHaveBeenCalledTimes(2)
    readerOn = false
    jobRuntime.setSchedule.mockClear()
    jobRuntime.removeSchedule.mockClear()
    await assembly.syncSchedule()
    expect(jobRuntime.setSchedule).not.toHaveBeenCalled()
    expect(jobRuntime.removeSchedule).toHaveBeenCalledTimes(2)
  })

  it('sends the key on the Authorization header and never in the URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ releases: [], next_cursor: null }), {
      status: 200, headers: { 'x-ratelimit-remaining': '7', 'x-ratelimit-reset': '1' }
    }))
    const { assembly } = assemblyFor({ apiKey: 'secret-key', fetchImpl: fetchImpl as unknown as typeof fetch })
    await assembly.initialize()
    await assembly.runtime.run({ startDate: '2026-11-13', endDate: '2026-11-13', countries: ['USA'] })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('secret-key')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
  })
})
