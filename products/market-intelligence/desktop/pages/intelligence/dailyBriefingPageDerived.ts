import type { DailyBriefingDocument, DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { briefingEditionPeriod } from '../../../contracts/dailyBriefing'

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
  // 期号来自文档自己，不写死 `default`：手动期的那一版写进列表时若按默认期算，同一天就会出现
  // 两条身份相同的行（键 = 日期 + 期号 + 语言），点一条会同时选中两条。
  const period = briefingEditionPeriod(document.edition)
  return {
    date: document.edition.date,
    periodId: period.periodId,
    periodTime: period.periodTime,
    periodKind: period.periodKind,
    runTrigger: period.runTrigger,
    locale: document.edition.locale,
    availableLocales: [document.edition.locale],
    state: 'generated',
    generatedAt: document.edition.generatedAt,
    // 列表的第二行是这一份在讲什么：新读到的文档自带这句话，不带的话写回列表后那一行就没有摘要
    // （今天那一行曾经因此空着，直到下一次整表刷新才恢复）。
    ...(document.lede.text === '' ? {} : { summaryLine: document.lede.text }),
    ...(document.conclusion ? { direction: document.conclusion.direction } : {}),
    readingsAvailable: document.status.readingsAvailable,
    windowEnd: document.edition.windowEnd
  }
}

/**
 * 新读到的这一版写回列表：只替换**同一行**——日期 + 期号 + 语言三者都相同的那一行。
 *
 * 按日期整片替换是"一天一份"时代的写法：照着数据里真实的两行看，它会把英文那一行写成中文版
 * （语言来自新文档），于是两行的语言、键都相同，列表里出现两个「中文」，一条英文标题。
 * 版次是一行，写回也必须是一行。
 */
export function mergeEditionSummary(
  rows: readonly DailyBriefingEditionSummary[],
  document: DailyBriefingDocument
): readonly DailyBriefingEditionSummary[] {
  const fresh = summaryFromDocument(document)
  const index = rows.findIndex((row) => row.date === fresh.date && row.periodId === fresh.periodId && row.locale === fresh.locale)
  if (index < 0) return [fresh, ...rows]
  return rows.map((row, position) => position === index
    ? {
      // 列表那一行先摆：排期时刻、尝试次数、这一期发布过哪些语言都只在它身上。新文档只覆盖它
      // 真正知道的东西——否则一次刷新会把这一行读成"另一条记录"，摘要那一格首当其冲。
      ...row,
      ...fresh,
      // 新文档只知道它自己的语言；这一期还发布过哪些语言，列表那一行知道，别丢。
      availableLocales: [...new Set([...row.availableLocales, ...fresh.availableLocales])],
      ...(row.expectedLocales === undefined ? {} : { expectedLocales: row.expectedLocales })
    }
    : row)
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

/**
 * What the rail and the poster need from the list, derived once.
 *
 * These answers were three inline expressions in the page, each recomputing "is there an edition".
 * Kept together so "this issue has an edition" has one shape.
 */
export function briefingListFacts<T extends Readonly<{ date: string; state: string; generatedAt?: string; scheduledTime?: string }>>(
  editions: readonly T[],
  todayDate: string
): Readonly<{ lastGeneratedAt?: string; scheduledTime?: string; todayMissing: boolean; hasTodayEdition: boolean }> {
  return {
    lastGeneratedAt: editions.find((edition) => edition.generatedAt && edition.state !== 'missing')?.generatedAt,
    scheduledTime: editions.find((edition) => edition.scheduledTime !== undefined)?.scheduledTime,
    todayMissing: editions.some((edition) => edition.date === todayDate && edition.state === 'missing'),
    hasTodayEdition: editions.some((edition) => edition.date === todayDate && edition.state !== 'missing')
  }
}
