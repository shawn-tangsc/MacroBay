import { Tooltip } from '@platform/ui/components/tooltip'
import { IconButton } from '@platform/ui/components/icon-button'

import { Popover } from '@platform/ui/components/popover'
import { ChevronRight, Info } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { Modal } from '@platform/ui/components/modal'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { useEffect, useRef, useState } from 'react'

import type { DashboardDivergenceViewState, DivergenceWithheldView } from '../../../pages/intelligence/dashboardDivergenceModel'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { SignalDetail } from '../shared'
import type { DivergencePanelText } from './divergenceText'

import './DivergencePanel.css'

/**
 * A conclusion about the card above it.
 *
 * Only readings are on the card: the "why this was judged, and by whom" prose lives behind the `?`
 * before the title, because a reader who came for the readings should not have to step over four
 * lines of explanation to reach them.
 */
/**
 * The bubble's four one-look bullets, one literal key per line.
 *
 * Literal on purpose: a guard checks that each key is a dotted path, and a template string would
 * hide the spelling from it. Four is also the popover's cap — the notes that would not fit moved
 * behind their own entry below the card.
 */
export const divergenceHelpBulletKeys = Object.freeze([
  'pages.intelligence.portal.dashboard.divergence.helpBullets.0',
  'pages.intelligence.portal.dashboard.divergence.helpBullets.1',
  'pages.intelligence.portal.dashboard.divergence.helpBullets.2',
  'pages.intelligence.portal.dashboard.divergence.helpBullets.3'
])

export function DivergencePanel({ state, text, onRetry }: Readonly<{
  state: DashboardDivergenceViewState
  text: DivergencePanelText
  /** Only offered on a quiet day: asking the model for a second opinion costs a request. */
  /** Always required: a failed read has one honest next step, and it must not appear and vanish. */
  onRetry: () => void
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const withheld = state.state === 'available' || state.state === 'empty' ? state.withheld : []
  // Three pairs withheld is not "no divergence": nothing was compared. Saying so is the whole
  // point of the withheld list, and it must not read as a quiet day.
  const nothingCompared = state.state === 'empty' && withheld.length >= Object.keys(text.pairNames).length
  const when = (value: string) => formatTime(`${value.replace('T', ' ').slice(0, 19)}Z`)
  const resolveProductKey = useProductTextKey()
  // 口径说明不常驻、也不就地展开：入口就是牌子本身，点开是平台 Modal（读者 2026-11-07；
  // 界面设计 v2 §一 —— 卡面上不再多一颗按钮，牌子从「纯状态」变成「可点的状态」）。
  const [notesOpen, setNotesOpen] = useState(false)
  // 关掉 dialog 时把悬停说明静音，否则焦点回到牌子上会让气泡自己弹回来（v2 §二）。
  // 静音只由「指针离开」或「焦点离开且没有弹层」解除——读者回来时才重新给说明。
  const [tooltipMuted, setTooltipMuted] = useState(false)
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const closedOnce = useRef(false)
  // 静音会换掉牌子的节点（有没有 `Tooltip` 是两种结构），所以关闭后焦点由我们自己还给当前这颗。
  useEffect(() => {
    if (notesOpen || !closedOnce.current) return
    chipRef.current?.focus()
  }, [notesOpen])
  // The rule's chip: only the intraday pair gets one, and it prints no numbers — those stay on the
  // row below, once. "Data insufficient" is not a chip here: the card's own state already says why
  // the pair was withheld, and a second badge saying the same thing would read as a second failure.
  const intraday = state.state === 'available' ? state.rows.find(row => row.pairId === 'liquidity-leverage') : undefined
  /** One group per leg the pair is built from; a leg the row does not carry is simply not named. */
  const legGroups = (['stablecoin', 'open-interest'] as const).flatMap(legId => {
    const leg = intraday?.legs.find(entry => entry.id === legId)
    if (!leg) return []
    return [{
      labelKey: legId === 'stablecoin'
        ? 'pages.intelligence.portal.dashboard.divergence.legs.stablecoin'
        : 'pages.intelligence.portal.dashboard.divergence.legs.open-interest',
      rows: [{
        labelKey: 'pages.intelligence.portal.dashboard.divergence.chipFreshLabel',
        value: `${text.chipFresh} · ${text.chipAsOf.replace('{at}', when(leg.observedAt))}`
      }]
    }]
  })

  /**
   * 牌子：结论本身，也是口径说明的入口。
   *
   * 用原生 `button` 而不是 `IconButton`：后者内部先跑 `onClick` 再跑 `onSelect`，一颗按钮两条点击语义，
   * 上次在跨资产那边就让「钉住」切了两次。回车与空格由原生按钮给，`aria-haspopup` 说清点开是 dialog。
   */
  const chipButton = (
    <button aria-haspopup="dialog" aria-label={`${text.chip} · ${text.chipDetailsOpen}`}
      className="mi-divergence__chip" data-state="alert" ref={chipRef}
      onBlur={() => { if (!notesOpen) setTooltipMuted(false) }}
      onClick={() => { setNotesOpen(true) }}
      onMouseLeave={() => setTooltipMuted(false)}
      type="button">{text.chip}
      {/* 6px 的 `›`：只表示「点开有东西」，不是第二颗按钮，也不抢牌子上那几个字。 */}
      <ChevronRight aria-hidden="true" className="mi-divergence__chip-chevron" size={6} strokeWidth={2} />
    </button>
  )

  // Two different facts, two different treatments — merging them was the first version's mistake.
  //
  // "Nothing could be compared" means we DID read and every pair was short a leg: the card above
  // already carries 数据已滞后, so a constant apology here is noise. Hidden, per the reader's
  // request (168 §16). "The read failed" means WE could not look: hiding that would let a failure
  // pass for "nothing here", so it keeps one assertable line — no numbers, no block.
  if (nothingCompared) return <></>
  if (state.state === 'unavailable') {
    return (
      <section className="mi-divergence" aria-label={text.title} data-state="unavailable" data-divergence-unavailable>
        <p role="status" className="mi-divergence__unavailable">{text.unavailableTrace}</p>
      </section>
    )
  }

  return (
    <section className="mi-divergence" aria-label={text.title} data-state={state.state}>
      <div className="mi-divergence__lead">
        {/* The chip sits ahead of the help entries, where a card's title would be: it is the one
            thing on this line that says "something happened", and the readings stay below it.
            牌子就是入口（界面设计 v2）：它是一枚结论，不是筛选项也不是计数器——只在确有背离时出现，
            没有结论时整颗不渲染。原生 `button` 给回车与空格；`aria-haspopup` 说清点开是 dialog，
            不写 `aria-expanded`——那是就地展开才有的语义。右侧那枚 6px 的 `›` 是唯一的「点开有东西」线索，
            不加第二颗按钮、不加下划线。 */}
        {intraday ? (tooltipMuted
          ? chipButton
          : <Tooltip labelKey="pages.intelligence.portal.dashboard.divergence.chipTip" resolveText={resolveProductKey}>
            {chipButton}
          </Tooltip>) : null}
        {/* Four lines are four keys, one per line: arrays are the semantic shape here, and a
            joined sentence with newlines would be lost the first time the copy is translated. */}
        <Popover
          lines={divergenceHelpBulletKeys.map(labelKey => ({ labelKey }))}
          resolveText={resolveProductKey}
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="pages.intelligence.portal.dashboard.divergence.helpLabel"
              icon={Info} size="sm" resolveText={resolveProductKey} variant="plain" />
          )} />
      </div>
      <div className="mi-divergence__content">
        {/* state-ternary: reviewed — 这一枝只画「正在读」这一块，不藏任何内容；扫描窗口里看到的列表属于下面 available 分支，与它无关。 */}
        {state.state === 'loading' ? <LoadingState label={text.loading} minHeight={40} /> : null}
        {/* state-ternary: reviewed — 这一枝只输出一行「今天没有背离」，不渲染列表；列表见下面 available 分支。 */}
        {state.state === 'empty' ? (
          // One line, no block: a card with nothing to report must not take half a screen to say so,
          // and the platform's empty-state heading ("nothing here yet") adds nothing on a quiet day.
          <p className="mi-divergence__quiet">{text.empty}</p>
        ) : null}
        {/* state-ternary: reviewed — 仍是迁移前自己那套三态：`available` 才带 `rows`，读失败由上面的 error 分支单独处理。
            R161 迁到 `AsyncState` 时连同「按 rows.length 判」一起改，那时这条注释随之删掉。 */}
        {state.state === 'available' ? (
          <div className="mi-divergence__conclusion" data-tone="conclusion">
            <ul className="mi-divergence__rows">
              {state.rows.map(row => (
                // Focusable, not titled: a `title` is invisible to the keyboard and the reader, so the
                // invalidation sentence opens on focus as well as on hover (single line, so Tooltip).
                <Tooltip key={row.pairId} resolveText={resolveProductKey}
                  dataText={invalidationLine(row.pairId, text)}>
                <li className="mi-divergence__row" data-pair={row.pairId} data-direction={row.direction} tabIndex={0}>
                  <div className="mi-divergence__line">
                    <b className="mi-divergence__direction" data-direction={row.direction}>{text.directions[row.direction]}</b>
                    {row.legs.map(leg => <span key={leg.id} className="mi-divergence__leg"><i>{text.legs[leg.id]}</i>{leg.text}</span>)}
                  </div>
                  <p className="mi-divergence__mechanism">{text.pairs[row.pairId as keyof DivergencePanelText['pairs']].mechanism}</p>
                </li>
                </Tooltip>
              ))}
            </ul>
          </div>
        ) : null}
        {state.state === 'available' && withheld.length > 0 ? (
          <p className="mi-divergence__withheld">
            <span className="mi-divergence__withheld-title">{text.withheldTitle}{text.labelSep}</span>
            {groupWithheld(withheld).map(group => (
              <span key={group.key} className="mi-divergence__withheld-item" data-reason={group.reason}>
                {withheldLine(text, group, when)}
                {group.count > 1 ? text.withheldGroup.replace('{count}', String(group.count)) : ''}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      {/* 点牌子打开的就是这一个 dialog：上面是牌子背后那几行读数（每条腿的新鲜期与「为什么算背离」），
          下面接口径说明。入口只有牌子一个——卡面上不再多一颗「口径说明」按钮（界面设计 v2 §一）。
          宽度 `standard`（520）：平台只有 420/520/720/860，界面稿写的 560 落不到档上，不发明第五档。
          三段说明各自成段：它们讲三件事（什么算不寻常 / 舆情口径 / 先对时间），拼成一整段读起来是一坨。 */}
      <Modal onClose={() => { closedOnce.current = true; setNotesOpen(false); setTooltipMuted(true) }}
        open={notesOpen} resolveText={resolveProductKey}
        titleKey="pages.intelligence.portal.dashboard.divergence.chipDetailsTitle" width="standard">
        {intraday ? <SignalDetail id="mi-divergence-chip-detail"
          titleKey="pages.intelligence.portal.dashboard.divergence.chipDetailsTitle"
          groups={legGroups}
          rows={[{ labelKey: 'pages.intelligence.portal.dashboard.divergence.chipWhyLabel', value: text.chipWhy }]} /> : null}
        <div className="mi-divergence__notes" data-divergence-notes>
          <h3 className="mi-divergence__notes-title">{text.helpDetailsLabel}</h3>
          {text.helpDetails.map(line => <p key={line}>{line}</p>)}
        </div>
      </Modal>
    </section>
  )
}

/**
 * The sentence for one refused pair.
 *
 * A sentiment leg that answered "nothing took a side" is a fact about the day, so it keeps its own
 * line instead of the generic "we did not get it" — the reader must be able to tell a quiet day
 * from a failed read.
 */
function withheldLine(text: DivergencePanelText, group: ReturnType<typeof groupWithheld>[number], when: (value: string) => string): string {
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
