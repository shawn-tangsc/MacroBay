import { useEffect, useState } from 'react'

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
  const [values, setValues] = useState<DrawerPlatformValues>({})

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const raw = (await window.platform?.settings?.get()) as Record<string, unknown> | undefined
        if (!active || raw === undefined) return
        setValues(readPlatformValues(raw))
      } catch {
        // 读失败：留空 → 抽屉显示「读不到」。不写「未设置」。
      }
    })()
    return () => {
      active = false
    }
  }, [])

  return values
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
    // 模型服务页的「是否配置」还没有在渲染层暴露成单一视图：留空 → 显示「读不到」，
    // 不编一个模型名。
    modelService: undefined
  }
}
