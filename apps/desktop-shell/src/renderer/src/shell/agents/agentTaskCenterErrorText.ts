import type { AgentText } from './agentText'
import type { AgentTaskDraftError } from './agentTaskCenterViewModel'

/**
 * 任务中心的错误状态：**只存是哪一种失败，句子在渲染那一刻取**。
 *
 * 把解析好的句子存进 state 会把语言冻结在写入那一刻——窗口切成英文后再出错，
 * 屏幕上可能还是中文（或反过来）。这里用判别联合把「哪一种」写进类型，
 * 句子留给渲染时的文案表，因此加一种失败在编译期就会红。
 */
export type AgentTaskCenterError =
  | { kind: 'validation'; reason: AgentTaskDraftError }
  | { kind: 'save-failed' }
  | { kind: 'revision-conflict' }
  | { kind: 'delete-failed' }
  | { kind: 'run-failed' }
  | { kind: 'cancel-failed' }
  | { kind: 'retry-delivery-failed' }

/** 句子只在这一处由「哪一种失败」算出来，调用点不持有句子。 */
export function agentTaskCenterErrorText(
  labels: AgentText['taskCenter'],
  error: AgentTaskCenterError
): string {
  switch (error.kind) {
    case 'validation':
      return labels.validation[error.reason]
    case 'save-failed':
      return labels.saveFailed
    case 'revision-conflict':
      return labels.revisionConflict
    case 'delete-failed':
      return labels.deleteFailed
    case 'run-failed':
      return labels.runFailed
    case 'cancel-failed':
      return labels.cancelFailed
    case 'retry-delivery-failed':
      return labels.retryDeliveryFailed
  }
}
