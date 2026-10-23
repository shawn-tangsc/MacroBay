import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { calendarText, calendarIdentity, zeroXRouterCalendarParserPolicy } from './zeroXRouterCalendarContracts'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'
import { parseZeroXRouterFinancialEvents } from './zeroXRouterFinancialEventsParser'
import { parseZeroXRouterCentralBankActivities } from './zeroXRouterCentralBankActivitiesParser'
import { prepareMarketCollection, marketScope, zeroXRouterCalendarStoragePolicy as policy } from './marketCalendarStorageValidation'

const scope = { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', month: '2026-09' }
const context = { ...scope, detectedAt: '2026-09-08T00:00:00.000Z', evidence: {
  providerId: '0xrouter', descriptorId: scope.descriptorId, rawRecordId: 'raw-one', evidenceHash: 'a'.repeat(64) } }
// Derived parser contract input, not a production evidence fixture.
const row = { calendarId: 'candidate', id: 1, calendarName: 'Derived', locale: 'zh', star: 3, pubTime: Date.parse('2026-09-09T12:00:00.000Z') }
function input(changes = {}) {
  return { ...scope, collectionId: 'one', parserVersion: 'v1', parseResult:
    parseZeroXRouterEconomicData({ code: 200, msg: '', data: [{ ...row, ...changes }] }, 'zh') }
}

// All ECMAScript WhiteSpace and LineTerminator code points, plus non-whitespace
// lookalikes. The MC2 functions are the compatibility oracle, not a new grammar.
const whitespace = ['\u0009', '\u000b', '\u000c', '\u0020', '\u00a0', '\u1680',
  ...Array.from({ length: 11 }, (_, index) => String.fromCharCode(0x2000 + index)),
  '\u202f', '\u205f', '\u3000', '\ufeff', '\u000a', '\u000d', '\u2028', '\u2029']
const canonicalSamples: unknown[] = [undefined, null, false, 0, 1, {}, [], '', ' ', '0', 'A B', 'A  B',
  ' A', 'A ', 'A\u200bB', 'A\u180eB', 'A\u0085B', 'A\u200dB',
  ...whitespace.flatMap((space) => [space, `${space}A`, `A${space}`, `A${space}B`, `A${space}${space}B`]),
  ...Array.from({ length: 32 }, (_, index) => `A${String.fromCharCode(index)}B`),
  ...Array.from({ length: 33 }, (_, index) => `A${String.fromCharCode(127 + index)}B`),
  'a'.repeat(511), 'a'.repeat(512), 'a'.repeat(513), 'é'.repeat(511), 'é'.repeat(512),
  'é'.repeat(511) + '€', '€'.repeat(341), '€'.repeat(341) + 'a', '€'.repeat(341) + 'é',
  '😀'.repeat(255), '😀'.repeat(256), '😀'.repeat(256) + 'a',
  'e\u0301'.repeat(256), '\ud800', '\udfff', 'A\ud800B', '\ud800'.repeat(341), '\ud800'.repeat(342),
  'N/A', 'null', '--', '—', '-', 'candidate', 'candidate-1_2', 'redacted-candidate', 'a'.repeat(128), 'a'.repeat(129)]

function withDraft(change: Record<string, unknown>) {
  const batch = input()
  if (batch.parseResult.state !== 'succeeded') throw new Error('expected derived draft')
  return { ...batch, parseResult: { ...batch.parseResult, drafts: [{ ...batch.parseResult.drafts[0], ...change }] } }
}

describe('market storage source and value validation', () => {
  it('serializes each observation only once per visitor pass and retains no row array', () => {
    const batch = input({ estimateValue: 0 })
    const original = JSON.stringify
    let serializedObservations = 0
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...rest: any[]) => {
      if (value && typeof value === 'object' && Object.hasOwn(value, 'observation_id')) serializedObservations++
      return original(value, ...rest)
    }) as typeof JSON.stringify)
    let visited = 0
    try {
      const prepared = prepareMarketCollection(batch, context, () => { visited++ })
      expect(visited).toBe(1)
      expect(prepared.observations).toEqual([])
      expect(serializedObservations).toBe(1)
    } finally { stringify.mockRestore() }
  })

  it('measures exact legacy reservation bytes without retaining batch serialization', () => {
    for (const count of [0, 1, 2, 1000]) {
      const base = input()
      if (base.parseResult.state !== 'succeeded') throw new Error('expected draft')
      const drafts = Array.from({ length: count }, (_, index) => {
        const sourceEventId = JSON.stringify(['candidate', index + 1])
        const draft = { ...base.parseResult.drafts[0], sourceEventId,
          marketFactKey: JSON.stringify(['0xrouter', scope.descriptorId, 'zh', sourceEventId]),
          displayName: 'Quoted "value" \\ 中文 😀 \ud800',
          ...(index % 2 ? { consensus: { displayValue: '0' }, providerImpact: { code: 'C', label: 'Impact' } } : {}) }
        // Caller field order must not affect normalized storage serialization.
        return index % 2 ? Object.fromEntries(Object.entries(draft).reverse()) : draft
      })
      const result = prepareMarketCollection({ ...base, parseResult: { ...base.parseResult, drafts,
        diagnostics: { inputRows: count, skippedRows: 0, reasons: { 'invalid-identity': 0, 'invalid-date': 0, 'invalid-row': 0 } } } }, context)
      const legacyBytes = Buffer.byteLength(JSON.stringify({ collection: result.collection, observations: result.observations }))
      expect(result.serializedBytes).toBe(legacyBytes)
    }
  })

  it('matches MC2 canonical text oracle on Unicode, encoding and input-type boundaries through the real prepare path', () => {
    for (const [index, value] of canonicalSamples.entries()) {
      const canonical = typeof value === 'string' && value.length > 0 && calendarText(value) === value
      const changes = [
        { displayName: value }, { countryName: value }, { providerImpact: { label: value } },
        { providerImpact: { label: 'Impact', code: value } },
        ...policy.valueFields.map((field) => ({ [field]: { displayValue: value } }))
      ]
      for (const [fieldIndex, change] of changes.entries()) {
        const optionalAbsent = value === undefined && (fieldIndex === 1 || fieldIndex === 3)
        const placeholder = fieldIndex >= 4 && typeof value === 'string' &&
          zeroXRouterCalendarParserPolicy.placeholders.includes(value.toLowerCase())
        const allowed = optionalAbsent || (canonical && !placeholder)
        const prepare = () => prepareMarketCollection(withDraft(change), context)
        if (!allowed) { expect(prepare, `sample ${index}, field ${fieldIndex}`).toThrow('invalid-input'); continue }
        const observation = prepare().observations[0]!
        // Preserve the precise business serialization/hash, including lone-surrogate
        // JSON escaping and separate missing states. No numeric/unit inference.
        const business = { event_kind: 'economic-indicator', display_name: 'Derived', indicator_id: null,
          country_code: null, country_name: null, importance: 'high', scheduled_date: '2026-09-09',
          scheduled_at: '2026-09-09T12:00:00.000Z', consensus_json: null, provider_previous_json: null,
          provider_actual_json: null, provider_impact_json: null, provider_time_status: null } as Record<string, unknown>
        if (fieldIndex === 0) business.display_name = value
        if (fieldIndex === 1) business.country_name = value ?? null
        if (fieldIndex === 2) business.provider_impact_json = JSON.stringify({ label: value })
        if (fieldIndex === 3) business.provider_impact_json = JSON.stringify({ label: 'Impact', ...(value !== undefined ? { code: value } : {}) })
        if (fieldIndex >= 4) business[['consensus_json', 'provider_previous_json', 'provider_actual_json'][fieldIndex - 4]!] = JSON.stringify({ displayValue: value })
        expect(observation.business_snapshot_hash).toBe(createHash('sha256').update(JSON.stringify(business)).digest('hex'))
      }
    }
  })

  it('matches the canonical identity oracle without accepting redacted, normalized or non-string identities', () => {
    for (const [index, value] of canonicalSamples.entries()) {
      const canonical = typeof value === 'string' && value.length > 0 && calendarIdentity(value) === value
      const sourceEventId = JSON.stringify([value, 1])
      const prepare = () => prepareMarketCollection(withDraft({ sourceEventId,
        marketFactKey: JSON.stringify(['0xrouter', scope.descriptorId, 'zh', sourceEventId]) }), context)
      if (canonical) expect(prepare().observations[0]?.source_event_id).toBe(sourceEventId)
      else expect(prepare, `identity sample ${index}`).toThrow('invalid-input')
      const indicator = () => prepareMarketCollection(withDraft({ indicatorId: value }), context)
      if (canonical || value === undefined) expect(indicator().observations[0]?.indicator_id).toBe(value ?? null)
      else expect(indicator, `indicator sample ${index}`).toThrow('invalid-input')
    }
  })

  it('hashes each value and missing state independently but excludes collection and evidence metadata', () => {
    const first = prepareMarketCollection(input({ estimateValue: 0, preValue: '2', pubValue: '3' }), context)
    const second = prepareMarketCollection({ ...input({ estimateValue: 0, preValue: '2', pubValue: '3' }), collectionId: 'two', parserVersion: 'v2' },
      { ...context, detectedAt: '2026-09-10T00:00:00.000Z', evidence: { ...context.evidence, rawRecordId: 'raw-two', evidenceHash: 'b'.repeat(64) } })
    expect(first.observations[0]?.business_snapshot_hash).toBe(second.observations[0]?.business_snapshot_hash)
    const hashes = [input(), input({ estimateValue: 0 }), input({ preValue: 0 }), input({ pubValue: 0 })]
      .map((batch) => prepareMarketCollection(batch, context).observations[0]?.business_snapshot_hash)
    expect(new Set(hashes).size).toBe(4)
  })

  it.each([
    ['macro-calendar-0xrouter-financial-events', parseZeroXRouterFinancialEvents],
    ['macro-calendar-0xrouter-central-bank-activities', parseZeroXRouterCentralBankActivities]
  ] as const)('accepts %s real parser contract with no economic value inference', (descriptorId, parse) => {
    const batch = { ...input(), descriptorId, parseResult: parse({ code: 200, msg: '', data: [row] }, 'zh') }
    const result = prepareMarketCollection(batch, { ...context, descriptorId, evidence: { ...context.evidence, descriptorId } })
    expect(result.observations[0]).toMatchObject({ consensus_json: null, provider_previous_json: null, provider_actual_json: null })
  })

  it('rejects duplicate valid candidates, unauthorized row fields and oversized observation serialization', () => {
    const batch = input()
    if (batch.parseResult.state !== 'succeeded') throw new Error('expected draft')
    const draft = batch.parseResult.drafts[0]!
    for (const bad of [{ ...draft, collectionId: 'another' }, { ...draft, sourceEventId: '["candidate",0]' },
      { ...draft, countryCode: '' }, { ...draft, scheduledDate: '2026-01-01' }, { ...draft, officialLink: 'enabled' }]) {
      expect(() => prepareMarketCollection({ ...batch, parseResult: { ...batch.parseResult, drafts: [bad] } }, context)).toThrow('invalid-input')
    }
    expect(() => prepareMarketCollection({ ...batch, parseResult: { ...batch.parseResult, drafts: [draft, draft],
      diagnostics: { ...batch.parseResult.diagnostics, inputRows: 2 } } }, context)).toThrow('invalid-input')
    const wide = { ...draft, displayName: 'é'.repeat(512), countryName: 'é'.repeat(512),
      consensus: { displayValue: 'é'.repeat(512) }, providerPrevious: { displayValue: 'é'.repeat(512) },
      providerActual: { displayValue: 'é'.repeat(512) }, providerImpact: { label: 'é'.repeat(512), code: 'é'.repeat(512) } }
    expect(() => prepareMarketCollection({ ...batch, parseResult: { ...batch.parseResult, drafts: [wide] } }, context)).toThrow('row-too-large')
    expect(policy.observationBytes).toBe(8192)
  })

  it('derives leap-month UTC boundaries without accepting arbitrary time windows', () => {
    expect(marketScope({ ...scope, month: '2028-02' })).toMatchObject({ window_start: '2028-02-01T00:00:00.000Z', window_end: '2028-02-29T23:59:59.999Z' })
    expect(() => prepareMarketCollection({ ...input(), windowStart: 'forged' }, context)).toThrow('invalid-input')
  })

  it('rejects noncanonical candidate identity even when its recomputed key is self-consistent', () => {
    const batch = input()
    if (batch.parseResult.state !== 'succeeded') throw new Error('expected draft')
    const sourceEventId = JSON.stringify([' candidate ', 1])
    const draft = { ...batch.parseResult.drafts[0], sourceEventId,
      marketFactKey: JSON.stringify(['0xrouter', scope.descriptorId, 'zh', sourceEventId]) }
    expect(() => prepareMarketCollection({ ...batch, parseResult: { ...batch.parseResult, drafts: [draft] } }, context))
      .toThrow('invalid-input')
  })
})
