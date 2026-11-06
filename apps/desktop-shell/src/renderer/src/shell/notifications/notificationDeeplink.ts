/**
 * 通知自带的动作要真的把人送到地方（PLAT-73 那一层）：把「设置分区 / 产品页 / 产品一级菜单」
 * 这组规则从 `AppShell` 里搬出来，变成一个纯函数。
 *
 * 为什么值得单独一个文件：这段是**导航规则**，不是装配。放在接缝文件里，每多一种 deeplink
 * 形状就长几行，而接缝恰恰是最不该长的那份文件；做成纯函数后，规则本身能被单测钉住
 * （同一份输入永远落到同一屏），不必启动整个壳去验。
 */

/** 通知里携带的跳转意图。字段来源是主进程的通知载荷，这里只读。 */
export type NotificationDeeplink = Readonly<{
  settingsSectionId?: string
  pageId?: string
  productId?: string
  /** 实体类型：例如任务失败的 `job-definition`。没有它就定位不到那一行。 */
  entityType?: string
  /** 实体 id：任务定义 id。 */
  entityId?: string
}>

/**
 * 产品 id 到一级菜单路由的映射来源。
 *
 * 暂时没有生产者发 `productId`，这一支按验收要求先删掉；保留类型是因为壳层还要把映射传进来，
 * 真有产品级通知时再加回分支并配用例——**没有生产者的跳转分支就是假指路**。
 */
export type ProductMenuEntry = Readonly<{ productId: string; routePath: string }>

/** 一次跳转最终落到哪里；`null` 表示这个 deeplink 没有可去的地方。 */
export type NotificationNavigationTarget = Readonly<{
  navKey?: string
  settingsPanelKey?: string
  /** 落进去之后要定位的那一行（任务定义 id）。 */
  focusEntityId?: string
}>

/**
 * 实体类型到设置分区：**只放真有生产者的那几条**。
 *
 * 任务失败的通知发的是 `entityType: 'job-definition'` + `entityId`（`taskFailureNotifier.ts:44`），
 * 所以它必须落到任务自动化面板并定位到那一行；只落面板不定位，读者还得自己在一张表里找。
 *
 * 分析失败的通知发的是 `entityType: 'analysis-run'` + 分析运行 id：它落到运行日志（排障页），
 * 并按 id 定位到那条记录。这里登记的是**面板 id**，不是旧的分区名（运行日志已经独立成面板）。
 */
const ENTITY_SETTINGS_PANEL: Readonly<Record<string, string>> = {
  'job-definition': 'task-automation',
  'analysis-run': 'intelligence-run-log'
}

/**
 * 产品页的 navKey **不是** manifest 里的 pageId，而是注册表里的 `routePath`
 * （`shellRegistry.ts` 给的是 `/market-intelligence/intelligence`）。
 *
 * 早先这里有一张 `PAGE_ID_TO_MENU_KEY = { 'daily-briefing': 'intelligence' }`：键是真的，
 * 但 `'intelligence'` 不是 navKey，`openTab` 会被主进程按注册表拒掉（`registration-missing`），
 * 而 `activateNavKey` 的 `.catch` 又把它吞成「侧栏高亮变了」——看起来像跳了，其实没开页。
 * 所以映射必须来自**注册表本身**，不能来自手写表。
 */
function routePathOfProduct(
  deeplink: NotificationDeeplink,
  productMenuEntries: readonly ProductMenuEntry[]
): string | null {
  if (deeplink.productId === undefined) return null
  // 恰好一个才跳：同一产品有多个一级菜单页时，「点哪个」是猜，猜错比不跳更糟。
  const candidates = productMenuEntries.filter((entry) => entry.productId === deeplink.productId)
  return candidates.length === 1 ? candidates[0]!.routePath : null
}

/**
 * 优先级是有意的：**登记过的实体 > 设置分区 > 页面 > 产品**。
 *
 * 一条通知最多带一个真跳转，但载荷可能同时带产品 id 与设置分区（例如「某来源连续失败」）：
 * 这时应当落到设置里的那个分区，而不是产品的首页——读者点它是因为有事要处理。
 *
 * **为什么实体能压过分区**（2026-11-06）：分区名会过时。运行日志从情报源页独立成面板之后，
 * 旧的生产者仍写着 `settingsSectionId: 'intelligence-sources'`，而它指的其实是那次分析记录；
 * 实体 id 是页面能真的定位到的那一条，分区只是「大概在哪一屏」。只有**在
 * `ENTITY_SETTINGS_PANEL` 登记过**的实体才享受这个优先级——没登记的实体（例如来源 `source`）
 * 仍然按分区走，所以既有行为不变。
 */
export function resolveNotificationNavigation(
  deeplink: NotificationDeeplink,
  productMenuEntries: readonly ProductMenuEntry[]
): NotificationNavigationTarget | null {
  // 能精确定位到某一行的实体：它自己知道自己该落在哪个面板。
  const panelFromEntity =
    deeplink.entityType === undefined ? undefined : ENTITY_SETTINGS_PANEL[deeplink.entityType]
  if (panelFromEntity !== undefined) {
    return { navKey: 'settings', settingsPanelKey: panelFromEntity, focusEntityId: focusEntityOf(deeplink) }
  }
  if (deeplink.settingsSectionId !== undefined) {
    return {
      navKey: 'settings',
      settingsPanelKey: deeplink.settingsSectionId,
      focusEntityId: focusEntityOf(deeplink)
    }
  }
  if (deeplink.pageId !== undefined) {
    // 页面 id 是产品内部的；壳层只认注册表给的 routePath，认不出就不跳。
    const routePath = routePathOfProduct(deeplink, productMenuEntries)
    return routePath === null ? null : { navKey: routePath }
  }
  return null
}

/** 只有「知道自己要去哪一行」的实体才带定位，避免所有通知都被当成行级跳转。 */
function focusEntityOf(deeplink: NotificationDeeplink): string | undefined {
  if (deeplink.entityId === undefined || deeplink.entityType === undefined) return undefined
  return ENTITY_SETTINGS_PANEL[deeplink.entityType] === undefined ? undefined : deeplink.entityId
}
