import { describe, expect, it } from 'vitest'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'

// Synthetic boundary data, not captured evidence for identity, units or official links.
const row = {
  calendarId: 'synthetic-calendar', id: 101, calendarName: 'Synthetic economic release',
  locale: 'zh', countryCode: 'USA', countryName: 'United States', star: 3,
  pubTimestamp: Date.UTC(2026, 8, 7, 12, 30), pubTime: Date.UTC(2026, 8, 8),
  indicatorsId: 'synthetic-indicator', dataTime: '2026-08',
  estimateValue: '12.5', fixPreValue: '-2', preValue: '7', pubValue: '0',
  dataEffect: 'provider description', dataEffectCode: 'synthetic-impact'
}
const envelope = (data: unknown = [row]) => ({ code: 200, msg: 'ok', data })

it('skips invalid rows with fixed counts while preserving valid events and distinguishing empty input', () => {
  const invalid = [
    { ...row, calendarId: null, rawBody: 'private-marker' },
    { ...row, id: -1 },
    { ...row, id: 302, pubTimestamp: 0, pubTime: NaN, dataTime: '2026-09-09' },
    { ...row, id: 303, star: 0 },
    { ...row, id: 304, locale: 'en' }
  ]
  const reasons = { 'invalid-identity': 2, 'invalid-date': 1, 'invalid-row': 2 }
  const mixed = parseZeroXRouterEconomicData(envelope([row, ...invalid]), 'zh')
  expect(mixed.state).toBe('succeeded')
  if (mixed.state === 'succeeded') {
    expect(mixed.drafts).toHaveLength(1)
    expect(mixed.drafts[0]!.displayName).toBe(row.calendarName)
    expect(mixed.diagnostics).toEqual({ inputRows: 6, skippedRows: 5, reasons })
  }
  expect(parseZeroXRouterEconomicData(envelope(invalid), 'zh')).toEqual({
    state: 'succeeded', drafts: [], diagnostics: { inputRows: 5, skippedRows: 5, reasons }
  })
  expect(parseZeroXRouterEconomicData(envelope([]), 'zh')).toEqual({ state: 'succeeded', drafts: [], diagnostics: {
    inputRows: 0, skippedRows: 0, reasons: { 'invalid-identity': 0, 'invalid-date': 0, 'invalid-row': 0 }
  } })
  expect(JSON.stringify(mixed)).not.toContain('private-marker')
})
const draft = (input = row) => {
  const result = parseZeroXRouterEconomicData(envelope([input]), 'zh')
  expect(result.state).toBe('succeeded')
  if (result.state !== 'succeeded') throw new Error('Expected successful synthetic parse')
  return result.drafts[0]!
}

describe('0xRouter economic data parser', () => {
  it('preserves consensus, corrected previous and provider actual as separate display values', () => {
    expect(draft()).toMatchObject({
      providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data',
      kind: 'economic-indicator', locale: 'zh', displayName: row.calendarName,
      consensus: { displayValue: '12.5' }, providerPrevious: { displayValue: '-2' },
      providerActual: { displayValue: '0' }, countryCode: 'US', importance: 'high',
      scheduledAt: '2026-09-07T12:30:00.000Z', scheduledDate: '2026-09-07',
      identityState: 'unverified', localeMerge: 'disabled', officialLink: 'disabled'
    })
    expect(draft()).not.toHaveProperty('periodKey')
    expect(draft()).not.toHaveProperty('surprise')
    expect(draft().consensus).toEqual({ displayValue: '12.5' })
  })

  it.each(['', ' ', '--', '-', '—', 'N/A', null, undefined])('does not coerce missing value %s to zero', (value) => {
    const input = { ...row, estimateValue: value, fixPreValue: value, pubValue: value }
    const result = parseZeroXRouterEconomicData(envelope([input]), 'zh')
    expect(result).toMatchObject({ state: 'succeeded', drafts: [{ providerPrevious: { displayValue: '7' } }] })
    if (result.state === 'succeeded') {
      expect(result.drafts[0]).not.toHaveProperty('consensus')
      expect(result.drafts[0]).not.toHaveProperty('providerActual')
    }
  })

  it.each(['0', 0])('preserves actual zero %s and corrected zero over the previous value', (zero) => {
    const result = parseZeroXRouterEconomicData(envelope([{ ...row, estimateValue: zero, fixPreValue: zero, pubValue: zero }]), 'zh')
    expect(result).toMatchObject({ state: 'succeeded', drafts: [{
      consensus: { displayValue: '0' }, providerPrevious: { displayValue: '0' }, providerActual: { displayValue: '0' }
    }] })
  })

  it('keeps unknown units, ranges and period evidence display-only', () => {
    const value = draft({ ...row, estimateValue: '3.50%–3.75%', fixPreValue: '12 mystery-units' })
    expect(value.consensus).toEqual({ displayValue: '3.50%–3.75%' })
    expect(value.providerPrevious).toEqual({ displayValue: '12 mystery-units' })
    expect(value).not.toHaveProperty('periodKey')
  })

  it('uses pubTime only if pubTimestamp is invalid, never dataTime', () => {
    expect(draft({ ...row, pubTimestamp: NaN }).scheduledAt).toBe('2026-09-08T00:00:00.000Z')
    for (const invalid of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(parseZeroXRouterEconomicData(envelope([{ ...row, pubTimestamp: invalid, pubTime: invalid, dataTime: '2026-09-09' }]), 'zh'))
        .toMatchObject({ state: 'succeeded', drafts: [], diagnostics: { inputRows: 1, skippedRows: 1, reasons: { 'invalid-date': 1 } } })
    }
  })

  it.each([[1, 'low'], [2, 'medium'], [3, 'high']] as const)('maps star %s explicitly', (star, importance) => {
    expect(draft({ ...row, star }).importance).toBe(importance)
  })

  it('isolates locale-local candidate identities and drops unknown fields/countries', () => {
    const zh = draft({ ...row, countryCode: 'ZZZ' })
    const en = parseZeroXRouterEconomicData(envelope([{ ...row, locale: 'en' }]), 'en')
    expect(zh).not.toHaveProperty('countryCode')
    expect(en.state).toBe('succeeded')
    if (en.state === 'succeeded') expect(en.drafts[0]!.marketFactKey).not.toBe(zh.marketFactKey)
    const result = parseZeroXRouterEconomicData(envelope([{ ...row, rawBody: 'discard', unit: 'percent', periodKey: '2026-08', officialLink: 'admitted' }]), 'zh')
    expect(JSON.stringify(result)).not.toContain('discard')
    if (result.state === 'succeeded') {
      expect(result.drafts[0]).not.toHaveProperty('unit')
      expect(result.drafts[0]).not.toHaveProperty('periodKey')
      expect(result.drafts[0]!.officialLink).toBe('disabled')
    }
  })

  it('rejects invalid envelope, malformed required fields, locale mismatch and duplicate identity', () => {
    for (const input of [null, [], { code: 500, msg: 'private error', data: [row] }, { code: 200, data: [] }, envelope({}), envelope([row, row]),
      envelope([row, { ...row, pubValue: 'different' }])]) {
      expect(parseZeroXRouterEconomicData(input, 'zh')).toEqual({ state: 'unavailable', failureCode: 'invalid-payload' })
    }
    expect(parseZeroXRouterEconomicData(envelope(), 'fr' as never)).toEqual({ state: 'unavailable', failureCode: 'invalid-payload' })
    expect(parseZeroXRouterEconomicData(envelope([]), 'zh')).toMatchObject({ state: 'succeeded', drafts: [] })
  })

  it('bounds array, text length and UTF-8 bytes and rejects control characters', () => {
    const rows = Array.from({ length: 1000 }, (_, index) => ({ ...row, id: index + 1 }))
    expect(parseZeroXRouterEconomicData(envelope(rows), 'zh').state).toBe('succeeded')
    expect(parseZeroXRouterEconomicData(envelope([...rows, { ...row, id: 1001 }]), 'zh').state).toBe('unavailable')
    expect(draft({ ...row, calendarName: 'a'.repeat(512) }).displayName).toHaveLength(512)
    for (const calendarName of ['a'.repeat(513), '界'.repeat(400), 'bad\u0000name']) {
      expect(parseZeroXRouterEconomicData(envelope([{ ...row, calendarName }]), 'zh')).toMatchObject({ state: 'succeeded', drafts: [], diagnostics: { skippedRows: 1 } })
    }
    expect(draft({ ...row, calendarName: '  spaced   title  ' }).displayName).toBe('spaced title')
  })

  it('rejects control-only and over-limit blank values before interpreting placeholders', () => {
    for (const estimateValue of ['\n', '\t', ' '.repeat(513)]) {
      expect(parseZeroXRouterEconomicData(envelope([{ ...row, estimateValue }]), 'zh'))
        .toMatchObject({ state: 'succeeded', drafts: [], diagnostics: { skippedRows: 1, reasons: { 'invalid-row': 1 } } })
    }
  })
})
