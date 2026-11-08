import { Info } from 'lucide-react'
import type { ReactElement } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { EconomicCalendarText } from './economicCalendarText'
import { marketCalendarAutomaticRefreshPolicy } from './marketCalendarAutomaticPolicy'

// CalendarObservedDataTimePolicy (133): receipt time is never page-open time.
// Missing runtime attempt after restart means unattempted, not healthy/latest.
// The automatic-refresh note is stated explicitly because this source is now
// refreshed by the product itself, so a stale timestamp means a failed automatic
// run rather than "nobody pressed refresh". A failed run also names its verdict and
// origin here: an automatic tick refused by the shared calendar ceiling used to be
// invisible, so the page looked like a source that had simply published nothing.

export type CalendarSourceStatusFragments = Readonly<{ body: readonly string[]; detail: readonly string[] }>

/**
 * 一条来源的状态拆成**正文**与**ⓘ 说明**两半（R35，产品 2026-11-09 定）。
 *
 * 正文只留"状态不是描述"的那些：读者必须当场知道出事了，才谈得上判断能不能信这条数据。
 * 常态串（刷新成功、手动/自动、已采集、数据采集于…、每 N 分钟自动更新）收进 ⓘ——它们讲的是
 * "这个系统按什么方式工作"，不是"此刻发生了什么"。
 *
 * 「本次无事件」（`success-empty`）**留在正文**：它是「确实没有」那一半，收进去就和「尚无可用
 * 批次（读不到）」混成一个了。
 */
export function calendarSourceStatusFragments(
  source: MarketCalendarSource,
  text: EconomicCalendarText,
  formatTime: (value: string, precision?: 'second') => string
): CalendarSourceStatusFragments {
  const attempt = source.latestAttempt
  const failed = attempt?.state === 'failed'
  const body: string[] = []
  const detail: string[] = [text.market.kinds[source.eventType]]

  /*
   * 分工写死：正文放异常句，ⓘ 只放常态句，**同一句不许两边都有**（R35 验收 ②）。
   * 所以下面每一分支要么进 body、要么进 detail，不并发。
   */
  if (attempt?.state === 'failed') {
    body.push(text.market.refreshOutcome.failed)
    if (attempt.failureCode) body.push(text.market.attemptFailure[attempt.failureCode])
  } else if (attempt?.state === 'succeeded') {
    detail.push(text.market.refreshOutcome.succeeded)
  } else {
    body.push(text.market.refreshOutcome.unattempted)
  }
  // 触发方式是常态信息，只要知道就走 ⓘ（正文从不说"这次是自动跑的"）。
  if (attempt?.trigger) detail.push(text.market.refreshTrigger[attempt.trigger])

  // 采集批次结论：只有「已采集」是常态；「本次无事件」留正文（确实没有），其余都是异常。
  if (source.status === 'success') detail.push(text.market.statuses.success)
  else body.push(text.market.statuses[source.status])

  // 采集时刻：失败时正文写「显示上次数据」+ 时刻（读者要知道自己在看旧数据）；成功路径只进 ⓘ。
  if (source.sourceObservedAt) {
    const observedAt = formatTime(source.sourceObservedAt, 'second')
    if (failed) body.push(`${text.market.retainedData} ${observedAt}`)
    else detail.push(`${text.market.collectedAt} ${observedAt}`)
  }

  if (marketCalendarAutomaticRefreshPolicy.automatic) {
    detail.push(text.market.automaticRefresh.replace('{interval}', String(marketCalendarAutomaticRefreshPolicy.intervalMinutes)))
  }
  return { body: Object.freeze(body), detail: Object.freeze(detail) }
}

/** 正文那半：类别名 + 只在异常时出现的句子。 */
export function MarketCalendarSourceStatus({ source, text }: { source: MarketCalendarSource; text: EconomicCalendarText }): ReactElement {
  const formatTime = useShellTimeFormat()
  const fragments = calendarSourceStatusFragments(source, text, formatTime)
  return <span className="mi-calendar-detail-status" data-market-source-status={source.eventType}
    data-automatic-refresh={marketCalendarAutomaticRefreshPolicy.automatic ? 'true' : 'false'}>
    {[text.market.kinds[source.eventType], ...fragments.body].join(' · ')}
  </span>
}

/**
 * ⓘ：常态串与「这些字段是什么」放在这里。内容只用文案键拼出来，组件里不写业务句子。
 */
export function CalendarSourceStatusInfo({ sources, text, coverage }: {
  sources: readonly MarketCalendarSource[]
  text: EconomicCalendarText
  coverage: string
}): ReactElement {
  const formatTime = useShellTimeFormat()
  const resolveText = useProductTextKey()
  return <Popover
    content={<>
      <p data-calendar-coverage>{coverage}</p>
      {sources.map((source) => <p data-calendar-source-status-detail={source.eventType} key={source.eventType}>
        {calendarSourceStatusFragments(source, text, formatTime).detail.join(' · ')}
      </p>)}
    </>}
    trigger={(triggerProps) => <IconButton {...triggerProps}
      ariaLabelKey="pages.intelligence.portal.calendar.info" icon={Info} resolveText={resolveText}
      size="sm" variant="plain" />}
  />
}
