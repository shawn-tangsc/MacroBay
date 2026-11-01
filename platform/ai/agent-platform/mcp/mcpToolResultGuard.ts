import { guardExternalContent, type ExternalContentMetadata } from '../channels/ExternalContentGuard'
import type { McpRuntimeToolInvokeResult } from './mcpRuntimeHost'

/**
 * A third-party tool server returns whatever it likes, and the model reads that return value as if
 * it were a fact. The guard is applied to the prose the model would read: text content items, and a
 * plain string output. Structured output and `structuredContent` are left alone on purpose — those
 * are machine-readable values our own code parses (`code`, `path`, ids), and wrapping them would
 * corrupt their meaning without protecting anyone.
 *
 * Applies to the path we own (`McpRuntimeServerHostFactory.invokeTool`). Tool calls the SDK makes
 * through its own connection never reach this function — that path is a known gap, not a covered one.
 */
export function guardMcpToolInvokeResult(
  result: McpRuntimeToolInvokeResult,
  provenance: { serverKey: string; toolName: string }
): McpRuntimeToolInvokeResult {
  const metadata: ExternalContentMetadata = {
    kind: 'mcp',
    serverKey: provenance.serverKey,
    toolName: provenance.toolName
  }

  return {
    ...result,
    output:
      typeof result.output === 'string' ? guardExternalContent(result.output, metadata).guardedText : result.output,
    ...(Array.isArray(result.content)
      ? { content: result.content.map((item) => guardTextItem(item, metadata)) }
      : {})
  }
}

function guardTextItem(item: unknown, metadata: ExternalContentMetadata): unknown {
  if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') return item
  return { ...item, text: guardExternalContent(item.text, metadata).guardedText }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
