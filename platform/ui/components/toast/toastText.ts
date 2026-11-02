import { useCallback } from 'react'

import type { AppLanguage } from '../../../settings/schema/appSettings'
import { useShellLanguage } from '../../shell/ShellLanguageContext'

/**
 * 提示自己的文案表，就一句：关闭键的读屏名。
 *
 * 与 `drawerText` / `panelText` 同一形状：句子归 `platform/ui`；关闭键是那个按钮**唯一的名字**，
 * 所以不走调用方的 `resolveText`——解析器遇到未知键可能返回空串，空串就是没有名字的按钮。
 */

export const TOAST_CLOSE_KEY = 'ui.toast.close' as const
/** 提示区的可访问名：读屏要靠它知道这一块是什么。 */
export const TOAST_REGION_KEY = 'ui.toast.region' as const

type ToastTextKey = typeof TOAST_CLOSE_KEY | typeof TOAST_REGION_KEY

const ZH_CN: Record<ToastTextKey, string> = { 'ui.toast.close': '关闭提示', 'ui.toast.region': '提示' }
const EN_US: Record<ToastTextKey, string> = { 'ui.toast.close': 'Dismiss', 'ui.toast.region': 'Notifications' }

const COPY: Record<AppLanguage, Record<ToastTextKey, string>> = { 'zh-CN': ZH_CN, 'en-US': EN_US }

export function resolveToastText(language: AppLanguage, key: ToastTextKey = TOAST_CLOSE_KEY): string {
  return COPY[language]?.[key] ?? ZH_CN[TOAST_CLOSE_KEY]
}

/** 组件自己用的入口：语言取自壳层，调用方不传、也不许覆盖。 */
export function useToastText(): (key?: ToastTextKey) => string {
  const language = useShellLanguage()
  return useCallback((key: ToastTextKey = TOAST_CLOSE_KEY) => resolveToastText(language, key), [language])
}
