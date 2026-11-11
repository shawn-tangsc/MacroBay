import { useCallback, useEffect, useState, type RefObject } from 'react'

import { intelligenceSourcesClient } from '../../../shared/ipc/intelligenceSourcesClient'
import { blsRefreshBlockedReasonCode, blsRefreshBlockedSentence, blsUnavailableListDetail, blsUnavailableListLabel, blsUnavailableSentence, readBlsUnavailable, type BlsScheduleFeedback, type BlsUnavailable } from './blsAvailability'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * 官方日历停用后的现状：原因码与上次成功日期来自源注册表同一个字段，句子只由 `blsAvailability`
 * 里那一个键拼出。页面拿它做两件事——不再发起同步、把 BLS 刷新置灰并显示同一句说明。
 *
 * 抽成 hook 是为了让 `EconomicCalendar.tsx` 保持体量（它有基线，只能变小）：这段是纯粹的状态读取，
 * 与页面的月份/选择逻辑无关。
 */
export function useBlsAvailability(text: EconomicCalendarText): Readonly<{
  unavailable?: BlsUnavailable
  notice?: string
  /** 列表顶部那一句状态词：点名 BLS，不带原因（原因在那颗 ⓘ 里）。 */
  listLabel?: string
  /** 那颗 ⓘ 里的完整说明：403、画的是哪次同步、怎么拿到新的。 */
  listDetail?: string
  /** 置灰的 BLS 刷新键自己的行内句：为什么不能刷新、何时能好（若有）。 */
  refreshBlocked?: string
  /** 行内句旁那颗 ⓘ 里的完整原因码（正文不拼它）。 */
  refreshBlockedCode?: string
  /** 官方日历腿的三态（宏观线在注册表那侧算好，这里只读，不遍历注册表）。 */
  feeds?: 'disabled' | 'enabled' | 'unavailable'
}> {
  const [unavailable, setUnavailable] = useState<BlsUnavailable>()
  const [feeds, setFeeds] = useState<'disabled' | 'enabled' | 'unavailable'>()
  useEffect(() => {
    let active = true
    void intelligenceSourcesClient.getPanelView('economic-calendar').then((view) => {
      if (!active || view === undefined) return
      setUnavailable(readBlsUnavailable(view.providers.flatMap(provider => provider.sources)))
      setFeeds(view.calendarOfficialFeeds?.state)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])
  const notice = blsUnavailableSentence(text, unavailable)
  const listLabel = blsUnavailableListLabel(text, unavailable)
  const listDetail = blsUnavailableListDetail(text, unavailable)
  const refreshBlocked = blsRefreshBlockedSentence(text, unavailable)
  const refreshBlockedCode = blsRefreshBlockedReasonCode(unavailable)
  return {
    ...(unavailable === undefined ? {} : { unavailable }),
    ...(notice === undefined ? {} : { notice }),
    ...(listLabel === undefined ? {} : { listLabel }),
    ...(listDetail === undefined ? {} : { listDetail }),
    ...(refreshBlocked === undefined ? {} : { refreshBlocked }),
    ...(refreshBlockedCode === undefined ? {} : { refreshBlockedCode }),
    ...(feeds === undefined ? {} : { feeds })
  }
}

/**
 * 年度 BLS 同步。停用之后**连一次往返都不发**——服务侧已改成立刻回 `unavailable`，
 * 但页面没有理由把这次请求送出去；页面上那颗刷新键也由同一个字段置灰。
 */
export function useBlsYearSync(input: Readonly<{
  client: { syncBlsEmploymentSchedule?: (input: { year: `${number}` }) => Promise<import('../../../../contracts/macro/economicCalendarQueryContracts').SyncBlsScheduleAndValuesResult> }
  unavailable: BlsUnavailable | undefined
  mountedRef: RefObject<boolean>
  selectedMonthRef: RefObject<string>
  syncedYearsRef: RefObject<Set<string>>
  onFeedback: (feedback: BlsScheduleFeedback) => void
  changed: (result: import('../../../../contracts/macro/economicCalendarQueryContracts').SyncBlsScheduleAndValuesResult) => boolean
}>): (year: string) => Promise<boolean> {
  const { client, unavailable, mountedRef, selectedMonthRef, syncedYearsRef, onFeedback, changed } = input
  return useCallback(async (year: string): Promise<boolean> => {
    const sync = client.syncBlsEmploymentSchedule
    if (typeof sync !== 'function' || unavailable !== undefined) return false
    if (syncedYearsRef.current?.has(year) === true) return false
    syncedYearsRef.current?.add(year)
    const result = await sync({ year: year as `${number}` })
    if (result.state === 'unavailable') syncedYearsRef.current?.delete(year)
    if (result.state === 'completed' && mountedRef.current === true && selectedMonthRef.current?.slice(0, 4) === year) {
      onFeedback({ year, schedule: result.schedule, cpi: result.values.cpi, employment: result.values.employment })
    }
    return changed(result)
  }, [changed, client, mountedRef, onFeedback, selectedMonthRef, syncedYearsRef, unavailable])
}
