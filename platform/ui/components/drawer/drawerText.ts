import { useCallback } from 'react'

import type { AppLanguage } from '../../../settings/schema/appSettings'
import { useShellLanguage } from '../../shell/ShellLanguageContext'

/**
 * 抽屉自己的文案表，就一句：关闭键的读屏名。
 *
 * 为什么放在组件旁边而不在 `apps/desktop-shell` 的 `platformText.ts`：句子归 `platform/ui`。
 * 产品和组件要一句文案却得去 app 层借解析函数，借不到就自己抄一份键表——`ui.state.*` 搬家
 * 就是这么发生的。抽屉照同一个结构。
 *
 * 为什么关闭键**不走**调用方的 `resolveText`：`ui.state.*` 那种「未知键返回空串」的策略用在
 * 一句话的补充说明上是对的（缺键宁可不念，也别念出键名）；但关闭键是这个按钮**唯一的名字**，
 * 解析成空串就是一个没有名字的按钮。所以它是表里的常量，只由本文件决定。
 */

export const DRAWER_CLOSE_KEY = 'ui.drawer.close' as const

type DrawerTextKey = typeof DRAWER_CLOSE_KEY

const ZH_CN: Record<DrawerTextKey, string> = { 'ui.drawer.close': '关闭抽屉' }
const EN_US: Record<DrawerTextKey, string> = { 'ui.drawer.close': 'Close drawer' }

const COPY: Record<AppLanguage, Record<DrawerTextKey, string>> = { 'zh-CN': ZH_CN, 'en-US': EN_US }

/** 纯函数：给定语言返回关闭键的读屏名。兜底取中文，不会返回空串。 */
export function resolveDrawerText(language: AppLanguage, key: DrawerTextKey = DRAWER_CLOSE_KEY): string {
  return COPY[language]?.[key] ?? ZH_CN[DRAWER_CLOSE_KEY]
}

/** 组件自己用的入口：语言取自壳层，调用方不传、也不许覆盖。 */
export function useDrawerText(): (key?: DrawerTextKey) => string {
  const language = useShellLanguage()
  return useCallback((key: DrawerTextKey = DRAWER_CLOSE_KEY) => resolveDrawerText(language, key), [language])
}
