import type { ProductSettingsNavIntent } from '@platform/product-manifest'
import { navigateTo } from '@platform/workspace/navigation/navigationRequest'
import { productSettingsEntries } from '@products/generated/shellRegistry'

/**
 * 「去某个产品的设置页」的唯一入口（R87）。
 *
 * 事件契约（照 `openModelServiceSettings` 的形态写死）：`app-shell:navigate`，detail 恒为
 * `{ navKey: 'settings', settingsPanelKey: <产品面板 id> }`。`AppShell` 收到后先过
 * `resolveAvailableSettingsPanelKey`：**面板没注册就静默回落到默认面板（models）**——那正是
 * 「点了落到别的页」的来源，所以这里的键不是随便一个字符串。
 *
 * 键是**本构建生成注册表里的字面量联合**：产品没装，那个 id 就不在联合里，调用点编译不过，
 * 不会出现「按钮在、页面不在了」。
 */
export type ProductSettingsPanelKey = (typeof productSettingsEntries)[number]['id']

/**
 * 注册表上一页设置里**壳层要读的那几个字段**（生成物里 `navIntent` 是可选字段：没声明的页没有这个键）。
 *
 * 只声明这一层需要的形状，不在壳层复述产品面板的全部字段——那会让「壳层知道产品什么」又长回来。
 */
export type RegisteredSettingsEntry = {
  id: string
  navIntent?: ProductSettingsNavIntent
}

/**
 * 按**业务意图**挑页面的纯函数：给定一份注册表，回答「哪一页承担这个意图」。
 *
 * 为什么按意图而不是写死面板 id：写死的表就是壳层对某个具体产品的点名——删掉那个产品包之后，
 * 壳里还留着一个指向不存在页面的按钮（`AppShell` 会把它静默落到默认面板，用户以为点错了页）。
 * 现在意图由产品在自己的设置分区上声明（`ProductSettingsNavIntent`），壳层按意图查：
 * **查不到就返回 `undefined`**，由调用方决定不出这个入口——不是回落到默认面板。
 */
export function resolveSettingsPanelForIntent(
  intent: ProductSettingsNavIntent,
  entries: readonly RegisteredSettingsEntry[]
): string | undefined {
  return entries.find((entry) => entry.navIntent === intent)?.id
}

/** 本构建的注册表上，承担某个意图的面板 id；没有就是 `undefined`。 */
export function findProductSettingsPanelByIntent(
  intent: ProductSettingsNavIntent
): ProductSettingsPanelKey | undefined {
  return resolveSettingsPanelForIntent(intent, productSettingsEntries) as ProductSettingsPanelKey | undefined
}

/**
 * 带用户去「承担某个业务意图」的设置页。
 *
 * @returns 真的发出导航 → `true`；本构建没有任何页承担这个意图 → `false`（**没有发事件**）。
 *   调用方据此决定出不出入口：返回 `false` 时不要造一个点了没反应的按钮。
 */
export function openProductSettingsPanelByIntent(intent: ProductSettingsNavIntent): boolean {
  const panelKey = findProductSettingsPanelByIntent(intent)
  if (panelKey === undefined) return false
  openProductSettingsPanel(panelKey)
  return true
}

export function openProductSettingsPanel(panelKey: ProductSettingsPanelKey): void {
  // 类型已经关死；这一层是给「绕过类型」的调用点（JS / `as any`）的：**不认识就炸**，
  // 不能让它悄悄回落到默认面板——用户会以为按钮点错了页，而代码里一点痕迹都没有。
  if (!productSettingsEntries.some((entry) => entry.id === panelKey)) {
    throw new Error(`unknown-product-settings-panel:${panelKey}`)
  }
  navigateTo({ page: 'settings', panel: panelKey })
}
