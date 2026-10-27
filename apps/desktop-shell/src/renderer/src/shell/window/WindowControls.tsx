import { useEffect, useState } from 'react'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { platformText } from '../../i18n/platformText'
import { readRendererPlatform } from './windowPlatform'

/**
 * Owner: apps/desktop-shell renderer / window（**自绘标题栏的窗口按钮**，仅 Windows）。
 *
 * 为什么自己画（而不是 `titleBarOverlay`）：Windows 上窗口顶部那一行已经是应用自己的内容
 * （`.topbar`：页面名 + 搜索/布局按钮；独立窗是 `WorkspaceWindowTopBar`），系统绘制的按钮只能
 * 浮在这行**之上**，颜色/底边/主题都得再对一次，且没法跟随本应用的主题 token。自绘后这行是
 * 一整块连续的面，按钮与右侧原有内容同一套 hover / 焦点 / 主题。
 *
 * 平台边界：
 *  - Windows：`frame: false`（`platform/desktop/window/windowChrome.ts`），本组件画最小化/最大化/关闭；
 *  - macOS：`hiddenInset`，系统红绿灯在左上角，本组件返回 `null`（绝不重复画按钮）。
 *
 * 每个按钮只调既有的受控 `window.platform.window.*`（主进程按 `event.sender` 推导目标窗口），
 * 不新增 IPC 通道；最大化/还原图形跟随主进程广播的 `onMaximizedChange`，不在渲染层自造状态。
 */
export function WindowControls(): React.ReactElement | null {
  const platform = readRendererPlatform()
  const maximized = useWindowMaximized(platform === 'win32')
  const language = useShellLanguage()
  // 非 Windows 一律不渲染：hooks 已在上面无条件调用完，提前返回不破坏 hooks 顺序。
  if (platform !== 'win32') return null

  const text = platformText[language].windowChrome
  const api = window.platform?.window
  return (
    <div className="window-controls" role="group" aria-label={text.controls} data-window-controls="true">
      <button
        type="button"
        className="window-control"
        data-window-control="minimize"
        aria-label={text.minimize}
        title={text.minimize}
        onClick={() => { void api?.minimize() }}>
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        className="window-control"
        data-window-control="maximize"
        data-maximized={maximized ? 'true' : 'false'}
        aria-label={maximized ? text.restore : text.maximize}
        title={maximized ? text.restore : text.maximize}
        onClick={() => { void api?.toggleMaximize() }}>
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        className="window-control"
        data-window-control="close"
        aria-label={text.close}
        title={text.close}
        onClick={() => { void api?.close() }}>
        <CloseGlyph />
      </button>
    </div>
  )
}

/**
 * 最大化事实：初值问一次主进程，之后只认 `onMaximizedChange` 广播（双击拖动区、Win+↑、贴边吸附
 * 都走同一条广播）。接口缺失（测试替身/非 Electron 环境）时保持「未最大化」，绝不抛。
 */
function useWindowMaximized(enabled: boolean): boolean {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const api = typeof window === 'undefined' ? undefined : window.platform?.window
    if (!api) return
    let cancelled = false
    void api.isMaximized()
      .then((value) => { if (!cancelled) setMaximized(value === true) })
      .catch(() => { /* 读不到就维持未最大化：图形只影响观感，绝不阻断窗口操作 */ })
    const unsubscribe = api.onMaximizedChange((value) => setMaximized(value === true))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [enabled])
  return maximized
}

/*
 * 图形按 Windows 11 的标题栏字体几何画：10×10、1px 描边、落在半像素上（crispEdges 后在任何
 * 缩放比下都是硬边）。用 SVG 而不是 Segoe Fluent Icons，避免依赖系统字体版本（Win10 只有 MDL2）。
 */
const GLYPH_PATHS = {
  minimize: <path d="M0 5.5H10" />,
  maximize: <path d="M0.5 0.5H9.5V9.5H0.5Z" />,
  restore: <path d="M2.5 0.5H9.5V7.5H2.5Z M0.5 2.5H2.5 M0.5 2.5V9.5H7.5V7.5" />,
  close: <path d="M0.5 0.5L9.5 9.5 M9.5 0.5L0.5 9.5" />
} as const

function Glyph(props: { shape: keyof typeof GLYPH_PATHS }): React.ReactElement {
  return (
    <svg
      className="window-control-glyph"
      viewBox="0 0 10 10"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false">
      {GLYPH_PATHS[props.shape]}
    </svg>
  )
}

function MinimizeGlyph(): React.ReactElement { return <Glyph shape="minimize" /> }
function MaximizeGlyph(): React.ReactElement { return <Glyph shape="maximize" /> }
function RestoreGlyph(): React.ReactElement { return <Glyph shape="restore" /> }
function CloseGlyph(): React.ReactElement { return <Glyph shape="close" /> }
