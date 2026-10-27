import React from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'

import { AppShell } from './shell/AppShell'
import { markRendererPlatform } from './shell/window/windowPlatform'
import './styles.css'

/**
 * 平台标记只给样式/窗口分叉用：渲染层拿不到 `process.platform`，读 UA 即可（判定与写入口径
 * 都在 `shell/window/windowPlatform.ts`，CSS 的滚动条/自绘标题栏让位与 React 的窗口按钮读同一处）。
 */
markRendererPlatform()

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
)
