/**
 * 跨页导航的唯一入口（契约 §14，R87）。
 *
 * 不新建导航系统：壳层早就有 `app-shell:navigate` 事件（监听在 `AppShell`），`openModelServiceSettings`
 * 是它的第一个包装。这里做的是**把那条既有缝收成一个公共函数**——产品模块也能用，而 `apps/*`
 * 不给产品 import。
 */

export const APP_NAVIGATE_EVENT = 'app-shell:navigate'

/**
 * 目的地是闭集：三个内置页 + 「设置里的某个面板」。
 *
 * `panel` 保持 `string`：面板由产品在运行时注册（`resolveAvailableSettingsPanelKey` 动态解析），
 * 平台枚举不出来。这是唯一允许的开区间，理由是对应运行时注册表，不是文案。
 */
export type NavigationRequest =
  | { page: 'assistants' }
  | { page: 'agents' }
  | { page: 'settings'; panel: string }

/** 唯一入口：任何「去设置里启用 / 去某页」都调它，不许各自 `dispatchEvent`。 */
export function navigateTo(request: NavigationRequest): void {
  const detail =
    request.page === 'settings'
      ? { navKey: request.page, settingsPanelKey: request.panel }
      : { navKey: request.page }
  window.dispatchEvent(new CustomEvent(APP_NAVIGATE_EVENT, { detail }))
}

/**
 * 导航后的焦点交接（契约 §14）：按钮所在的空态随即被卸载，焦点会掉回 `body`，读屏一声不响，
 * 而「点了有反应」还会被当成通过。
 *
 * 顺序固定三条：`[data-nav-focus]` → 目标容器里第一个 `h1–h3` → 容器自身；后两者给
 * `tabIndex={-1}`（只作落点，不进 Tab 序列）。**不造只给读屏听的隐藏标题**，也**不用 `aria-live`**
 * 播页面名——那是每跳一次念一遍的噪音。
 */
export function handoffFocusAfterNavigation(container: HTMLElement | null): HTMLElement | null {
  if (container === null) return null

  const marked = container.querySelector<HTMLElement>('[data-nav-focus]')
  if (marked !== null) {
    marked.focus()
    return marked
  }

  const heading = container.querySelector<HTMLElement>('h1, h2, h3')
  const target = heading ?? container
  if (target.tabIndex < 0) target.tabIndex = -1
  target.focus()
  return target
}
