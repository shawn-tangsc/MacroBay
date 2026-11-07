import { Tooltip } from '@platform/ui/components/tooltip'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { Info } from 'lucide-react'
import { LoadingState } from '@platform/ui/components/loading'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { useId, useState } from 'react'

import type { DivergenceBound } from '../../../../contracts/marketDivergence'
import type { DashboardDivergenceViewState, DivergenceWithheldView } from '../../../pages/intelligence/dashboardDivergenceModel'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { DivergencePanelText } from './divergenceText'

import './DivergencePanel.css'

/**
 * 收进 ⓘ 的四句，逐句一个字面键（守卫要查点分形状，模板字符串会把拼写藏起来）。
 */
export const divergenceNoteKeys = Object.freeze([
  'pages.intelligence.portal.dashboard.divergence.notes.0',
  'pages.intelligence.portal.dashboard.divergence.notes.1',
  'pages.intelligence.portal.dashboard.divergence.notes.2',
  'pages.intelligence.portal.dashboard.divergence.notes.3'
])

/**
 * One line about the day, and the readings behind it when the reader asks.
 *
 * The card used to print every reading inline: with three pairs, three leg rows and a threshold
 * sentence each, it pushed the cards below it down the screen and read as an alarm even on a quiet
 * day. The reader's decision (2026-11-08) is one neutral line — an index, not a conclusion — and
 * the readings one click away. Direction colour therefore never reaches the summary line: with two
 * pairs pointing different ways it would be wrong for one of them.
 */
export function DivergencePanel({ state, text, onRetry }: Readonly<{
  state: DashboardDivergenceViewState
  text: DivergencePanelText
  /** Always required: a failed read has one honest next step, and it must not appear and vanish. */
  onRetry: () => void
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const resolveProductKey = useProductTextKey()
  const detailId = useId()
  const [expanded, setExpanded] = useState(false)
  const when = (value: string) => formatTime(`${value.replace('T', ' ').slice(0, 19)}Z`)

  const rows = state.state === 'available' ? state.rows : []
  const withheld = state.state === 'available' || state.state === 'empty' ? state.withheld : []
  const grouped = groupWithheld(withheld)
  /** A pair, not a reason: two pairs refused for the same missing leg are still two refusals. */
  const pairCount = new Set(withheld.map(entry => entry.pairId)).size
  const totalPairs = Object.keys(text.pairNames).length
  const allWithheld = pairCount >= totalPairs
  const summary = summaryLine({ rows: rows.length, pairCount, allWithheld, grouped, text, when })
  /**
   * Five states, one of which is not a control: a quiet day with nothing withheld has nothing to
   * open, so it is a plain paragraph — not a disabled button, and not a button that does nothing.
   */
  const expandable = rows.length > 0 || pairCount > 0

  if (state.state === 'loading') {
    return (
      <section className="mi-divergence" aria-label={text.title} data-state="loading">
        {/* 加载态不画摘要行：先给一句占位再换掉，比晚一句出现更容易读成「结论」。 */}
        <LoadingState label={text.loading} minHeight={40} />
      </section>
    )
  }
  if (state.state === 'unavailable') {
    return (
      <section className="mi-divergence" aria-label={text.title} data-state="unavailable" data-divergence-unavailable>
        <p role="status" className="mi-divergence__unavailable">{text.unavailableTrace}</p>
      </section>
    )
  }

  return (
    <section className="mi-divergence" aria-label={text.title} data-state={state.state}>
      {expandable ? (
        <button aria-controls={detailId} aria-expanded={expanded} className="mi-divergence__summary"
          onClick={() => setExpanded(current => !current)} type="button">
          <span className="mi-divergence__summary-text">{summary}</span>
          {/* 8px 的 `›` 用字符画，不用图标组件：摘要行里不许出现 `<svg>`（界面设计 v2 §四）。 */}
          <span aria-hidden="true" className="mi-divergence__summary-chevron">›</span>
        </button>
      ) : (
        <p className="mi-divergence__summary mi-divergence__summary--static">{summary}</p>
      )}
      {expandable && expanded ? (
        <div className="mi-divergence__content" data-divergence-detail id={detailId}>
          {/* 说明只有一处：展开区标题行尾的一颗 ⓘ，悬停/聚焦打开，四句全在里面。
              正文只留读数与证据——解释卡片本身怎么来的文字不占正文（界面 2026-11-08）。 */}
          <div className="mi-divergence__detail-head">
            <Popover lines={divergenceNoteKeys.map(labelKey => ({ labelKey }))} resolveText={resolveProductKey}
              trigger={triggerProps => (
                <IconButton {...triggerProps} ariaLabelKey="pages.intelligence.portal.dashboard.divergence.helpLabel"
                  icon={Info} resolveText={resolveProductKey} size="sm" variant="plain" />
              )} />
          </div>
          {/* 没判成的组放最上面：读者点开最常见的理由是「为什么这组没结论」。一组一条（按配对去重，
              不是按原因合并），原因用的就是卡片原来那几句，不另造。 */}
          {pairCount > 0 ? (
            <ul className="mi-divergence__withheld">
              {[...new Map(withheld.map(entry => [entry.pairId, entry])).values()].map(entry => (
                <li className="mi-divergence__withheld-item" data-reason={entry.reason} key={entry.pairId}>
                  <b>{text.pairNames[entry.pairId as keyof DivergencePanelText['pairNames']]}</b>
                  {text.labelSep}{withheldLine(text, entry, when)}
                </li>
              ))}
            </ul>
          ) : null}
          {rows.length > 0 ? (
            <ul className="mi-divergence__rows">
              {rows.map(row => {
                const mechanism = text.pairs[row.pairId as keyof DivergencePanelText['pairs']].mechanism
                return (
                  // Focusable, not titled: a `title` is invisible to the keyboard, so the
                  // invalidation sentence opens on focus as well as on hover (one line → Tooltip).
                  <Tooltip dataText={invalidationLine(row.pairId, text)} key={row.pairId} resolveText={resolveProductKey}>
                    <li className="mi-divergence__row" data-direction={row.direction} data-pair={row.pairId} tabIndex={0}>
                      <div className="mi-divergence__line">
                        <b className="mi-divergence__direction" data-direction={row.direction}>
                          {row.direction === 'unpriced' ? text.observedLabel : text.directions[row.direction]}
                        </b>
                        {row.legs.map(leg => <span className="mi-divergence__leg" key={leg.id}><i>{text.legs[leg.id]}</i>{leg.text}</span>)}
                      </div>
                      {mechanism === undefined ? null : <p className="mi-divergence__mechanism">{mechanism}</p>}
                      {/* 每条腿各自的截至时刻：一条腿的「截至」不能替另一条腿作证。 */}
                      {/* 顺序固定：截至 → 规则（→ 还差）。「还差」要投影层给，今天没有这一项就不显示，
                          不许拿规则反推一个距离。 */}
                      <p className="mi-divergence__asof">{[
                        row.legs.map(leg => `${text.legs[leg.id]} ${text.chipAsOf.replace('{at}', when(leg.observedAt))}`).join(' · '),
                        row.bound === undefined ? undefined : boundRuleClause(text, row.bound)
                      ].filter(part => part !== undefined).join(' · ')}</p>
                    </li>
                  </Tooltip>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/**
 * The five summary sentences, verbatim (design v2 §二).
 *
 * No count of divergences: the three pairs' thresholds do not overlap, so at most one can hold and
 * "2 divergences" is unreachable — a constant in a sentence is noise (the same reason the v1 badge
 * was withdrawn). What *can* be 1–2 is how many pairs refused to answer, and that is where the
 * number still carries information. If the thresholds ever change, this line and its assertions
 * have to be reconsidered in the same change.
 */
function summaryLine(input: Readonly<{
  rows: number
  pairCount: number
  allWithheld: boolean
  grouped: ReturnType<typeof groupWithheld>
  text: DivergencePanelText
  when: (value: string) => string
}>): string {
  const { rows, pairCount, allWithheld, grouped, text, when } = input
  if (allWithheld) return text.summary.allWithheld
  // 冒号后是「那唯一一组」的腿与原因，不是固定写舆情：原型里恰好是舆情腿，照抄就错。
  const reason = pairCount === 1 && grouped[0] !== undefined ? withheldLine(text, grouped[0], when) : undefined
  if (rows > 0) {
    if (pairCount === 0) return text.summary.divergence
    return reason === undefined
      ? fillLabelParams(text.summary.divergenceWithheldMany, { count: String(pairCount) })
      : fillLabelParams(text.summary.divergenceWithheldOne, { reason })
  }
  if (pairCount === 0) return text.summary.quiet
  return reason === undefined
    ? fillLabelParams(text.summary.quietWithheldMany, { count: String(pairCount) })
    : fillLabelParams(text.summary.quietWithheldOne, { reason })
}

/**
 * 「规则 ≥ +3%」这个子句——**全卡只在这里拼**（界面规格 v3 §八；复核后要改只改这一处）。
 *
 * 阈值只从契约读，不取绝对值、不做百分比换算；负号用排版减号。绝对值那条读作「变动不超过」——
 * 它和「≤ −3%」是同一个 `atMost`，区别只在阈值是正是负，所以不新增第三个 comparator。
 */
export function boundRuleClause(text: DivergencePanelText, bound: DivergenceBound): string {
  // 符号跟着句式走：`≥ +3%` 带正号（那是一个下界），`≤ −3%` 带排版减号，
  // 绝对值那条写 `1%` 不带号（它说的是「变动不超过」，不是一个带方向的数）。
  const absolute = bound.comparator === 'atMost' && bound.threshold > 0
  const magnitude = bound.threshold < 0 ? `−${-bound.threshold}` : String(bound.threshold)
  const threshold = absolute ? magnitude : bound.comparator === 'atLeast' && bound.threshold > 0 ? `+${magnitude}` : magnitude
  const template = bound.comparator === 'atLeast'
    ? text.boundAtLeast
    : bound.threshold < 0 ? text.boundAtMostNegative : text.boundAtMostAbsolute
  return fillLabelParams(template, { threshold: `${threshold}%` })
}

/**
 * The sentence for one refused pair.
 *
 * A sentiment leg that answered "nothing took a side" is a fact about the day, so it keeps its own
 * line instead of the generic "we did not get it" — the reader must be able to tell a quiet day
 * from a failed read.
 */
function withheldLine(
  text: DivergencePanelText,
  group: Readonly<{ reason: DivergenceWithheldView['reason']; leg: DivergenceWithheldView['leg']; observedAt?: string }>,
  when: (value: string) => string
): string {
  if (group.reason === 'leg-missing' && group.leg === 'sentiment') return text.sentimentNoScoredItems.replace('{leg}', text.legs[group.leg])
  return text.withheldReasons[group.reason].replace('{leg}', text.legs[group.leg]).replace('{at}', group.observedAt ? when(group.observedAt) : text.missingValue)
}

/**
 * One entry per reason, not per pair: two pairs held back for the same missing leg is one fact
 * about the data, and printing it twice reads like a rendering fault.
 */
export function groupWithheld(entries: readonly DivergenceWithheldView[]): readonly Readonly<{
  key: string
  reason: DivergenceWithheldView['reason']
  leg: DivergenceWithheldView['leg']
  observedAt?: string
  count: number
}>[] {
  const groups = new Map<string, { key: string; reason: DivergenceWithheldView['reason']; leg: DivergenceWithheldView['leg']; observedAt?: string; count: number }>()
  for (const entry of entries) {
    const key = `${entry.reason}:${entry.leg}:${entry.observedAt ?? ''}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else {
      groups.set(key, {
        key, reason: entry.reason, leg: entry.leg,
        ...(entry.observedAt ? { observedAt: entry.observedAt } : {}),
        count: 1
      })
    }
  }
  return [...groups.values()]
}

/**
 * The one line a reader gets on the row: what invalidates this reading.
 */
const invalidationLine = (pairId: string, text: DivergencePanelText): string =>
  `${text.invalidationLabel}${text.labelSep}${text.pairs[pairId as keyof DivergencePanelText['pairs']].invalidation}`
