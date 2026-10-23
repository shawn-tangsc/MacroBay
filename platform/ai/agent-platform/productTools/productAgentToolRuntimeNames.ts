export function buildProductAgentToolMcpServerKey(productId: string): string {
  return productId.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

export function buildProductAgentToolRuntimeName(productId: string, toolName: string): string {
  return `mcp__${buildProductAgentToolMcpServerKey(productId)}__${toolName}`
}

export function parseProductAgentToolRuntimeName(
  runtimeName: string
): { productId: string; toolName: string } | null {
  const match = /^mcp__([^_]+(?:-[^_]+)*)__([a-zA-Z0-9_.-]+)$/.exec(runtimeName)
  if (!match) return null
  return {
    productId: match[1]!,
    toolName: match[2]!
  }
}

export function resolveProductToolRuntimeName(
  runtimeName: string,
  packages: ReadonlyArray<{ productId: string; toolNames: readonly string[] }>
): { productId: string; toolName: string } | null {
  for (const pkg of packages) {
    for (const toolName of pkg.toolNames) {
      if (buildProductAgentToolRuntimeName(pkg.productId, toolName) === runtimeName) {
        return { productId: pkg.productId, toolName }
      }
    }
  }
  return parseProductAgentToolRuntimeName(runtimeName)
}
