import { describe, expect, it } from 'vitest'

import type { IntelligenceAgentCapability } from './capabilityTypes'
import { ProductToolGuardError } from './capabilityTypes'

describe('ProductToolGuardError', () => {
  it('carries a guard code and a stable name', () => {
    const error = new ProductToolGuardError('sensitive-output-blocked', 'Tool output was blocked.')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ProductToolGuardError')
    expect(error.code).toBe('sensitive-output-blocked')
    expect(error.message).toBe('Tool output was blocked.')
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
