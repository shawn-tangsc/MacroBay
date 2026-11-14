import type { MutableRefObject } from 'react'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { briefingEditionPeriod } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import { readGenerationTrace, type GenerationTrace } from './dailyBriefingGenerationTrace'

/**
 * Reading one edition: one entry, one answer.
 *
 * A row click and a language switch both come here with a date and a language; the answer is cached
 * per `${date}:${locale}`, so moving away and back is a render rather than a second read. The reader
 * never generates, and it reports what it found — an edition, no edition in this language, a failed
 * attempt — so the caller can say which one it is instead of guessing from a boolean.
 */
/** 诊断去重：同一次身份 / 同一种状态只报到一次（每 1.5 秒一条会把日志淹掉）。 */
const reportedReads = new Set<string>()
const reportedResults = new Set<string>()

export function useBriefingEditionReader(input: Readonly<{
  client: Pick<DailyBriefingClient, 'get'>
  editions: readonly DailyBriefingEditionSummary[]
  todayDate: string
  readyDocument: DailyBriefingDocument | undefined
  requestRef: MutableRefObject<number>
  cache: MutableRefObject<Map<string, DailyBriefingDocument>>
  periodDate: MutableRefObject<string | null>
  setView: (next: DailyBriefingPageViewState | ((current: DailyBriefingPageViewState) => DailyBriefingPageViewState)) => void
  setPinnedDate: (date: string) => void
  setRegenerateFailure: (failure: null) => void
}>): Readonly<{
  readEdition: (date: string, target: 'zh-CN' | 'en-US', options?: Readonly<{ fresh?: boolean; periodId?: string }>) => Promise<Readonly<{
    kind: 'available' | 'missing' | 'failed' | 'unknown'
    failureCode?: string
    /** 失败那一次自己的步骤：点开这一行要看得见卡在哪一步（用户 2026-11-06）。 */
    generationTrace?: GenerationTrace
  }>>
  openEdition: (date: string, target: 'zh-CN' | 'en-US', rowHint?: DailyBriefingEditionSummary, periodId?: string) => void
}> {
  const { client, editions, todayDate, readyDocument, requestRef, cache, periodDate, setView, setPinnedDate, setRegenerateFailure } = input
  const readEdition = async (date: string, target: 'zh-CN' | 'en-US', options: Readonly<{ fresh?: boolean; periodId?: string }> = {}): Promise<Readonly<{
    kind: 'available' | 'missing' | 'failed' | 'unknown'
    failureCode?: string
    generationTrace?: GenerationTrace
  }>> => {
    const key = `${date}:${options.periodId ?? 'default'}:${target}`
    const cached = options.fresh ? undefined : cache.current.get(key)
    if (cached) {
      setView({ status: 'ready', document: cached, kind: date === (periodDate.current ?? todayDate) ? 'today' : 'history' })
      return { kind: 'available' }
    }
    // 请求与返回各打一行（用户 2026-11-14：所有版本一起读不到，而链路上一个字都没有）：
    // **按哪个三元组请的、回来的是什么状态、有没有失败码**。同一组身份只打一次，避免刷屏。
    const diagnosticKey = `${date}|${options.periodId ?? 'default'}|${target}`
    if (!reportedReads.has(diagnosticKey)) {
      reportedReads.add(diagnosticKey)
      console.info(`[daily-briefing] reading edition ${JSON.stringify({ date, periodId: options.periodId ?? 'default', locale: target, fresh: options.fresh === true })}`)
    }
    const result = await client.get({ date, locale: target, ...(options.periodId ? { periodId: options.periodId } : {}) })
      .catch((error: unknown) => {
        console.warn(`[daily-briefing] edition read threw ${JSON.stringify({
          date, periodId: options.periodId ?? 'default', locale: target,
          error: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)
        })}`)
        return undefined
      })
    if (!reportedResults.has(`${diagnosticKey}|${result?.state ?? 'threw'}`)) {
      reportedResults.add(`${diagnosticKey}|${result?.state ?? 'threw'}`)
      console.info(`[daily-briefing] edition read answered ${JSON.stringify({
        date, periodId: options.periodId ?? 'default', locale: target,
        state: result?.state ?? 'threw',
        failureCode: (result as { failureCode?: string } | undefined)?.failureCode ?? null
      })}`)
    }
    if (result?.state === 'available') {
      cache.current.set(key, result.document)
      setView({ status: 'ready', document: result.document, kind: date === (periodDate.current ?? todayDate) ? 'today' : 'history' })
      return { kind: 'available' }
    }
    if (result?.state === 'missing') return { kind: 'missing' }
    if (result?.state === 'unavailable') {
      const generationTrace = readGenerationTrace(result.generationTrace)
      return { kind: 'failed', failureCode: result.failureCode, ...(generationTrace === undefined ? {} : { generationTrace }) }
    }
    return { kind: 'unknown' }
  }

  const openEdition = (date: string, target: 'zh-CN' | 'en-US', rowHint?: DailyBriefingEditionSummary, periodId?: string): void => {
    const row = rowHint ?? editions.find((edition) => edition.date === date && (periodId === undefined || edition.periodId === periodId))
    // 一行 = 一期 = 一种语言：身份是三样。此前这里只比日期与语言，同一天两期同为中文时（07:00 与
    // 08:00），点第二期日期和语言都相同 → 提前返回，右侧还是上一份。少一个维度的判断，和「点一个
    // 选中两个」是同一个形状。
    const wantedPeriod = row?.periodId ?? periodId ?? 'default'
    const documentPeriod = readyDocument === undefined ? undefined : briefingEditionPeriod(readyDocument.edition).periodId
    if (readyDocument && readyDocument.edition.date === date && readyDocument.edition.locale === target
      && (periodId === undefined || documentPeriod === wantedPeriod)) return
    setPinnedDate(date)
    const request = ++requestRef.current
    setRegenerateFailure(null)
    if (!row) {
      setView({ status: 'locale-missing', locale: target, date, ...(date !== todayDate ? { historical: true } : {}) })
      return
    }
    if (row.state === 'missing') {
      setView({ status: 'no-edition', date, failed: Boolean(row.attemptCount) })
      if (!row.attemptCount) return
    }
    setView((current) => current.status === 'no-edition' && current.date === date ? current : { status: 'loading' })
    void readEdition(date, target, { ...(periodId ? { periodId } : {}) })
      .then((read) => {
        if (request !== requestRef.current) return
        if (read.kind === 'available') return
        const other = (row.availableLocales ?? []).find((candidate: 'zh-CN' | 'en-US') => candidate !== target)
        // A day that did not publish says which nothing it is; a failed attempt carries its code and
        // this version cannot backfill a past day, so the pane owns both facts.
        // 失败的那一版：码 + **这次尝试自己的**步骤一起落进视图。步骤不借同一天另一期的，
        // 也不落回已存版次的 trace —— 那会让读者以为这一版真跑过那几步。
        if (row.state === 'missing') setView({
          status: 'no-edition',
          date,
          failed: read.kind === 'failed',
          ...(read.kind === 'failed' && read.failureCode ? { failureCode: read.failureCode } : {}),
          ...(read.kind === 'failed' && read.generationTrace ? { generationTrace: read.generationTrace } : {})
        })
        else if (other) setView({ status: 'locale-missing', locale: target, date, ...(date !== todayDate ? { historical: true } : {}) })
        else setView({ status: 'no-edition', date, failed: false })
      })
      .catch(() => { if (request === requestRef.current) setView({ status: 'no-edition', date, failed: row.state === 'missing' }) })
  }
  return { readEdition, openEdition }
}
