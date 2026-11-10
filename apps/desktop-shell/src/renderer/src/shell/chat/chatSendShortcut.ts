import type { KeyboardEvent } from 'react'

import type { ChatSettings } from '@platform/settings/schema/appSettings'

/**
 * 发送快捷键的**唯一判定**：智能体输入栏与助手输入栏都引这一份，两边不各读一套。
 *
 * 设置来自同一份 `settings.chat.sendShortcut`（平台设置 → 对话）。两种取值：
 * - `enter`：裸 Enter 发送；Shift / Ctrl / Cmd / Alt + Enter 一律换行。
 * - `mod-enter`：Cmd（macOS）/ Ctrl（其他） + Enter 发送；裸 Enter 换行。
 *
 * 输入法组合中的 Enter 永远不是发送。按住 Alt 的 Enter 也从不发送：它可能是输入法/字符输入的组合键。
 */
export function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>, shortcut: ChatSettings['sendShortcut']): boolean {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return false
  if (shortcut === 'mod-enter') return event.metaKey || event.ctrlKey
  return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
}
