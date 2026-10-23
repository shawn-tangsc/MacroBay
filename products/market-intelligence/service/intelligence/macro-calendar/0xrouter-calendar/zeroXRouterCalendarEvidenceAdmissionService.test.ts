import { describe, expect, it, vi } from 'vitest'

import { createSourceRequestGovernanceQueue } from '../../application/sourceRequestGovernance'
import { zeroXRouterCalendarEvidenceDescriptors } from '../macroCalendarOfficialSourceRegistry'
import { createZeroXRouterCalendarEvidenceAdmissionService } from './zeroXRouterCalendarEvidenceAdmissionService'

const apiKey = 'safe-test-key'
const body = JSON.stringify({ code: 200, data: [{ id: 'event-1' }] })

function createHarness(options: {
  apiKey?: string
  transport?: (input: unknown) => Promise<unknown>
  append?: (input: unknown) => unknown
} = {}) {
  const calls: string[] = []
  const queue = createSourceRequestGovernanceQueue({ now: () => Date.parse('2026-09-06T01:02:03.000Z') })
  const transport = options.transport ?? (async () => ({ state: 'succeeded' as const, body, acceptedBytes: Buffer.byteLength(body), status: 200, contentType: 'application/json' }))
  const append = options.append ?? (() => ({ rawRecordId: 'raw-1', evidenceHash: 'hash-1', inserted: true, deduped: false }))
  const service = createZeroXRouterCalendarEvidenceAdmissionService({
    requestGovernanceQueue: queue,
    getApiKey: async () => options.apiKey === undefined ? apiKey : options.apiKey,
    requestJsonBody: async (input) => {
      calls.push('request-body')
      return transport(input)
    },
    evidence: {
      reserve: () => ({ reservationId: 'reservation-1', maximumBytes: 256 * 1024 }),
      release: () => true,
      append: async (input) => append(input)
    },
    now: () => new Date('2026-09-06T01:02:03.000Z'),
    createRunId: () => 'run-1',
    onCall: (name) => calls.push(name)
  })
  return { service, queue, calls }
}

describe('zeroXRouter calendar evidence admission', () => {
  it('exposes exactly three fixed evidence-only descriptors and rejects forged ids', () => {
    expect(zeroXRouterCalendarEvidenceDescriptors.map((item) => item.descriptorId)).toEqual([
      'macro-calendar-0xrouter-economic-data',
      'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities'
    ])
    const { service } = createHarness()
    expect(service.listDescriptors()).toHaveLength(3)
    expect(service.collect({ descriptorId: 'macro-calendar-0xrouter-economic-data- forged', locale: 'zh' })).resolves.toMatchObject({
      state: 'unavailable', failureCode: 'descriptor-not-found'
    })
  })

  it('fails closed for invalid locale or caller-provided window without requesting', async () => {
    const { service, calls } = createHarness()
    await expect(service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[0]!.descriptorId, locale: 'fr' as never }))
      .resolves.toMatchObject({ state: 'unavailable', failureCode: 'locale-not-supported' })
    await expect(service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[0]!.descriptorId, locale: 'zh', month: '2026-01' } as never))
      .resolves.toMatchObject({ state: 'unavailable', failureCode: 'window-not-accepted' })
    expect(calls).toEqual([])
  })

  it('does not request or archive when credential is absent', async () => {
    const { service, calls } = createHarness({ apiKey: '' })
    await expect(service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[0]!.descriptorId, locale: 'zh' }))
      .resolves.toMatchObject({ state: 'unavailable', failureCode: 'credential-not-configured' })
    expect(calls).toEqual([])
  })

  it('queues before transport and archives only a valid 200 array envelope', async () => {
    const { service, calls } = createHarness()
    const result = await service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[1]!.descriptorId, locale: 'en' })
    expect(result).toMatchObject({ state: 'persisted', descriptorId: zeroXRouterCalendarEvidenceDescriptors[1]!.descriptorId, locale: 'en', acceptedBytes: Buffer.byteLength(body), evidenceHash: 'hash-1' })
    expect(calls).toEqual(['queue', 'request-body', 'archive'])
  })

  it('derives the current UTC month window and locale in the fixed request without caller URL input', async () => {
    const requestJsonBody = vi.fn(async () => ({ state: 'succeeded' as const, body, acceptedBytes: Buffer.byteLength(body), status: 200, contentType: 'application/json' }))
    const { service } = createHarness({ transport: requestJsonBody })
    await service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[0]!.descriptorId, locale: 'en' })
    const request = requestJsonBody.mock.calls[0]?.[0] as { url: string; apiKey: string }
    const url = new URL(request.url)
    expect(url.pathname).toBe('/cexdata/calendar/economic-data')
    expect([...url.searchParams.keys()].sort()).toEqual(['endTime', 'locale', 'startTime'])
    expect(url.searchParams.get('locale')).toBe('en')
    expect(url.searchParams.get('startTime')).toBe(String(Date.UTC(2026, 8, 1)))
    expect(url.searchParams.get('endTime')).toBe(String(Date.UTC(2026, 9, 1) - 1))
    expect(request.apiKey).toBe(apiKey)
  })

  it('does not request or archive when the shared queue denies admission', async () => {
    const { service, queue, calls } = createHarness()
    queue.close()
    await expect(service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[0]!.descriptorId, locale: 'zh' }))
      .resolves.toMatchObject({ state: 'unavailable', failureCode: 'transport-unavailable' })
    expect(calls).toEqual(['queue'])
  })

  it('rejects error envelopes and malformed data without archive writes', async () => {
    const append = vi.fn()
    const { service } = createHarness({
      transport: async () => ({ state: 'succeeded', body: JSON.stringify({ code: 500, data: [] }), acceptedBytes: 20, status: 200, contentType: 'application/json' }),
      append
    })
    await expect(service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[2]!.descriptorId, locale: 'zh' }))
      .resolves.toMatchObject({ state: 'unavailable', failureCode: 'response-envelope' })
    expect(append).not.toHaveBeenCalled()
  })

  it('returns safe metadata only and never includes body, key, URL, headers, or error text', async () => {
    const { service } = createHarness()
    const result = await service.collect({ descriptorId: zeroXRouterCalendarEvidenceDescriptors[0]!.descriptorId, locale: 'zh' })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(apiKey)
    expect(serialized).not.toContain(body)
    expect(serialized).not.toContain('X-My-Token')
    expect(serialized).not.toContain('https://')
    expect(result).not.toHaveProperty('body')
  })
})
