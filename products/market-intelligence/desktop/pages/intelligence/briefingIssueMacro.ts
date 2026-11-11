import type { BriefingMacroItem, BriefingNextItem } from '../../../contracts/dailyBriefing'
import type { BriefingIssue, BriefingIssueInput } from './dailyBriefingIssues'
import { eventTitle, fillTemplate } from './dailyBriefingIssueLabels'

/**
 * 宏观与「接下来」那几行在右列的缺口：缺预期、缺实际、缺前值、两个来源说两个数。
 *
 * 抽出来的理由不是行数：它有一条自己的判断——**讲话/声明类事件没有数值是设计如此，不是缺口**
 * （`02` v2.133 B 案）。判据落在数据上（没有实际值、没有预期、没有前值三者全无），不靠事件名，
 * 也**不进右列**：记成缺口会让读者和排查的人都以为坏了，而它本来就不会有数。
 */
type AddIssue = (issue: Omit<BriefingIssue, 'at' | 'code'> & Readonly<{ at?: string }>) => void

export function collectMacroIssues(input: BriefingIssueInput, add: AddIssue): void {
  for (const item of input.document.news.macro) macroItemIssues(input, add, item)
  // 两个来源说两个数（`02` v2.128）：值格整格不渲染，右列**恰一条**冲突说明（按事件数合并）。
  const conflicts = input.document.news.notes.macroValueConflicts ?? []
  if (conflicts.length > 0) {
    add({
      id: 'data:macro:value-conflict', severity: 'warning', category: 'data', template: 'macro-value-conflict',
      source: input.text.limits.sources.calendar, at: input.document.edition.generatedAt,
      title: input.text.limits.macro.valueConflict, advice: input.text.limits.advice.checkCalendar
    })
  }
  for (const item of [input.document.next.focus, ...input.document.next.items]) {
    if (item) nextItemIssues(input, add, item)
  }
}

function isStatementOnly(item: BriefingMacroItem): boolean {
  return !item.actual && !item.consensus && !item.previous
}

function macroItemIssues(input: BriefingIssueInput, add: AddIssue, item: BriefingMacroItem): void {
  const { text } = input
  if (isStatementOnly(item)) return
  const name = eventTitle(item, input.eventTitles)
  // 时刻没公布（`MI-1-R39` §4）就没有事件时刻可印：`scheduledAt` 只是排序位，印到缺口清单里就是
  // 一个假时刻。这时不传 `at`，缺口读文档的约定兜底（这一版什么时候核的），不说成发布时刻。
  const at = item.releaseTimeNotPublished ? undefined : item.scheduledAt
  if (!item.consensus) {
    add({
      id: `data:macro:consensus:${item.eventKey}`, severity: 'warning', category: 'data', template: 'macro-consensus',
      source: text.limits.sources.calendar, ...(at === undefined ? {} : { at }),
      title: fillTemplate(text.limits.macro.consensusMissing, { event: name }), advice: text.limits.advice.fillConsensus
    })
  }
  if (!item.actual) {
    add({
      id: `data:macro:actual:${item.eventKey}`, severity: 'warning', category: 'data', template: 'macro-actual',
      source: text.limits.sources.calendar, ...(at === undefined ? {} : { at }),
      title: fillTemplate(text.limits.macro.actualMissing, { event: name }), advice: text.limits.advice.waitCollection
    })
  }
  if (!item.previous) {
    add({
      id: `data:macro:previous:${item.eventKey}`, severity: 'info', category: 'data', template: 'macro-previous',
      source: text.limits.sources.calendar, ...(at === undefined ? {} : { at }),
      title: fillTemplate(text.limits.macro.previousMissing, { event: name }), advice: text.limits.advice.waitCollection
    })
  }
}

function nextItemIssues(input: BriefingIssueInput, add: AddIssue, item: BriefingNextItem): void {
  const { text } = input
  const name = eventTitle(item, input.eventTitles)
  // 与宏观那三行同一条规矩：时刻没公布就没有事件时刻可印，别把排序位当成发布时刻。
  const at = item.releaseTimeNotPublished ? undefined : item.at
  if (!item.consensus) {
    add({
      id: `data:next:consensus:${item.eventKey}`, severity: 'warning', category: 'data', template: 'macro-consensus',
      source: text.limits.sources.calendar, ...(at === undefined ? {} : { at }),
      title: fillTemplate(text.limits.macro.consensusMissing, { event: name }), advice: text.limits.advice.fillConsensus
    })
  }
  if (!item.previous) {
    add({
      id: `data:next:previous:${item.eventKey}`, severity: 'info', category: 'data', template: 'macro-previous',
      source: text.limits.sources.calendar, ...(at === undefined ? {} : { at }),
      title: fillTemplate(text.limits.macro.previousMissing, { event: name }), advice: text.limits.advice.waitCollection
    })
  }
}
