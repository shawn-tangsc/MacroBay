import { describe, expect, it } from 'vitest'
import { captureMarketStorageSnapshot, MarketCalendarDataOnlySnapshotPolicy as policy } from './marketCalendarStorageSnapshot'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'

// Derived internal-contract inputs only; not source evidence.
const input = () => ({ parseResult: { drafts: [{ consensus: { displayValue: '0' } }] } })
describe('market storage fixed data-only snapshot', () => {
  it('rejects accessors and proxies before executing getter or traps', () => {
    let calls = 0
    const value = Object.defineProperty({}, 'collectionId', { enumerable: true, get() { calls++; return 'one' } })
    const proxy = new Proxy({}, {
      ownKeys() { calls++; return [] },
      getPrototypeOf() { calls++; return Object.prototype },
      getOwnPropertyDescriptor() { calls++; return undefined }
    })
    for (const candidate of [value, proxy, { parseResult: proxy }]) {
      expect(() => captureMarketStorageSnapshot(candidate)).toThrow('invalid-input')
    }
    expect(calls).toBe(0)
  })

  it('copies shared noncyclic children by value and freezes only the private copy', () => {
    const shared = { displayValue: '0' }
    const caller = { parseResult: { drafts: [{ consensus: shared, providerActual: shared, countryCode: undefined }] } }
    Object.setPrototypeOf(caller, null)
    const result = captureMarketStorageSnapshot(caller) as typeof caller
    expect(result).toEqual(caller)
    expect(Object.getPrototypeOf(result)).toBeNull()
    expect(result.parseResult.drafts[0].consensus).not.toBe(result.parseResult.drafts[0].providerActual)
    expect(Object.isFrozen(result.parseResult.drafts[0].consensus)).toBe(true)
    expect(Object.isFrozen(caller)).toBe(false)
    shared.displayValue = 'changed'
    expect(result.parseResult.drafts[0].consensus.displayValue).toBe('0')
    expect(Object.hasOwn(result.parseResult.drafts[0], 'countryCode')).toBe(true)
  })

  it.each([
    () => ({ unknown: 'x' }),
    () => Object.defineProperty({}, 'hidden', { value: 'x' }),
    () => ({ [Symbol('x')]: 0 }),
    () => ({ collectionId: () => 'x' }),
    () => ({ collectionId: Symbol('x') }),
    () => ({ collectionId: 1n }),
    () => new Date(),
    () => { const value: any = {}; value.parseResult = value; return value },
    () => ({ parseResult: { drafts: new Array(1) } }),
    () => { const value = input(); Object.defineProperty(value.parseResult.drafts, 'extra', { value: 0 }); return value },
    () => ({ parseResult: { drafts: Array.from({ length: policy.maximumNodes + 1 }, () => ({})) } })
  ])('rejects non-contract data without a generic serialization fallback %#', (make) => {
    expect(() => captureMarketStorageSnapshot(make())).toThrow('invalid-input')
  })

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite primitive %s', (value) => {
    expect(() => captureMarketStorageSnapshot({ parseResult: { diagnostics: { inputRows: value } } })).toThrow('invalid-input')
  })

  it('includes UTF-8 property names at the exact text budget boundary', () => {
    const nameBytes = Buffer.byteLength('collectionId')
    const valid = { collectionId: 'x'.repeat(policy.maximumTextBytes - nameBytes) }
    expect(() => captureMarketStorageSnapshot(valid)).not.toThrow()
    valid.collectionId += 'x'
    expect(() => captureMarketStorageSnapshot(valid)).toThrow('invalid-input')
  })

  it('preserves lone-surrogate UTF-8 semantics without rewriting text', () => {
    const value = { collectionId: String.fromCharCode(0xd800) }
    expect(value.collectionId.length).toBe(1)
    expect(Buffer.byteLength(value.collectionId, 'utf8')).toBe(3)
    expect(captureMarketStorageSnapshot(value)).toEqual(value)
  })

  it('accepts the maximum-shape legal 1000-row MC2 input including names and array metadata', () => {
    const text = '😀'.repeat(256)
    const parseResult = parseZeroXRouterEconomicData({ code: 200, msg: '', data: Array.from({ length: 1000 }, (_, i) => ({
      calendarId: 'a'.repeat(128), id: Number.MAX_SAFE_INTEGER - i, calendarName: text,
      countryCode: 'US', countryName: text, locale: 'zh', star: 2, pubTimestamp: 253402300799999,
      indicatorsId: 'b'.repeat(128), estimateValue: text, preValue: text, pubValue: text,
      dataEffect: text, dataEffectCode: text
    })) }, 'zh')
    expect(parseResult.state).toBe('succeeded')
    if (parseResult.state !== 'succeeded') throw new Error('derived maximum-shape fixture failed')
    expect(parseResult.drafts).toHaveLength(1000)
    const batch = { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data',
      locale: 'zh', month: '9999-12', collectionId: 'c'.repeat(128), parserVersion: 'v'.repeat(128), parseResult }
    let nodes = 0, bytes = 0, depth = 0, maximumKeys = 0
    function measure(value: unknown, level: number) {
      nodes++; depth = Math.max(depth, level)
      if (typeof value === 'string') bytes += Buffer.byteLength(value)
      if (!value || typeof value !== 'object') return
      const keys = Reflect.ownKeys(value)
      maximumKeys = Math.max(maximumKeys, keys.length)
      for (const key of keys) { nodes++; bytes += Buffer.byteLength(String(key)); measure(Object.getOwnPropertyDescriptor(value, key)!.value, level + 1) }
    }
    measure(batch, 0)
    expect({ nodes, bytes, depth, maximumKeys }).toEqual({ nodes: 52035, bytes: 8062372, depth: 5, maximumKeys: 1001 })
    expect(nodes).toBeLessThanOrEqual(policy.maximumNodes)
    expect(bytes).toBeLessThanOrEqual(policy.maximumTextBytes)
    expect(depth).toBeLessThanOrEqual(policy.maximumDepth)
    expect(maximumKeys).toBeLessThanOrEqual(policy.maximumPropertyKeys)
    expect(captureMarketStorageSnapshot(batch)).toEqual(batch)
    // Fixed fields and <=1000 rows impose a tighter node/depth ceiling than
    // the outer guard. Over-node trees must fail shape/row checks first.
  })
})
