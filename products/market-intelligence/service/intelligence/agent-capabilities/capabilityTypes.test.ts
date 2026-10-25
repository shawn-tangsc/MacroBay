import { describe, expect, it } from 'vitest'

import type { IntelligenceAgentCapability } from './capabilityTypes'
import { ProductToolGuardError, createGuardedHandler, isGuardedHandlerValue } from './capabilityTypes'

describe('ProductToolGuardError', () => {
  it('carries a guard code and a stable name', () => {
    const error = new ProductToolGuardError('sensitive-output-blocked', 'Tool output was blocked.')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ProductToolGuardError')
    expect(error.code).toBe('sensitive-output-blocked')
    expect(error.message).toBe('Tool output was blocked.')
  })

  it('accepts the invalid-output code', () => {
    expect(new ProductToolGuardError('invalid-output', 'Not JSON-shaped.').code).toBe('invalid-output')
  })
})

describe('IntelligenceAgentCapability', () => {
  it('accepts a localized title and both schemas', () => {
    const capability: IntelligenceAgentCapability = {
      id: 'get_source_detail',
      domain: 'query',
      kind: 'read',
      title: { 'zh-CN': '获取来源详情', 'en-US': 'Get source detail' },
      description: 'Returns one source projection.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { sourceId: { type: 'string' } } },
      outputSchema: { type: 'object' },
      handlerId: 'market-intelligence.get-source-detail',
      timeoutMs: 5000,
      maxOutputBytes: 65536
    }

    expect(capability.title['en-US']).toBe('Get source detail')
    expect(capability.domain).toBe('query')
    expect(capability.inputSchema).toMatchObject({ additionalProperties: false })
  })
})

describe('guarded handler brand', () => {
  it('accepts a handler produced by createGuardedHandler', () => {
    const handler = createGuardedHandler({ capabilityId: 'get_source_detail', handle: async () => ({ ok: true }) })

    expect(isGuardedHandlerValue(handler)).toBe(true)
    expect(handler.capabilityId).toBe('get_source_detail')
  })

  it('rejects a hand-built object with the same public fields', () => {
    const forged = { capabilityId: 'get_source_detail', handle: async () => ({ ok: true }) }

    expect(isGuardedHandlerValue(forged)).toBe(false)
  })

  it('rejects an object whose prototype copies a guarded handler', () => {
    const handler = createGuardedHandler({ capabilityId: 'get_source_detail', handle: async () => ({ ok: true }) })
    const inherited = Object.create(handler) as unknown

    expect(isGuardedHandlerValue(inherited)).toBe(false)
  })

  it('does not carry the brand into a spread copy', () => {
    const handler = createGuardedHandler({ capabilityId: 'get_source_detail', handle: async () => ({ ok: true }) })

    expect(isGuardedHandlerValue({ ...handler })).toBe(false)
  })

  it.each([null, undefined, 'handler', 42, {}, [], () => {}])('rejects a non-handler value: %s', (value) => {
    expect(isGuardedHandlerValue(value)).toBe(false)
  })
})
