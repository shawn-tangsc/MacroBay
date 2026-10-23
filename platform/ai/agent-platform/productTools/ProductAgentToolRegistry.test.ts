import { describe, expect, it } from 'vitest'

import { ProductAgentToolRegistry } from './ProductAgentToolRegistry'

describe('ProductAgentToolRegistry', () => {
  it('rejects duplicate tool registrations for the same product', () => {
    const registry = new ProductAgentToolRegistry()
    registry.registerToolMetadata({
      toolName: 'query_sentiment_snapshot',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-sentiment-snapshot',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      schemaVersion: 1,
      description: 'snapshot',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive'
    })

    expect(() =>
      registry.registerToolMetadata({
        toolName: 'query_sentiment_snapshot',
        productId: 'market-intelligence',
        handlerId: 'market-intelligence.query-sentiment-snapshot',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        schemaVersion: 1,
        description: 'duplicate',
        readOnly: true,
        requiresTemporalBoundary: true,
        requiresApproval: 'on-sensitive'
      })
    ).toThrow(/already registered/)
  })

  it('excludes installed products without declared tools or handlers', () => {
    const registry = new ProductAgentToolRegistry()
    const packages = registry.listPackages(['sample-product', 'market-intelligence'])
    expect(packages).toEqual([])
  })

  it('marks packages missing handlers as unavailable', () => {
    const registry = new ProductAgentToolRegistry()
    registry.registerToolMetadata({
      toolName: 'get_source_health',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-source-health',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      schemaVersion: 1,
      description: 'health',
      readOnly: true,
      requiresTemporalBoundary: false,
      requiresApproval: 'never'
    })

    const [pkg] = registry.listPackages(['market-intelligence'])
    expect(pkg?.status).toBe('missing-handler')
  })
})

describe('ProductAgentToolRegistry write registrations', () => {
  const writeTool = {
    toolName: 'configure_source',
    productId: 'market-intelligence',
    handlerId: 'market-intelligence.configure-source',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    schemaVersion: 1,
    description: 'configure',
    readOnly: false as const,
    requiresTemporalBoundary: false,
    requiresApproval: 'always' as const,
    timeoutMs: 10_000
  }

  it('accepts a mutating tool that declares an approval mode and a timeout', () => {
    const registry = new ProductAgentToolRegistry()
    registry.registerToolMetadata(writeTool)
    registry.registerHandler({
      productId: writeTool.productId,
      handlerId: writeTool.handlerId,
      handle: async () => ({ ok: true })
    })

    const [pkg] = registry.listPackages(['market-intelligence'])
    expect(pkg?.status).toBe('available')
    expect(pkg?.tools[0]).toMatchObject({ readOnly: false, requiresApproval: 'always' })
  })

  it('rejects a mutating tool that declares it never needs approval', () => {
    const registry = new ProductAgentToolRegistry()
    expect(() =>
      registry.registerToolMetadata({ ...writeTool, requiresApproval: 'never' })
    ).toThrow(/must not declare requiresApproval/i)
  })

  it('rejects a mutating tool without a timeout', () => {
    const registry = new ProductAgentToolRegistry()
    const { timeoutMs: _timeoutMs, ...withoutTimeout } = writeTool
    expect(() => registry.registerToolMetadata(withoutTimeout)).toThrow(/timeout/i)
  })

  it('keeps a package with mixed read and write tools available', () => {
    const registry = new ProductAgentToolRegistry()
    registry.registerToolMetadata({
      toolName: 'get_health',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-health',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      schemaVersion: 1,
      description: 'health',
      readOnly: true,
      requiresTemporalBoundary: false,
      requiresApproval: 'never'
    })
    registry.registerToolMetadata(writeTool)

    const [pkg] = registry.listPackages(['market-intelligence'])
    expect(pkg?.status).toBe('missing-handler')
  })
})
