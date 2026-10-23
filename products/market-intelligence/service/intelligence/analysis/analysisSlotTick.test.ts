import { expect, it, vi } from 'vitest'

import { analysisSchedulePolicy } from './analysisSchedulePolicy'
import { analysisSlotTickPolicy, createAnalysisSlotTick, hasSlotAnchor } from './analysisSlotTick'
import type { SessionSlotInstant } from './analysisSlotCoverage'

/** Local wall clock, so the assertions hold in whatever timezone the suite runs in. */
const local = (day: number, hour: number) => new Date(2026, 9, day, hour)

const tick = (overrides: Record<string, unknown> = {}) => {
  const requestSlotAnalysis = vi.fn(async () => undefined)
  const log = vi.fn(async () => undefined)
  const instance = createAnalysisSlotTick({
    now: () => local(14, 9).toISOString(),
    isDelivered: () => false,
    hasEligibleAnchor: () => true,
    requestSlotAnalysis,
    log,
    ...overrides
  } as never)
  return { instance, requestSlotAnalysis, log }
}

const slotsOf = (calls: readonly unknown[]) => (calls as readonly [SessionSlotInstant][]).map(([instant]) => instant.slot)

it('declares its period from the schedule policy', () => {
  expect(analysisSlotTickPolicy.version).toBe('marketAnalysisSlotTickPolicy.v1')
  expect(analysisSlotTickPolicy.intervalMs).toBe(15 * 60 * 1_000)
  expect(analysisSlotTickPolicy.intervalMs).toBe(analysisSchedulePolicy.tickIntervalMs)
  expect(Object.isFrozen(analysisSlotTickPolicy)).toBe(true)
})

it('serves the newest open that is owed, and only that one', async () => {
  const { instance, requestSlotAnalysis } = tick()
  const result = await instance.run()
  expect(result.outcome).toBe('requested')
  // 09:00 with nothing served: the 08:00 Asian open is the one that runs. Yesterday's European open
  // is not replayed — catching up is not a backlog.
  expect(result.requested).toEqual(['asia'])
  expect(slotsOf(requestSlotAnalysis.mock.calls)).toEqual(['asia'])
  expect(new Date((requestSlotAnalysis.mock.calls[0]![0] as SessionSlotInstant).atMs).getHours()).toBe(8)
})

it('serves the US open when the app opens just after it, not the European one it missed', async () => {
  // The reader's own case: 01:21 local, the European open (16:00) long gone, the US open (00:00) just
  // passed. Only the US session is analysed.
  const requestSlotAnalysis = vi.fn(async () => undefined)
  const instance = createAnalysisSlotTick({
    now: () => local(14, 1).toISOString(), isDelivered: () => false, hasEligibleAnchor: () => true,
    requestSlotAnalysis, log: vi.fn(async () => undefined)
  } as never)
  const result = await instance.run()
  expect(result.requested).toEqual(['us'])
  expect(new Date((requestSlotAnalysis.mock.calls[0]![0] as SessionSlotInstant).atMs).getDate()).toBe(14)
})

it('stays quiet once every open in the window has been served', async () => {
  const { instance, requestSlotAnalysis } = tick({ isDelivered: () => true })
  const result = await instance.run()
  expect(result.outcome).toBe('not-due')
  expect(result.requested).toEqual([])
  expect(requestSlotAnalysis).not.toHaveBeenCalled()
})

it('retries an open whose request was refused instead of counting it as served', async () => {
  // A refusal (a run already in flight, the reserve spent) leaves no ledger row, so the open stays
  // owed: `deferred` names it, and the next tick inside its window asks again.
  const { instance } = tick({ requestSlotAnalysis: vi.fn(async () => { throw new Error('analysis-already-available') }) })
  const result = await instance.run()
  expect(result.requested).toEqual([])
  expect(result.deferred).toEqual(['asia'])
  expect(result.outcome).toBe('not-due')
})

it('reports a missing anchor instead of pretending it ran', async () => {
  const { instance, requestSlotAnalysis, log } = tick({ hasEligibleAnchor: () => false })
  const result = await instance.run()
  expect(result.outcome).toBe('no-anchor')
  // No group exists, so the ledger cannot record this: the log is the only trace.
  expect(requestSlotAnalysis).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith(expect.stringContaining('no eligible intelligence anchor'), expect.objectContaining({ due: ['asia'] }))
})

it('treats any item as an anchor, because the schedule is not the anchor eligibility rule', () => {
  // The defect this guards: gating the floor on `full-intelligence` + sentiment-eligible news made
  // it unsatisfiable for a macro-only pipeline, and the ledger showed it never ran.
  expect(hasSlotAnchor([])).toBe(false)
  expect(hasSlotAnchor([{ sourceTrust: 'low', processingLabelsJson: null }])).toBe(true)
  expect(hasSlotAnchor([{ publishedAt: null }])).toBe(true)
})
