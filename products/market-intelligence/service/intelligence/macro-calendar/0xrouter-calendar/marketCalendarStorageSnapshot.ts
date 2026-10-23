import { types } from 'node:util'
import { reject, zeroXRouterCalendarStoragePolicy as storage } from './marketCalendarStorageValidation'

// Internal MC2 data-only contract, not a general JS serializer. Product acceptance
// owns changes. Max-shape 1000 rows including names: 52,035 nodes / 8,062,372 bytes.
export const MarketCalendarDataOnlySnapshotPolicy = Object.freeze({
  maximumDepth: 8, maximumNodes: 64_256, maximumTextBytes: 16_384_000,
  maximumPropertyKeys: storage.maximumRows + 1
})
const fields = {
  input: ['providerId', 'descriptorId', 'locale', 'month', 'collectionId', 'parserVersion', 'parseResult'],
  context: ['providerId', 'descriptorId', 'locale', 'month', 'detectedAt', 'evidence'],
  evidence: ['providerId', 'descriptorId', 'rawRecordId', 'evidenceHash'],
  parseResult: ['state', 'drafts', 'diagnostics'],
  diagnostics: ['inputRows', 'skippedRows', 'reasons'],
  reasons: storage.skipReasons, draft: storage.draftFields,
  display: ['displayValue'], impact: ['label', 'code']
} as const
type Shape = keyof typeof fields | 'drafts' | 'primitive'
const children: Partial<Record<Shape, Readonly<Record<string, Shape>>>> = {
  input: { parseResult: 'parseResult' }, context: { evidence: 'evidence' },
  parseResult: { drafts: 'drafts', diagnostics: 'diagnostics' },
  diagnostics: { reasons: 'reasons' },
  draft: { consensus: 'display', providerPrevious: 'display', providerActual: 'display', providerImpact: 'impact' }
}

export function captureMarketStorageSnapshot(value: unknown, shape: 'input' | 'context' = 'input'): unknown {
  const policy = MarketCalendarDataOnlySnapshotPolicy
  const ancestors = new WeakSet<object>()
  let nodes = 0
  let textBytes = 0
  const count = (text?: string) => {
    if (++nodes > policy.maximumNodes) reject('invalid-input')
    if (text !== undefined) textBytes += Buffer.byteLength(text, 'utf8')
    if (textBytes > policy.maximumTextBytes) reject('invalid-input')
  }
  const dataDescriptor = (object: object, key: string, enumerable = true) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (descriptor && (!('value' in descriptor) || descriptor.enumerable !== enumerable)) reject('invalid-input')
    return descriptor
  }
  const copy = (current: unknown, currentShape: Shape, depth: number): unknown => {
    if (depth > policy.maximumDepth) reject('invalid-input')
    count(typeof current === 'string' ? current : undefined)
    if (current === null || current === undefined) return current
    if (typeof current !== 'object') {
      if (currentShape !== 'primitive' ||
        !['string', 'boolean', 'number'].includes(typeof current) ||
        (typeof current === 'number' && !Number.isFinite(current))) reject('invalid-input')
      return current
    }
    if (types.isProxy(current) || ancestors.has(current) || currentShape === 'primitive') reject('invalid-input')
    const prototype = Object.getPrototypeOf(current)
    const array = Array.isArray(current)
    if (array ? currentShape !== 'drafts' || prototype !== Array.prototype
      : currentShape === 'drafts' || (prototype !== Object.prototype && prototype !== null)) reject('invalid-input')
    ancestors.add(current)
    if (array) {
      const length = dataDescriptor(current, 'length', false)!.value as number
      if (!Number.isSafeInteger(length) || length < 0 || length > storage.maximumRows) reject('invalid-input')
      for (let index = 0; index < length; index++) {
        if (!dataDescriptor(current, String(index))) reject('invalid-input')
      }
      const keys = Reflect.ownKeys(current)
      if (keys.length > policy.maximumPropertyKeys || keys.length !== length + 1) reject('invalid-input')
      count('length'); count()
      const result: unknown[] = []
      for (let index = 0; index < length; index++) {
        count(String(index))
        result.push(copy(dataDescriptor(current, String(index))!.value, 'draft', depth + 1))
      }
      ancestors.delete(current)
      return Object.freeze(result)
    }
    const allowed = fields[currentShape as keyof typeof fields]
    for (const key of allowed) dataDescriptor(current, key)
    // One rejection-only enumeration. Native allocation may scale with hostile
    // key count; bounded arbitrary-object enumeration is NOT claimed.
    const keys = Reflect.ownKeys(current)
    if (keys.length > policy.maximumPropertyKeys || keys.length > allowed.length ||
      keys.some((key) => typeof key !== 'string' || !(allowed as readonly string[]).includes(key))) reject('invalid-input')
    const result: Record<string, unknown> = prototype === null ? Object.create(null) : {}
    for (const key of allowed) {
      const descriptor = dataDescriptor(current, key)
      if (!descriptor) continue
      count(key)
      result[key] = copy(descriptor.value, children[currentShape]?.[key] ?? 'primitive', depth + 1)
    }
    ancestors.delete(current)
    return Object.freeze(result)
  }
  return copy(value, shape, 0)
}
