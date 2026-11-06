import type { AgentRuntimeStopReason } from './runtimeTypes'

/** 停止原因只保留结构字段：带 `message` 时才带，避免把空串写进 transcript。 */
export function cloneStopReason(reason: AgentRuntimeStopReason): AgentRuntimeStopReason {
  return {
    kind: reason.kind,
    ...(reason.message ? { message: reason.message } : {})
  }
}
