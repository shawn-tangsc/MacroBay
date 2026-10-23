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
