import { useEffect, useState } from 'react'

import { sourceUnavailableSentence } from '../../shared/i18n/sourceUnavailableCopy'
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
export function useDrawerSourcesView(
  active: boolean,
  /** 兜底那句「取不到（原因见详情）」由调用方按语言给。 */
  unavailableFallback: string
): DrawerSourcesView | undefined {
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
          // 供应商名：列表按它分组（同一页里 30 多个源，不分组就是一堵名字墙）。
          groupName: provider.displayName,
          // 正文只给人话：原因码走映射表，表里没有就兜底，**绝不把码漏出来**。
          statusLabel: source.unavailable
            ? // 第三个参数是 kind：官方日历 / 市场日历 / 其它各说各的话，
            // 不传会退到「这个来源…」，BLS 在抽屉里就和详情不是同一句。
            sourceUnavailableSentence(source.unavailable.reasonCode, unavailableFallback, source.kind)
            : undefined,
          enabled: source.enabled,
          // 投影给什么画什么；拿不到就是 none，不猜健康也不猜故障。
          healthMarker: source.healthMarker
        }))))
        setView({ state: 'ready', rows })
      })
      .catch(() => { if (alive) setView({ state: 'error', onRetry: () => setView({ state: 'loading' }) }) })
    return () => { alive = false }
  }, [active, unavailableFallback])

  return view
}
