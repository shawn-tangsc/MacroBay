import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { briefingFailedNotice, briefingTimeLabel, notifyDailyBriefing, type DailyBriefingNoticeSubmit } from './dailyBriefingNotifier'
import type { DailyBriefingAttemptJournal } from './dailyBriefingAttemptJournal'
import type { DailyBriefingPeriodRunJournal } from './dailyBriefingPeriodRunJournal'
import type { DailyBriefingGenerationRecorder } from './dailyBriefingGenerationTrace'
import { withGenerationTrace } from './dailyBriefingStoredAttempt'
import { cutoffDate } from './dailyBriefingGenerationGuards'
import type { DailyBriefingStore } from './dailyBriefingService'
import type { DailyBriefingTodayFailureCode, DailyBriefingTodayResult } from './dailyBriefingService'

/**
 * 一跑结束之后的两件事：**落库并发布**，或者**什么都不发布但如实记账**。
 *
 * 抽出来有两个原因，都是被实测逼出来的：
 * 1. 服务文件已经顶到体积基线，这一段是它最独立的一块（只碰 store/attempt/run/通知）；
 * 2. 「发布」和「记成功」必须同时发生、也必须同时不发生——用户 2026-11-06 报的那次，
 *    页面说失败、库里记成功、正文却是空模板，就是因为这两件事各写了一遍。
 */
export async function publishDailyBriefingEdition(input: Readonly<{
  document: DailyBriefingDocument
  store: Pick<DailyBriefingStore, 'publishEdition' | 'put' | 'prune'> & Partial<Pick<DailyBriefingStore, 'finishAttempt'>>
  attempts: Pick<DailyBriefingAttemptJournal, 'build' | 'settle'>
  run: Pick<DailyBriefingPeriodRunJournal, 'settle'>
  recorder: Pick<DailyBriefingGenerationRecorder, 'begin' | 'end' | 'complete'>
  now: () => string
  noticeSubmit?: DailyBriefingNoticeSubmit
  date: string
  periodId: string
  locale: DailyBriefingLocale
  /** A manual run records the completion notice without delivering it: the reader asked for a run, not a push. */
  deliver: boolean
}>): Promise<DailyBriefingTodayResult> {
  const { document, store, attempts, run, recorder, date, periodId, locale } = input
  recorder.begin('store')
  recorder.end('store', 'success')
  const traced = withGenerationTrace(document, recorder.complete(document.provenance.editorialFailure ? 'failed' : 'success'))
  try {
    const edition = {
      date,
      periodId,
      locale,
      generatedAt: traced.edition.generatedAt,
      windowStart: traced.edition.windowStart,
      windowEnd: traced.edition.windowEnd,
      document: traced
    }
    const settled = attempts.build('succeeded', traced.provenance.generationTrace?.finishedAt ?? input.now())
    // The edition row and the attempt that wrote it are one write: a reader never sees one without
    // the other.
    if (store.publishEdition) {
      await store.publishEdition(edition, settled)
    } else {
      await store.put(edition)
      if (settled) await store.finishAttempt?.(settled).catch(() => undefined)
    }
    await run.settle('published', 1)
  } catch {
    // Returning the document here would report a stored edition that does not exist; the next read
    // would fall back to a different generation, so surface the write failure instead.
    recorder.end('store', 'failed', { failureCode: 'store-failed' })
    // 失败也要带阶段表、也要把这一跑记成失败（以前走到同一个 `fail()` 出口，现在拆开了不能丢）。
    const failedTrace = recorder.complete('failed')
    await attempts.settle('failed', failedTrace.finishedAt ?? input.now(), { failureCode: 'store-failed', trace: failedTrace })
    await run.settle('failed', 0)
    await notifyDailyBriefing(input.noticeSubmit, {
      kind: 'failed', variant: 'not-generated', date, periodId
    }, input.now())
    return {
      state: 'unavailable',
      failureCode: 'store-failed' as DailyBriefingTodayFailureCode,
      generationTrace: failedTrace
    }
  }
  await store.prune(cutoffDate(date)).catch(() => undefined)
  await notifyDailyBriefing(input.noticeSubmit, {
    kind: 'ready', date, periodId, editionId: `${date}:${locale}:${periodId}`, locale, deliver: input.deliver,
    timeLabel: briefingTimeLabel(traced.edition.windowEnd, traced.edition.timeZone)
  }, input.now())
  return { state: 'available', document: traced }
}

/**
 * 写作没出来：**一行都不落库**，并把这一跑记成失败（用户 2026-11-06 拍板）。
 *
 * 以前这里发的是事实层模板版：页面能打开、却没有任何解读，而库里记的是成功。现在失败就是失败，
 * 原因码原样回给页面，右列与失败面板据此说清是超时、输出不合规还是模型不可用。
 */
export async function abandonDailyBriefingEditorial(input: Readonly<{
  failureCode: string
  attempts: Pick<DailyBriefingAttemptJournal, 'settle'>
  run: Pick<DailyBriefingPeriodRunJournal, 'settle'>
  recorder: Pick<DailyBriefingGenerationRecorder, 'complete'>
  now: () => string
  noticeSubmit?: DailyBriefingNoticeSubmit
  date: string
  periodId: string
  locale?: DailyBriefingLocale
  /** 这一期的名义截止与它自己的时区：失败时也要点名到"哪一期"。 */
  asOf?: string
  timeZone?: string
}>): Promise<DailyBriefingTodayResult> {
  const trace = input.recorder.complete('failed')
  await input.attempts.settle('failed', trace.finishedAt ?? input.now(), { failureCode: input.failureCode, trace })
  await input.run.settle('failed', 0)
  await notifyDailyBriefing(input.noticeSubmit, briefingFailedNotice({
    variant: 'editorial-missing', date: input.date, periodId: input.periodId,
    locale: input.locale ?? 'zh-CN',
    asOf: input.asOf ?? input.now(), timeZone: input.timeZone ?? 'UTC'
  }), input.now())
  return {
    state: 'unavailable',
    failureCode: input.failureCode as DailyBriefingTodayFailureCode,
    generationTrace: trace
  }
}
