import type { WorkspacePageRegistration } from '@platform/workspace/contracts'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-41**；按 PLAT-30 行数纪律从 `tabWorkspaceIpcHandlers` 抽出）。
 *
 * 页窗建窗时的**标题计划**：`title` 由 Main 按当前宿主语言解析（此前恒取 en-US），`allowedTitles` 是
 * `page-title-updated` 的受控白名单（两种语言的页面名 + pageId 兜底）。
 *
 * 白名单语义（与工厂的收口配套）：
 *  - 白名单内 ⇒ 允许渲染侧跟随语言（PLAT-10/28 不回退）；
 *  - 白名单外（入口 HTML 的**应用名**、任意篡改）⇒ 工厂 `preventDefault()` 并强制回主标题；
 *  - 缺省 `[title]`（工厂侧）⇒ 不传白名单的调用方语义是「标题只认主标题」，绝不放宽。
 */
export type TabDetachedTitlePlan = {
  title: string
  allowedTitles: readonly string[]
}

export async function planTabDetachedTitle(input: {
  registration: WorkspacePageRegistration
  /** 注册信息没有本地化标题时的兜底（store 的权威 pageId）。 */
  fallbackPageId: string
  /** 与 `getHostContext` 同源的受控语言读取；缺省回落到注册信息的 en-US（既有语义）。 */
  resolveTitle?: (registration: WorkspacePageRegistration) => string | Promise<string>
}): Promise<TabDetachedTitlePlan> {
  const resolved = await input.resolveTitle?.(input.registration)
  const title = resolved !== undefined && resolved !== ''
    ? resolved
    : (input.registration.title === undefined ? input.fallbackPageId : input.registration.title['en-US'])
  const allowedTitles = [...new Set([
    title,
    input.fallbackPageId,
    ...(input.registration.title === undefined
      ? []
      : [input.registration.title['zh-CN'], input.registration.title['en-US']])
  ])].filter((entry) => entry.length > 0)
  return Object.freeze({ title, allowedTitles: Object.freeze(allowedTitles) })
}
