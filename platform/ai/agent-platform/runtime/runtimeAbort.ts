export function throwIfAbortSignalAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return
  }

  throw createRuntimeAbortError()
}

export function throwRuntimeAbort(): never {
  throw createRuntimeAbortError()
}

export function isRuntimeAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function createRuntimeAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}
