import React from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'

// Design tokens first: every stylesheet below reads them. Kept as a module import rather than a
// CSS `@import` so the path goes through the `@platform` alias and survives a directory move.
import '@platform/ui/tokens/tokens.css'
// 行内文字动作（句子里的「重试」这类）：属于平台样式层，随 token 一起全局加载。
import '@platform/ui/styles/textAction.css'
// antd 静态方法（确认框、提示消息、通知）在 React 19 下要显式接上渲染器，否则静默不显示。
import { installAntdStaticRender } from '@platform/ui/antd/antdStaticRender'

import { AppShell } from './shell/AppShell'
import { markRendererPlatform } from './shell/window/windowPlatform'
import './styles.css'

/**
 * 平台标记只给样式/窗口分叉用：渲染层拿不到 `process.platform`，读 UA 即可（判定与写入口径
 * 都在 `shell/window/windowPlatform.ts`，CSS 的滚动条/自绘标题栏让位与 React 的窗口按钮读同一处）。
 */
markRendererPlatform()
installAntdStaticRender()

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
)
