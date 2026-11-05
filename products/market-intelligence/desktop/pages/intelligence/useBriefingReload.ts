import { useEffect } from 'react'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { mergeEditionSummary, withDeadline } from './dailyBriefingPageDerived'
import { nextEditionAfterDelete } from './briefingEditionSelection'
import { readGenerationTrace } from './dailyBriefingGenerationTrace'
import type { DailyBriefingPageViewState as ViewState } from './dailyBriefingPageViewState'
import type { GenerationTrace } from './dailyBriefingGenerationTrace'

/**
 * 打开页面（或删完之后重读）那一次读取的完整过程。
 *
 * 它是一次读取的**全部**分支：列表读到没有、今天那份读到了没有、删完之后往哪一行落、读到一半
 * 失败时旧正文留不留——这些判断彼此依赖，拆开就会各判一遍、各说一套。抽出来之前它是页面里
 * 一段 145 行的 effect，任何一处小改都要在整段里找位置。
 *
 * 状态仍归页面：这里只读入 setter 与 ref，不接管所有权。重读由 `reloadKey` 触发。
 */
export function useBriefingReload(deps: Readonly<{
  client: Pick<DailyBriefingClient, 'getToday' | 'list'>
  reloadKey: number
  todayDate: string
  pinnedDate: string | undefined
  readEdition: (date: string, locale: 'zh-CN' | 'en-US', options?: Readonly<{ fresh?: boolean; periodId?: string }>) => Promise<Readonly<{ kind: string }>>
  takeSkipGenerate: () => boolean
  setView: (next: ViewState) => void
  setEditions: (next: readonly DailyBriefingEditionSummary[]) => void
  setRailDates: (next: readonly string[] | undefined) => void
  setEditionsLoading: (next: boolean) => void
  setEditionsFailed: (next: boolean) => void
  setRegenerateFailure: (next: Readonly<{ code?: string; generationTrace?: GenerationTrace }> | null) => void
  setRegenerating: (next: boolean) => void
  setShowingStale: (next: boolean) => void
  setPickedLocale: (next: 'zh-CN' | 'en-US') => void
  setPickedPeriodId: (next: string | undefined) => void
  setPinnedDate: (next: string | undefined) => void
  setCurrentPeriodDate: (next: string) => void
  afterDeleteLocaleRef: { current: 'zh-CN' | 'en-US' | null }
  afterDeleteRef: { current: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }> | null }
  effectiveLocaleRef: { current: 'zh-CN' | 'en-US' }
  loadedLocaleRef: { current: 'zh-CN' | 'en-US' | null }
  lastReadyRef: { current: DailyBriefingDocument | null }
  openEditionRef: { current: (date: string, locale: 'zh-CN' | 'en-US', row?: DailyBriefingEditionSummary) => void }
  periodDateRef: { current: string | null }
  timeZoneRef: { current: string }
}>): void {
  const { client, reloadKey, todayDate, pinnedDate, readEdition, takeSkipGenerate } = deps
  const { setView, setEditions, setRailDates, setEditionsLoading, setEditionsFailed, setRegenerateFailure, setRegenerating, setShowingStale } = deps
  const { setPickedLocale, setPickedPeriodId, setPinnedDate, setCurrentPeriodDate } = deps
  const { afterDeleteLocaleRef, afterDeleteRef, effectiveLocaleRef, loadedLocaleRef } = deps
  const { lastReadyRef, openEditionRef, periodDateRef, timeZoneRef } = deps

  useEffect(() => {
  let active = true
  setView({ status: 'loading' })
  setEditions([])
  setRailDates(undefined)
  setEditionsLoading(true)
  setEditionsFailed(false)
  setRegenerateFailure(null)
  void (async () => {
    // One-shot: only the reload a delete asked for skips the generation; the next ordinary open
    // must be able to generate today again.
    const skipGenerate = takeSkipGenerate()
    // Opening the page may generate today's edition; everything else is a read. The language tab
    // therefore never comes through here — it calls the same read path a row click does.
    const afterDeleteLocale = afterDeleteLocaleRef.current
    afterDeleteLocaleRef.current = null
    const afterDelete = afterDeleteRef.current
    afterDeleteRef.current = null
    const localeForLoad = afterDeleteLocale ?? effectiveLocaleRef.current
    if (afterDeleteLocale && afterDeleteLocale !== effectiveLocaleRef.current) setPickedLocale(afterDeleteLocale)
    loadedLocaleRef.current = localeForLoad
    const todayPromise = skipGenerate
      ? Promise.resolve(undefined)
      : withDeadline(client.getToday({ locale: localeForLoad, timeZone: timeZoneRef.current, generate: false }), 15_000).catch(() => undefined)
    const listed = await withDeadline(client.list({ locale: localeForLoad, timeZone: timeZoneRef.current }), 8_000).catch(() => undefined)
    if (!active) return
    // The issue day this load is about: the service's, when the list answered.
    const periodDate = listed?.state === 'available' && typeof listed.result.today === 'string' ? listed.result.today : todayDate
    setCurrentPeriodDate(periodDate)
    periodDateRef.current = periodDate
    let rows: readonly DailyBriefingEditionSummary[] = listed?.state === 'available' ? [...listed.result.editions] : []
    setEditions(rows.slice(0, 14))
    setRailDates(listed?.state === 'available' ? listed.result.dates : undefined)
    // The list has been read: from here an empty rail means "none" — unless the read itself failed.
    setEditionsLoading(false)
    setEditionsFailed(listed?.state !== 'available')
    // The row this load is about. `periodDate` is the list's own answer; using the wall-clock
    // `todayDate` here is what made a delete reload look at a day the list does not contain, find
    // nothing, and report the whole issue as empty.
    const periodRow = rows.find((row) => row.date === periodDate)
    if (skipGenerate) {
      // 删完之后"自动定位到下一版"：**先把身份定全，再设选中，最后才读**。
      // 以前只按日期取当天第一行、读取不带期号、只 setPickedLocale —— 选中项于是还指着被删的那一版：
      // 左侧不高亮、右列留痕落空、正文与选中项各说各话（用户报的三处异常同一个根）。
      const deletedDate = afterDelete?.date ?? periodDate
      // ① 这一天还有别的版次 → 取它（同一天、按期号序的邻居），身份一次设全。
      const survivor = nextEditionAfterDelete(rows, deletedDate, afterDelete ?? undefined)
      if (survivor !== undefined) {
        setPinnedDate(survivor.date)
        setPickedPeriodId(survivor.periodId)
        setPickedLocale(survivor.locale)
        // 读的就是选中那一版：期号一起传，否则一天两期时读回来的是当天第一行。
        const read = await readEdition(survivor.date, survivor.locale, { fresh: true, periodId: survivor.periodId })
        if (!active) return
        if (read.kind === 'available') return
      }
      // ② 这一天删空了。**停在读者原来那一天**给空态，不跨天把读者送走——除非读者本来
      //    删的就是过去某天：那种情况回到这一期的今天（`periodDate` 是列表给的今天）。
      const stayingDate = deletedDate === periodDate ? deletedDate : periodDate
      if (stayingDate !== deletedDate) {
        const todayRow = rows.find((row) => row.date === stayingDate && row.state !== 'missing')
        if (todayRow !== undefined) {
          setPinnedDate(todayRow.date)
          setPickedPeriodId(todayRow.periodId)
          setPickedLocale(todayRow.locale)
          const read = await readEdition(todayRow.date, todayRow.locale, { fresh: true, periodId: todayRow.periodId })
          if (!active) return
          if (read.kind === 'available') return
        }
      }
      setPinnedDate(stayingDate)
      setPickedPeriodId(undefined)
      setView({ status: 'no-edition', date: stayingDate, failed: false })
      return
    }
    const today = await todayPromise
    if (!active) return
    if (today?.state === 'available') {
      const date = today.document.edition.date
      setCurrentPeriodDate(date)
      // 只回写**读到的那一行**（日期 + 期号 + 语言）：按日期整片替换会把同一天另一种语言的行
      // 也写成这一版，两行于是同键同语言，React 会把它们当同一行复用，右键与删除落到另一行上。
      rows = mergeEditionSummary(rows, today.document)
      setView({
        status: 'ready',
        document: today.document,
        kind: 'today',
        ...(today.timeZoneSource === 'system' ? { timeZoneSource: 'system' as const } : {})
      })
      setRegenerateFailure(null)
    } else if (today?.state === 'unavailable' && today.failureCode === 'not-generated'
      && rows.some((edition) => edition.date === periodDate && edition.availableLocales.includes(localeForLoad))) {
      // The list says this language exists, so the answer "nothing written" is the read's miss, not
      // the truth. Read that edition by its date and put the answer on screen here — handing it to
      // the row path made the result depend on state that was still settling after a delete.
      const recovered = await readEdition(periodDate, localeForLoad, { fresh: true })
      if (!active) return
      if (recovered.kind === 'available') {
        setRegenerateFailure(null)
        return
      }
      setView({ status: 'locale-missing', locale: localeForLoad, date: periodDate })
    } else if (today?.state === 'unavailable' && today.failureCode === 'not-generated') {
      // Nothing is written in this language. Whether that means "the issue has no content" or
      // "this issue has the other language" is the list's answer, not this branch's guess.
      const row = rows.find((edition) => edition.date === periodDate)
      const other = (row?.availableLocales ?? []).find((candidate) => candidate !== localeForLoad)
      if (other) {
        if (skipGenerate) {
          setPickedLocale(other)
          openEditionRef.current(periodDate, other, row)
        } else {
          setView({ status: 'locale-missing', locale: localeForLoad, date: periodDate })
        }
      } else setView({ status: 'no-edition', date: periodDate, failed: false })
    } else if (false) {
      // Nothing is left for that day — same sentence as any day that never generated.
      setView({ status: 'no-edition', date: pinnedDate ?? periodDate, failed: false })
    } else {
      // A read that failed still says so. The delete reload is the opposite case: today was never
      // read, so it must not be reported as unreadable — the row the list already returned stands.
      const generationTrace = readGenerationTrace((today as unknown as Readonly<{ generationTrace?: unknown }> | undefined)?.generationTrace)
      const stale = lastReadyRef.current
      // A retry that failed after an earlier success: the issue still has an edition, so the reader
      // keeps reading it under the failure notice. Only a day that never produced one goes blank.
      // The stale copy is what a failed retry keeps on screen. A delete reload is the opposite:
      // the reader removed that edition, so putting it back would undo their action.
      if (!skipGenerate && stale && stale.edition.date === todayDate && rows.some((row) => row.date === todayDate && row.state !== 'missing')) {
        setView({ status: 'ready', document: stale, kind: 'today' })
        setShowingStale(true)
        setRegenerating(false)
        return
      }
      setView({
        status: 'unavailable',
        ...(today?.state === 'unavailable' ? { failureCode: today.failureCode } : {}),
        ...(generationTrace ? { generationTrace } : {})
      })
    }
    setEditions(rows.slice(0, 14))
    setRailDates(listed?.state === 'available' ? listed.result.dates : undefined)
    setRegenerating(false)
  })()
  return () => { active = false }
  }, [client, reloadKey])
}
