import type { PostToolUseHookSpecificOutput } from '@anthropic-ai/claude-agent-sdk'

import { guardExternalContent, type ExternalContentMetadata } from '../../../channels/ExternalContentGuard'

/**
 * Guards tool results that come from **externally configured MCP servers** before the model reads
 * them, on the SDK-direct path that never passes through our own host.
 *
 * Which servers count as external is decided by the caller: the composition root knows which
 * servers the user configured and which ones this platform builds itself. The four platform-owned
 * servers share the `mcp__` prefix (`macrobay_web`, `agent-skills`, `agent-task-management`, product
 * tools), so a prefix match would label our own data untrusted and wrap it twice — the judgement is
 * membership in the external set, never the prefix.
 *
 * `updatedToolOutput` replaces only the copy sent to the model; the stored transcript keeps the
 * original text. Consequently this guard says nothing about replay or later re-ingestion of stored
 * results: those paths must run the guard again.
 */

export type ExternalMcpToolIdentity = {
  serverName: string
  toolName: string
}

export type McpPostToolUseEvent = {
  tool_name?: string
  tool_response?: unknown
}

const BOUNDARY_MARKER = '<<<EXTERNAL_UNTRUSTED_CONTENT'

/** `mcp__<serverName>__<tool>` → the server, but only when that server is user-configured. */
export function resolveExternalMcpTool(
  toolName: string | undefined,
  externalServerNames: readonly string[]
): ExternalMcpToolIdentity | null {
  if (!toolName || !toolName.startsWith('mcp__')) return null
  for (const serverName of externalServerNames) {
    const prefix = `mcp__${serverName}__`
    if (toolName.startsWith(prefix)) {
      return { serverName, toolName: toolName.slice(prefix.length) }
    }
  }
  return null
}

export function createExternalMcpPostToolUseGuard(input: {
  externalServerNames: readonly string[]
}): (event: McpPostToolUseEvent) => Promise<Record<string, unknown>> {
  return async (event) => {
    const identity = resolveExternalMcpTool(event.tool_name, input.externalServerNames)
    if (!identity) return {}

    const metadata: ExternalContentMetadata = {
      kind: 'mcp',
      serverKey: identity.serverName,
      toolName: identity.toolName
    }

    try {
      const response = event.tool_response
      if (alreadyGuarded(response)) return {}
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: guardToolResponse(response, metadata)
        } satisfies PostToolUseHookSpecificOutput
      }
    } catch {
      // Total function: a guard failure must not lose the result or fail the turn. The fallback is
      // the most conservative shape that still carries a boundary — one wrapped text block.
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: [wrappedTextBlock(serializeSafely(event.tool_response), metadata, 'unreadable')]
        } satisfies PostToolUseHookSpecificOutput
      }
    }
  }
}

function guardToolResponse(response: unknown, metadata: ExternalContentMetadata): unknown {
  if (Array.isArray(response)) {
    // The SDK hands MCP results over as content blocks, with `resource` already flattened to text,
    // so guarding text blocks covers everything the model reads. Other blocks (images, audio) are
    // left byte-identical.
    return response.map((block) => {
      if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
        return { ...block, text: guardExternalContent(block.text, metadata).guardedText }
      }
      return block
    })
  }

  // Anything else is a shape the model would still read as text. Degrade to a serialized, wrapped
  // text block and say what it originally was, rather than rewriting structured fields.
  return [wrappedTextBlock(serializeSafely(response), metadata, describeShape(response))]
}

function wrappedTextBlock(serialized: string, metadata: ExternalContentMetadata, shape: string): { type: 'text'; text: string } {
  const note = `[The tool returned ${shape}; its content is serialized below.]\n`
  return { type: 'text', text: guardExternalContent(`${note}${serialized}`, metadata).guardedText }
}

function alreadyGuarded(response: unknown): boolean {
  if (typeof response === 'string') return response.includes(BOUNDARY_MARKER)
  if (!Array.isArray(response)) return false
  return response.some(
    (block) => isRecord(block) && typeof block.text === 'string' && block.text.includes(BOUNDARY_MARKER)
  )
}

function describeShape(response: unknown): string {
  if (response === null) return 'null'
  if (response === undefined) return 'nothing (undefined)'
  return `a value of type ${typeof response}`
}

function serializeSafely(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
