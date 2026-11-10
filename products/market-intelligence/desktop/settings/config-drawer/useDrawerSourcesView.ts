import { useEffect, useState } from 'react'

import { intelligenceSourcesClient } from '../../shared/ipc/intelligenceSourcesClient'

import type { DrawerSourcesView } from './drawerScreenView'

/**
 * 来源与采集屏的源列表：走 `getSettingsView()`——**配置面要的是全部源**。
 *
 * 为什么不用 `getPanelView(panelId)`：那个只有 `dashboard` / `economic-calendar` 两个面板，
 * 拿面板视图喂配置抽屉，等于让「只给日历」和「哪都不给」的源在配置面里直接消失——
 * 读者会以为没有这个源。配置面少一个源，比多一行更糟。
 *
 * 与平台那屏同一个分工：hook 在抽屉目录**之外**，由宿主使用；抽屉只渲染传进去的列表。
 */
export function useDrawerSourcesView(active: boolean): DrawerSourcesView | undefined {
  const [view, setView] = useState<DrawerSourcesView>()

  useEffect(() => {
    if (!active) return
    let alive = true
    setView({ state: 'loading' })
    void intelligenceSourcesClient.getSettingsView()
      .then((settings) => {
        if (!alive) return
        // 分组是「品类 → 供应商 → 源」三层：配置面要的是**全部**源，所以两层都展开。
        const rows = settings.groups.flatMap((group) => group.providers.flatMap((provider) => provider.sources.map((source) => ({
          sourceId: source.sourceId,
          name: source.displayName,
          statusLabel: source.unavailable ? source.unavailable.reasonCode : undefined,
          enabled: source.enabled
        }))))
        setView({ state: 'ready', rows })
      })
      .catch(() => { if (alive) setView({ state: 'error', onRetry: () => setView({ state: 'loading' }) }) })
    return () => { alive = false }
  }, [active])

  return view
}
