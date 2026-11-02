import { useEffect, useRef, useState } from 'react'

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
 * - 挂载时用 `get-state` 补一次初值，之后**只订阅事件**，不轮询；
 * - 点进关于页**不会让它消失**，下次确认「已是最新」才灭；
 * - 不做动画、不做闪烁——它是提示，不是警报。
 *
 * 两点实现细节，都是被真机退回来的：
 * 1. 用 `<i>` 不用 `<span>`——侧栏有一条 `.nav-item span { display: none }`（本意藏导航文字），
 *    用 span 会被它一起藏掉，元素在 DOM 里、屏幕上却没有（「看着有、其实没有」）。
 * 2. **读屏信息挂在导航按钮的可读名上**，小点自己 `aria-hidden`：它只是视觉装饰，
 *    单独念出来反而多一条没有动作的朗读。
 */
export function SettingsUpdateDot(props: {
  language: AppLanguage
  client?: UpdateCheckClient
}): React.ReactElement | null {
  const [projection, setProjection] = useState<UpdateCheckProjection | null>(null)
  const dotRef = useRef<HTMLElement | null>(null)
  const visible = shouldShowUpdateDot(projection)

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

  // 信息挂在导航按钮上：读屏念「设置，有新版本可用」。卸载时还原，别把标签留在别人身上。
  useEffect(() => {
    const button = dotRef.current?.parentElement
    if (button === null || button === undefined) return
    if (!visible) return
    const previous = button.getAttribute('aria-label')
    button.setAttribute('aria-label', platformText[props.language].about.settingsWithUpdate)
    return () => {
      if (previous === null) button.removeAttribute('aria-label')
      else button.setAttribute('aria-label', previous)
    }
  }, [props.language, visible])

  if (!visible) return null

  return <i className="settings-update-dot" data-update-dot aria-hidden="true" ref={dotRef} />
}
