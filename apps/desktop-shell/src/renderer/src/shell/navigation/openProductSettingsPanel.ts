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
 * 不会出现「按钮在、页面不在了」。值与注册表同生共死由 `PRODUCT_SETTINGS_PANELS` 的
 * `satisfies` 保证；面板 id 的字面量只写在那张表里，调用点一律用表里的名字。
 */
export type ProductSettingsPanelKey = (typeof productSettingsEntries)[number]['id']

/**
 * 壳层已知的产品设置面板。**新增一个 = 先确认产品真的把面板注册进 `productSettingsEntries`**，
 * 否则这里能编过、界面上却回落到模型服务——那是最难看出来的一种假可用。
 */
export const PRODUCT_SETTINGS_PANELS = {
  /** 情报源：任务自动化的资源任务「去启用/去配置来源」落在这一页。 */
  marketIntelligenceSources: 'market-intelligence.intelligence-sources'
} as const satisfies Readonly<Record<string, ProductSettingsPanelKey>>

export function openProductSettingsPanel(panelKey: ProductSettingsPanelKey): void {
  // 类型已经关死；这一层是给「绕过类型」的调用点（JS / `as any`）的：**不认识就炸**，
  // 不能让它悄悄回落到默认面板——用户会以为按钮点错了页，而代码里一点痕迹都没有。
  if (!productSettingsEntries.some((entry) => entry.id === panelKey)) {
    throw new Error(`unknown-product-settings-panel:${panelKey}`)
  }
  navigateTo({ page: 'settings', panel: panelKey })
}
