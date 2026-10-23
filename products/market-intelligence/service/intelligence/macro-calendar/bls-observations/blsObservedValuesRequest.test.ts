import { describe, expect, it } from 'vitest'

import { buildBlsObservedValuesRequest } from './blsObservedValuesRequest'

describe('buildBlsObservedValuesRequest', () => {
  it('builds the fixed six-series request for the previous and current UTC years', () => {
    expect(buildBlsObservedValuesRequest('2026-08-04T00:00:00.000Z')).toBe(
      '{"seriesid":["CUUR0000SA0","CUUR0000SA0L1E","CES0000000001","LNS14000000","CES0500000003","CES0500000001"],"startyear":"2025","endyear":"2026"}'
    )
    expect(buildBlsObservedValuesRequest('2027-01-01T00:00:00.000Z')).toContain('"startyear":"2026","endyear":"2027"')
  })

  it.each([
    '2026-08-04T00:00:00Z',
    '2026-02-29T00:00:00.000Z',
    'not-a-date'
  ])('rejects a noncanonical or invalid run time', (runAt) => {
    expect(buildBlsObservedValuesRequest(runAt)).toBeUndefined()
  })
})
