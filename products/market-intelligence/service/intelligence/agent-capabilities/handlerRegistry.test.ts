import { describe, expect, it } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import { intelligenceAgentCapabilities } from './capabilityCatalog'
import { ProductToolGuardError, type ToolCallContext } from './capabilityTypes'
import { registerIntelligenceAgentToolHandlers } from './handlerRegistry'

const jobRuntime = {} as JobRuntime

const context = {
  toolCallId: 'tool-call-1',
  productId: 'market-intelligence',
  toolName: 'test',
  schemaVersion: 1,
  agentId: 'crypto-market-analyst',
  agentSessionId: 'session-1',
  signal: new AbortController().signal,
  log: async () => undefined
} satisfies ToolCallContext

function registerAll(getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>) {
  const registrations = new Map<string, ProductAgentToolHandlerRegistration>()
  registerIntelligenceAgentToolHandlers(
    (registration) => registrations.set(registration.handlerId, registration),
    { jobRuntime, ...(getAppLanguage ? { getAppLanguage } : {}) }
  )
  return registrations
}

describe('intelligence agent handler registry', () => {
  it('registers one handler per catalog entry, with the catalog handler ids', () => {
    const registrations = registerAll()
    expect(registrations.size).toBe(intelligenceAgentCapabilities.length)
    for (const capability of intelligenceAgentCapabilities) {
      const registration = registrations.get(capability.handlerId)
      expect(registration).toBeDefined()
      expect(registration?.productId).toBe('market-intelligence')
      expect(typeof registration?.handle).toBe('function')
    }
  })

  it('rejects unknown input before the handler can touch a service', async () => {
    const registrations = registerAll()
    const operations = registrations.get('market-intelligence.get-operations-health')
    expect(operations).toBeDefined()

    const error = await operations!.handle({ surprise: true }, context).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProductToolGuardError)
    expect((error as ProductToolGuardError).code).toBe('unexpected-property')

    const analysis = registrations.get('market-intelligence.get-market-analysis-context')
    const mismatch = await analysis!.handle({ eventGroupId: 'group-1', asOf: 1 }, context).catch((caught: unknown) => caught)
    expect(mismatch).toBeInstanceOf(ProductToolGuardError)
    expect((mismatch as ProductToolGuardError).code).toBe('type-mismatch')
  })

  it('derives the discovery answer from the catalog and localizes titles', async () => {
    const registrations = registerAll(async () => 'en-US')
    const discovery = registrations.get('market-intelligence.describe-intelligence-capabilities')

    const result = (await discovery!.handle({ domain: 'operations' }, context)) as {
      state: string
      domains: Array<{ domain: string; capabilities: Array<{ id: string; title: string; requiredFields: string[] }> }>
    }

    expect(result.state).toBe('available')
    expect(result.domains).toHaveLength(1)
    expect(result.domains[0].domain).toBe('operations')
    expect(result.domains[0].capabilities.map((capability) => capability.id)).toEqual([
      'get_operations_health',
      'get_dashboard_feed_status',
      'describe_intelligence_capabilities'
    ])
    expect(result.domains[0].capabilities[0].title).toBe('Operations health')
    expect(result.domains[0].capabilities[0].requiredFields).toEqual([])
  })

  it('rejects an unsupported discovery domain through the input guard', async () => {
    const registrations = registerAll()
    const discovery = registrations.get('market-intelligence.describe-intelligence-capabilities')

    const error = await discovery!.handle({ domain: 'nope' }, context).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ProductToolGuardError)
    expect((error as ProductToolGuardError).code).toBe('invalid-enum')
  })
})
