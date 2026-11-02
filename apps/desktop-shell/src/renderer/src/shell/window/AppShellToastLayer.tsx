import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ToastHost } from '@platform/ui/components/toast/ToastHost'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { ReactElement, ReactNode } from 'react'

/**
 * 提示宿主这一层（从 `AppShell` 抽出来，行为不变）。
 *
 * 两个渲染根（主窗与每个分离窗）都经 `AppShell` 进入，所以宿主在这里挂**一次**就覆盖两类窗口；
 * 它在页面内容之外，弹提示不会被布局裁掉。
 *
 * 语言上下文显式给一层：宿主的区域名与关闭键读法要跟界面语言走；内层 provider 仍按各页面覆盖。
 * 抽出来是为了让 `AppShell` 只回答「壳层怎么拼」，不再顺带管宿主挂载。
 */
export function AppShellToastLayer(props: { language: AppLanguage; children: ReactNode }): ReactElement {
  return (
    <ShellLanguageProvider language={props.language}>
      <ToastHost>{props.children}</ToastHost>
    </ShellLanguageProvider>
  )
}
