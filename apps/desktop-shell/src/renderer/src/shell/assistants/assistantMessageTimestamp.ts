import { formatShellClock } from '@platform/ui/time/shellTimeFormat'

/**
 * 助手消息的时间标签。
 *
 * 这里只做一件事：把「显示时区」交给平台口径（`platform/ui/time/shellTimeFormat`）。
 * 它曾经自己用 `Intl.DateTimeFormat` + 系统时区拼一份，结果是用户把显示时区设成非系统时区后，
 * 消息行的时间和同屏其他地方对不上——两套实现早晚会分叉，这不是配置问题。
 */
export function formatAssistantMessageTimestamp(
  createdAt: string,
  timeZone: string,
  now = new Date()
): string | null {
  return formatShellClock(createdAt, { timeZone, now })
}
