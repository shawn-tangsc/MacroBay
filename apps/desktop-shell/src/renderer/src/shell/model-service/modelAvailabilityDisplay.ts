import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'
import type { PlatformText } from '../../i18n/platformText'

import type { ModelAvailabilityView } from './modelAvailabilityView'
import { probeReasonLabel } from './modelProbeReason'

/**
 * 落库的可用性结论 → 行内文案（唯一实现）。
 *
 * 行内只放短词（可用 / 不可用 / 待检测），原因与检测时间放 title；
 * 失败原因复用 `probeReasonLabel`，与检测结果、连接检查共用一套原因码翻译。
 */
export function modelAvailabilityLabel(labels: PlatformText['models'], view: ModelAvailabilityView): string {
  if (view.stale) return labels.modelAvailabilityStale
  return view.status === 'ok' ? labels.modelAvailabilityOk : labels.modelAvailabilityFailed
}

export function modelAvailabilityTitle(
  labels: PlatformText['models'],
  view: ModelAvailabilityView,
  timeZone: string
): string {
  if (view.stale) return labels.modelAvailabilityStaleHint
  // 时间只走平台口径：`toLocaleString()` 既没有指定时区，也没有跟随显示语言。
  const checkedAt = formatShellInstant(view.checkedAt, { timeZone })
  const status = view.status === 'ok'
    ? labels.modelAvailabilityOk
    : labels.modelAvailabilityFailedWithReason(probeReasonLabel(labels, view.reasonCode))
  return labels.modelAvailabilityCheckedAt(status, checkedAt)
}
