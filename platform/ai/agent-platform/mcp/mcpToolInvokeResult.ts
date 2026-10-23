import type { McpRuntimeToolInvokeResult } from './mcpRuntimeHost'

type McpRawToolInvokeResultShape = {
  output?: unknown
  content?: unknown
  structuredContent?: unknown
  isError?: unknown
  sessionContext?: unknown | null
}

export function normalizeMcpRuntimeToolInvokeResult(result: unknown): McpRuntimeToolInvokeResult {
  const rawResult = isRecord(result) ? (result as McpRawToolInvokeResultShape) : null
  const hasExplicitOutput = rawResult !== null && hasOwn(rawResult, 'output')
  const content = rawResult !== null && hasOwn(rawResult, 'content') ? rawResult.content : undefined
  const structuredContent =
    rawResult !== null && hasOwn(rawResult, 'structuredContent') ? rawResult.structuredContent : undefined
  const output = hasExplicitOutput
    ? rawResult!.output
      : structuredContent !== undefined
      ? structuredContent
      : normalizeOutputFromContent(content, result)

  return {
    output,
    ...(content !== undefined ? { content } : {}),
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    ...(rawResult && hasOwn(rawResult, 'isError') ? { isError: Boolean(rawResult.isError) } : {}),
    ...(rawResult && hasOwn(rawResult, 'sessionContext')
      ? { sessionContext: rawResult.sessionContext ?? null }
      : {})
  }
}

function normalizeOutputFromContent(content: unknown, fallback: unknown): unknown {
  const textOutput = normalizeTextContent(content)
  if (textOutput !== undefined) {
    return textOutput
  }

  if (content !== undefined) {
    return content
  }

  return fallback
}

function normalizeTextContent(content: unknown): string | undefined {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content) || content.length === 0) {
    return undefined
  }

  const textBlocks = content.filter(isTextContentBlock)
  if (textBlocks.length === 0 || textBlocks.length !== content.length) {
    return undefined
  }

  return textBlocks.map((block) => block.text).join('')
}

function isTextContentBlock(value: unknown): value is { type: 'text'; text: string } {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
