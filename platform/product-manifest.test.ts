import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ProductAgentToolRegistration, ProductManifest } from './product-manifest'

describe('ProductManifest productAgentTools', () => {
  it('supports productAgentTools registrations with schema, timeout, read-only, and temporal-boundary fields', () => {
    const registration: ProductAgentToolRegistration = {
      toolName: 'market_intelligence.query_sentiment_snapshot',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-sentiment-snapshot',
      inputSchema: {
        type: 'object',
        properties: {
          asOf: { type: 'string', format: 'date-time' },
          symbol: { type: 'string' }
        },
        required: ['asOf', 'symbol']
      },
      outputSchema: {
        type: 'object',
        properties: {
          sentiment: { type: 'string' }
        }
      },
      schemaVersion: 1,
      description: 'Query sentiment snapshot at a historical decision time.',
      readOnly: true,
      requiresTemporalBoundary: true,
      timeoutMs: 15_000,
      maxOutputBytes: 65_536,
      requiresApproval: 'never'
    }

    const manifest: ProductManifest = {
      id: 'market-intelligence',
      name: { 'zh-CN': 'Market Intelligence', 'en-US': 'Market Intelligence' },
      version: '0.1.0',
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      migrations: [],
      productAgentTools: [registration]
    }

    expect(manifest.productAgentTools).toHaveLength(1)
    expect(manifest.productAgentTools?.[0]).toMatchObject({
      toolName: 'market_intelligence.query_sentiment_snapshot',
      readOnly: true,
      requiresTemporalBoundary: true,
      timeoutMs: 15_000,
      requiresApproval: 'never'
    })
  })

  it('allows manifests without productAgentTools', () => {
    const manifest: ProductManifest = {
      id: 'generic-product',
      name: { 'zh-CN': 'Generic Product', 'en-US': 'Generic Product' },
      version: '0.1.0',
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      migrations: []
    }

    expect(manifest.productAgentTools).toBeUndefined()
  })
})

describe('platform product boundary', () => {
  it('keeps the reusable desktop main process independent from product modules', () => {
    const desktopMain = readFileSync(resolve(process.cwd(), 'platform/desktop/main/app.ts'), 'utf8')

    expect(desktopMain).not.toContain("../../../products")
    expect(desktopMain).not.toContain('@products/')
  })
})
