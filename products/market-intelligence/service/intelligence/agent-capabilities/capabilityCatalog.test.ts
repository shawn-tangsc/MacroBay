import { describe, expect, it } from 'vitest'

import { intelligenceAgentCapabilities } from './capabilityCatalog'
import { marketIntelligenceProductManifest } from '../../../product.manifest'

describe('intelligence agent capability catalog', () => {
  it('declares the full read, write, discovery, and handoff surface', () => {
    expect(intelligenceAgentCapabilities).toHaveLength(30)
    expect(new Set(intelligenceAgentCapabilities.map((capability) => capability.id)).size).toBe(30)
    expect(new Set(intelligenceAgentCapabilities.map((capability) => capability.handlerId)).size).toBe(30)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'read')).toHaveLength(23)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'write')).toHaveLength(5)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'handoff')).toHaveLength(1)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'discovery')).toHaveLength(1)
  })

  it('gives every capability a bilingual title, a model-facing description, and strict input', () => {
    for (const capability of intelligenceAgentCapabilities) {
      expect(capability.title['zh-CN'].trim().length).toBeGreaterThan(0)
      expect(capability.title['en-US'].trim().length).toBeGreaterThan(0)
      expect(capability.description.trim().length).toBeGreaterThan(20)
      expect(capability.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(capability.outputSchema).toMatchObject({ type: 'object' })
    }
  })

  it('keeps read timeouts within 5–10 s, write timeouts within 10–15 s, and output caps at 64 KiB', () => {
    for (const capability of intelligenceAgentCapabilities) {
      if (capability.kind === 'write') {
        expect(capability.timeoutMs).toBeGreaterThanOrEqual(10_000)
        expect(capability.timeoutMs).toBeLessThanOrEqual(15_000)
      } else {
        expect(capability.timeoutMs).toBeGreaterThanOrEqual(5_000)
        expect(capability.timeoutMs).toBeLessThanOrEqual(10_000)
      }
      const expectedBytes = capability.id === 'get_market_analysis_context' ? 256 * 1024 : 64 * 1024
      expect(capability.maxOutputBytes).toBe(expectedBytes)
    }
  })

  it('restores the original 10 s timeout for the four query adapters', () => {
    const timeoutFor = (id: string) =>
      intelligenceAgentCapabilities.find((capability) => capability.id === id)?.timeoutMs

    for (const id of [
      'query_sentiment_snapshot',
      'query_sentiment_series',
      'query_related_events',
      'query_impact_timeline'
    ]) {
      expect(timeoutFor(id), id).toBe(10_000)
    }
  })

  it('declares a strict source-detail output schema with the health and runtime projections', () => {
    const capability = intelligenceAgentCapabilities.find((entry) => entry.id === 'get_source_detail')
    const schema = capability?.outputSchema as {
      additionalProperties?: boolean
      properties: {
        source: {
          additionalProperties?: boolean
          properties: Record<string, { additionalProperties?: boolean; properties?: Record<string, unknown> }>
        }
      }
    }

    expect(schema).toMatchObject({ type: 'object', additionalProperties: false })
    expect(schema.properties.source).toMatchObject({ additionalProperties: false })
    expect(schema.properties.source.properties.health).toMatchObject({
      type: 'object',
      additionalProperties: false
    })
    expect(Object.keys(schema.properties.source.properties.health.properties ?? {}).sort()).toEqual([
      'collectionGap',
      'connectivityStatus',
      'consecutiveFailures',
      'lastFailureAt',
      'lastSuccessAt',
      'runtimeStatus'
    ])
    expect(schema.properties.source.properties.runtime).toMatchObject({
      type: 'object',
      additionalProperties: false
    })
    expect(Object.keys(schema.properties.source.properties.runtime.properties ?? {}).sort()).toEqual([
      'desiredState',
      'pollingIntervalSec',
      'schedule'
    ])
  })

  it('exposes every capability through the derived manifest', () => {
    const manifestTools = marketIntelligenceProductManifest.productAgentTools ?? []
    expect(manifestTools).toHaveLength(intelligenceAgentCapabilities.length)
    expect(manifestTools.map((tool) => tool.toolName)).toEqual(
      intelligenceAgentCapabilities.map((capability) => capability.id)
    )
    expect(manifestTools.map((tool) => tool.handlerId)).toEqual(
      intelligenceAgentCapabilities.map((capability) => capability.handlerId)
    )
  })

  it('lists explain_figure on the analysis agent now that the manifest is derived', () => {
    const agent = marketIntelligenceProductManifest.agents?.find((entry) => entry.id === 'crypto-market-analyst')
    expect(agent?.toolIds).toEqual(expect.arrayContaining(['explain_figure']))
  })
})
