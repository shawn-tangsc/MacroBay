import { describe, expect, it } from 'vitest'

import { mergeFirstTierNext } from './briefingFirstTierEvents'

describe('merging the must-keep next events', () => {
  const item = (eventKey: string) => ({ eventKey })
  it('puts first-tier events first, keeps the selection order, and respects the cap', () => {
    expect(mergeFirstTierNext({
      focusEventKey: 'US.FOMC',
      selected: [item('CN.NBS_PMI'), item('US.CPI'), item('US.NFP')],
      mustKeep: [item('US.CPI')],
      limit: 3
    }).map((entry) => entry.eventKey)).toEqual(['US.CPI', 'CN.NBS_PMI', 'US.NFP'])
  })

  it('never duplicates an event already selected, and never repeats the focus', () => {
    expect(mergeFirstTierNext({
      focusEventKey: 'US.FOMC',
      selected: [item('US.CPI')],
      mustKeep: [item('US.FOMC'), item('US.CPI')],
      limit: 3
    }).map((entry) => entry.eventKey)).toEqual(['US.CPI'])
  })
})
