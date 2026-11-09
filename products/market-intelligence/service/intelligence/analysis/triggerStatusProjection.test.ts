import { expect, it } from 'vitest'
import { projectTriggerStatus, triggerStatusPolicy } from './triggerStatusProjection'

/** 读者时区固定下来：开盘时刻按它换算，用例不跟着跑测试的机器漂。 */
const TIME_ZONE = 'Asia/Shanghai'

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
  }), TIME_ZONE)
  expect(delayed?.slotOpenAt).toBe('2026-10-13T08:00:00.000Z')
  expect(delayed?.slotDelayed).toBe(true)

  // On time: the US open served nine minutes after it opened.
  const onTime = projectTriggerStatus([{ ...europe, triggerKey: 'schedule.us.open', reasonCode: 'session-slot-us', createdAt: '2026-10-13T16:00:30.000Z' }],
    run({ triggerKey: 'schedule.us.open', queuedAt: '2026-10-13T16:09:00.000Z', completedAt: '2026-10-13T16:10:00.000Z' }), TIME_ZONE)
  expect(onTime?.slotOpenAt).toBe('2026-10-13T16:00:00.000Z')
  expect(onTime?.slotDelayed).toBe(false)
  // A non-slot run carries neither field: nothing about it is session-shaped.
  expect(projectTriggerStatus([row()], run(), TIME_ZONE)).toEqual({ triggerKey: 'calendar.refresh', reasonCode: 'significance-below-threshold', decidedAt: '2026-10-09T12:00:00.000Z' })
})

it('explains the run with the newest decision for its own trigger key', () => {
  expect(projectTriggerStatus([row(), row({ reasonCode: 'significance-confirmed', decision: 'queued', createdAt: '2026-10-09T12:30:00.000Z' })], run(), TIME_ZONE))
    .toEqual({ triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decidedAt: '2026-10-09T12:30:00.000Z' })
})

it('attributes a manual run to the reader instead of to another key\u2019s decision', () => {
  // The reported defect: a 重新分析 row showed the staleness floor's "since the day before
  // yesterday" wording, because the group's newest explainable decision was the floor's.
  const floorRow = row({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decision: 'queued', createdAt: '2026-10-12T07:02:09.203Z' })
  expect(projectTriggerStatus([floorRow], run({ triggerKey: 'manual.refresh', queuedAt: '2026-10-13T14:41:32.883Z', completedAt: '2026-10-13T14:42:55.801Z' }), TIME_ZONE))
    .toEqual({ triggerKey: 'manual.refresh', reasonCode: 'manual-request', decidedAt: '2026-10-13T14:41:32.883Z' })
  // A manual run is not session-shaped, so it carries no open: `withSlotOpen` only adds them for a
  // slot key, which is what keeps the wording honest.
  expect(projectTriggerStatus([floorRow], run({ triggerKey: 'manual.initial', queuedAt: '2026-10-13T14:41:32.883Z' }), TIME_ZONE)?.reasonCode).toBe('manual-request')
})

it('keeps the floor\u2019s own wording on a floor run', () => {
  const floorRow = row({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decision: 'queued', createdAt: '2026-10-12T07:02:09.203Z' })
  // The open it served and whether it was late ride along with the wording.
  expect(projectTriggerStatus([floorRow], run({ triggerKey: 'schedule.asia.open', queuedAt: '2026-10-13T12:16:56.497Z', completedAt: '2026-10-13T12:17:44.957Z' }), TIME_ZONE))
    .toMatchObject({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot-asia', decidedAt: '2026-10-12T07:02:09.203Z', slotDelayed: true })
})

it('never borrows another key\u2019s decision, and never one made after the run finished', () => {
  expect(projectTriggerStatus([row({ reasonCode: 'interval-active' })], run({ triggerKey: 'schedule.asia.open' }), TIME_ZONE)).toBeNull()
  expect(projectTriggerStatus([row({ createdAt: '2026-10-09T13:00:00.000Z', reasonCode: 'interval-active' })], run(), TIME_ZONE)).toBeNull()
})

it('explains an item-path run from its own decision', () => {
  const itemRun = run({ triggerKey: 'macro.actual.first-confirmed', queuedAt: '2026-10-13T15:14:03.000Z', completedAt: '2026-10-13T15:14:48.000Z' })
  expect(projectTriggerStatus([row({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'severity-confirmed', decision: 'queued', createdAt: '2026-10-13T15:14:03.000Z' })], itemRun, TIME_ZONE))
    .toEqual({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'severity-confirmed', decidedAt: '2026-10-13T15:14:03.000Z' })
  const reviewRun = run({ triggerKey: 'market-reaction.15m', queuedAt: '2026-10-13T15:14:03.000Z', completedAt: '2026-10-13T15:14:48.000Z' })
  expect(projectTriggerStatus([row({ triggerKey: 'market-reaction.15m', reasonCode: 'market-reaction-confirmed', decision: 'queued', createdAt: '2026-10-13T15:14:03.000Z' })], reviewRun, TIME_ZONE))
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
  expect(projectTriggerStatus(ledger, itemRun, TIME_ZONE))
    .toEqual({ triggerKey: 'macro.actual.first-confirmed', reasonCode: 'restart-initial-compensated', decidedAt: '2026-10-13T15:14:03.000Z' })
})

it('explains a module signal run from its own ledger row, by prefix', () => {
  // One key per rule, so the key cannot be listed in the policy array: without the prefix the
  // signal's run loses its line and the timeline shows a reason-less analysis.
  const key = 'signal.open-interest.oi-liquidation-proxy'
  const signalRun = run({ triggerKey: key, queuedAt: '2026-11-03T02:07:00.000Z', completedAt: '2026-11-03T02:08:00.000Z' })
  expect(projectTriggerStatus([row({ triggerKey: key, reasonCode: 'signal-high-triggered', decision: 'queued', createdAt: '2026-11-03T02:07:00.000Z' })], signalRun, TIME_ZONE))
    .toEqual({ triggerKey: key, reasonCode: 'signal-high-triggered', decidedAt: '2026-11-03T02:07:00.000Z' })
  // A skipped signal explains the non-run too: that is the reader's "why was this not analysed".
  expect(projectTriggerStatus([row({ triggerKey: key, reasonCode: 'signal-cooldown-active', decision: 'skipped', createdAt: '2026-11-03T02:06:00.000Z' })], signalRun, TIME_ZONE)?.reasonCode)
    .toBe('signal-cooldown-active')
  // A key outside the registry stays unexplained: the prefix is the only thing added.
  const unknown = run({ triggerKey: 'future.unknown.key' })
  expect(projectTriggerStatus([row({ triggerKey: 'future.unknown.key' })], unknown, TIME_ZONE)).toBeNull()
})

it('registers every reason a signal decision can carry, so the timeline can translate it', () => {
  for (const code of ['signal-high-triggered', 'signal-medium-triggered', 'signal-cooldown-active',
    'signal-low-marker-only', 'signal-calendar-owned', 'signal-freeze-unavailable']) {
    expect(Object.values(triggerStatusPolicy.explainableReasonCodes)).toContain(code)
  }
  // Budget refusals are the existing codes: a second synonym for the same limit is a second truth.
  expect(Object.values(triggerStatusPolicy.explainableReasonCodes)).not.toContain('signal-budget-exhausted')
})

it('says nothing for an item run whose decision was never recorded', () => {
  expect(projectTriggerStatus([row()], run({ triggerKey: 'macro.actual.first-confirmed' }), TIME_ZONE)).toBeNull()
})

it('ignores codes the panel cannot translate rather than showing a raw token', () => {
  // `restart-expired` explains a run that was expired instead of published, so no row carries it.
  expect(projectTriggerStatus([row({ reasonCode: 'restart-expired' })], run(), TIME_ZONE)).toBeNull()
  expect(projectTriggerStatus([], run(), TIME_ZONE)).toBeNull()
  expect(projectTriggerStatus(undefined, run(), TIME_ZONE)).toBeNull()
})

it('says nothing when the entry\u2019s run cannot be read', () => {
  expect(projectTriggerStatus([row()], undefined, TIME_ZONE)).toBeNull()
})
