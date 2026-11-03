import { describe, expect, it } from 'vitest'

import { moduleSignalPolicy, signalWindow, type ModuleSignal, type SignalCadence } from './moduleSignal'
import {
  moduleSignalEvidencePolicy, parseSignalEvidence, queuedSignalEvidence, signalEvidenceJson,
  skippedSignalEvidence, type SignalWithWindow
} from './moduleSignalEvidence'

const intraday: SignalCadence = { kind: 'intraday', bucketMs: 15 * 60_000 }

const signal = (overrides: Partial<ModuleSignal> = {}): ModuleSignal => ({
  version: moduleSignalPolicy.version,
  moduleId: 'open-interest',
  ruleId: 'oi-liquidation-proxy',
  asset: 'btc',
  severity: 'high',
  observedAt: '2026-11-03T02:00:00.000Z',
  cadence: intraday,
  values: { dropPct: -1.9, volumeMultiple: 3.4 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-11-03T02:00:00.000Z',
  readiness: 'available',
  triggerOwner: 'module-signal',
  ...overrides
})

const withWindow = (value: ModuleSignal, amount = 1): SignalWithWindow => ({
  signal: value, window: signalWindow(value.cadence, amount)!
})

describe('signal evidence contract', () => {
  it('writes a skipped row as exactly the four reading keys', () => {
    const evidence = skippedSignalEvidence(withWindow(signal({ severity: 'medium' })))
    // Not "at least": `moduleId`/`ruleId`/`asset` belong to the queued shape, and a skipped row that
    // started carrying them would be a second, undocumented shape.
    expect(Object.keys(evidence).sort()).toEqual([...moduleSignalEvidencePolicy.skippedKeys].sort())
    expect(evidence.severity).toBe('medium')
    expect(evidence.observedAt).toBe('2026-11-03T02:00:00.000Z')
    expect(evidence.window).toEqual({ unit: 'buckets', amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 })
    expect(evidence.values).toEqual({ dropPct: -1.9, volumeMultiple: 3.4 })
  })

  it('writes a queued run as exactly two keys, with one countable entry per signal', () => {
    const evidence = queuedSignalEvidence([
      withWindow(signal({ severity: 'low', observedAt: '2026-11-03T02:15:00.000Z', ruleId: 'oi-quiet' })),
      withWindow(signal({ severity: 'high' })),
      withWindow(signal({ severity: 'medium', observedAt: '2026-11-03T02:10:00.000Z', ruleId: 'oi-mid' }))
    ])
    expect(Object.keys(evidence).sort()).toEqual([...moduleSignalEvidencePolicy.queuedKeys].sort())
    expect(evidence.signalCount).toBe(3)
    expect(evidence.signals).toHaveLength(3)
    for (const entry of evidence.signals) {
      expect(Object.keys(entry).sort()).toEqual([...moduleSignalEvidencePolicy.entryKeys].sort())
    }
    // Most severe first; same severity keeps the earlier observation first.
    expect(evidence.signals.map(entry => entry.severity)).toEqual(['high', 'medium', 'low'])
    expect(evidence.signals[0]!.moduleId).toBe('open-interest')
    expect(evidence.signals[0]!.ruleId).toBe('oi-liquidation-proxy')
    expect(evidence.signals[0]!.asset).toBe('btc')
  })

  it('refuses to write a shape the decision does not carry', () => {
    const skipped = skippedSignalEvidence(withWindow(signal()))
    const queued = queuedSignalEvidence([withWindow(signal())])
    // A skipped decision cannot store a batch, a queued one cannot store a single reading, and usage
    // (`recorded`) is not a signal at all.
    expect(() => signalEvidenceJson('skipped', queued)).toThrowError('signal-evidence-shape-mismatch')
    expect(() => signalEvidenceJson('queued', skipped)).toThrowError('signal-evidence-shape-mismatch')
    expect(() => signalEvidenceJson('recorded', skipped)).toThrowError('signal-evidence-shape-mismatch')
    expect(signalEvidenceJson('recorded', null)).toBeNull()
    expect(signalEvidenceJson('startup.refresh', null)).toBeNull()
    // A by-hand object with an extra key is refused instead of being stored.
    expect(() => signalEvidenceJson('skipped', { ...skipped, moduleId: 'open-interest' } as never)).toThrowError('signal-evidence-shape-mismatch')
  })

  it('round-trips each shape through storage', () => {
    const skipped = skippedSignalEvidence(withWindow(signal()))
    const queued = queuedSignalEvidence([withWindow(signal()), withWindow(signal({ severity: 'low', ruleId: 'oi-quiet' }))])
    expect(parseSignalEvidence('skipped', signalEvidenceJson('skipped', skipped))).toEqual(skipped)
    expect(parseSignalEvidence('queued', signalEvidenceJson('queued', queued))).toEqual(queued)
  })

  it('reads the shape its decision names, and never the other one', () => {
    const skippedJson = signalEvidenceJson('skipped', skippedSignalEvidence(withWindow(signal())))
    const queuedJson = signalEvidenceJson('queued', queuedSignalEvidence([withWindow(signal())]))
    // The defect the decision-first rule prevents: a batch read as one reading yields a plausible
    // object with no signals in it, and the row shows no reason at all.
    expect(parseSignalEvidence('skipped', queuedJson)).toBeNull()
    expect(parseSignalEvidence('queued', skippedJson)).toBeNull()
    expect(parseSignalEvidence('recorded', queuedJson)).toBeNull()
    expect(parseSignalEvidence('unknown', skippedJson)).toBeNull()
  })

  it('rejects a row that no longer matches its shape, instead of reading around the gap', () => {
    const skipped = skippedSignalEvidence(withWindow(signal()))
    const queued = queuedSignalEvidence([withWindow(signal())])
    const { values: _values, ...missingValues } = skipped
    const withExtra = { ...skipped, note: 'not part of the shape' }
    expect(parseSignalEvidence('skipped', JSON.stringify(missingValues))).toBeNull()
    expect(parseSignalEvidence('skipped', JSON.stringify(withExtra))).toBeNull()
    expect(parseSignalEvidence('skipped', 'not-json')).toBeNull()
    expect(parseSignalEvidence('skipped', null)).toBeNull()
    // A count that disagrees with the array is how "1 row, 3 signals" turns into a second truth.
    expect(parseSignalEvidence('queued', JSON.stringify({ ...queued, signalCount: 3 }))).toBeNull()
    expect(parseSignalEvidence('queued', JSON.stringify({ ...queued, signals: [] }))).toBeNull()
    expect(parseSignalEvidence('queued', JSON.stringify({ signalCount: 0, signals: [] }))).toBeNull()
    const [entry] = queued.signals
    const { moduleId: _moduleId, ...entryWithoutModule } = entry!
    expect(parseSignalEvidence('queued', JSON.stringify({ signalCount: 1, signals: [entryWithoutModule] }))).toBeNull()
  })
})
