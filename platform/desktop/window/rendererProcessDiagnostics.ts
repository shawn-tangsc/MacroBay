import type { BrowserWindow, WebContents } from 'electron'

type RendererGoneDetails = {
  reason: string
  exitCode: number
}

type ConsoleMessageDetails = {
  level: 'info' | 'warning' | 'error' | 'debug'
  message: string
  lineNumber: number
  sourceId: string
  frame?: {
    url?: string
    routingId?: number
    processId?: number
  }
}

export type RendererProcessDiagnosticEvent =
  | {
      timestamp: string
      event: 'render-process-gone'
      reason: string
      exitCode: number
    }
  | {
      timestamp: string
      event: 'did-fail-load'
      errorCode: number
      errorDescription: string
      validatedURL: string
      isMainFrame: boolean
    }
  | {
      timestamp: string
      event: 'console-message'
      level: 'info' | 'warning' | 'error' | 'debug'
      message: string
      lineNumber: number
      sourceId: string
      frame?: {
        url?: string
        routingId?: number
        processId?: number
      }
    }
  | {
      timestamp: string
      event: 'unresponsive'
    }
  | {
      timestamp: string
      event: 'responsive'
    }
  | {
      timestamp: string
      event: 'renderer-reload'
      reason: string
    }

export type RendererProcessDiagnosticsOptions = {
  logEvent?: (event: RendererProcessDiagnosticEvent) => void
  now?: () => string
  scheduleReload?: (reload: () => void) => void
}

type RendererProcessDiagnosticListener = (event: RendererProcessDiagnosticEvent) => void

const rendererProcessDiagnosticListeners = new Set<RendererProcessDiagnosticListener>()

export function registerRendererProcessDiagnosticListener(listener: RendererProcessDiagnosticListener): () => void {
  rendererProcessDiagnosticListeners.add(listener)
  return () => rendererProcessDiagnosticListeners.delete(listener)
}

export function resetRendererProcessDiagnosticListenersForTests(): void {
  rendererProcessDiagnosticListeners.clear()
}

const reloadableGoneReasons = new Set(['abnormal-exit', 'crashed', 'killed', 'oom', 'launch-failed', 'integrity-failure'])

export function wireRendererProcessDiagnostics(
  window: BrowserWindow,
  options: RendererProcessDiagnosticsOptions = {}
): void {
  const { webContents } = window
  const now = options.now ?? (() => new Date().toISOString())
  const logEvent = options.logEvent ?? (() => undefined)
  const record = (event: RendererProcessDiagnosticEvent): void => {
    logEvent(event)
    for (const listener of rendererProcessDiagnosticListeners) {
      try {
        listener(event)
      } catch {
        // Product diagnostics must not interfere with host lifecycle recovery.
      }
    }
  }
  const scheduleReload = options.scheduleReload ?? ((reload) => setTimeout(reload, 500))
  let reloadScheduled = false

  webContents.on('render-process-gone', (_event, details: RendererGoneDetails) => {
    record({
      timestamp: now(),
      event: 'render-process-gone',
      reason: details.reason,
      exitCode: details.exitCode
    })

    if (reloadScheduled || !reloadableGoneReasons.has(details.reason)) return
    reloadScheduled = true
    record({
      timestamp: now(),
      event: 'renderer-reload',
      reason: details.reason
    })
    scheduleReload(() => {
      reloadScheduled = false
      reloadWindowRenderer(window, webContents)
    })
  })

  webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    record({
      timestamp: now(),
      event: 'did-fail-load',
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    })
  })

  webContents.on('console-message', (details: ConsoleMessageDetails) => {
    if (details.level !== 'warning' && details.level !== 'error') return
    record({
      timestamp: now(),
      event: 'console-message',
      level: details.level,
      message: details.message,
      lineNumber: details.lineNumber,
      sourceId: details.sourceId,
      frame: normalizeConsoleMessageFrame(details.frame)
    })
  })

  window.on('unresponsive', () => {
    record({ timestamp: now(), event: 'unresponsive' })
  })

  window.on('responsive', () => {
    record({ timestamp: now(), event: 'responsive' })
  })
}

function reloadWindowRenderer(window: BrowserWindow, webContents: WebContents): void {
  if (window.isDestroyed() || webContents.isDestroyed()) return
  webContents.reloadIgnoringCache()
}

function normalizeConsoleMessageFrame(frame: ConsoleMessageDetails['frame']): ConsoleMessageDetails['frame'] {
  if (!frame) return undefined
  return {
    url: frame.url,
    routingId: frame.routingId,
    processId: frame.processId
  }
}
