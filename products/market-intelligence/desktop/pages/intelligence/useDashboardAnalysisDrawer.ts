import { useCallback } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { marketAnalysisTimelineClient } from '../../shared/ipc/marketAnalysisTimelineClient'
import type { DrawerRowView, DrawerScreenView } from '../../settings/config-drawer/drawerScreenView'
import {
  drawerAnalysisFactsFrom,
  useDrawerAnalysisView,
  type DrawerAnalysisFacts,
  type DrawerSettingsTarget
} from './useDrawerAnalysisView'

/**
 * 配置抽屉「AI 分析」屏的**宿主侧读**：把两处现成的事实拼成那一屏要的东西。
 *
 * 界面设计 2026-11-10 定的口径（Chief 转达）：内联**只读 + 跳转**，不给保存按钮——那个
 * 「草稿 + 保存/取消」的模态搬进来就是第二个写入口。要改就去原对话框改。
 *
 * 读的两样都是现成的：`marketAnalysisTimelineClient.getSettings()`（开关、选了哪个模型）与
 * 平台模型清单（把 `providerId:modelId` 翻成人话）。**读失败必须抛**：客户端的 `getSettings`
 * 把失败收成 `undefined`，如果这里当成「没配置」，就会把「读不到」画成「关」。
 */
export function useDashboardAnalysisDrawer(
  active: boolean,
  onOpenSettings: (target: DrawerSettingsTarget) => void
): DrawerScreenView<DrawerRowView> | undefined {
  const read = useCallback(async (): Promise<DrawerAnalysisFacts> => {
    const settings = await marketAnalysisTimelineClient.getSettings()
    if (settings === undefined) throw new Error('market analysis settings unreadable')
    const providers = await window.platform?.modelProviders?.list() as SafeModelProvider[] | undefined
    return drawerAnalysisFactsFrom({ settings, providers: providers ?? [] })
  }, [])
  return useDrawerAnalysisView(active, read, onOpenSettings)
}
