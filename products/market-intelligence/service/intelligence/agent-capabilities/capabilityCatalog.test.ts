import { describe, expect, it } from 'vitest'

import { intelligenceAgentCapabilities } from './capabilityCatalog'
import { marketIntelligenceProductManifest } from '../../../product.manifest'

describe('intelligence agent capability catalog', () => {
  it('declares the 19 read/discovery capabilities from the design', () => {
    expect(intelligenceAgentCapabilities).toHaveLength(19)
    expect(new Set(intelligenceAgentCapabilities.map((capability) => capability.id)).size).toBe(19)
    expect(new Set(intelligenceAgentCapabilities.map((capability) => capability.handlerId)).size).toBe(19)
    expect(intelligenceAgentCapabilities.filter((capability) => capability.kind === 'read')).toHaveLength(18)
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

  it('keeps read timeouts within the 5–10 s budget and output caps at 64 KiB except the analysis context', () => {
    for (const capability of intelligenceAgentCapabilities) {
      expect(capability.timeoutMs).toBeGreaterThanOrEqual(5_000)
      expect(capability.timeoutMs).toBeLessThanOrEqual(10_000)
      const expectedBytes = capability.id === 'get_market_analysis_context' ? 256 * 1024 : 64 * 1024
      expect(capability.maxOutputBytes).toBe(expectedBytes)
    }
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
