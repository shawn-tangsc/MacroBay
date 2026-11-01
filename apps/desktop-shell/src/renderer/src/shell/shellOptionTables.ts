import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { Moon, Palette, Sun } from 'lucide-react'

import type { AppLanguage, ProxyMode, ThemeMode } from '@platform/settings/schema/appSettings'

/**
 * 壳层的选项表与 antd 语言包映射（从 `AppShell.tsx` 抽出）。
 *
 * 这三张表是**纯数据**：语言、主题、代理方式的取值与显示键，加上「语言 → antd 语言包」的映射。
 * 它们住在 `AppShell` 里的唯一后果是那个接缝文件每加一个选项就长一行——接缝只该有装配，
 * 不该有选项表。抽出来之后，加一种主题或一种代理方式不再动 `AppShell`。
 *
 * `resolveAntDesignLocale` 仍从 `AppShell` 转出：它是既有的公开路径，测试也在用，
 * 搬家不改变引用位置。
 */

export const languageOptions: Array<{ value: AppLanguage; labelKey: 'chinese' | 'english' }> = [
  { value: 'zh-CN', labelKey: 'chinese' },
  { value: 'en-US', labelKey: 'english' }
]

export const themeOptions: Array<{ value: ThemeMode; labelKey: 'system' | 'light' | 'dark'; icon: typeof Sun }> = [
  { value: 'system', labelKey: 'system', icon: Palette },
  { value: 'light', labelKey: 'light', icon: Sun },
  { value: 'dark', labelKey: 'dark', icon: Moon }
]

export const proxyModeOptions: Array<{ value: ProxyMode; labelKey: 'proxySystem' | 'proxyCustom' | 'proxyNone' }> = [
  { value: 'system', labelKey: 'proxySystem' },
  { value: 'custom', labelKey: 'proxyCustom' },
  { value: 'none', labelKey: 'proxyNone' }
]

const antDesignLocalePolicy = {
  'zh-CN': zhCN,
  'en-US': enUS
} as const

export function resolveAntDesignLocale(language: AppLanguage) {
  return antDesignLocalePolicy[language]
}
