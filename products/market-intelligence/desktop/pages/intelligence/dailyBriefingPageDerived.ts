import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'

import type { DailyBriefingClient, DailyBriefingClientTodayResult } from '../../shared/ipc/dailyBriefingClient'
import type { BriefFailure } from './DailyBriefingFailurePanel'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import type { DailyBriefingText } from './dailyBriefingText'
import { type GenerationTrace, readGenerationTrace } from './dailyBriefingGenerationTrace'

/**
 * The page's pure derivations, kept out of it.
 *
 * They answer questions the reader sees — which summary a freshly read document turns into, which
 * sentence a failure code becomes, how many issues of each severity there are — and none of them
 * touch React. The page itself had grown past the size limit by carrying them inline; a page is a
 * layout, not a place for four small functions that a test can call on their own.
 */

export function summaryFromDocument(document: DailyBriefingDocument): DailyBriefingEditionSummary {
  return {
    date: document.edition.date,
    periodId: 'default',
    locale: document.edition.locale,
    availableLocales: [document.edition.locale],
    state: 'generated',
    generatedAt: document.edition.generatedAt,
    ...(document.conclusion ? { direction: document.conclusion.direction } : {}),
    readingsAvailable: document.status.readingsAvailable,
    windowEnd: document.edition.windowEnd
  }
}

export async function withDeadline<T>(read: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('daily-briefing-request-timeout')), milliseconds)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Read the edition that already exists for one day and language, never starting a run.
 *
 * The language tab is a look, not a request: opening the page may still generate today's edition,
 * but a glance at the other language must not spend a model call. The answer keeps the shape of an
 * open so the page has one branch below it.
 */
export async function readExistingEdition(client: Pick<DailyBriefingClient, 'get'>, date: string, locale: 'zh-CN' | 'en-US'): Promise<DailyBriefingClientTodayResult | undefined> {
  const existing = await withDeadline(client.get({ date, locale }), 8_000).catch(() => undefined)
  if (!existing) return undefined
  if (existing.state === 'available') return { state: 'available', document: existing.document }
  return { state: 'unavailable', failureCode: existing.state === 'unavailable' ? existing.failureCode : 'edition-missing' }
}

export function localDate(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function editorialFailureText(code: string, text: DailyBriefingText): string {
  return (text.aiSettings.failure as Readonly<Record<string, string>>)[code] ?? code
}

/** "2 blocking · 3 warnings · 1 note", with empty severities omitted. */
export function issueCountsText(
  counts: Readonly<Record<'blocking' | 'warning' | 'info', number>>,
  text: DailyBriefingText
): string {
  return (['blocking', 'warning', 'info'] as const)
    .filter((severity) => counts[severity] > 0)
    .map((severity) => text.limits.counts[severity].replace('{count}', String(counts[severity])))
    .join(' · ')
}

/**
 * Which failure, if any, the page is showing — and whether the stored edition may still be read.
 *
 * Three sources in one order: a retry this page started, the editorial gate recorded inside a
 * stored edition, and a failed open. Kept out of the page: the branches are the whole answer, and
 * a wrong order here shows a retry failure as a successful edition.
 */
export function briefingFailure(input: Readonly<{
  view: DailyBriefingPageViewState
  regenerateFailure: Readonly<{ code?: string; generationTrace?: GenerationTrace }> | null
}>): Readonly<{ failure: BriefFailure | null; editorialBlocked: boolean }> {
  const { view, regenerateFailure } = input
  const editorialFailureCode = view.status === 'ready' ? view.document.provenance.editorialFailure : undefined
  const editorialBlocked = Boolean(editorialFailureCode && editorialFailureCode !== 'editorial-disabled')
  if (regenerateFailure) {
    return {
      editorialBlocked,
      failure: {
        kind: 'generation',
        ...(regenerateFailure.code ? { code: regenerateFailure.code } : {}),
        ...(regenerateFailure.generationTrace ? { generationTrace: regenerateFailure.generationTrace } : {})
      }
    }
  }
  if (editorialBlocked && view.status === 'ready' && editorialFailureCode) {
    const editorialTrace = readGenerationTrace((view.document.provenance as unknown as Readonly<{ generationTrace?: unknown }>).generationTrace)
    return {
      editorialBlocked,
      failure: {
        kind: 'editorial',
        code: editorialFailureCode,
        ...(view.document.provenance.editorialFailureDetail ? { detail: view.document.provenance.editorialFailureDetail } : {}),
        ...(editorialTrace ? { generationTrace: editorialTrace } : {})
      }
    }
  }
  if (view.status === 'unavailable' && view.failureCode) {
    return {
      editorialBlocked,
      failure: {
        kind: 'generation',
        code: view.failureCode,
        ...(view.generationTrace ? { generationTrace: view.generationTrace } : {})
      }
    }
  }
  return { failure: null, editorialBlocked }
}
