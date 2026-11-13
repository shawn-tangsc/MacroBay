import { expect, it } from 'vitest'
import {
  latestPerEstimateIdentity,
  selectMacroCalendarAdmissions,
  type MacroCalendarAdmissionRow
} from './macroCalendarAdmission'

const row = (overrides: Partial<MacroCalendarAdmissionRow> = {}): MacroCalendarAdmissionRow => ({
  identity: 'USA|US.NONFARM.SA.CHANGE|2026-10|2026-11-06',
  releaseGroup: 'us-employment-situation',
  importance: 'high', hasValue: true, distanceMs: 0, isEstimate: false, observedAtMs: 0, ...overrides
})

it('caps one release group so a twelve-metric release cannot eat half the budget', () => {
  const rows = Array.from({ length: 12 }, (_, index) => row({ identity: `USA|US.M${index}.SA.RATE|2026-10|2026-11-06` }))
  const result = selectMacroCalendarAdmissions(rows, { maximumRows: 16, maximumPerGroup: 1 })
  expect(result.admitted).toHaveLength(1)
  expect(result.droppedByGroup).toBe(11)
  expect(result.droppedByTotal).toBe(0)
})

it('fills the total budget across groups, never beyond it', () => {
  const rows = Array.from({ length: 20 }, (_, index) => row({
    identity: `USA|US.M${index}.SA.RATE|2026-10|2026-11-06`, releaseGroup: `group-${index}`
  }))
  const result = selectMacroCalendarAdmissions(rows, { maximumRows: 16, maximumPerGroup: 2 })
  expect(result.admitted).toHaveLength(16)
  expect(result.droppedByTotal).toBe(4)
})

it('prefers the primary measure inside a group', () => {
  const rows = [
    row({ identity: 'USA|US.UNEMPLOYMENT.SA.RATE|2026-10|2026-11-06', isPrimary: false }),
    row({ identity: 'USA|US.NONFARM.SA.CHANGE|2026-10|2026-11-06', isPrimary: true })
  ]
  const result = selectMacroCalendarAdmissions(rows, { maximumRows: 16, maximumPerGroup: 1 })
  expect(result.admitted.map(entry => entry.identity)).toEqual(['USA|US.NONFARM.SA.CHANGE|2026-10|2026-11-06'])
})

it('keeps estimates out of the release budget and takes only their latest row per identity', () => {
  const releases = Array.from({ length: 16 }, (_, index) => row({
    identity: `USA|US.M${index}.SA.RATE|2026-10|2026-11-06`, releaseGroup: `group-${index}`
  }))
  const estimates = [
    row({ identity: 'USA|US.GDP_NOWCAST.SA.ANNUALIZED_QOQ|2026-Q4', releaseGroup: 'us-gdp-nowcast', isEstimate: true, observedAtMs: 1 }),
    row({ identity: 'USA|US.GDP_NOWCAST.SA.ANNUALIZED_QOQ|2026-Q4', releaseGroup: 'us-gdp-nowcast', isEstimate: true, observedAtMs: 3 })
  ]
  const result = selectMacroCalendarAdmissions([...releases, ...estimates], { maximumRows: 16, maximumPerGroup: 2 })
  expect(result.admitted.filter(entry => entry.isEstimate)).toEqual([
    expect.objectContaining({ isEstimate: true, observedAtMs: 3 })
  ])
  expect(result.admitted).toHaveLength(17)
  expect(result.droppedByTotal).toBe(0)
})

it('dedupes estimates by identity alone, not by value', () => {
  const latest = latestPerEstimateIdentity([
    row({ isEstimate: true, observedAtMs: 5 }), row({ isEstimate: true, observedAtMs: 9 })
  ])
  expect(latest).toHaveLength(1)
  expect(latest[0]!.observedAtMs).toBe(9)
})

it('treats an unknown group as its own, never collapsing every unknown into one group', () => {
  const rows = Array.from({ length: 3 }, (_, index) => row({ identity: `USA|US.M${index}.SA.RATE|2026-10|2026-11-06`, releaseGroup: '' }))
  const result = selectMacroCalendarAdmissions(rows, { maximumRows: 16, maximumPerGroup: 1 })
  expect(result.admitted).toHaveLength(3)
  expect(result.droppedByGroup).toBe(0)
})
