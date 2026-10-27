export const SHELL_ICON_IDS = [
  'activity',
  'bot',
  'chart-candlestick',
  'database',
  'file-text',
  'home',
  'key-round',
  'languages',
  'message-square-text',
  'radar',
  'scroll-text',
  'settings',
  'shield'
] as const

export type ShellIconId = (typeof SHELL_ICON_IDS)[number]

export function isShellIconId(value: string): value is ShellIconId {
  return (SHELL_ICON_IDS as readonly string[]).includes(value)
}
