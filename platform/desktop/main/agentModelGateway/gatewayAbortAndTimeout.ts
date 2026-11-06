import { AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS } from '../../../ai/agent-platform/runtime/agentModelRequestBudget'

export type GatewayAbortTimeoutOptions = {
  timeoutMs?: number
  parentSignal?: AbortSignal
}

export type GatewayAbortTimeoutHandle = {
  signal: AbortSignal
  clear: () => void
}

export function createGatewayAbortTimeout(options: GatewayAbortTimeoutOptions = {}): GatewayAbortTimeoutHandle {
  const controller = new AbortController()
  // The fallback only covers a caller that declared nothing. A declared budget (the caller's own
  // budget, read from the request header by the HTTP server) is what the request is timed against,
  // so this constant is not a cap for everyone.
  const timeoutMs = options.timeoutMs ?? AGENT_MODEL_GATEWAY_FALLBACK_TIMEOUT_MS
  const timeout = setTimeout(() => {
    controller.abort(new Error('gateway-timeout'))
  }, timeoutMs)

  const onParentAbort = () => {
    controller.abort(options.parentSignal?.reason ?? new Error('gateway-abort'))
  }

  if (options.parentSignal) {
    if (options.parentSignal.aborted) {
      onParentAbort()
    } else {
      options.parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }
  }

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timeout)
      options.parentSignal?.removeEventListener('abort', onParentAbort)
    }
  }
}

export function isGatewayTimeoutAbort(signal: AbortSignal): boolean {
  return signal.aborted && String(signal.reason ?? '').includes('gateway-timeout')
}
