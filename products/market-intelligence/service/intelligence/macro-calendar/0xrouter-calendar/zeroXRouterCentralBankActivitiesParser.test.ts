import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseZeroXRouterCentralBankActivities } from './zeroXRouterCentralBankActivitiesParser'

// Synthetic rows exercise boundaries; they are not captured identity evidence.
const row = { calendarId: 'synthetic-event', id: 201, calendarName: 'Synthetic event',
  locale: 'zh', countryCode: 'GER', countryName: 'Germany', star: 2,
  pubTimestamp: Date.UTC(2026, 8, 7), pubTime: Date.UTC(2026, 8, 8) }
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
  const mixed = parse(envelope([row, ...invalid]), 'zh')
  expect(mixed.state).toBe('succeeded')
  if (mixed.state === 'succeeded') {
    expect(mixed.drafts).toHaveLength(1)
    expect(mixed.drafts[0]!.displayName).toBe(row.calendarName)
    expect(mixed.diagnostics).toEqual({ inputRows: 6, skippedRows: 5, reasons })
  }
  expect(parse(envelope(invalid), 'zh')).toEqual({
    state: 'succeeded', drafts: [], diagnostics: { inputRows: 5, skippedRows: 5, reasons }
  })
  expect(parse(envelope([]), 'zh')).toEqual({ state: 'succeeded', drafts: [], diagnostics: {
    inputRows: 0, skippedRows: 0, reasons: { 'invalid-identity': 0, 'invalid-date': 0, 'invalid-row': 0 }
  } })
  expect(JSON.stringify(mixed)).not.toContain('private-marker')
})
const parse = parseZeroXRouterCentralBankActivities

describe('0xRouter central-bank-activities parser', () => {
  it('projects only event metadata with explicit country and unverified locale-local identity', () => {
    const result = parse(envelope([{ ...row, estimateValue: '9', pubValue: '8', preValue: '7', rawBody: 'discard' }]), 'zh')
    expect(result).toMatchObject({ state: 'succeeded', drafts: [{
      providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-central-bank-activities',
      kind: 'central-bank-activity', displayName: 'Synthetic event', countryCode: 'DE', importance: 'medium',
      scheduledAt: '2026-09-07T00:00:00.000Z', scheduledDate: '2026-09-07',
      identityState: 'unverified', localeMerge: 'disabled', officialLink: 'disabled'
    }] })
    if (result.state === 'succeeded') {
      for (const field of ['consensus', 'providerPrevious', 'providerActual', 'rawBody', 'periodKey', 'surprise']) {
        expect(result.drafts[0]).not.toHaveProperty(field)
      }
    }
  })

  it('accepts the captured English success-empty fixture', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/zeroxrouter-central-bank-activities-en-success.json', import.meta.url), 'utf8'))
    expect(parse(fixture, 'en')).toMatchObject({ state: 'succeeded', drafts: [], diagnostics: { inputRows: 0, skippedRows: 0 } })
  })

  it('does not treat structural redaction as stable identity or valid event evidence', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/zeroxrouter-central-bank-activities-zh-success.json', import.meta.url), 'utf8'))
    expect(parse(fixture, 'zh')).toMatchObject({ state: 'succeeded', drafts: [], diagnostics: { inputRows: 1, skippedRows: 1, reasons: { 'invalid-identity': 1 } } })
  })

  it('omits unknown country and invalid times without guessing from dataTime', () => {
    const result = parse(envelope([{ ...row, countryCode: 'UNKNOWN', pubTimestamp: 0, pubTime: 1.5, dataTime: '2026-09-09' }]), 'zh')
    expect(result).toMatchObject({ state: 'succeeded', drafts: [], diagnostics: { skippedRows: 1, reasons: { 'invalid-date': 1 } } })
    const unknownCountry = parse(envelope([{ ...row, countryCode: 'UNKNOWN' }]), 'zh')
    expect(unknownCountry).toMatchObject({ state: 'succeeded', drafts: [{ scheduledDate: '2026-09-07' }] })
    if (unknownCountry.state === 'succeeded') expect(unknownCountry.drafts[0]).not.toHaveProperty('countryCode')
    const fallback = parse(envelope([{ ...row, pubTimestamp: 'invalid' }]), 'zh')
    expect(fallback).toMatchObject({ state: 'succeeded', drafts: [{ scheduledAt: '2026-09-08T00:00:00.000Z' }] })
  })

  it('rejects errors, malformed rows, invalid stars, mismatched locale and duplicate identities', () => {
    for (const input of [null, { code: 403, msg: 'private', data: [] }, { code: 200, data: [] }, envelope({}),
      envelope([row, row]), envelope([row, { ...row, calendarName: 'Conflicting event' }])]) {
      expect(parse(input, 'zh')).toEqual({ state: 'unavailable', failureCode: 'invalid-payload' })
    }
    expect(parse(envelope(), 'fr' as never)).toEqual({ state: 'unavailable', failureCode: 'invalid-payload' })
  })

  it('keeps same source candidates separate across locales', () => {
    const zh = parse(envelope(), 'zh')
    const en = parse(envelope([{ ...row, locale: 'en' }]), 'en')
    expect(zh.state).toBe('succeeded')
    expect(en.state).toBe('succeeded')
    if (zh.state === 'succeeded' && en.state === 'succeeded') {
      expect(zh.drafts[0]!.marketFactKey).not.toBe(en.drafts[0]!.marketFactKey)
    }
  })

  it('enforces named array and text boundaries', () => {
    expect(parse(envelope(Array.from({ length: 1001 }, (_, index) => ({ ...row, id: index + 1 }))), 'zh').state).toBe('unavailable')
    for (const calendarName of ['a'.repeat(513), '界'.repeat(400), 'bad\u0000name']) {
      expect(parse(envelope([{ ...row, calendarName }]), 'zh')).toMatchObject({ state: 'succeeded', drafts: [], diagnostics: { skippedRows: 1, reasons: { 'invalid-row': 1 } } })
    }
  })
})
