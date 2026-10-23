import { describe, expect, it, vi } from 'vitest'

import type { IntelligenceAgentCapability, ToolCallContext } from './capabilityTypes'
import { ProductToolGuardError } from './capabilityTypes'
import { isGuardedHandler, wrapProductToolHandler } from './wrapProductToolHandler'

const capability: IntelligenceAgentCapability = {
  id: 'get_test_capability',
  domain: 'query',
  kind: 'read',
  title: { 'zh-CN': '测试能力', 'en-US': 'Test capability' },
  description: 'Reads a single test value.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { asOf: { type: 'string' } },
    required: ['asOf']
  },
  outputSchema: { type: 'object' },
  handlerId: 'market-intelligence.get-test-capability',
  timeoutMs: 5000,
  maxOutputBytes: 65536
}

const context: ToolCallContext = {
  toolCallId: 'call-1',
  productId: 'market-intelligence',
  toolName: capability.id,
  schemaVersion: 1,
  agentId: 'agent-1',
  agentSessionId: 'session-1',
  signal: new AbortController().signal,
  log: async () => {}
}

describe('wrapProductToolHandler', () => {
  it('produces a guarded handler that reports its capability id', () => {
    const handler = wrapProductToolHandler({ capability, handle: async () => ({ ok: true }) })

    expect(isGuardedHandler(handler)).toBe(true)
    expect(handler.capabilityId).toBe(capability.id)
  })

  it('runs the input guard before the handler and never calls the handler on invalid input', async () => {
    const handle = vi.fn(async () => ({ ok: true }))
    const handler = wrapProductToolHandler({ capability, handle })

    await expect(handler.handle({ asOf: 'x', surprise: true }, context)).rejects.toMatchObject({
      code: 'unexpected-property'
    })
    await expect(handler.handle({ asOf: 'Bearer abcdefgh123' }, context)).rejects.toMatchObject({
      code: 'sensitive-input-rejected'
    })
    expect(handle).not.toHaveBeenCalled()
  })

  it('passes the validated input and the context through unchanged', async () => {
    const input = { asOf: '2026-07-08T10:00:00.000Z' }
    const handle = vi.fn(async () => ({ state: 'available' }))
    const handler = wrapProductToolHandler({ capability, handle })

    await expect(handler.handle(input, context)).resolves.toEqual({ state: 'available' })
    expect(handle).toHaveBeenCalledWith(input, context)
  })

  it('runs the output guard after the handler and surfaces blocked output as an error', async () => {
    const handle = vi.fn(async () => ({ apiKey: 'sk-test' }))
    const handler = wrapProductToolHandler({ capability, handle })

    try {
      await handler.handle({ asOf: '2026-07-08T10:00:00.000Z' }, context)
      throw new Error('expected the guarded handler to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ProductToolGuardError)
      const guardError = error as ProductToolGuardError
      expect(guardError.code).toBe('sensitive-output-blocked')
      expect(guardError.message).not.toContain('sk-test')
    }
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('returns sanitised output', async () => {
    const handler = wrapProductToolHandler({
      capability,
      handle: async () => ({ sourceId: 'source-a', credentialRef: 'vault://source-a' })
    })

    await expect(handler.handle({ asOf: 'x' }, context)).resolves.toEqual({ sourceId: 'source-a' })
  })

  it('rethrows handler failures as a guard error without leaking the original message', async () => {
    const handler = wrapProductToolHandler({
      capability,
      handle: async () => {
        throw new Error('boom sk-abcdefgh1234')
      }
    })

    try {
      await handler.handle({ asOf: 'x' }, context)
      throw new Error('expected the guarded handler to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(ProductToolGuardError)
      const guardError = error as ProductToolGuardError
      expect(guardError.code).toBe('handler-error')
      expect(guardError.message).not.toContain('abcdefgh1234')
      expect(guardError.message).not.toContain('boom')
    }
  })

  it('preserves a guard error raised by the handler', async () => {
    const handler = wrapProductToolHandler({
      capability,
      handle: async () => {
        throw new ProductToolGuardError('source-not-ready', 'Source is not ready.')
      }
    })

    await expect(handler.handle({ asOf: 'x' }, context)).rejects.toMatchObject({
      code: 'source-not-ready',
      message: 'Source is not ready.'
    })
  })
})

describe('isGuardedHandler', () => {
  it.each([null, undefined, 'handler', 42, {}, { capabilityId: 'x' }, () => {}])(
    'rejects a value that is not a guarded handler',
    (value) => {
      expect(isGuardedHandler(value)).toBe(false)
    }
  )
})
