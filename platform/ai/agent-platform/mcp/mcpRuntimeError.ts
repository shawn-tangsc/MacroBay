const MCP_RUNTIME_ERROR_KIND_BY_CODE = {
  MCP_RUNTIME_ABORT: 'abort',
  MCP_RUNTIME_CONFIG: 'config',
  MCP_RUNTIME_DEPENDENCY: 'dependency',
  MCP_RUNTIME_AUTH: 'auth',
  MCP_RUNTIME_TRANSIENT: 'transient'
} as const

type McpRuntimeErrorCode = keyof typeof MCP_RUNTIME_ERROR_KIND_BY_CODE

export type McpRuntimeErrorKind = (typeof MCP_RUNTIME_ERROR_KIND_BY_CODE)[McpRuntimeErrorCode]

type McpRuntimeErrorShape = Error & {
  code?: string
  status?: number
  statusCode?: number
  cause?: unknown
}

export type McpRuntimeErrorClassification = {
  kind: McpRuntimeErrorKind
  retryable: boolean
  message: string
  code?: string
  status?: number
}

export function createMcpRuntimeConfigError(message: string): Error & { code: 'MCP_RUNTIME_CONFIG' } {
  return Object.assign(new Error(message), {
    code: 'MCP_RUNTIME_CONFIG' as const
  })
}

export function createMcpRuntimeDependencyError(message: string): Error & { code: 'MCP_RUNTIME_DEPENDENCY' } {
  return Object.assign(new Error(message), {
    code: 'MCP_RUNTIME_DEPENDENCY' as const
  })
}

export function createMcpRuntimeAuthError(
  message: string,
  status?: number
): Error & { code: 'MCP_RUNTIME_AUTH'; status?: number } {
  return Object.assign(new Error(message), {
    code: 'MCP_RUNTIME_AUTH' as const,
    ...(typeof status === 'number' ? { status } : {})
  })
}

export function classifyMcpRuntimeError(error: unknown): McpRuntimeErrorClassification {
  const normalized = normalizeError(error)
  const status = extractStatus(error)

  if (normalized.code && normalized.code in MCP_RUNTIME_ERROR_KIND_BY_CODE) {
    const kind = MCP_RUNTIME_ERROR_KIND_BY_CODE[normalized.code as McpRuntimeErrorCode]
    return {
      kind,
      retryable: kind === 'transient',
      message: normalized.message,
      code: normalized.code,
      ...(typeof status === 'number' ? { status } : {})
    }
  }

  if (typeof status === 'number' && (status === 401 || status === 403)) {
    return {
      kind: 'auth',
      retryable: false,
      message: normalized.message,
      status
    }
  }

  const lowerMessage = normalized.message.trim().toLowerCase()
  if (
    normalized.name === 'AbortError' ||
    normalized.code === 'ABORT_ERR' ||
    lowerMessage === 'aborted' ||
    lowerMessage.includes('operation was aborted') ||
    lowerMessage.includes('request was aborted')
  ) {
    return {
      kind: 'abort',
      retryable: false,
      message: normalized.message
    }
  }

  if (
    lowerMessage.includes('missing a command') ||
    lowerMessage.includes('missing a baseurl') ||
    lowerMessage.includes('unsupported mcp server type')
  ) {
    return {
      kind: 'config',
      retryable: false,
      message: normalized.message
    }
  }

  if (
    lowerMessage.includes('mcp sdk package is not installed') ||
    lowerMessage.includes('mcp sdk client export is not available') ||
    lowerMessage.includes('mcp sdk stdioclienttransport export is not available') ||
    lowerMessage.includes('mcp sdk sseclienttransport export is not available') ||
    lowerMessage.includes('mcp sdk streamablehttpclienttransport export is not available') ||
    lowerMessage.includes('module-not-installed')
  ) {
    return {
      kind: 'dependency',
      retryable: false,
      message: normalized.message
    }
  }

  if (
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('invalid api key') ||
    lowerMessage.includes('authentication failed') ||
    lowerMessage.includes('permission denied')
  ) {
    return {
      kind: 'auth',
      retryable: false,
      message: normalized.message,
      ...(typeof status === 'number' ? { status } : {})
    }
  }

  return {
    kind: 'transient',
    retryable: true,
    message: normalized.message,
    ...(typeof status === 'number' ? { status } : {})
  }
}

export function isMcpRuntimeErrorRetryable(error: unknown): boolean {
  return classifyMcpRuntimeError(error).retryable
}

function normalizeError(error: unknown): { message: string; code?: string; name?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || 'MCP runtime host failed.',
      ...(typeof error.name === 'string' && error.name ? { name: error.name } : {}),
      ...(('code' in error && typeof error.code === 'string') ? { code: error.code } : {})
    }
  }

  if (typeof error === 'string') {
    return {
      message: error
    }
  }

  return {
    message: 'MCP runtime host failed.'
  }
}

function extractStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as McpRuntimeErrorShape
  const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined
}
