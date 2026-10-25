import type { ProductAgentToolRegistration } from '@platform/product-manifest'

import type { IntelligenceAgentCapability } from './capabilityTypes'

const PRODUCT_ID = 'market-intelligence'

/**
 * Catalog → manifest (design 152 §2). The catalog is the only hand-written list: read tools run
 * without approval, writes always ask. `requiresTemporalBoundary` is derived from the declared input
 * rather than copied, so a new time-bounded read cannot claim to be a "now" snapshot by omission.
 */
export function toManifestRegistrations(
  capabilities: readonly IntelligenceAgentCapability[]
): ProductAgentToolRegistration[] {
  return capabilities.map((capability) => {
    const write = capability.kind === 'write'
    return {
      toolName: capability.id,
      productId: PRODUCT_ID,
      handlerId: capability.handlerId,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      schemaVersion: 1,
      description: capability.description,
      readOnly: !write,
      requiresTemporalBoundary: declaresTemporalBoundary(capability.inputSchema),
      requiresApproval: write ? 'always' : 'never',
      timeoutMs: capability.timeoutMs,
      maxOutputBytes: capability.maxOutputBytes
    }
  })
}

function declaresTemporalBoundary(inputSchema: Record<string, unknown>): boolean {
  const required = inputSchema.required
  return Array.isArray(required) && required.includes('asOf')
}
