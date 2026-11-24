import type { NotificationCenterItem } from '@platform/notifications/contracts/notificationCenterContracts'

import type { PosterRowTexts } from './posterRowModel'

/**
 * 「送达」组里「文字」那一行的判定（#46 §4）。
 *
 * 与海报行同一形态、同一套计数规则，只有两处不同：
 * - **没有「这一版没有图」那一档**：文字只有已发送 / 等回执 / 未发送；
 * - **不带原因、也不进 ⓘ**：原因在列表正文里已经说过，详情不重复（界面设计 2026-11-25 §4）。
 *
 * 分母是**这一次推送的全部通道**（不按图片能力筛）。老记录没有逐通道行时按聚合那一条渲染，
 * 单通道不写数字，也不编通道名。
 */
export type TextRowModel = {
  state: 'sent' | 'unconfirmed' | 'failed'
  counts?: string
}

function withCounts(state: TextRowModel['state'], counts: string | undefined): TextRowModel {
  return counts === undefined ? { state } : { state, counts }
}

export function textRowModel(
  push: NotificationCenterItem['delivery']['push'],
  text: PosterRowTexts
): TextRowModel | null {
  if (push === undefined) return null

  const rows = push.channels ?? []
  if (rows.length === 0) {
    // 老记录只有聚合那一档：按它说，不写数字（单通道不写数字）。
    if (push.state === 'failed') return { state: 'failed' }
    if (push.state === 'queued' || push.state === 'sent-unconfirmed') return { state: 'unconfirmed' }
    return { state: 'sent' }
  }

  const total = rows.length
  const counts = (count: number): string | undefined =>
    total < 2 ? undefined : count === total ? text.counts.all(total) : text.counts.partial(count, total)

  const failed = rows.filter((row) => row.state === 'failed').length
  const pending = rows.filter((row) => row.state === 'queued' || row.state === 'sent-unconfirmed').length
  if (failed > 0) return withCounts('failed', counts(failed))
  if (pending > 0) return withCounts('unconfirmed', counts(pending))
  return withCounts('sent', counts(total))
}
