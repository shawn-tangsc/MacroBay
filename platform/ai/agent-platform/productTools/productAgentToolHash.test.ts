import { describe, expect, it } from 'vitest'

import { canonicalJsonHash } from './productAgentToolHash'
import { ProductAgentToolError } from './productAgentToolErrors'

describe('canonicalJsonHash', () => {
  it('produces stable hashes for key-sorted plain objects', () => {
    const first = canonicalJsonHash({ b: 2, a: 1 })
    const second = canonicalJsonHash({ a: 1, b: 2 })

    expect(first.sha256).toBe(second.sha256)
    expect(first.canonicalJson).toBe('{"a":1,"b":2}')
  })

  it('rejects unsupported value types', () => {
    expect(() => canonicalJsonHash(() => undefined)).toThrow(ProductAgentToolError)
  })
})
