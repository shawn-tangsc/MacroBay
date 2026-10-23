import { createHash } from 'node:crypto'

import { ProductAgentToolError } from './productAgentToolErrors'

export type CanonicalJsonHashResult = {
  canonicalJson: string
  sha256: string
  byteLength: number
}

export function canonicalJsonHash(value: unknown): CanonicalJsonHashResult {
  const canonicalJson = canonicalizeJsonValue(value)
  const bytes = Buffer.from(canonicalJson, 'utf8')
  return {
    canonicalJson,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength
  }
}

function canonicalizeJsonValue(value: unknown): string {
  return JSON.stringify(serializeCanonicalValue(value))
}

function serializeCanonicalValue(value: unknown): unknown {
  if (value === null) return null

  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value
  }

  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') {
    throw new ProductAgentToolError('invalid-input-schema', 'Unsupported value type for canonical JSON hashing.')
  }

  if (typeof value === 'bigint') {
    throw new ProductAgentToolError('invalid-input-schema', 'BigInt values are not supported for canonical JSON hashing.')
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeCanonicalValue(item))
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'object') {
    if (value && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new ProductAgentToolError('invalid-input-schema', 'Only plain objects are supported for canonical JSON hashing.')
    }

    const record = value as Record<string, unknown>
    const sortedKeys = Object.keys(record).sort()
    const normalized: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      const entry = record[key]
      if (entry === undefined) continue
      normalized[key] = serializeCanonicalValue(entry)
    }
    return normalized
  }

  throw new ProductAgentToolError('invalid-input-schema', 'Unsupported value for canonical JSON hashing.')
}
