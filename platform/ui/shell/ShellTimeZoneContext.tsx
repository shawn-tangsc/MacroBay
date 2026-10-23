import { createContext, useContext } from 'react'

import { resolveSystemTimeZone } from '../time/shellTimeFormat'

/**
 * Owner: platform/ui/shell（与 `ShellLanguageContext` 对称）。
 *
 * 窗口级已解析显示时区。产品按它格式化时间，绝不各自读设置或回退 UTC：主窗、分离页窗、停靠面板窗
 * 拿到的是同一个由 Main 解析的 id（`system` 已在 Main 解析为真实时区）。未提供 provider 时（单测、
 * 平台自带页面）跟随运行时时区，也就是默认设置 `system` 的行为。
 */
const ShellTimeZoneContext = createContext<string>(resolveSystemTimeZone())

export function ShellTimeZoneProvider(props: {
  timeZone: string
  children: React.ReactNode
}): React.ReactElement {
  return <ShellTimeZoneContext.Provider value={props.timeZone}>{props.children}</ShellTimeZoneContext.Provider>
}

export function useShellTimeZone(): string {
  return useContext(ShellTimeZoneContext)
}
