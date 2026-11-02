import { useEffect, useState } from 'react'

import { platformText } from '../../i18n/platformText'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { shouldShowUpdateDot } from '../settings/version/versionCheckViewModel'
import { platformUpdateCheckClient, type UpdateCheckClient } from '../settings/version/updateCheckClient'

/**
 * 侧栏「设置」上的小点：**有新版才亮**。
 *
 * 四条判据都在这里，结构上防住：
 * - 亮灭只由**主进程的结论**决定（`shouldShowUpdateDot` 只看 `state`），壳层不重算版本号；
 * - 挂载时用 `get-state` 补一次初值（补上挂载之前已经发生的那次），之后**只订阅事件**，不轮询；
 * - 点进关于页**不会让它消失**（点击不改投影）；下次确认「已是最新」才灭；
 * - 不做动画、不做闪烁——它是提示，不是警报。
 *
 * 组件自带订阅与退订，`AppShell` 只加一行 import + 一行 JSX（那里只剩几行额度）。
 */
export function SettingsUpdateDot(props: {
  language: AppLanguage
  client?: UpdateCheckClient
}): React.ReactElement | null {
  const [projection, setProjection] = useState<UpdateCheckProjection | null>(null)

  useEffect(() => {
    const client = props.client ?? platformUpdateCheckClient
    let alive = true
    void client
      .getState()
      .then((next) => {
        if (alive) setProjection(next)
      })
      .catch(() => {
        // 读不到就不亮：小点绝不拿失败当「有新版本」。
      })
    const unsubscribe = client.onChanged((next) => {
      if (alive) setProjection(next)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [props.client])

  if (!shouldShowUpdateDot(projection)) return null

  return (
    <span
      className="settings-update-dot"
      data-update-dot
      role="status"
      aria-label={platformText[props.language].about.settingsWithUpdate}
    />
  )
}
