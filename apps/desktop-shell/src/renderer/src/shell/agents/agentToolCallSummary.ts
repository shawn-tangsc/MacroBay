/**
 * A tool row is useless when it only says "Bash" or "Read": the reader needs the command, the
 * path, the pattern. This module owns that translation for the built-in runtime tools and falls
 * back to a generic first-field summary so unknown or product tools still say something.
 */

const ONE_LINE_LIMIT = 160
const PATH_LIMIT = 72

const COMMAND_INPUT_TOOLS = new Set(['Bash', 'Shell', 'PowerShell'])
const PATH_INPUT_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookRead',
  'NotebookEdit',
  'LS'
])

const FALLBACK_FIELDS = [
  'command',
  'description',
  'file_path',
  'notebook_path',
  'path',
  'pattern',
  'query',
  'url',
  'prompt',
  'name',
  'skill',
  'subagent_type'
] as const

/** MCP tools arrive as `mcp__<server>__<tool>`; the server segment is noise in a row title. */
export function resolveToolDisplayName(toolName: string): string {
  const mcpName = /^mcp__[^_]+(?:-[^_]+)*__(.+)$/.exec(toolName)
  return mcpName?.[1] ?? toolName
}

/**
 * One line describing what the call asked for. Returns null when the tool has nothing worth
 * saying (for example a todo list update), so the row falls back to its status wording.
 */
export function summarizeToolCallInput(toolName: string, input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'string') return toOneLine(input)
  if (typeof input === 'number' || typeof input === 'boolean') return String(input)
  if (Array.isArray(input)) return null
  if (typeof input !== 'object') return null

  const record = input as Record<string, unknown>

  if (COMMAND_INPUT_TOOLS.has(toolName)) {
    return toOneLine(readString(record.command))
  }

  if (PATH_INPUT_TOOLS.has(toolName)) {
    return formatPath(
      readString(record.file_path) ?? readString(record.notebook_path) ?? readString(record.path)
    )
  }

  switch (toolName) {
    case 'Glob':
      return joinParts([readString(record.pattern), readString(record.path)], ' · ')
    case 'Grep':
      return joinParts(
        [readString(record.pattern), readString(record.path) ?? readString(record.glob)],
        ' · '
      )
    case 'WebFetch':
      return toOneLine(readString(record.url))
    case 'WebSearch':
      return toOneLine(readString(record.query))
    case 'Task':
      return toOneLine(readString(record.description) ?? readString(record.prompt))
    case 'Skill':
      return toOneLine(readString(record.skill))
    case 'TodoWrite':
    case 'AskUserQuestion':
      return null
    default:
      return pickFallbackSummary(record)
  }
}

function pickFallbackSummary(record: Record<string, unknown>): string | null {
  for (const field of FALLBACK_FIELDS) {
    const value = readString(record[field])
    if (value) return toOneLine(value)
  }
  return null
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function toOneLine(value: string | null): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return normalized.length > ONE_LINE_LIMIT
    ? `${normalized.slice(0, ONE_LINE_LIMIT).trimEnd()}…`
    : normalized
}

/** A long absolute path is less readable than its tail; the file name is what identifies it. */
function formatPath(value: string | null): string | null {
  const oneLine = toOneLine(value)
  if (!oneLine || oneLine.length <= PATH_LIMIT) return oneLine
  const segments = oneLine.split('/').filter(Boolean)
  const tail = segments.slice(-2).join('/')
  return tail && tail.length + 2 <= PATH_LIMIT ? `…/${tail}` : `…${oneLine.slice(-(PATH_LIMIT - 1))}`
}

function joinParts(parts: Array<string | null>, separator: string): string | null {
  const normalized = parts.filter((part): part is string => Boolean(part))
  return normalized.length > 0 ? toOneLine(normalized.join(separator)) : null
}
