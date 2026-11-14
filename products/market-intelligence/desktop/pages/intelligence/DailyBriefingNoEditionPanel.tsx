import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { StateView } from '@platform/ui/components/state'

import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import { briefingCutoffPassed } from './briefingPeriodCutoff'
import { DailyBriefingFailurePanel } from './DailyBriefingFailurePanel'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'

/**
 * 今天的副句：什么时候会出、想现在看怎么走。手动期没有固定时刻，换成对应那句。
 *
 * **过了点还没版次就不许再说"到点会自动出"**（`02` v2.129 G6）：那天不会再出了，那句话
 * 做的是一个做不到的承诺。过了点改说「这一期没有生成」，只留"现在手动生成一次"这条真能走的路。
 */
function noEditionToday(text: DailyBriefingText, timeZone: string, scheduledTime: string | undefined, cutoffPassed: boolean | undefined): string {
  const labels = text.history
  if (scheduledTime === undefined) return labels.emptyTodayManual
  if (cutoffPassed === true) return labels.emptyTodayMissed.replace('{time}', scheduledTime).replace('{zone}', formatShellTimeZoneLabel(timeZone))
  return labels.emptyToday.replace('{time}', scheduledTime).replace('{zone}', formatShellTimeZoneLabel(timeZone))
}

/** What the pane says for one day the reader selected that has nothing to read. */
/** 诊断去重：同一组三元组 + 同一种空态只报一次。 */
const reportedPaneGaps = new Set<string>()

export function DailyBriefingNoEditionPanel({ view, text, timeZone, scheduledTime, todayDate, formatTime, now, onOpenSettings, selection, editions, onReread }: Readonly<{
  view: Extract<DailyBriefingPageViewState, { status: 'no-edition' }>
  text: DailyBriefingText
  timeZone: string
  scheduledTime?: string
  /** 判断"到点了没有"用的钟；用例注入一个固定时刻，生产不传就是现在。 */
  now?: Date
  /** 读者本地日历的今天：空态据此决定说"计划时刻"还是"这一期没有生成"。 */
  todayDate?: string
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  onOpenSettings: () => void
  /** 读者选中那一期的期次与语言：与 `view.date` 组成 (date, periodId, locale) 三元组。 */
  selection?: Readonly<{ periodId: string; locale: 'zh-CN' | 'en-US' }>
  /** 期次投影：用来判断「这一期在库里、只是读不到」还是「这一期根本没生成」。 */
  editions?: readonly Pick<DailyBriefingEditionSummary, 'date' | 'periodId' | 'languages' | 'periodDeleted'>[]
  /** 重新读这一版（不是重新生成）。读不到这一档必须有一颗重试，所以这里不给可选。 */
  onReread: () => void
}>): React.ReactElement {
  const labels = text.history
  // 今天与历史日**共用同一块平台空态**（`02` v2.98）：标题由 `ui.state.empty` 提供，两块自动逐字
  // 相同；差异只在副句，副句走 `productReason` 的 key（字面键，守卫要求可判断前缀）。
  // **三元组**判断，不用「这一天有任意一版」（用户 2026-11-14）：
  // 列表里有同一 (date, periodId, locale) 的行、正文却读不到，是「读不到这一版」；
  // 没有这一行才是「这一版没生成」。按日期推断会在缺另一种语言时把「没有这一版」说成「读不到」。
  // 只有「这一期这一语言**发布过**、正文却读不到」才算读不到：
  // - 已删的期（`periodDeleted`）→ 是「没有」，不是读不到；
  // - 正在生成 / 压根没有这一语言 → 也各有自己的说法。
  const knownRow = selection === undefined ? undefined : editions?.find((edition) =>
    edition.date === view.date && edition.periodId === selection.periodId)
  const languageState = knownRow?.languages?.find((entry) => entry.locale === selection?.locale)?.state
  const knownButUnreadable = knownRow !== undefined && knownRow.periodDeleted !== true && languageState === 'published'
  if (knownButUnreadable) {
    // 诊断：列表说这一期这一语言发布过，这一屏却没有正文。三样一次打全——**按哪个三元组判的、
    // 这一屏处于哪种空态、有没有失败码**；JSON 拼进字符串，别让 Electron 摊成 `[object Object]`。
    // 同一组身份只打一次：每 1.5 秒一条会把日志淹掉（用户 2026-11-14 的日志就是这样刷屏的）。
    const diagnosticKey = [view.date, selection?.periodId ?? '', selection?.locale ?? '', view.status,
      String((view as { failureCode?: string }).failureCode ?? '')].join('|')
    if (!reportedPaneGaps.has(diagnosticKey)) {
      reportedPaneGaps.add(diagnosticKey)
      console.warn(`[daily-briefing] published edition has no body in the pane ${JSON.stringify({
        date: view.date,
        periodId: selection?.periodId ?? null,
        locale: selection?.locale ?? null,
        viewStatus: view.status,
        failureCode: (view as { failureCode?: string }).failureCode ?? null
      })}`)
    }
    // 诊断：列表说这一期这一语言发布过，这一屏却没有正文。把**实际按哪个三元组判的**写出来，
    // 否则只能靠猜（用户 2026-11-14 的那一屏就是这样查了很久）。
    console.warn('[daily-briefing] published edition has no body in the pane', {
      date: view.date, periodId: selection?.periodId, locale: selection?.locale
    })
    // 诊断：列表说这一期这一语言发布过，这一屏却没有正文。把**实际按哪个三元组判的**写出来，
    // 否则只能靠猜（用户 2026-11-14 的那一屏就是这样查了很久）。

    return <StateView state="error" reasonCode="unreadable" size="md"
      className="mi-daily-briefing-page__no-edition"
      action={{ labelKey: 'ui.state.action.retry', onSelect: onReread }}
      productReason={{ key: 'mi.dailyBriefing.unreadable', resolve: (key, params) => resolveBriefingStateReason(text, key, params) }} />
  }
  const isCurrent = view.date === todayDate
  if (isCurrent) {
    const cutoffPassed = scheduledTime === undefined ? undefined : briefingCutoffPassed({
      date: view.date, time: scheduledTime, timeZone, now: now ?? new Date()
    })
    return <StateView
      state="empty"
      /* 「还没发生」这一档。**不许 `never-ran`**——它配的动作是"现在跑一次"，而历史日报不支持补生成；
         **不许 `error`**——那会把"还没有"和"读不到"合成一句。 */
      reasonCode="not-yet"
      size="md"
      className="mi-daily-briefing-page__no-edition"
      productReason={{ key: 'mi.dailyBriefing.emptyToday', resolve: () => noEditionToday(text, timeZone, scheduledTime, cutoffPassed) }}
    />
  }
  return <StateView
    state="empty"
    /* 历史日：「那段时间确实没有」，不是"还没跑"。 */
    reasonCode="nothing-in-window"
    size="md"
    className="mi-daily-briefing-page__no-edition"
    productReason={{ key: 'mi.dailyBriefing.emptyHistorical', resolve: () => text.history.emptyBodyHistorical }}
  />
}
