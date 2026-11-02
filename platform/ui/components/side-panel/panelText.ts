import { useCallback } from 'react'

import type { AppLanguage } from '../../../settings/schema/appSettings'
import { useShellLanguage } from '../../shell/ShellLanguageContext'

/**
 * 侧面板自己的文案表，就一句：收起键的读屏名。
 *
 * 与 `drawerText` 同一个理由——句子归 `platform/ui`；而收起键是这个按钮**唯一的名字**，
 * 所以不走调用方的 `resolveText`：解析器遇到未知键可能返回空串，空串就是一个没有名字的按钮。
 */

export const PANEL_COLLAPSE_KEY = 'ui.panel.close' as const
/** `stay` 档的播报句：只报「当前显示什么」，不播正文。 */
export const PANEL_SHOWING_KEY = 'ui.panel.showing' as const

type PanelTextKey = typeof PANEL_COLLAPSE_KEY | typeof PANEL_SHOWING_KEY

const ZH_CN: Record<PanelTextKey, string> = {
  'ui.panel.close': '收起面板',
  'ui.panel.showing': '当前显示：{title}'
}
const EN_US: Record<PanelTextKey, string> = {
  'ui.panel.close': 'Collapse panel',
  'ui.panel.showing': 'Showing: {title}'
}

const COPY: Record<AppLanguage, Record<PanelTextKey, string>> = { 'zh-CN': ZH_CN, 'en-US': EN_US }

export function resolvePanelText(language: AppLanguage, key: PanelTextKey = PANEL_COLLAPSE_KEY): string {
  return COPY[language]?.[key] ?? ZH_CN[PANEL_COLLAPSE_KEY]
}

/** 组件自己用的入口：语言取自壳层，调用方不传、也不许覆盖。 */
export function usePanelText(): (key?: PanelTextKey) => string {
  const language = useShellLanguage()
  return useCallback((key: PanelTextKey = PANEL_COLLAPSE_KEY) => resolvePanelText(language, key), [language])
}
