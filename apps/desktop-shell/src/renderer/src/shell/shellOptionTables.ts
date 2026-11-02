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

/**
 * 两个偏好分段的**键**与**键→句子解析**。
 *
 * 键写成一枚举一张表（`Record<AppLanguage, string>` / `Record<ThemeMode, string>`），
 * 不用模板串：模板串拼出来的键静态校验不到形状，`choiceKeyGuard` 只判得动字面量；
 * 而查表还让「加一种语言／主题」在编译期就红——两层都保住了。
 *
 * 住在选项表旁边，是因为它们属于同一件事：**一张表管取值，一张表管这个取值怎么说**。
 */
export const LANGUAGE_SEGMENTED_KEY = 'preferences.language'
export const THEME_SEGMENTED_KEY = 'preferences.displayStyle'

export const LANGUAGE_LABEL_KEYS: Record<AppLanguage, string> = {
  'zh-CN': 'preferences.chinese',
  'en-US': 'preferences.english'
}

export const THEME_LABEL_KEYS: Record<ThemeMode, string> = {
  system: 'preferences.system',
  light: 'preferences.light',
  dark: 'preferences.dark'
}

/**
 * 键 → 句子：分段只用 `preferences.*` 这几句；未知键返回空串，组件据此整块不渲染，
 * 不会把键名念给读者（与平台其余解析器同口径）。句子来源仍是 `platformText`，这里只做匹配。
 */
export function resolvePreferencesText(
  labels: Readonly<Record<string, unknown>>,
  key: string
): string {
  const path = key.startsWith('preferences.') ? key.slice('preferences.'.length) : key
  const value = labels[path]
  return typeof value === 'string' ? value : ''
}

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
