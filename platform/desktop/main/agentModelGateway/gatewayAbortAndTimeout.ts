export type GatewayAbortTimeoutOptions = {
  timeoutMs?: number
  parentSignal?: AbortSignal
}

export type GatewayAbortTimeoutHandle = {
  signal: AbortSignal
  clear: () => void
}

const DEFAULT_TIMEOUT_MS = 60_000

export function createGatewayAbortTimeout(options: GatewayAbortTimeoutOptions = {}): GatewayAbortTimeoutHandle {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
