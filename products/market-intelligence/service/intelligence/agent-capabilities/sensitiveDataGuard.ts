import { sanitizeSafeView } from '../schema/intelligenceSourcesContracts'
import { ProductToolGuardError } from './capabilityTypes'
import {
  CREDENTIAL_KEY_NAMES,
  STRIPPED_OUTPUT_KEY_NAMES,
  redactCredentialValue
} from './sensitivePatterns'

const MAX_DEPTH = 32
const PATH_PREFIX = /^(?:[A-Za-z]:\\|\/(?:Users|home|var|private|tmp)\/)/
const SENSITIVE_OUTPUT_MESSAGE = 'Tool output contained sensitive content and was blocked.'

/**
 * Returns a sanitised clone containing only JSON-shaped values: plain objects,
 * arrays, strings, finite numbers, booleans and null. `Date` becomes its ISO
 * string. Anything else fails with `invalid-output`. Cyclic structures fail
 * with `output-too-deep` before the shared view sanitiser recurses into them.
 * Symbol keys are dropped; only own string keys are kept.
 */
export function guardProductToolOutput(value: unknown): unknown {
  const sanitized = walk(value, 0, new WeakSet())

  // Shared product helper runs on the acyclic clone; it rejects some
  // secret-shaped strings that are not URL parameters.
  try {
    sanitizeSafeView(sanitized as Record<string, unknown>)
  } catch {
    throw new ProductToolGuardError('sensitive-output-blocked', SENSITIVE_OUTPUT_MESSAGE)
  }

  return sanitized
}

function walk(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) throw outputTooDeep()

  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'boolean' || value === null) return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidOutput()
    return value
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalidOutput()
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    enter(value, ancestors)
    const clone = value.map((item) => walk(item, depth + 1, ancestors))
    ancestors.delete(value)
    return clone
  }

  if (isPlainObject(value)) {
    enter(value, ancestors)
    const clone: Record<string, unknown> = {}
    for (const key of Object.getOwnPropertyNames(value)) {
      const normalizedKey = key.toLowerCase()
      if (CREDENTIAL_KEY_NAMES.has(normalizedKey)) throw sensitiveOutput()
      if (STRIPPED_OUTPUT_KEY_NAMES.has(normalizedKey)) continue
      Object.defineProperty(clone, key, {
        value: walk(value[key], depth + 1, ancestors),
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
    ancestors.delete(value)
    return clone
  }

  throw invalidOutput()
}

function enter(value: object, ancestors: WeakSet<object>): void {
  if (ancestors.has(value)) throw outputTooDeep()
  ancestors.add(value)
}

function redactString(value: string): string {
  if (PATH_PREFIX.test(value)) return '<path>'
  return redactCredentialValue(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function invalidOutput(): ProductToolGuardError {
  return new ProductToolGuardError('invalid-output', 'Tool output must be a JSON-shaped value.')
}

function outputTooDeep(): ProductToolGuardError {
  return new ProductToolGuardError('output-too-deep', 'Tool output is nested too deeply or contains a cycle.')
}

function sensitiveOutput(): ProductToolGuardError {
  return new ProductToolGuardError('sensitive-output-blocked', SENSITIVE_OUTPUT_MESSAGE)
}
