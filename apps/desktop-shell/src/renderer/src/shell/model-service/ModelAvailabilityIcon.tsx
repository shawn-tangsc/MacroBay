import { CircleCheck, CircleDashed, CircleX } from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'

import type { ModelAvailabilityView } from './modelAvailabilityView'
import { modelAvailabilityTitle } from './modelAvailabilityDisplay'

/**
 * 可用性结论的**紧凑图标**（模型选择器 / 其它紧凑位置用）。
 *
 * `ok` = 绿勾，`failed` = 红叉；`stale` 与「从未检测」（`pending`）都是灰圈：
 * 前者标题说明配置已变，后者说明还没测过。其余位置继续用文字（模型列表）。
 */
export function ModelAvailabilityIcon({
  labels,
  view,
  pending = false
}: {
  labels: PlatformText['models']
  view?: ModelAvailabilityView
  /** 没有结论时也显示「尚未检测」灰圈（默认不显示，避免每个下拉都挂一圈灰点）。 */
  pending?: boolean
}): React.ReactElement | null {
  const state = view === undefined
    ? (pending ? 'pending' : null)
    : view.stale
      ? 'stale'
      : view.status
  if (state === null) return null

  const title = view === undefined || state === 'pending'
    ? labels.modelAvailabilityNeverChecked
    : state === 'stale'
      ? labels.modelAvailabilityStaleHint
      : modelAvailabilityTitle(labels, view)
  const Icon = state === 'ok' ? CircleCheck : state === 'failed' ? CircleX : CircleDashed

  return (
    <span
      className={`model-availability-icon is-${state}`}
      data-model-availability-icon={state}
      role="img"
      aria-label={title}
      title={title}>
      <Icon size={12} aria-hidden="true" />
    </span>
  )
}
