import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseBlsCalendarFamilyValues, parseBlsObservedValues } from './blsObservedValuesParser'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bls-six-series-2025-2026-2026-08-03.json'), 'utf8'))

function familyPayload(family: 'cpi' | 'employment') {
  const payload = structuredClone(fixture)
  const seriesIds = family === 'cpi'
    ? new Set(['CUUR0000SA0', 'CUUR0000SA0L1E'])
    : new Set(['CES0000000001', 'LNS14000000', 'CES0500000003'])
  payload.Results.series = payload.Results.series.filter((series: { seriesID: string }) => seriesIds.has(series.seriesID))
  return payload
}

describe('parseBlsObservedValues', () => {
  it('maps exact CPI and Employment families from the caller-selected period, including same-response calendar previous values', () => {
    const cpi = parseBlsCalendarFamilyValues(familyPayload('cpi'), { family: 'cpi', period: '2026-M06' })
    const employment = parseBlsCalendarFamilyValues(familyPayload('employment'), { family: 'employment', period: '2026-M06' })

    expect(cpi).toMatchObject({
      state: 'available', family: 'cpi', period: '2026-M06',
      values: {
        cpi: { actual: expect.closeTo(3.5314, 3), calendarPrevious: expect.closeTo(4.2487, 3) },
        coreCpi: { actual: expect.closeTo(2.5941, 3), calendarPrevious: expect.closeTo(2.8509, 3) }
      }
    })
    expect(employment).toEqual({
      state: 'available', family: 'employment', period: '2026-M06',
      values: {
        nonfarm: { actual: 57, calendarPrevious: 129 },
        unemployment: { actual: 4.2, calendarPrevious: 4.3 },
        averageHourlyEarnings: { actual: expect.closeTo(0.3466, 3), calendarPrevious: expect.closeTo(0.2673, 3) }
      }
    })
  })

  it.each([
    ['missing selected series', (value: any) => { value.Results.series = value.Results.series.filter((series: { seriesID: string }) => series.seriesID !== 'CUUR0000SA0') }, { family: 'cpi', period: '2026-M06' }],
    ['CUSR substitution', (value: any) => { value.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').seriesID = 'CUSR0000SA0' }, { family: 'cpi', period: '2026-M06' }],
    ['private payroll substitution', (value: any) => { value.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CES0000000001').seriesID = 'CES0500000001' }, { family: 'employment', period: '2026-M06' }],
    ['duplicate required period', (value: any) => { const series = value.Results.series.find((item: { seriesID: string }) => item.seriesID === 'LNS14000000'); series.data.push(structuredClone(series.data[0])) }, { family: 'employment', period: '2026-M06' }],
    ['unavailable selected observation', (value: any) => { value.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data[0].value = '-' }, { family: 'cpi', period: '2026-M06' }],
    ['noncanonical selected decimal', (value: any) => { value.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CES0500000003').data[0].value = '1e2' }, { family: 'employment', period: '2026-M06' }],
    ['M13 selected period', (_value: any) => {}, { family: 'employment', period: '2026-M13' }]
  ])('fails closed for exact family input with %s', (_name, mutate, selected) => {
    const payload = familyPayload(selected.family)
    mutate(payload)
    expect(parseBlsCalendarFamilyValues(payload, selected)).toEqual({ state: 'unavailable' })
  })

  it.each([
    ['non-success response status', (value: any) => { value.status = 'REQUEST_NOT_PROCESSED' }, { family: 'cpi' as const, period: '2026-M06' }],
    ['foreign response series', (value: any) => { value.Results.series.push(structuredClone(fixture.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CES0500000001'))) }, { family: 'employment' as const, period: '2026-M06' }],
    ['zero CPI actual denominator', (value: any) => { value.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data.find((item: { year: string; period: string }) => item.year === '2025' && item.period === 'M06').value = '0' }, { family: 'cpi' as const, period: '2026-M06' }],
    ['zero AHE previous denominator', (value: any) => { value.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CES0500000003').data.find((item: { year: string; period: string }) => item.year === '2026' && item.period === 'M04').value = '0' }, { family: 'employment' as const, period: '2026-M06' }]
  ])('fails closed for a required family boundary: %s', (_name, mutate, selected) => {
    const payload = familyPayload(selected.family)
    mutate(payload)
    expect(parseBlsCalendarFamilyValues(payload, selected)).toEqual({ state: 'unavailable' })
  })

  it('does not infer a newer response period when the caller selects an earlier period', () => {
    const result = parseBlsCalendarFamilyValues(familyPayload('employment'), { family: 'employment', period: '2026-M05' })

    expect(result).toMatchObject({ state: 'available', family: 'employment', period: '2026-M05' })
  })

  it('parses only observed values for the latest complete month from the captured BLS response', () => {
    const drafts = parseBlsObservedValues(fixture)

    expect(drafts.map((draft) => draft.metric)).toEqual([
      'cpi-12-month-percent', 'core-cpi-12-month-percent', 'nonfarm-payrolls-monthly-change-thousands',
      'unemployment-rate-percent', 'average-hourly-earnings-monthly-percent-change'
    ])
    expect(drafts.every((draft) => draft.observedPeriod === '2026-M06')).toBe(true)
    expect(drafts.find((draft) => draft.metric === 'cpi-12-month-percent')?.value).toBeCloseTo(3.5314, 3)
    expect(drafts.find((draft) => draft.metric === 'core-cpi-12-month-percent')?.value).toBeCloseTo(2.5944, 3)
    expect(drafts.find((draft) => draft.metric === 'nonfarm-payrolls-monthly-change-thousands')?.value).toBe(57)
    expect(drafts.find((draft) => draft.metric === 'unemployment-rate-percent')?.value).toBe(4.2)
    expect(drafts.find((draft) => draft.metric === 'average-hourly-earnings-monthly-percent-change')?.value).toBeCloseTo(0.3466, 3)
    expect(JSON.stringify(drafts)).not.toMatch(/scheduled|published|eventKey|releaseTime/i)
  })

  it('rejects malformed primary series or selects an earlier complete five-metric snapshot', () => {
    const missing = structuredClone(fixture)
    missing.Results.series = missing.Results.series.filter((series: { seriesID: string }) => series.seriesID !== 'LNS14000000')
    expect(parseBlsObservedValues(missing)).toEqual([])

    const mismatched = structuredClone(fixture)
    mismatched.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0L1E').seriesID = 'WRONG'
    expect(parseBlsObservedValues(mismatched)).toEqual([])

    const nonnumeric = structuredClone(fixture)
    nonnumeric.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CES0000000001').data[0].value = '-'
    expect(parseBlsObservedValues(nonnumeric).every((draft) => draft.observedPeriod === '2026-M05')).toBe(true)

    const nonconsecutive = structuredClone(fixture)
    nonconsecutive.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CES0500000003').data[1].period = 'M04'
    expect(parseBlsObservedValues(nonconsecutive)).toEqual([])

    const invalidPeriod = structuredClone(fixture)
    invalidPeriod.Results.series.find((series: { seriesID: string }) => series.seriesID === 'LNS14000000').data[0].period = 'M13'
    expect(parseBlsObservedValues(invalidPeriod)).toEqual([])
  })

  it('rejects an affected metric when an allowed series or monthly period is duplicated', () => {
    const duplicateSeries = structuredClone(fixture)
    duplicateSeries.Results.series.push(structuredClone(duplicateSeries.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0')))
    expect(parseBlsObservedValues(duplicateSeries)).toEqual([])

    const duplicatePeriod = structuredClone(fixture)
    const cpi = duplicatePeriod.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0')
    cpi.data.push(structuredClone(cpi.data[0]))
    expect(parseBlsObservedValues(duplicatePeriod)).toEqual([])
  })

  it('does not let the supporting private payrolls series advance the common observed month', () => {
    const auxiliaryNewerPeriod = structuredClone(fixture)
    auxiliaryNewerPeriod.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CES0500000001').data.unshift({ year: '2026', period: 'M07', value: '135700' })

    const drafts = parseBlsObservedValues(auxiliaryNewerPeriod)
    expect(drafts).toHaveLength(5)
    expect(drafts.every((draft) => draft.observedPeriod === '2026-M06')).toBe(true)
  })

  it('uses the latest common complete metric month rather than a newer partial primary month', () => {
    const partialNewerPeriod = structuredClone(fixture)
    partialNewerPeriod.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data.unshift({ year: '2026', period: 'M07', value: '334.000' })

    const drafts = parseBlsObservedValues(partialNewerPeriod)
    expect(drafts).toHaveLength(5)
    expect(drafts.every((draft) => draft.observedPeriod === '2026-M06')).toBe(true)

    const noCommonCompletePeriod = structuredClone(fixture)
    noCommonCompletePeriod.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0L1E').data = []
    expect(parseBlsObservedValues(noCommonCompletePeriod)).toEqual([])
  })

  it.each([
    { seriesId: 'CUUR0000SA0', year: '2025', period: 'M06' },
    { seriesId: 'CES0500000003', year: '2026', period: 'M05' }
  ])('selects an earlier computable complete snapshot when a denominator is zero: $seriesId', ({ seriesId, year, period }) => {
    const zeroDenominator = structuredClone(fixture)
    zeroDenominator.Results.series.find((series: { seriesID: string }) => series.seriesID === seriesId).data.find((item: { year: string; period: string }) => item.year === year && item.period === period).value = '0'

    const drafts = parseBlsObservedValues(zeroDenominator)
    expect(drafts).toHaveLength(5)
    expect(drafts.every((draft) => draft.observedPeriod === '2026-M05')).toBe(true)
  })

  it('returns no snapshot when no candidate has computable denominators', () => {
    const noComputableCompletePeriod = structuredClone(fixture)
    noComputableCompletePeriod.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data
      .filter((item: { year: string; value: string }) => item.year === '2025' && item.value !== '-')
      .forEach((item: { value: string }) => { item.value = '0' })
    expect(parseBlsObservedValues(noComputableCompletePeriod)).toEqual([])
  })

  it.each([
    { year: '2025', period: 'M06' },
    { year: '2026', period: 'M06' }
  ])('omits an unrepresentable CPI observation and selects an earlier finite complete snapshot: $year-$period', ({ year, period }) => {
    const unrepresentable = structuredClone(fixture)
    unrepresentable.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data.find((item: { year: string; period: string }) => item.year === year && item.period === period).value = '9'.repeat(400)

    const drafts = parseBlsObservedValues(unrepresentable)
    expect(drafts).toHaveLength(5)
    expect(drafts.every((draft) => draft.observedPeriod === '2026-M05' && Number.isFinite(draft.value))).toBe(true)
  })

  it('returns no snapshot when every CPI observation is unrepresentable', () => {
    const noFiniteCpi = structuredClone(fixture)
    noFiniteCpi.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data
      .filter((item: { value: string }) => item.value !== '-')
      .forEach((item: { value: string }) => { item.value = '9'.repeat(400) })
    expect(parseBlsObservedValues(noFiniteCpi)).toEqual([])
  })

  it.each([
    { seriesId: 'CUUR0000SA0', current: '1' + '0'.repeat(308), base: '0.' + '0'.repeat(307) + '1', baseYear: '2025', basePeriod: 'M06' },
    { seriesId: 'CES0000000001', current: '1' + '0'.repeat(308), base: '-1' + '0'.repeat(308), baseYear: '2026', basePeriod: 'M05' },
    { seriesId: 'CES0500000003', current: '1' + '0'.repeat(308), base: '0.' + '0'.repeat(307) + '1', baseYear: '2026', basePeriod: 'M05' }
  ])('selects an earlier finite complete snapshot when a derived metric overflows: $seriesId', ({ seriesId, current, base, baseYear, basePeriod }) => {
    const overflow = structuredClone(fixture)
    const data = overflow.Results.series.find((series: { seriesID: string }) => series.seriesID === seriesId).data
    data.find((item: { year: string; period: string }) => item.year === '2026' && item.period === 'M06').value = current
    data.find((item: { year: string; period: string }) => item.year === baseYear && item.period === basePeriod).value = base

    const drafts = parseBlsObservedValues(overflow)
    expect(drafts).toHaveLength(5)
    expect(drafts.every((draft) => draft.observedPeriod === '2026-M05' && Number.isFinite(draft.value))).toBe(true)
  })

  it('returns no snapshot when every candidate has a non-finite derived CPI metric', () => {
    const noFiniteDerivedCpi = structuredClone(fixture)
    const cpi = noFiniteDerivedCpi.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data
    cpi.filter((item: { year: string; value: string }) => item.year === '2026').forEach((item: { value: string }) => { item.value = '1' + '0'.repeat(308) })
    cpi.filter((item: { year: string; value: string }) => item.year === '2025' && item.value !== '-').forEach((item: { value: string }) => { item.value = '0.' + '0'.repeat(307) + '1' })
    expect(parseBlsObservedValues(noFiniteDerivedCpi)).toEqual([])
  })

  it.each([null, undefined, 0, 'response', [], {}, { Results: {} }, { Results: { series: {} } }, { Results: { series: [null] } }, { Results: { series: [{ seriesID: 'CUUR0000SA0', data: {} }] } }])('safely rejects an unexpected payload shape: %j', (payload) => {
    expect(parseBlsObservedValues(payload)).toEqual([])
  })

  it.each([null, 4, 'observation', [], {}, { year: '2026' }])('rejects the complete snapshot when an allowed series has a malformed observation: %j', (observation) => {
    const malformed = structuredClone(fixture)
    malformed.Results.series.find((series: { seriesID: string }) => series.seriesID === 'CUUR0000SA0').data.unshift(observation)
    expect(parseBlsObservedValues(malformed)).toEqual([])
  })

  it.each(['', '   ', '0x10', '1_000', '1e3', 'Infinity', 'NaN'])('rejects a noncanonical BLS decimal observation: %s', (numericText) => {
    const malformed = structuredClone(fixture)
    malformed.Results.series.find((series: { seriesID: string }) => series.seriesID === 'LNS14000000').data[0].value = numericText
    expect(parseBlsObservedValues(malformed)).toEqual([])
  })

  it('keeps the official unavailable marker outside the selected snapshot unavailable without failing the capture', () => {
    expect(parseBlsObservedValues(fixture)).toHaveLength(5)
  })

  it.each([{ year: '2026', period: 'M13', value: '-' }, { year: 'bad', period: 'M06', value: '-' }])('rejects an unavailable marker with an invalid observation coordinate: %j', (observation) => {
    const malformed = structuredClone(fixture)
    malformed.Results.series.find((series: { seriesID: string }) => series.seriesID === 'LNS14000000').data[0] = observation
    expect(parseBlsObservedValues(malformed)).toEqual([])
  })
})
