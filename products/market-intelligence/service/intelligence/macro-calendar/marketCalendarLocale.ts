import type { AppLanguage } from '@platform/settings/schema/appSettings'

/**
 * 应用语言（`zh-CN` / `en-US`）→ 市场日历查询契约的两字母 locale（`zh` / `en`）。
 *
 * **这是唯一映射处**：`MarketCalendarQuery.locale` 只收 `'zh' | 'en'`
 * （`contracts/macro/marketCalendarQueryContracts.ts` 的 `scope()`），把应用语言直接传进去会被判成
 * 非法输入（`input-invalid`），然后在读者侧被显示成「读不到」——那是我们自己的 bug 伪装成读者的
 * 读取失败。所有要两字母契约的调用点都用这个函数，不要再各写一个三元。
 */
export type MarketCalendarLocale = 'zh' | 'en'

export function marketCalendarLocale(language: AppLanguage): MarketCalendarLocale {
  return language === 'en-US' ? 'en' : 'zh'
}
