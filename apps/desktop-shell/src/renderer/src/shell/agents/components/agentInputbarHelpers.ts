// 发送快捷键的判定不在这里：两面（智能体 / 助手）共用一份，见 `shell/chat/chatSendShortcut.ts`。
export function resizeTextarea(textarea: HTMLTextAreaElement, maxHeight: number): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
}
