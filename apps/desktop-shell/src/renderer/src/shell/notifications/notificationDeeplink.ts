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
}>

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
    return { navKey: 'settings', settingsPanelKey: deeplink.settingsSectionId }
  }
  // `pageId` / `productId` 两支今天没有任何生产者（唯一来源是任务失败的
  // `settingsSectionId: 'task-automation'`）。留着等于提前写一条走不通的指路，
  // 验收会当假指路退回；等真有通知发这两种载荷时再加回来，并配一条端到端用例。
  void productMenuEntries
  return null
}
