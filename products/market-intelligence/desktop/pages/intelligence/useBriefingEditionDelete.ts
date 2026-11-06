import { useState } from 'react'

import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { useDailyBriefingIssueDeletion, type BriefingIssueTarget } from './useDailyBriefingIssueDeletion'
import type { BriefingEditionDeleteTarget } from './briefingEditionDeleteConfirm'

/**
 * Deleting the edition on screen: one action, two entries, one state.
 *
 * The toolbar's fifth button and the row's right-click menu both land here, so "which edition is
 * being deleted" and "is a delete running" have exactly one answer. The language to read afterwards
 * is decided **before** the delete starts — after it, that row is gone and the question has no
 * answer left to read.
 */
export function useBriefingEditionDelete(input: Readonly<{
  /** 与删除服务要求的那一份完全一致：这里再多要一个字段，页面就得为它造一个假客户端。 */
  client: Parameters<typeof useDailyBriefingIssueDeletion>[0]['client']
  editions: readonly DailyBriefingEditionSummary[]
  afterDeleteLocaleRef: { current: DailyBriefingLocale | null }
  /** 被删掉那一版的身份：删完之后"下一版是谁"要按它取邻居，不能按日期猜。 */
  afterDeleteRef: { current: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }> | null }
  onSettled: () => void
}>): Readonly<{
  deleteOutcome: ReturnType<typeof useDailyBriefingIssueDeletion>['outcome']
  deleting: boolean
  deleteEdition: (target: BriefingEditionDeleteTarget & Readonly<{ periodId: string; entry: 'toolbar' | 'row-menu' }>) => void
  takeSkipGenerate: ReturnType<typeof useDailyBriefingIssueDeletion>['takeSkipGenerate']
  /** 重试某一次删除（失败提示条上的那颗按钮）。 */
  retryDelete: (target: BriefingIssueTarget) => void
}> {
  const { outcome: deleteOutcome, deletePeriod, takeSkipGenerate } = useDailyBriefingIssueDeletion({ client: input.client, onSettled: input.onSettled })
  const [deleting, setDeleting] = useState(false)
  const deleteEdition = (target: BriefingEditionDeleteTarget & Readonly<{ periodId: string; entry: 'toolbar' | 'row-menu' }>): void => {
    const row = input.editions.find((edition) => edition.date === target.date && edition.periodId === target.periodId)
    input.afterDeleteLocaleRef.current = (row?.availableLocales ?? []).find((language) => language !== target.language) ?? null
    input.afterDeleteRef.current = { date: target.date, periodId: target.periodId, locale: target.language }
    setDeleting(true)
    void deletePeriod({
      date: target.date, periodId: target.periodId, locale: target.language, entry: target.entry,
      ...(target.clock === undefined ? {} : { clock: target.clock })
    }).finally(() => setDeleting(false))
  }
  return { deleteOutcome, deleting, deleteEdition, takeSkipGenerate, retryDelete: (target: BriefingIssueTarget) => { void deletePeriod(target) } }
}
