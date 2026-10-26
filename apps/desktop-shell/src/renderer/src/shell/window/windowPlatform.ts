/**
 * Owner: apps/desktop-shell renderer / window。
 *
 * 渲染层拿不到 `process.platform`（contextIsolation），窗口外观的平台分叉只能靠一个**只读标记**：
 * 入口 `main.tsx` 在首帧前把平台写进 `<html data-platform>`，CSS（滚动条、自绘标题栏的让位）
 * 与 React（是否画窗口按钮）都读同一处，避免两套判断各说一份。
 *
 * 判定只读 UA：Electron 的 UA 一定带 `Windows NT` / `Macintosh`，与本仓库既有的滚动条分叉同源。
 * 未知平台一律 `linux`（保留原生装饰，不画窗口按钮）——绝不猜成 Windows。
 */
export type RendererPlatform = 'win32' | 'darwin' | 'linux'

export function detectRendererPlatform(): RendererPlatform {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Windows/i.test(userAgent)) return 'win32'
  if (/Mac/i.test(userAgent)) return 'darwin'
  return 'linux'
}

/** 读入口写入的标记；标记缺失（测试/独立渲染）时退回 UA 判定，绝不返回空值。 */
export function readRendererPlatform(): RendererPlatform {
  const marked = typeof document === 'undefined' ? undefined : document.documentElement.dataset.platform
  return marked === 'win32' || marked === 'darwin' || marked === 'linux' ? marked : detectRendererPlatform()
}

/** 写入平台标记（入口唯一调用点）；返回写入值，便于启动期诊断与测试断言。 */
export function markRendererPlatform(): RendererPlatform {
  const platform = detectRendererPlatform()
  document.documentElement.dataset.platform = platform
  return platform
}
