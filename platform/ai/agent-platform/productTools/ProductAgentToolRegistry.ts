import type { ProductAgentToolRegistration } from '../../../product-manifest'
import type { ProductAgentToolHandlerRegistration } from './productAgentToolBootstrapContracts'
import type {
  ProductAgentToolDescriptor,
  ProductAgentToolPackageDescriptor,
  ProductAgentToolPackageStatus,
  ProductAgentToolResolvedRegistration
} from './productAgentToolSchemas'

type StoredHandler = ProductAgentToolHandlerRegistration

export class ProductAgentToolRegistry {
  private readonly metadataByKey = new Map<string, ProductAgentToolRegistration>()
  private readonly handlersByKey = new Map<string, StoredHandler>()

  registerToolMetadata(registration: ProductAgentToolRegistration): void {
    const key = buildRegistrationKey(registration.productId, registration.toolName)
    if (this.metadataByKey.has(key)) {
      throw new Error(`Product tool "${registration.toolName}" is already registered for "${registration.productId}".`)
    }
    assertMutatingToolPolicy(registration)
    this.metadataByKey.set(key, { ...registration })
  }

  registerHandler(registration: ProductAgentToolHandlerRegistration): void {
    const key = buildHandlerKey(registration.productId, registration.handlerId)
    if (this.handlersByKey.has(key)) {
      throw new Error(`Product tool handler "${registration.handlerId}" is already registered for "${registration.productId}".`)
    }
    this.handlersByKey.set(key, registration)
  }

  listPackages(installedProductIds: readonly string[]): ProductAgentToolPackageDescriptor[] {
    const packages = new Map<string, ProductAgentToolDescriptor[]>()

    for (const registration of this.metadataByKey.values()) {
      const tools = packages.get(registration.productId) ?? []
      tools.push(toDescriptor(registration, this.hasHandler(registration)))
      packages.set(registration.productId, tools)
    }

    const productIds = new Set([...packages.keys(), ...[...this.handlersByKey.values()].map((handler) => handler.productId)])

    return [...productIds]
      .filter((productId) => {
        const tools = packages.get(productId) ?? []
        const hasHandlers = [...this.handlersByKey.values()].some((handler) => handler.productId === productId)
        return tools.length > 0 || hasHandlers
      })
      .sort((left, right) => left.localeCompare(right))
      .map((productId) => buildPackageDescriptor(productId, packages.get(productId) ?? [], installedProductIds))
  }

  listToolsForProduct(productId: string): ProductAgentToolDescriptor[] {
    return [...this.metadataByKey.values()]
      .filter((registration) => registration.productId === productId)
      .map((registration) => toDescriptor(registration, this.hasHandler(registration)))
      .sort((left, right) => left.toolName.localeCompare(right.toolName))
  }

  resolve(productId: string, toolName: string): ProductAgentToolResolvedRegistration | null {
    const registration = this.metadataByKey.get(buildRegistrationKey(productId, toolName))
    if (!registration) return null
    const handler = this.handlersByKey.get(buildHandlerKey(productId, registration.handlerId))
    if (!handler) return null
    return {
      ...registration,
      handle: handler.handle
    }
  }

  private hasHandler(registration: ProductAgentToolRegistration): boolean {
    return this.handlersByKey.has(buildHandlerKey(registration.productId, registration.handlerId))
  }
}

function buildPackageDescriptor(
  productId: string,
  tools: ProductAgentToolDescriptor[],
  installedProductIds: readonly string[]
): ProductAgentToolPackageDescriptor {
  const installed = new Set(installedProductIds)
  const diagnostics: string[] = []
  let status: ProductAgentToolPackageStatus = 'available'

  if (tools.length === 0) {
    status = 'not-installed'
    diagnostics.push('No product agent tools are registered for this product.')
  } else if (!installed.has(productId)) {
    status = 'not-installed'
    diagnostics.push('Product package is not currently installed.')
  } else if (tools.some((tool) => !tool.hasHandler)) {
    status = 'missing-handler'
    diagnostics.push('One or more declared product tools are missing handler registrations.')
  }

  return {
    productId,
    status,
    tools: tools.sort((left, right) => left.toolName.localeCompare(right.toolName)),
    diagnostics
  }
}

function toDescriptor(
  registration: ProductAgentToolRegistration,
  hasHandler: boolean
): ProductAgentToolDescriptor {
  return {
    toolName: registration.toolName,
    productId: registration.productId,
    handlerId: registration.handlerId,
    description: registration.description,
    title: registration.title,
    schemaVersion: registration.schemaVersion,
    readOnly: registration.readOnly,
    requiresTemporalBoundary: registration.requiresTemporalBoundary,
    timeoutMs: registration.timeoutMs,
    maxOutputBytes: registration.maxOutputBytes,
    requiresApproval: registration.requiresApproval,
    hasHandler
  }
}

/**
 * A mutating tool may never pre-authorize itself, and it must be able to time out: a write that can
 * hang has no safe default. Both rules are generic platform policy, not product-specific.
 */
function assertMutatingToolPolicy(registration: ProductAgentToolRegistration): void {
  if (registration.readOnly) return
  if (registration.requiresApproval === 'never') {
    throw new Error(
      `Mutating product tool "${registration.toolName}" must not declare requiresApproval "never".`
    )
  }
  if (registration.timeoutMs === undefined) {
    throw new Error(`Mutating product tool "${registration.toolName}" must declare timeoutMs.`)
  }
}

function buildRegistrationKey(productId: string, toolName: string): string {
  return `${productId}::${toolName}`
}

function buildHandlerKey(productId: string, handlerId: string): string {
  return `${productId}::${handlerId}`
}

export function buildProductAgentToolId(
  productId: string,
  toolName: string,
  schemaVersion: number
): string {
  return `product__${productId}__${normalizeToolNameForId(toolName)}__v${schemaVersion}`
}

export function buildProductAgentToolSourceId(agentId: string, productId: string): string {
  return `product-tool:${agentId}:${productId}`
}

function normalizeToolNameForId(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}
