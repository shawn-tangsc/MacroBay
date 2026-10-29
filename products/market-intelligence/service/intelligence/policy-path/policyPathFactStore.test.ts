import { afterEach, describe, expect, it } from 'vitest'

import { createMacroCalendarRepository, type MacroCalendarRepository } from '../macro-calendar/macroCalendarRepository'

const open: MacroCalendarRepository[] = []
const repository = (): MacroCalendarRepository => {
  const created = createMacroCalendarRepository({ filePath: ':memory:' })
  open.push(created)
  return created
}

afterEach(() => {
  while (open.length) open.pop()!.close()
})

const statement = 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261209a.htm'

describe('policy path fact store', () => {
  it('keeps the projection marker when the decision arrives later', () => {
    const store = repository().policyFacts
    store.recordSchedule({ meetingDate: '2026-12-09', hasProjectionMaterials: true, detectedAt: '2026-10-30T00:00:00.000Z' })
    store.recordDecision({
      meetingDate: '2026-12-09',
      targetRange: { lowerPercent: 3.75, upperPercent: 4 },
      vote: { for: 10, against: 2 },
      dissents: [{ name: 'Lisa D. Cook', preferred: 'raise' }, { name: 'Beth M. Hammack', preferred: 'raise' }],
      statementUrl: statement,
      detectedAt: '2026-12-10T00:00:00.000Z'
    })
    expect(store.read('2026-12-09')).toMatchObject({
      meetingDate: '2026-12-09',
      hasProjectionMaterials: true,
      targetRange: { lowerPercent: 3.75, upperPercent: 4 },
      vote: { for: 10, against: 2 },
      dissents: [{ name: 'Lisa D. Cook', preferred: 'raise' }, { name: 'Beth M. Hammack', preferred: 'raise' }],
      statementUrl: statement
    })
  })

  it('does not lose the vote when a later schedule write has no tally', () => {
    const store = repository().policyFacts
    store.recordDecision({
      meetingDate: '2026-12-09',
      targetRange: { lowerPercent: 3.75, upperPercent: 4 },
      vote: { for: 10, against: 2 },
      statementUrl: statement,
      detectedAt: '2026-12-10T00:00:00.000Z'
    })
    store.recordSchedule({ meetingDate: '2026-12-09', hasProjectionMaterials: true, detectedAt: '2026-12-10T01:00:00.000Z' })
    expect(store.read('2026-12-09')).toMatchObject({
      hasProjectionMaterials: true,
      targetRange: { lowerPercent: 3.75, upperPercent: 4 },
      vote: { for: 10, against: 2 }
    })
  })

  it('reports nothing for a meeting it has never seen', () => {
    expect(repository().policyFacts.read('2027-01-27')).toBeUndefined()
  })
})
