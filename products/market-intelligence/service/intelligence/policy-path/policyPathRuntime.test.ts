import { describe, expect, it, vi } from 'vitest'

import { createPolicyPathRuntime } from './policyPathRuntime'
import type { MacroCalendarRevision } from '../macro-calendar/macroCalendarContracts'

const meeting = (scheduledDate: string): MacroCalendarRevision => ({
  revisionId: `r-${scheduledDate}`, eventKey: `US.FOMC.${scheduledDate}`, releaseGroupKey: `US.FOMC.${scheduledDate}`,
  eventFamily: 'fomc', eventNameKey: 'fomc', countryCode: 'US', importance: 'high', periodKey: scheduledDate,
  lifecycleState: 'scheduled', revisionKind: 'schedule', scheduledDate, detectedAt: '2026-10-01T00:00:00.000Z',
  recordedAt: '2026-10-01T00:00:00.000Z', providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule',
  sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', evidenceHash: 'a'.repeat(64),
  evidenceRefs: [], snapshotHash: 'b'.repeat(64), parserVersion: 'fed-fomc-schedule-v3', caveats: []
})

const search = JSON.stringify({ events: [{ title: 'Fed Decision in December?', slug: 'fed-decision-in-december', endDate: '2026-12-10T04:59:00Z' }] })
const event = JSON.stringify([{ markets: [
  { groupItemTitle: '25 bps increase', outcomePrices: '["0.765","0.235"]', bestBid: 0.76, bestAsk: 0.77 },
  { groupItemTitle: 'No change', outcomePrices: '["0.215","0.785"]', bestBid: 0.21, bestAsk: 0.22 },
  { groupItemTitle: '50+ bps increase', outcomePrices: '["0.0195","0.9805"]', bestBid: 0.02, bestAsk: 0.02 },
  { groupItemTitle: '25 bps decrease', outcomePrices: '["0.0045","0.9955"]', bestBid: 0, bestAsk: 0.01 },
  { groupItemTitle: '50+ bps decrease', outcomePrices: '["0.0025","0.9975"]', bestBid: 0, bestAsk: 0 }
] }])

const runtimeWith = (input: { enabled?: boolean; scheduled?: string; fetch?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }> }) => {
  const appended: Array<{ meetingDate: string; at: string }> = []
  const runtime = createPolicyPathRuntime({
    jobRuntime: { registerHandler: vi.fn(), setSchedule: vi.fn() },
    repository: {
      listEffectiveMonthAsOf: () => input.scheduled ? [meeting(input.scheduled)] : [],
      policyObservations: { append: (meetingDate: string, observation: { at: string }) => { appended.push({ meetingDate, at: observation.at }) } }
    } as never,
    fetch: input.fetch ?? (async (url: string) => ({ ok: true, status: 200, text: async () => url.includes('public-search') ? search : event })),
    isEnabled: async () => input.enabled ?? true,
    now: () => '2026-11-25T13:10:00.000Z'
  })
  return { runtime, appended }
}

describe('policy path runtime', () => {
  it('discovers the event by month and records one observation', async () => {
    const { runtime, appended } = runtimeWith({ scheduled: '2026-12-09' })
    await expect(runtime.run()).resolves.toEqual({ state: 'recorded', meetingDate: '2026-12-09', at: '2026-11-25T13:10:00.000Z' })
    expect(appended).toEqual([{ meetingDate: '2026-12-09', at: '2026-11-25T13:10:00.000Z' }])
  })

  it('does nothing while the source is switched off', async () => {
    const { runtime, appended } = runtimeWith({ enabled: false, scheduled: '2026-12-09' })
    await expect(runtime.run()).resolves.toEqual({ state: 'disabled' })
    expect(appended).toEqual([])
  })

  it('skips without a meeting, without an event and without a full distribution', async () => {
    await expect(runtimeWith({ scheduled: undefined }).runtime.run()).resolves.toEqual({ state: 'skipped', reason: 'no-meeting' })
    await expect(runtimeWith({ scheduled: '2026-12-09', fetch: async () => ({ ok: true, status: 200, text: async () => '{"events":[]}' }) }).runtime.run())
      .resolves.toEqual({ state: 'skipped', reason: 'no-event' })
    await expect(runtimeWith({ scheduled: '2026-12-09', fetch: async (url) => ({ ok: true, status: 200, text: async () => url.includes('public-search') ? search : '[]' }) }).runtime.run())
      .resolves.toEqual({ state: 'skipped', reason: 'no-reading' })
  })

  it('registers exactly one schedule and no startup duplicate', () => {
    const { runtime } = runtimeWith({ scheduled: '2026-12-09' })
    const jobRuntime = { registerHandler: vi.fn(), setSchedule: vi.fn() }
    const scoped = createPolicyPathRuntime({
      jobRuntime,
      repository: { listEffectiveMonthAsOf: () => [], policyObservations: { append: vi.fn() } } as never,
      fetch: async () => ({ ok: false, status: 0, text: async () => '' }),
      isEnabled: async () => true
    })
    scoped.start()
    expect(jobRuntime.registerHandler).toHaveBeenCalledTimes(1)
    expect(jobRuntime.setSchedule).toHaveBeenCalledTimes(1)
    void runtime
  })
})
