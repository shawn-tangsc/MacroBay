import { StateView } from '@platform/ui/components/state'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'

/**
 * Today's edition is not readable: nothing was ever generated, today has not run yet, or the read
 * itself failed. Each branch carries a literal reason key, so the resolver guard can tell which
 * sentence the reader will see; a computed key is invisible to it.
 */
export function DailyBriefingEmptyState({ editions, todayDate, timeZone, lastGeneratedAt, formatTime, text, documentRejected = false, onRetry }: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  todayDate: string
  timeZone: string
  lastGeneratedAt?: string
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  text: DailyBriefingText
  /**
   * 文档到了、但本机读不懂它（`02` v2.129 G5）。
   *
   * 它与"这次没读到"是两件事：读到了才谈得上"读不懂"。这一档写**原因**（版本或结构不符），
   * 不写成"读不到"——否则读者会一直点重试，而重试永远不会改变文档的形状。
   */
  documentRejected?: boolean
  /**
   * 重新**读**这一版（不是重新生成）。
   *
   * 空态里一颗按钮都不放——还没有内容时，动作入口在顶部；读不到是另一回事，那颗「重试」只能
   * 再读一次，绝不能顺手跑一期、写一版、花一次模型调用。这两件事以前接的是同一个 `onGenerate`。
   */
  onRetry: () => void
}>): React.ReactElement {
  const resolve = (key: string, params?: Readonly<Record<string, string>>): string => resolveBriefingStateReason(text, key, params)
  const scheduledTime = editions.find((edition) => edition.scheduledTime !== undefined)?.scheduledTime
  const todayMissing = editions.some((edition) => edition.date === todayDate && edition.state === 'missing')

  if (documentRejected) {
    return <StateView state="error" reasonCode="unreadable" size="lg"
      action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }}
      productReason={{ key: 'mi.dailyBriefing.documentInvalid', resolve }} />
  }


  // 「还没有内容」这一档用 `not-yet`（平台契约：这一档不许给动作），不是 `never-created`
  // （那一档要求必须有一颗 `create`，与"空态零按钮"直接冲突）。动作入口在顶部工具栏。
  if (editions.every((edition) => edition.state === 'missing')) {
    return scheduledTime
      ? <StateView state="empty" reasonCode="not-yet" size="lg"
        productReason={{ key: 'mi.dailyBriefing.noBriefAt', params: { time: scheduledTime, zone: formatShellTimeZoneLabel(timeZone) }, resolve }} />
      : <StateView state="empty" reasonCode="not-yet" size="lg"
        productReason={{ key: 'mi.dailyBriefing.noBrief', resolve }} />
  }
  if (todayMissing) {
    return <StateView state="empty" reasonCode="not-yet" size="lg"
      productReason={{ key: 'mi.dailyBriefing.todayNotRun', resolve }} />
  }
  if (lastGeneratedAt) {
    return <StateView state="error" reasonCode="unreadable" size="lg"
      action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }}
      productReason={{ key: 'mi.dailyBriefing.unreadableSince', params: { moment: formatTime(lastGeneratedAt, 'minute') }, resolve }} />
  }
  return <StateView state="error" reasonCode="unreadable" size="lg"
    action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }}
    productReason={{ key: 'mi.dailyBriefing.unreadable', resolve }} />
}
