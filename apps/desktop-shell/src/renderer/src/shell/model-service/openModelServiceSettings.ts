/**
 * 「配置自定义模型」的唯一跳转口：只去 设置 → 模型服务，不定位厂商、不带参数。
 *
 * 事件契约来自 AppShell 的 `app-shell:navigate`（`{ navKey, settingsPanelKey }`）。
 * 任何"去配置模型服务"的入口都必须调用这里，不要各自 `dispatchEvent`。
 */
export const MODEL_SERVICE_NAVIGATION_EVENT = 'app-shell:navigate'

export type ModelServiceNavigationDetail = {
  navKey: 'settings'
  settingsPanelKey: 'models'
}

export function openModelServiceSettings(): void {
  window.dispatchEvent(
    new CustomEvent<ModelServiceNavigationDetail>(MODEL_SERVICE_NAVIGATION_EVENT, {
      detail: { navKey: 'settings', settingsPanelKey: 'models' }
    })
  )
}
