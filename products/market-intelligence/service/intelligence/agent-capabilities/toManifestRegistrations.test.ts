import { describe, expect, it } from 'vitest'

import { intelligenceAgentCapabilities } from './capabilityCatalog'
import { toManifestRegistrations } from './toManifestRegistrations'

describe('catalog → manifest derivation', () => {
  const registrations = toManifestRegistrations(intelligenceAgentCapabilities)

  it('derives one registration per catalog entry with the same ids', () => {
    expect(registrations).toHaveLength(intelligenceAgentCapabilities.length)
    expect(registrations.map((entry) => entry.toolName)).toEqual(
      intelligenceAgentCapabilities.map((capability) => capability.id)
    )
    expect(registrations.map((entry) => entry.handlerId)).toEqual(
      intelligenceAgentCapabilities.map((capability) => capability.handlerId)
    )
    expect(registrations.every((entry) => entry.productId === 'market-intelligence')).toBe(true)
    expect(registrations.every((entry) => entry.schemaVersion === 1)).toBe(true)
  })

  it('marks writes as approval-gated and keeps read, discovery, and handoff prompt-free', () => {
    for (const [index, capability] of intelligenceAgentCapabilities.entries()) {
      const write = capability.kind === 'write'
      expect(registrations[index].readOnly, capability.id).toBe(!write)
      expect(registrations[index].requiresApproval, capability.id).toBe(write ? 'always' : 'never')
      expect(registrations[index].timeoutMs, capability.id).toBe(capability.timeoutMs)
    }
    expect(registrations.filter((registration) => registration.readOnly === false)).toHaveLength(5)
  })

  it('passes timeout, output cap, and schemas through unchanged', () => {
    for (const [index, capability] of intelligenceAgentCapabilities.entries()) {
      const registration = registrations[index]
      expect(registration.description).toBe(capability.description)
      expect(registration.inputSchema).toBe(capability.inputSchema)
      expect(registration.outputSchema).toBe(capability.outputSchema)
      expect(registration.timeoutMs).toBe(capability.timeoutMs)
      expect(registration.maxOutputBytes).toBe(capability.maxOutputBytes)
    }
  })

  it('derives the temporal boundary from a required asOf instead of a second declaration', () => {
    for (const registration of registrations) {
      const required = registration.inputSchema.required
      expect(registration.requiresTemporalBoundary).toBe(Array.isArray(required) && required.includes('asOf'))
    }
  })

  it('keeps every declared write tool out of the automatic execution path', () => {
    const writes = registrations.filter((registration) => !registration.readOnly)
    expect(writes.map((registration) => registration.toolName)).toEqual([
      'configure_intelligence_source',
      'operate_intelligence_source',
      'operate_macro_calendar',
      'configure_translation',
      'configure_cross_asset_interface'
    ])
    for (const write of writes) {
      expect(write.requiresApproval).toBe('always')
      expect(write.timeoutMs).toBeGreaterThanOrEqual(10_000)
    }
  })
})
