import type { PlatformText } from '../../i18n/platformText'
import { normalizeAssistantStatusMessage, resolveAssistantStreamErrorText } from './assistantPageReadiness'

/**
 * 助手页底部那条状态提示：**state 里只存「哪一种」，句子在渲染那一刻取**。
 *
 * 之前直接存解析好的句子，于是提示会冻结在写入那一刻的语言——窗口切成英文后再出错，
 * 屏幕上还是中文（今天那个「英文界面显示已保存」的同一个病，只是换了一屏）。
 *
 * `text` 与 `stream-error` 两档是为**运行时输入**留的：前者是 IPC 返回的原文，
 * 后者是流式失败的 error 对象（要按其中的 code 才能翻成句子）。键做不到这两件事，
 * 所以它们单独成档——这样「哪几句是我们的文案、哪几句是别人给的」在类型上一目了然。
 */
export type AssistantsStatus =
  | { kind: 'text'; text: string }
  | { kind: 'stream-error'; error: unknown }
  | { kind: 'model-not-ready' }
  | { kind: 'operation-failed' }

export function assistantStatusText(labels: PlatformText['assistants'], status: AssistantsStatus): string {
  switch (status.kind) {
    case 'text':
      return status.text
    case 'stream-error':
      return resolveAssistantStreamErrorText(status.error, labels)
    case 'model-not-ready':
      return labels.modelNotReady
    case 'operation-failed':
      return labels.conversationOperationFailed
  }
}

/** 一次操作返回了一条运行时消息就用它，没有消息则归到「模型还没准备好」。 */
export function assistantStatusFromResponse(message: string | null | undefined): AssistantsStatus {
  return message ? { kind: 'text', text: message } : { kind: 'model-not-ready' }
}

/** 抛出来的错误里若有可读消息就用它，否则归到「模型还没准备好」。 */
export function assistantStatusFromError(error: unknown): AssistantsStatus {
  const message = normalizeAssistantStatusMessage(error, '')
  return message ? { kind: 'text', text: message } : { kind: 'model-not-ready' }
}
