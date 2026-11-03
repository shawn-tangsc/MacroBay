import { useEffect, useRef, useState } from 'react'
import { Download, TriangleAlert } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'
import { IconButton } from '@platform/ui/components/icon-button'

import { platformText } from '../../i18n/platformText'
import { shouldShowUpdateDot } from '../settings/version/versionCheckViewModel'
import { platformUpdateCheckClient, type UpdateCheckClient } from '../settings/version/updateCheckClient'

/**
 * 顶栏「有更新」动作按钮，挨着铃铛放。
 *
 * 边界（和文档同一套，写在代码里）：
 * - **它是动作，不是状态**：出现本身就是信号，所以**不画小点**——再配个点，铃铛角标旁边又是两个点；
 * - 出现条件 = 投影 `available`，复用 `shouldShowUpdateDot` 那一条判据，**不另写一份**；
 * - 点击只做一件事：`openUpdateLink('download')`——**不导航、不切页面**；点完**不消失**
 *   （结论还是「有新版本」，没装成还能再点，再点就是重试）；
 * - 失败态：图标换警示三角、`--warning` 着色、**4 秒**后回下载图标；**可读名全程不变**
 *   （它做的事没变），变化用视觉隐藏的 `role="status"` 播报一次；
 * - 它**不属于通知**：名字、目录、可读名里都没有「通知 / 铃铛」。
 */
export function UpdateActionButton(props: {
  language: AppLanguage
  client?: UpdateCheckClient
}): React.ReactElement | null {
  const [projection, setProjection] = useState<UpdateCheckProjection | null>(null)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visible = shouldShowUpdateDot(projection)
  const text = platformText[props.language].about.action

  useEffect(() => {
    const client = props.client ?? platformUpdateCheckClient
    let alive = true
    void client
      .getState()
      .then((next) => {
        if (alive) setProjection(next)
      })
      .catch(() => undefined)
    const unsubscribe = client.onChanged((next) => {
      if (alive) setProjection(next)
    })
    return () => {
      alive = false
      unsubscribe()
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [props.client])

  if (!visible) return null

  const openDownload = async (): Promise<void> => {
    const client = props.client ?? platformUpdateCheckClient
    if (timer.current !== null) clearTimeout(timer.current)
    setFailed(false)
    let ok = false
    try {
      ok = (await client.openUpdateLink('download')).ok
    } catch {
      ok = false
    }
    if (ok) return
    setFailed(true)
    // 再点会重置这 4 秒：用户可能马上重试。
    timer.current = setTimeout(() => setFailed(false), 4000)
  }

  return (
    <span className="update-action" data-update-action>
      <IconButton
        ariaLabelKey="about.action.updateAvailable"
        // 解析器必须真的按 key 解析（一条零参的 resolveText 会被守卫用例拦下：那是把句子写死）。
        resolveText={(key) => (key === 'about.action.updateAvailable' ? text.updateAvailable : key)}
        icon={failed ? TriangleAlert : Download}
        size="md"
        variant="plain"
        className={failed ? 'update-action__button update-action__button--failed' : 'update-action__button'}
        onSelect={() => void openDownload()}
      />
      {failed ? (
        // 读屏听不到颜色变化，所以播报一次；视觉上是隐藏的，不占版面。
        <span className="update-action__status" role="status">
          {text.openFailedNote}
        </span>
      ) : null}
    </span>
  )
}
