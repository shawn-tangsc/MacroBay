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
 */
const ENTITY_SETTINGS_PANEL: Readonly<Record<string, string>> = {
  'job-definition': 'task-automation'
}

/**
 * 通知里的 `pageId` → 壳层真能打开的那个页面。
 *
 * **日报不是独立页**：产品登记的页 id 是 `intelligence`，日报是那页里的一个子视图
 * （`activeView === 'briefing'`，状态在产品页内部）。只按 `pageId: 'daily-briefing'` 去
 * `openTab` 会落到一个不存在的页，所以这里映射到 `intelligence` 这个真页。
 *
 * 差的那半步要说清：**切到「日报」子视图今天没有跨模块入口**——那个 `activeView` 是产品页
 * 自己的状态，只能由它接受一个外部「显示哪一屏」的请求，那属于产品页与导航契约那一侧。
 * 在这里假造一个不存在的 pageId，比只打开产品页更糟：前者是假指路，后者至少到了对的产品。
 */
const PAGE_ID_TO_MENU_KEY: Readonly<Record<string, string>> = {
  'daily-briefing': 'intelligence'
}

/**
 * 优先级是有意的：**设置分区 > 页面 > 产品**。
 *
 * 一条通知最多带一个真跳转，但载荷可能同时带产品 id 与设置分区（例如「某来源连续失败」）：
 * 这时应当落到设置里的那个分区，而不是产品的首页——读者点它是因为有事要处理。
 */
export function resolveNotificationNavigation(
  deeplink: NotificationDeeplink,
  productMenuEntries: readonly ProductMenuEntry[]
): NotificationNavigationTarget | null {
  if (deeplink.settingsSectionId !== undefined) {
    return {
      navKey: 'settings',
      settingsPanelKey: deeplink.settingsSectionId,
      focusEntityId: focusEntityOf(deeplink)
    }
  }
  // 没有显式分区、但带了能认出来的实体：按实体找到自己的面板。
  const panelFromEntity =
    deeplink.entityType === undefined ? undefined : ENTITY_SETTINGS_PANEL[deeplink.entityType]
  if (panelFromEntity !== undefined) {
    return { navKey: 'settings', settingsPanelKey: panelFromEntity, focusEntityId: focusEntityOf(deeplink) }
  }
  if (deeplink.pageId !== undefined) {
    const menuKey = PAGE_ID_TO_MENU_KEY[deeplink.pageId]
    if (menuKey !== undefined) return { navKey: menuKey }
    return null
  }
  // `productId` 这一支今天仍然没有生产者：留着等于提前写一条走不通的指路。
  void productMenuEntries
  return null
}

/** 只有「知道自己要去哪一行」的实体才带定位，避免所有通知都被当成行级跳转。 */
function focusEntityOf(deeplink: NotificationDeeplink): string | undefined {
  if (deeplink.entityId === undefined || deeplink.entityType === undefined) return undefined
  return ENTITY_SETTINGS_PANEL[deeplink.entityType] === undefined ? undefined : deeplink.entityId
}
