import type { MutableRefObject } from 'react'

import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'

/**
 * Reading one edition: one entry, one answer.
 *
 * A row click and a language switch both come here with a date and a language; the answer is cached
 * per `${date}:${locale}`, so moving away and back is a render rather than a second read. The reader
 * never generates, and it reports what it found — an edition, no edition in this language, a failed
 * attempt — so the caller can say which one it is instead of guessing from a boolean.
 */
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
  readEdition: (date: string, target: 'zh-CN' | 'en-US', options?: Readonly<{ fresh?: boolean }>) => Promise<Readonly<{ kind: 'available' | 'missing' | 'failed' | 'unknown'; failureCode?: string }>>
  openEdition: (date: string, target: 'zh-CN' | 'en-US', rowHint?: DailyBriefingEditionSummary) => void
}> {
  const { client, editions, todayDate, readyDocument, requestRef, cache, periodDate, setView, setPinnedDate, setRegenerateFailure } = input
  const readEdition = async (date: string, target: 'zh-CN' | 'en-US', options: Readonly<{ fresh?: boolean }> = {}): Promise<Readonly<{ kind: 'available' | 'missing' | 'failed' | 'unknown'; failureCode?: string }>> => {
    const key = `${date}:${target}`
    const cached = options.fresh ? undefined : cache.current.get(key)
    if (cached) {
      setView({ status: 'ready', document: cached, kind: date === (periodDate.current ?? todayDate) ? 'today' : 'history' })
      return { kind: 'available' }
    }
    const result = await client.get({ date, locale: target }).catch(() => undefined)
    if (result?.state === 'available') {
      cache.current.set(key, result.document)
      setView({ status: 'ready', document: result.document, kind: date === (periodDate.current ?? todayDate) ? 'today' : 'history' })
      return { kind: 'available' }
    }
    if (result?.state === 'missing') return { kind: 'missing' }
    if (result?.state === 'unavailable') return { kind: 'failed', failureCode: result.failureCode }
    return { kind: 'unknown' }
  }

  const openEdition = (date: string, target: 'zh-CN' | 'en-US', rowHint?: DailyBriefingEditionSummary): void => {
    const row = rowHint ?? editions.find((edition) => edition.date === date)
    if (readyDocument && readyDocument.edition.date === date && readyDocument.edition.locale === target) return
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
    void readEdition(date, target)
      .then((read) => {
        if (request !== requestRef.current) return
        if (read.kind === 'available') return
        const other = (row.availableLocales ?? []).find((candidate: 'zh-CN' | 'en-US') => candidate !== target)
        // A day that did not publish says which nothing it is; a failed attempt carries its code and
        // this version cannot backfill a past day, so the pane owns both facts.
        if (row.state === 'missing') setView({ status: 'no-edition', date, failed: read.kind === 'failed', ...(read.kind === 'failed' && read.failureCode ? { failureCode: read.failureCode } : {}) })
        else if (other) setView({ status: 'locale-missing', locale: target, date, ...(date !== todayDate ? { historical: true } : {}) })
        else setView({ status: 'no-edition', date, failed: false })
      })
      .catch(() => { if (request === requestRef.current) setView({ status: 'no-edition', date, failed: row.state === 'missing' }) })
  }
  return { readEdition, openEdition }
}
