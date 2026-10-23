const WIRE_PREFIX = 'mcp__'
const MAX_WIRE_NAME_LENGTH = 63
const DISAMBIGUATOR_LENGTH = 7
const DISAMBIGUATOR_SEPARATOR = '_'

export type McpToolNameParts = {
  serverPart: string
  toolPart: string
}

/**
 * Turns a free-form server or tool name into a single camel-cased segment that
 * can be embedded in a function-call tool name.
 */
export function toCamelSegment(value: string): string {
  let segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_match, next: string) => next.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')

  if (segment && !/^[a-zA-Z_]/.test(segment)) {
    segment = `_${segment}`
  }

  return segment
}

/**
 * Builds the wire name used by the model when it calls an MCP tool.
 *
 * Long names are truncated and suffixed with a short hash of the server name so
 * two servers with the same prefix stay distinguishable.
 */
export function buildMcpToolName(serverName: string, toolName: string): string {
  const server = serverName ? toCamelSegment(serverName) : ''
  const tool = toCamelSegment(toolName)
  const candidate = server ? `${WIRE_PREFIX}${server}__${tool}` : `${WIRE_PREFIX}${tool}`

  if (candidate.length <= MAX_WIRE_NAME_LENGTH) {
    return candidate
  }

  const suffix = `${DISAMBIGUATOR_SEPARATOR}${shortHash(serverName)}`
  const body = clampLength(candidate, MAX_WIRE_NAME_LENGTH - suffix.length)
  return `${body}${suffix}`
}

/**
 * Splits a wire name back into its server and tool segments. Returns null for
 * names that do not follow the wire format.
 */
export function parseMcpToolName(wireName: string): McpToolNameParts | null {
  if (!wireName.startsWith(WIRE_PREFIX)) {
    return null
  }

  const remainder = wireName.slice(WIRE_PREFIX.length)
  const splitAt = remainder.lastIndexOf('__')
  if (splitAt <= 0 || splitAt >= remainder.length - 2) {
    return null
  }

  return {
    serverPart: remainder.slice(0, splitAt),
    toolPart: remainder.slice(splitAt + 2)
  }
}

/**
 * Tells whether a wire name belongs to the given server, including truncated
 * names that only keep the hash disambiguator.
 */
export function isMcpToolNameForServer(serverName: string, wireName: string): boolean {
  const server = toCamelSegment(serverName)
  if (wireName.startsWith(`${WIRE_PREFIX}${server}__`)) {
    return true
  }

  const suffix = `${DISAMBIGUATOR_SEPARATOR}${shortHash(serverName)}`
  if (!wireName.endsWith(suffix)) {
    return false
  }

  const body = wireName.slice(0, wireName.length - suffix.length)
  const serverCore = `${WIRE_PREFIX}${server}`
  return serverCore.startsWith(body) || body.startsWith(serverCore)
}

function clampLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return value.slice(0, maxLength).replace(/_+$/, '')
}

/** FNV-1a, rendered as a fixed-length base36 string. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0)
    .toString(36)
    .padStart(DISAMBIGUATOR_LENGTH, '0')
    .slice(-DISAMBIGUATOR_LENGTH)
}
