import { useEffect, useState } from 'react'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { StateView } from '@platform/ui/components/state'
import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarClient, type CalendarValueRevisionRead } from '../../../shared/ipc/marketCalendarClient'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * **数值修订审计**（用户 2026-11-20，产品 41 号文）：这一格被谁在什么时候改成了什么。
 *
 * 四条显示口径（Chief 定，一条都不许合并）：
 * 1. **有身份 + 有记录**：两个及以上来源才出并列；只有一个来源只写一行来源。「更新于」只认
 *    `decision='write'` 的最后一条（读口的 `updatedAt`，不是标准表的更新时间）；
 * 2. **有身份 + 没有记录**：写「未记录」——不拿别的时间顶替，也不把整块藏掉；
 * 3. **没有身份**（讲话、旧源未登记的行）：**整块不渲染**——没有身份就谈不上「有没有记录」；
 * 4. **读不到**：`StateView` 错误态 + 重试，不许画成空、也不许写成「未记录」。
 *
 * 身份**不从 `scheduledAt` 反推**：同一天同一码有多行（真库 52 组 108 行），反推会挑错行。
 */
export function EventValueRevisions({ event, text }: Readonly<{
  event: MarketCalendarEvent
  text: EconomicCalendarText
}>): React.ReactElement | null {
  const formatTime = useShellTimeFormat()
  // 身份**从合同搬出来的两列**（`ffc6ad4`）：不从 `scheduledAt` 反推——同一天同一码有多行。
  const metricKey = event.eventNameKey
  const ready = metricKey !== undefined && event.countryCode !== null
    && event.periodKey !== undefined && event.firstScheduledDate !== undefined
  const [read, setRead] = useState<CalendarValueRevisionRead | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!ready) return undefined
    let live = true
    setRead(undefined)
    void marketCalendarClient.queryValueRevisions({
      countryCode: event.countryCode!, metricKey: metricKey!,
      periodKey: event.periodKey!, firstScheduledDate: event.firstScheduledDate!
    }).then((answer) => { if (live) setRead(answer) })
      .catch(() => { if (live) setRead({ state: 'unavailable', reasonCode: 'query-unavailable' }) })
    return () => { live = false }
  }, [ready, event.eventKey, metricKey, event.countryCode, event.periodKey, event.firstScheduledDate, attempt])
  // ③ 没有身份：整块不渲染（不是「未记录」——那是把我们的缺口说成审计问题）。
  if (!ready) return null
  const unreadable = read === undefined || read.state === 'unreadable' || read.state === 'unavailable'
  if (read === undefined) return null
  if (unreadable) {
    return <div data-value-revisions="unreadable">
      <StateView state="error" reasonCode="unreadable" size="sm"
        action={{ labelKey: 'ui.state.action.retry', onSelect: () => setAttempt((value) => value + 1) }} />
    </div>
  }
  if (read.state === 'not-recorded') {
    return <div data-value-revisions="not-recorded">
      <dt>{text.details.revisions}</dt><dd>{text.details.revisionsNotRecorded}</dd>
    </div>
  }
  const providers = [...new Set(read.revisions.map((row) => row.providerId))]
  return <div data-value-revisions="recorded" data-provider-count={String(providers.length)}>
    <dt>{text.details.revisions}</dt>
    <dd>
      {/* ① 只有一个来源：只写来源一行，不做并列；两个及以上才是并列对照。 */}
      {providers.length < 2
        ? <span data-revisions-source>{text.details.revisionsSource}：{providers[0] ?? '—'}</span>
        : <span data-revisions-parallel>{read.revisions.map((row) => <span key={`${row.providerId}-${row.observedAt}-${row.field}`}
            data-revision-row={row.providerId}>
            {text.details.revisionsSource}：{row.providerId} · {formatTime(row.observedAt, 'minute')}
            {' · '}{row.valueAfter ?? '—'}
          </span>)}</span>}
      {read.updatedAt === null ? null : <span data-revisions-updated>
        {' · '}{text.details.revisionsUpdatedAt}：{formatTime(read.updatedAt, 'minute')}
      </span>}
    </dd>
  </div>
}
