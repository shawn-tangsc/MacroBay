import { expect, it } from 'vitest'
import { projectTriggerStatus, triggerStatusPolicy } from './triggerStatusProjection'

const row = (overrides: Record<string, unknown> = {}) => ({
  triggerKey: 'calendar.refresh', reasonCode: 'significance-below-threshold', decision: 'skipped', createdAt: '2026-10-09T12:00:00.000Z', ...overrides
})
const run = (overrides: Record<string, unknown> = {}) => ({
  id: 'mi-ar-1', triggerKey: 'calendar.refresh', queuedAt: '2026-10-09T12:30:00.000Z', completedAt: '2026-10-09T12:31:00.000Z', ...overrides
})

it('states its version and the codes it can explain', () => {
  expect(triggerStatusPolicy.version).toBe('marketAnalysisTriggerStatusPolicy.v1')
  expect(Object.values(triggerStatusPolicy.explainableReasonCodes)).toContain('interval-active')
  // Every slot the gate can be asked about, plus the historical startup key, which stays
  // explainable so rows recorded under it keep their line after the schedule replaced that path.
  expect(triggerStatusPolicy.explainableTriggerKeys).toEqual([
    'calendar.refresh', 'schedule.asia.open', 'schedule.europe.open', 'schedule.us.open', 'startup.refresh'
  ])
  for (const code of ['session-slot-asia', 'session-slot-europe', 'session-slot-us', 'schedule-reserve-exhausted']) {
    expect(Object.values(triggerStatusPolicy.explainableReasonCodes)).toContain(code)
  }
  expect(Object.isFrozen(triggerStatusPolicy)).toBe(true)
})

it('says which open a session-slot run served, and whether it was a catch-up', () => {
  // The reader's question ("这个是欧洲盘吗？") came from this line: a 16:00 open analysed at 01:21 the
  // next morning read like a mistake because nothing said which open it was or that it was late.
  const europe = { triggerKey: 'schedule.europe.open', reasonCode: 'session-slot-europe', decision: 'queued', createdAt: '2026-10-13T17:21:16.780Z' }
  const delayed = projectTriggerStatus([europe], run({
    triggerKey: 'schedule.europe.open', queuedAt: '2026-10-13T17:21:16.919Z', completedAt: '2026-10-13T17:22:28.753Z'
  }))
  expect(delayed?.slotOpenAt).toBe(new Date(2026, 9, 13, 16, 0, 0).toISOString())
  expect(delayed?.slotDelayed).toBe(true)

  // On time: the US open served nine minutes after it opened.
  const onTime = projectTriggerStatus([{ ...europe, triggerKey: 'schedule.us.open', reasonCode: 'session-slot-us', createdAt: '2026-10-13T16:00:30.000Z' }],
    run({ triggerKey: 'schedule.us.open', queuedAt: new Date(2026, 9, 14, 0, 9, 0).toISOString(), completedAt: new Date(2026, 9, 14, 0, 10, 0).toISOString() }))
  expect(onTime?.slotOpenAt).toBe(new Date(2026, 9, 14, 0, 0, 0).toISOString())
  expect(onTime?.slotDelayed).toBe(false)
  // A non-slot run carries neither field: nothing about it is session-shaped.
  expect(projectTriggerStatus([row()], run())).toEqual({ triggerKey: 'calendar.refresh', reasonCode: 'significance-below-threshold', decidedAt: '2026-10-09T12:00:00.000Z' })
})

it('explains the run with the newest decision for its own trigger key', () => {
  expect(projectTriggerStatus([row(), row({ reasonCode: 'significance-confirmed', decision: 'queued', createdAt: '2026-10-09T12:30:00.000Z' })], run()))
    .toEqual({ triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decidedAt: '2026-10-09T12:30:00.000Z' })
})

it('attributes a manual run to the reader instead of to another key\u2019s decision', () => {
  // The reported defect: a 重新分析 row showed the staleness floor's "since the day before
  // yesterday" wording, because the group's newest explainable decision was the floor's.
  const floorRow = row({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decision: 'queued', createdAt: '2026-10-12T07:02:09.203Z' })
  expect(projectTriggerStatus([floorRow], run({ triggerKey: 'manual.refresh', queuedAt: '2026-10-13T14:41:32.883Z', completedAt: '2026-10-13T14:42:55.801Z' })))
    .toEqual({ triggerKey: 'manual.refresh', reasonCode: 'manual-request', decidedAt: '2026-10-13T14:41:32.883Z' })
  // A manual run is not session-shaped, so it carries no open: `withSlotOpen` only adds them for a
  // slot key, which is what keeps the wording honest.
  expect(projectTriggerStatus([floorRow], run({ triggerKey: 'manual.initial', queuedAt: '2026-10-13T14:41:32.883Z' }))?.reasonCode).toBe('manual-request')
})

it('keeps the floor\u2019s own wording on a floor run', () => {
  const floorRow = row({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decision: 'queued', createdAt: '2026-10-12T07:02:09.203Z' })
  // The open it served and whether it was late ride along with the wording.
  expect(projectTriggerStatus([floorRow], run({ triggerKey: 'schedule.asia.open', queuedAt: '2026-10-13T12:16:56.497Z', completedAt: '2026-10-13T12:17:44.957Z' })))
    .toMatchObject({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decidedAt: '2026-10-12T07:02:09.203Z', slotDelayed: true })
})

it('never borrows another key\u2019s decision, and never one made after the run finished', () => {
  expect(projectTriggerStatus([row({ reasonCode: 'interval-active' })], run({ triggerKey: 'schedule.asia.open' }))).toBeNull()
  expect(projectTriggerStatus([row({ createdAt: '2026-10-09T13:00:00.000Z', reasonCode: 'interval-active' })], run())).toBeNull()
})

it('explains an item-path run from its own decision', () => {
  const itemRun = run({ triggerKey: 'macro.actual.first-confirmed', queuedAt: '2026-10-13T15:14:03.000Z', completedAt: '2026-10-13T15:14:48.000Z' })
  expect(projectTriggerStatus([row({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'severity-confirmed', decision: 'queued', createdAt: '2026-10-13T15:14:03.000Z' })], itemRun))
    .toEqual({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'severity-confirmed', decidedAt: '2026-10-13T15:14:03.000Z' })
  const reviewRun = run({ triggerKey: 'market-reaction.15m', queuedAt: '2026-10-13T15:14:03.000Z', completedAt: '2026-10-13T15:14:48.000Z' })
  expect(projectTriggerStatus([row({ triggerKey: 'market-reaction.15m', reasonCode: 'market-reaction-confirmed', decision: 'queued', createdAt: '2026-10-13T15:14:03.000Z' })], reviewRun))
    .toMatchObject({ reasonCode: 'market-reaction-confirmed' })
})

it('prefers the decision that names this run, which is how a restart compensation is told apart from an item', () => {
  // The published row a reader could not explain: an initial run the recovery pass compensated,
  // sitting next to an older item decision for the same trigger key.
  const itemRun = run({ id: 'mi-ar-67947ded', triggerKey: 'macro.actual.first-confirmed', queuedAt: '2026-10-13T15:14:03.000Z', completedAt: '2026-10-13T15:14:48.000Z' })
  const ledger = [
    row({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'severity-confirmed', decision: 'queued', createdAt: '2026-10-09T15:15:38.000Z', analysisRunId: null }),
    row({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'restart-initial-compensated', decision: 'queued', createdAt: '2026-10-13T15:14:03.000Z', analysisRunId: 'mi-ar-67947ded' })
  ]
  expect(projectTriggerStatus(ledger, itemRun))
    .toEqual({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'restart-initial-compensated', decidedAt: '2026-10-13T15:14:03.000Z' })
})

it('says nothing for an item run whose decision was never recorded', () => {
  expect(projectTriggerStatus([row()], run({ triggerKey: 'macro.actual.first-confirmed' }))).toBeNull()
})

it('ignores codes the panel cannot translate rather than showing a raw token', () => {
  // `restart-expired` explains a run that was expired instead of published, so no row carries it.
  expect(projectTriggerStatus([row({ reasonCode: 'restart-expired' })], run())).toBeNull()
  expect(projectTriggerStatus([], run())).toBeNull()
  expect(projectTriggerStatus(undefined, run())).toBeNull()
})

it('says nothing when the entry\u2019s run cannot be read', () => {
  expect(projectTriggerStatus([row()], undefined)).toBeNull()
})
