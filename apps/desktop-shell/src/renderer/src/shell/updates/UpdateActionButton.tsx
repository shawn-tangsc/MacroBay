import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { UpdateCheckProjection } from '@platform/updates/contracts/updateCheck'
import { navigateTo } from '@platform/workspace/navigation/navigationRequest'

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
 * 顶栏「有新版本 {版本}」按钮，挨着铃铛放。
 *
 * **只负责发现**（用户 11-03 定）：点它进「关于我们」，不打开浏览器、不打开发布页——
 * 关于页里那颗「立即更新」是唯一执行按钮。两处都执行同一个动作就是两个真相。
 *
 * - **没有新版时整颗不渲染**（不是隐藏、不是禁用）：投影 `available` 才出现，复用
 *   `shouldShowUpdateDot` 那一条判据，不另写一份；
 * - **版本号只有一处来源**：可见文字里的版本号与版本行「最新版本」读的是同一个字段
 *   （投影的 `latestVersion`）；
 * - 点击只走壳层唯一导航入口 `navigateTo`，与侧栏进关于页同一条路；**不调 `openUpdateLink`**，
 *   所以不会碰到 http(s) 白名单，也不会发外部请求；
 * - 读屏名带版本号并说出动作（「有新版本 0.4.0，打开关于我们」）；视觉文字是陈述句，
 *   不再是「更新到 X」这种命令句。
 */
export function UpdateActionButton(props: {
  language: AppLanguage
  client?: UpdateCheckClient
}): React.ReactElement | null {
  const [projection, setProjection] = useState<UpdateCheckProjection | null>(null)
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
    }
  }, [props.client])

  if (!visible || projection === null) return null

  // 与版本行同一字段：`available` 投影一定带 `latestVersion`。
  const version = projection.state === 'available' ? projection.latestVersion : null
  const labelPlan = version === null || version.length > versionInLabelMaxLength
    ? { text: text.updateNoVersion, label: text.updateAvailable }
    : { text: text.updateToVersion(version), label: text.updateToVersionLabel(version) }

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
        onClick={() => navigateTo({ page: 'settings', panel: 'about' })}>
        <Download className="update-action__glyph" aria-hidden="true" size={14} strokeWidth={2.2} />
        <span className="update-action__text">{labelPlan.text}</span>
      </button>
    </span>
  )
}
