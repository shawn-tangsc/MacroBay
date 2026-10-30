import type { JobRuntime } from '@platform/jobs'

import { createMacroEconomicCalendarQueryService } from '../macro-calendar/macroEconomicCalendarQueryService'
import type { MacroCalendarRepository } from '../macro-calendar/macroCalendarRepository'
import { createPolicyPathMarketSource, type PolicyPathMarketResponse } from './policyPathMarketSource'

/**
 * Collects one meeting's implied odds and appends them to the series.
 *
 * Discovery comes first: the venue identifies a meeting by an event slug that carries a timestamp
 * (`fed-decision-in-december-20260729232808632`), so the slug cannot be derived from the date. The
 * event is found by month and then matched on its settlement date, which is the meeting's own day.
 */
export const policyPathRuntimePolicy = {
  sourceId: 'policy-path-market',
  jobId: 'market-intelligence.collect-policy-path',
  productId: 'market-intelligence',
  /** Ten minutes: the measured median gap between two prints is ten minutes. */
  intervalMs: 10 * 60_000,
  searchQuery: 'fed decision',
  titlePrefix: 'Fed Decision in ',
  /** The venue settles the day after the decision at 23:59 ET; allow a day of slack either side. */
  settlementSlackDays: 2
} as const

export type PolicyPathRunResult =
  | Readonly<{ state: 'disabled' }>
  | Readonly<{ state: 'skipped'; reason: 'no-meeting' | 'no-event' | 'no-reading' }>
  | Readonly<{ state: 'recorded'; meetingDate: string; at: string }>

export type PolicyPathRuntime = Readonly<{
  run: (atMs?: number) => Promise<PolicyPathRunResult>
  start: () => void
}>

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

export function createPolicyPathRuntime(deps: {
  jobRuntime: Pick<JobRuntime, 'registerHandler' | 'setSchedule'>
  repository: Pick<MacroCalendarRepository, 'policyObservations' | 'listEffectiveMonthAsOf' | 'getEffectiveEventAsOf'>
  fetch: FetchLike
  isEnabled: () => Promise<boolean>
  now?: () => string
}): PolicyPathRuntime {
  const now = deps.now ?? (() => new Date().toISOString())
  const source = createPolicyPathMarketSource({ request: (url) => requestJson(deps.fetch, url) })
  const calendar = createMacroEconomicCalendarQueryService({ repository: deps.repository })

  async function run(atMs?: number): Promise<PolicyPathRunResult> {
    if (!(await deps.isEnabled())) return { state: 'disabled' }
    const at = atMs === undefined ? now() : new Date(atMs).toISOString()
    const next = calendar.nextFomcMeeting({ asOf: at })
    if (next.state !== 'available') return { state: 'skipped', reason: 'no-meeting' }
    const meetingDate = next.meeting.scheduledDate
    const slug = await discoverSlug(deps.fetch, meetingDate)
    if (!slug) return { state: 'skipped', reason: 'no-event' }
    const observation = await source.fetchMeeting({ slug, at })
    if (!observation) return { state: 'skipped', reason: 'no-reading' }
    deps.repository.policyObservations.append(meetingDate, observation)
    return { state: 'recorded', meetingDate, at }
  }

  return Object.freeze({
    run,
    start() {
      deps.jobRuntime.registerHandler(policyPathRuntimePolicy.jobId, async () => { await run() })
      deps.jobRuntime.setSchedule({
        id: policyPathRuntimePolicy.jobId,
        owner: 'product',
        productId: policyPathRuntimePolicy.productId,
        handlerId: policyPathRuntimePolicy.jobId,
        title: 'Collect the policy path odds',
        trigger: { kind: 'interval', intervalMs: policyPathRuntimePolicy.intervalMs, anchor: 'lastComplete' },
        payload: {}
      } as never)
    }
  })
}

/** The venue answers a search with events; the one whose month and settlement match wins. */
async function discoverSlug(fetchImpl: FetchLike, meetingDate: string): Promise<string | undefined> {
  const response = await fetchImpl(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(policyPathRuntimePolicy.searchQuery)}&limit_per_type=20`)
  if (!response.ok) return undefined
  const body = await response.text().catch(() => '')
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  const events = (parsed as { events?: unknown })?.events
  if (!Array.isArray(events)) return undefined
  const month = monthName(meetingDate)
  const candidates = events.flatMap((event) => {
    const row = event as { title?: unknown; slug?: unknown; endDate?: unknown }
    if (typeof row.title !== 'string' || typeof row.slug !== 'string' || typeof row.endDate !== 'string') return []
    if (!row.title.startsWith(policyPathRuntimePolicy.titlePrefix)) return []
    const endDay = Date.parse(row.endDate)
    if (!Number.isFinite(endDay)) return []
    const distance = Math.abs(endDay - Date.parse(`${meetingDate}T23:59:00.000Z`)) / 86_400_000
    if (distance > policyPathRuntimePolicy.settlementSlackDays) return []
    return [{ slug: row.slug, distance, matchesMonth: row.title.includes(month) }]
  })
  candidates.sort((left, right) => Number(right.matchesMonth) - Number(left.matchesMonth) || left.distance - right.distance)
  return candidates[0]?.slug
}

function monthName(date: string): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return ''
  return new Date(parsed).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
}

async function requestJson(fetchImpl: FetchLike, url: string): Promise<PolicyPathMarketResponse> {
  try {
    const response = await fetchImpl(url)
    return { ok: response.ok, status: response.status, body: await response.text() }
  } catch {
    return { ok: false, status: 0, body: '' }
  }
}
