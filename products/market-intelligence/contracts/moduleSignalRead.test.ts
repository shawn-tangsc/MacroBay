import { describe, expect, it } from 'vitest'

import { isCanonicalSignalTime } from './moduleSignal'
import {
  isModuleSignalRead,
  isModuleSignalReadRetryable,
  moduleSignalReadCopyKey,
  moduleSignalReadPolicy,
  moduleSignalsOf,
  toModuleSignalRead
} from './moduleSignalRead'

import type { SignalWindow } from './moduleSignal'
import type { SignalWithWindow } from './moduleSignalEvidence'

const asOf = '2026-11-06T10:30:00.000Z'
const window: SignalWindow = { unit: 'buckets', amount: 1, bucketMs: 15 * 60_000, upperBoundMs: 15 * 60_000 }
const signal = {
  version: '1',
  moduleId: 'open-interest' as const,
  ruleId: 'oi-liquidation-proxy',
  asset: 'btc' as const,
  severity: 'high' as const,
  observedAt: '2026-11-06T10:15:00.000Z',
  cadence: { kind: 'intraday' as const, bucketMs: 15 * 60_000 },
  values: { dropPct: -2.7, volumeMultiple: 3.4 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-11-06T10:15:00.000Z',
  readiness: 'available' as const,
  triggerOwner: 'module-signal'
}
const good: SignalWithWindow = { signal, window }

describe('module signal read', () => {
  it('keeps every readable signal and counts none as dropped', () => {
    expect(toModuleSignalRead([good, good])).toMatchObject({ state: 'available', droppedInvalid: 0 })
    expect(toModuleSignalRead([good, good])).toMatchObject({ signals: [good, good] })
  })

  it('drops a malformed entry but counts it, so the defect cannot hide behind a missing chip', () => {
    const read = toModuleSignalRead([good, good, good, { signal: { ...signal, severity: 'critical' }, window }])
    expect(read).toMatchObject({ state: 'available', droppedInvalid: 1 })
    expect(read.state === 'available' && read.signals).toHaveLength(3)
  })

  it('answers contract-invalid when nothing readable came back but something did', () => {
    expect(toModuleSignalRead([{ signal: { ...signal, severity: 'critical' }, window }]))
      .toEqual({ state: 'unavailable', failureCode: 'contract-invalid' })
    expect(toModuleSignalRead('nonsense')).toEqual({ state: 'unavailable', failureCode: 'contract-invalid' })
  })

  it('treats a batch of windowless entries as an unreadable answer, not a quiet market', () => {
    // 旧版返回体没有窗口（窗口是后加的）。这不是「今天没事」，是两边的形状没对上——而形状没对上
    // 时静默显示「没有」正是这套校验存在的理由。
    expect(toModuleSignalRead([{ signal }]))
      .toEqual({ state: 'unavailable', failureCode: 'contract-invalid' })
    // 一条旧的混在好条里：好条照常显示，旧条计数，不把整批判死。
    expect(toModuleSignalRead([good, { signal }]))
      .toEqual({ state: 'available', signals: [good], droppedInvalid: 1 })
  })

  it('accepts a genuinely empty read as a quiet market, not a failure', () => {
    expect(toModuleSignalRead([])).toEqual({ state: 'available', signals: [], droppedInvalid: 0 })
  })

  it('decides retryability in one place and offers it only where retrying can work', () => {
    expect(isModuleSignalReadRetryable('query-failed')).toBe(true)
    expect(isModuleSignalReadRetryable('invalid-as-of')).toBe(false)
    expect(isModuleSignalReadRetryable('contract-invalid')).toBe(false)
  })

  it('names the sentence by the same code table the rules came from', () => {
    expect(moduleSignalReadCopyKey('a.b', 'query-failed')).toBe('a.b.query-failed')
    expect(moduleSignalReadPolicy.failureCodes).toHaveLength(3)
  })

  it('hands the chips the signals of a successful read and nothing on a failure', () => {
    expect(moduleSignalsOf({ state: 'available', signals: [good], droppedInvalid: 0 })).toEqual([signal])
    expect(moduleSignalsOf({ state: 'unavailable', failureCode: 'query-failed' })).toBeUndefined()
  })

  it('recognises its own shape on both sides of the bridge', () => {
    expect(isModuleSignalRead({ state: 'available', signals: [], droppedInvalid: 0 })).toBe(true)
    expect(isModuleSignalRead({ state: 'unavailable', failureCode: 'query-failed' })).toBe(true)
    expect(isModuleSignalRead({ state: 'unavailable', failureCode: 'gone' })).toBe(false)
    expect(isModuleSignalRead({ state: 'available', signals: [] })).toBe(false)
    expect(isModuleSignalRead(null)).toBe(false)
  })

  it('keeps the canonical instant check the payload path uses', () => {
    expect(isCanonicalSignalTime(asOf)).toBe(true)
  })
})
