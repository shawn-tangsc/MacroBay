export type AgentMcpManualBindingResult =
  | { status: 'empty' }
  | { status: 'duplicate'; id: string }
  | { status: 'added'; id: string; mcps: string[] }

export function addManualMcpBinding(
  currentMcps: readonly string[],
  rawValue: string
): AgentMcpManualBindingResult {
  const id = rawValue.trim()
  if (!id) return { status: 'empty' }
  if (currentMcps.includes(id)) return { status: 'duplicate', id }
  return {
    status: 'added',
    id,
    mcps: [...currentMcps, id]
  }
}
