import { describe, expect, it, vi } from 'vitest'

import { createNarwhalCalendarAssembly, narwhalCalendarCredentialRef } from './narwhalCalendarAssembly'
import { narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy } from './narwhalCalendarJob'

const repository = { upsertReleaseRow: vi.fn(), recordFirstPublished: vi.fn(() => true) } as never

const assemblyFor = (options: Readonly<{ apiKey?: string; readerEnabled?: () => boolean | undefined; fetchImpl?: typeof fetch }> = {}) => {
  const jobRuntime = { registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn(), enqueueDefinition: vi.fn(), listRuns: vi.fn(() => []) }
  const assembly = createNarwhalCalendarAssembly({
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
