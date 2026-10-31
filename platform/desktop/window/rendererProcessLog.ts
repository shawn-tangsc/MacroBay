import type { AppLog, AppLogLevel } from '../../observability/logging/appLog'
import type { RendererProcessDiagnosticEvent } from './rendererProcessDiagnostics'

/**
 * 渲染进程诊断没有自己的落盘管道：事件进唯一的应用日志写入器，用 `category` 标出来源，
 * 因此它和主进程日志共享同一套脱敏、轮转与总量上限。
 */
export function createRendererProcessLog(appLog: AppLog): {
  write: (event: RendererProcessDiagnosticEvent) => void
} {
  return {
    write(event) {
      const { event: kind, ...fields } = event
      appLog.log(eventLevel(event), kind, { category: 'renderer', ...fields })
    }
  }
}

function eventLevel(event: RendererProcessDiagnosticEvent): AppLogLevel {
  switch (event.event) {
    case 'render-process-gone':
    case 'unresponsive':
    case 'did-fail-load':
      return 'error'
    case 'console-message':
      return event.level === 'error' ? 'error' : 'warn'
    default:
      return 'info'
  }
}
