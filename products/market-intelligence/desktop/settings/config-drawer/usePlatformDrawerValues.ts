import { useEffect, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { isModelServiceConfigured } from '@platform/ai/providers/modelServiceReadiness'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import type { DrawerPlatformValues } from './drawerScreenView'

/**
 * 平台与模型那一屏的**只读值**：读现成的平台设置，不新造 IPC、不写任何东西。
 *
 * 读不到就保持空——抽屉那边会把「缺键」显示成「读不到」，**不会画成「未设置」**。
 * 这一条很关键：把「没读到」画成「没设置」，读者会去改一个其实已经好的设置。
 *
 * 不放在抽屉目录里：抽屉不许 import 数据层（那条守卫还在），这里由**宿主**用它、再传进去。
 */
export function usePlatformDrawerValues(): DrawerPlatformValues {
  const language = useShellLanguage()
  const [values, setValues] = useState<DrawerPlatformValues>({})

  useEffect(() => {
    let active = true
    void (async () => {
      // 两份读数各自成败：设置读不到仍可给「模型服务」那一档，反之亦然；
      // 哪一份没读到，就把那一档留空（抽屉画「读不到」，不画「未设置」）。
      const [settingsResult, providersResult] = await Promise.allSettled([
        window.platform?.settings?.get(),
        window.platform?.modelProviders?.list()
      ])
      if (!active) return
      const raw = settingsResult.status === 'fulfilled'
        ? (settingsResult.value as Record<string, unknown> | undefined)
        : undefined
      const providers = providersResult.status === 'fulfilled'
        ? (providersResult.value as readonly SafeModelProvider[] | undefined)
        : undefined
      setValues({
        ...(raw === undefined ? {} : readPlatformValues(raw)),
        ...(providers === undefined ? {} : { modelService: modelServiceValue(providers, language) })
      })
    })()
    return () => {
      active = false
    }
  }, [language])

  return values
}

/**
 * 「模型服务」那一行只给一档事实：**已配置 / 未配置**。
 *
 * 判据是 `isModelServiceConfigured`（供应商三件齐，与 `resolveChatModel` 同一函数），
 * 这里只负责把它翻成读者语言；不显示是哪个供应商、也不显示任何 key。
 * 供应商列表读不到时**不调用**本函数——那种情况是「读不到」，不是「未配置」。
 */
export function modelServiceValue(
  providers: readonly SafeModelProvider[],
  language: 'zh-CN' | 'en-US'
): string {
  const text = productText[language].pages.intelligence.portal.dashboard.configDrawer.values
  return isModelServiceConfigured(providers) ? text.modelServiceConfigured : text.modelServiceUnconfigured
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/** 只取五个已知字段；形状不认识就是 `undefined`（= 读不到），绝不猜。 */
function readPlatformValues(raw: Record<string, unknown>): DrawerPlatformValues {
  const preferences = (raw.preferences ?? {}) as Record<string, unknown>
  const proxy = (raw.proxy ?? {}) as Record<string, unknown>
  return {
    timeZone: text(preferences.timeZone),
    language: text(preferences.language),
    theme: text(preferences.displayStyle) ?? text(preferences.theme),
    proxy: text(proxy.mode),
    // 「模型服务」不在这一份设置快照里：由 `modelServiceValue` 从供应商读数单独算
    // （见上面的 hook），这里不编一个值。
  }
}
