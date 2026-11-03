import { useEffect, useRef, useState } from 'react'
import { Download, TriangleAlert } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'

import { platformText } from '../../i18n/platformText'
import { shouldShowUpdateDot } from '../settings/version/versionCheckViewModel'
import { platformUpdateCheckClient, type UpdateCheckClient } from '../settings/version/updateCheckClient'

/**
 * 版本串超过这个长度就不再塞进按钮，退回「有新版本」。
 *
 * 12 是判据不是估计：`0.10.0-beta.3` 正好 13 个字符，顶栏 42 高、单行不换行，超长版本号会把
 * 按钮拉长进而挤坏顶栏。
 */
const versionInLabelMaxLength = 12

/**
 * 顶栏「更新到 {版本}」按钮，挨着铃铛放。
 *
 * 用户 11-03 的话是「一点都不醒目，就一个醒目的更新按钮就行了」——所以它是**实心强调色 + 图标 + 文字**，
 * 不再是和铃铛一样灰的纯图标：
 * - **出现条件不变**：投影 `available`，复用 `shouldShowUpdateDot` 那一条判据，不另写一份；
 *   没有新版时**整颗不渲染**（顶栏那一格是 `auto`，所以它消失不会把铃铛推动）；
 * - **版本号只有一处来源**：可见文字里的版本号与版本行「最新版本」读的是同一个字段
 *   （投影的 `latestVersion`）。今晚已经因为「结论存下来、版本现算」撞过一次，不再开第二种；
 * - 点击只做一件事：`openUpdateLink('download')`——**不导航、不切页**；点完**不消失**（再点就是重试）；
 * - 失败态：**只换图标**（警示三角），文字与底色不动，4 秒后恢复；可读名不变（它做的事没变），
 *   变化用视觉隐藏的 `role="status"` 播报一次。
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

  if (!visible || projection === null) return null

  // 与版本行同一字段：`available` 投影一定带 `latestVersion`。
  const version = projection.state === 'available' ? projection.latestVersion : null
  const labelPlan = version === null || version.length > versionInLabelMaxLength
    ? { text: text.updateNoVersion, label: text.updateAvailable }
    : { text: text.updateToVersion(version), label: text.updateToVersionLabel(version) }

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
      {/*
        实心按钮，所以不用 `IconButton`（那个组件只服务「纯图标触发器」）：这里图标是配字，
        可读名与可见文字一致（label-in-name），动作在可读名后半句里补上。
      */}
      <button
        type="button"
        className="update-action__button"
        aria-label={labelPlan.label}
        onClick={() => void openDownload()}>
        {failed ? (
          <TriangleAlert className="update-action__glyph" aria-hidden="true" size={14} strokeWidth={2.2} />
        ) : (
          <Download className="update-action__glyph" aria-hidden="true" size={14} strokeWidth={2.2} />
        )}
        <span className="update-action__text">{labelPlan.text}</span>
      </button>
      {failed ? (
        // 读屏听不到颜色变化，所以播报一次；视觉上是隐藏的，不占版面。
        <span className="update-action__status" role="status">
          {text.openFailedNote}
        </span>
      ) : null}
    </span>
  )
}
