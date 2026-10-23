import type { KeyboardEvent } from 'react'

import type { ChatSettings } from '@platform/settings/schema/appSettings'

export function isSendShortcut(event: KeyboardEvent<HTMLTextAreaElement>, shortcut: ChatSettings['sendShortcut']): boolean {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return false
  if (shortcut === 'mod-enter') return event.metaKey || event.ctrlKey
  return !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
}

export function resizeTextarea(textarea: HTMLTextAreaElement, maxHeight: number): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
}
