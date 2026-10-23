import type { EventEmitter } from 'node:events'

type StdioLike = Pick<EventEmitter, 'on'>

let installed = false

export function installStdioBrokenPipeGuard(
  streams: { stdout?: StdioLike; stderr?: StdioLike } = {
    stdout: process.stdout,
    stderr: process.stderr
  }
): void {
  if (streams.stdout === process.stdout && streams.stderr === process.stderr) {
    if (installed) return
    installed = true
  }

  const onError = (error: unknown) => {
    if (isBrokenPipeError(error)) return
    throw error
  }

  streams.stdout?.on('error', onError)
  streams.stderr?.on('error', onError)
}

function isBrokenPipeError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'EPIPE')
}
