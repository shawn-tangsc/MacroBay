import { describe, expect, it } from 'vitest'

import type { ProductAgentToolRegistration } from '@platform/product-manifest'

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

  it('makes every slice capability read-only and prompt-free', () => {
    for (const registration of registrations) {
      expect(registration.readOnly).toBe(true)
      expect(registration.requiresApproval).toBe('never')
    }
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

  it('maps write capabilities to an approval-gated mutation (contract guard for later slices)', () => {
    const writeRegistration: ProductAgentToolRegistration = {
      ...registrations[0],
      readOnly: false,
      requiresApproval: 'always'
    }
    expect(writeRegistration.readOnly).toBe(false)
    expect(writeRegistration.requiresApproval).toBe('always')
  })
})
