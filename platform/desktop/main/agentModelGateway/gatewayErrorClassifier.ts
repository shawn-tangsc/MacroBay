export type AgentModelGatewayErrorKind =
  | 'auth'
  | 'forbidden'
  | 'rate-limit'
  | 'timeout'
  | 'abort'
  | 'network'
  | 'protocol'
  | 'config'
  | 'upstream'

export type AgentModelGatewayErrorLocation =
  | 'local-gateway-config'
  | 'local-gateway-auth'
  | 'upstream-provider-auth'
  | 'upstream-provider-protocol'
  | 'upstream-provider'
  | 'timeout'
  | 'abort'
  | 'network'

export type AgentModelGatewayClassifiedError = {
  kind: AgentModelGatewayErrorKind
  location: AgentModelGatewayErrorLocation
  status: number
  message: string
  retryable: boolean
}

export function classifyGatewayHttpStatus(
  status: number,
  options: {
    location?: 'local' | 'upstream'
    bodyText?: string
  } = {}
): AgentModelGatewayClassifiedError {
  const locationSide = options.location ?? 'upstream'
  const body = (options.bodyText ?? '').toLowerCase()

  if (status === 401) {
    return {
      kind: 'auth',
      location: locationSide === 'local' ? 'local-gateway-auth' : 'upstream-provider-auth',
      status,
      message:
        locationSide === 'local'
          ? 'Local agent model gateway rejected the auth token.'
          : 'Upstream provider authentication failed for the gateway route.',
      retryable: false
    }
  }

  if (status === 403) {
    return {
      kind: 'forbidden',
      location: locationSide === 'local' ? 'local-gateway-auth' : 'upstream-provider-auth',
      status,
      message:
        locationSide === 'local'
          ? 'Local agent model gateway denied the request.'
          : 'Upstream provider denied access for the gateway route.',
      retryable: false
    }
  }

  if (status === 429 || body.includes('rate limit') || body.includes('rate_limit')) {
    return {
      kind: 'rate-limit',
      location: 'upstream-provider',
      status,
      message: 'Upstream provider rate-limited the gateway route.',
      retryable: true
    }
  }

  if (status === 400 || status === 422 || status === 415 || body.includes('unsupported') || body.includes('invalid')) {
    return {
      kind: 'protocol',
      location: 'upstream-provider-protocol',
      status,
      message: 'Upstream provider rejected the gateway-converted request as protocol-incompatible.',
      retryable: false
    }
  }

  if (status === 404 || status === 405 || status === 501) {
    return {
      kind: 'protocol',
      location: 'upstream-provider-protocol',
      status,
      message: 'Upstream provider endpoint does not support the selected gateway API type.',
      retryable: false
    }
  }

  if (status >= 500) {
    return {
      kind: 'upstream',
      location: 'upstream-provider',
      status,
      message: `Upstream provider failed with status ${status}.`,
      retryable: true
    }
  }

  return {
    kind: 'upstream',
    location: 'upstream-provider',
    status,
    message: `Upstream provider returned status ${status}.`,
    retryable: false
  }
}

export function classifyGatewayTransportError(error: unknown): AgentModelGatewayClassifiedError {
  if (isAbortError(error)) {
    return {
      kind: 'abort',
      location: 'abort',
      status: 499,
      message: 'Gateway request was aborted.',
      retryable: false
    }
  }

  if (isTimeoutError(error)) {
    return {
      kind: 'timeout',
      location: 'timeout',
      status: 504,
      message: 'Gateway upstream request timed out.',
      retryable: true
    }
  }

  return {
    kind: 'network',
    location: 'network',
    status: 502,
    message: error instanceof Error ? sanitizeErrorMessage(error.message) : 'Gateway upstream network error.',
    retryable: true
  }
}

export function classifyGatewayConfigError(message: string): AgentModelGatewayClassifiedError {
  return {
    kind: 'config',
    location: 'local-gateway-config',
    status: 503,
    message: sanitizeErrorMessage(message),
    retryable: false
  }
}

export function toSafeGatewayErrorBody(error: AgentModelGatewayClassifiedError): Record<string, unknown> {
  return {
    type: 'error',
    error: {
      type: error.kind,
      message: error.message,
      location: error.location
    }
  }
}

function isAbortError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))) return true
  return false
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TimeoutError' || /timeout|timed out|probe-timeout/i.test(error.message)
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/x-api-key["']?\s*[:=]\s*["']?[^"'\\s]+/gi, 'x-api-key=[redacted]')
    .slice(0, 240)
}
