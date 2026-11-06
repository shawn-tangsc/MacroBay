/**
 * Owner: apps/desktop-shell renderer / shell/navigation。
 * 权威：`docs-private/10-development/home-menu-contract.md`（用户 2026-11-06 选口径 A）。
 *
 * 「打开应用先落在哪一页」此前是壳层里一个写死的常量（`AppShell.tsx` 的 `useState('assistants')`）；
 * 现在由菜单注册自己声明（`home?: true`）。它**只在没有可恢复的活动页**（首次打开 / 布局被重置）时
 * 被问到——有历史时一律沿用上次那一页，这是口径 A 的另一半，不能拿默认首页把它换掉。
 *
 * 本模块只做「菜单 → 菜单键」这一件事，不碰 shell 状态：需要起应用才能验的东西，换成一条纯函数用例。
 */

/** 解析首次落点只需要三样：菜单键、排序、是否声明过 `home`。内置页与产品页用同一个形状。 */
export interface HomeMenuCandidate {
  /** 页注册里的稳定菜单键（内置页 = pageId；产品页 = 产品路由路径）。 */
  menuKey: string
  /**
   * 菜单排序值。内置页没有这个字段，所以它**不参与**「order 第一项」的兜底；
   * order 只决定排序，home 只决定首次打开哪一页，两个字段各管一件事。
   */
  order?: number
  /** 声明「我是首页」。未声明时字段不存在，不是 `false`。 */
  home?: true
}

/**
 * 产品菜单项的候选投影：产品的菜单键就是它的 `routePath`（同 `mergeShellNavItems` 与 shell 页注册）。
 * 放在这里是为了让「routePath 就是菜单键」这件事只有一个解释点，调用方不必各自再翻译一遍。
 */
export function toProductHomeMenuCandidate(entry: {
  routePath: string
  order: number
  home?: true
}): HomeMenuCandidate {
  return entry.home === true
    ? { menuKey: entry.routePath, order: entry.order, home: true }
    : { menuKey: entry.routePath, order: entry.order }
}

/**
 * 首次落点的唯一解析实现。优先序见契约 §4：
 *   声明了 `home` 的那一页 → 菜单里 `order` 最小的一页 → `null`（一页都没有）。
 *
 * 返回 `null` 的语义是「菜单里一页都没有」，**不是**「落到某处」：把它映射成最后的兜底常量是壳层那一句
 * 落点的事。两层分开，用例才能断在「输入 → null」这一层；只断「最终等于某个常量」的用例，一个永远返回
 * 该常量的实现也能过，而那个实现会让声明的首页形同不存在。
 *
 * 两处以上声明是**错误状态**（`platform/product-registry/homeMenuDeclaration.test.ts` 会红）。这里仍给出
 * 确定结果（按菜单顺序取第一个）：解析器不该在运行期替守卫做判断，但也不能给出随机答案。
 */
export function resolveHomeMenuKey(
  builtInEntries: readonly HomeMenuCandidate[],
  productMenuEntries: readonly HomeMenuCandidate[]
): string | null {
  const productsByOrder = [...productMenuEntries].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
  const declared = [...builtInEntries, ...productsByOrder].find((entry) => entry.home === true)
  if (declared !== undefined) return declared.menuKey
  return productsByOrder.find((entry) => entry.order !== undefined)?.menuKey ?? null
}
