import { useMemo, useRef, useState } from 'react'

import { useConfirm } from '@platform/ui/components/confirm'
import { ContextMenu, type MenuAnchor } from '@platform/ui/components/menu'
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'
import type {
  DailyBriefingEditionLanguage,
  DailyBriefingEditionSummary,
  DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

/** Which edition is on screen: one identity, shared by the rail and the page. */
export type BriefingRailSelection = Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>

/**
 * The history rail: one section per day, one row per issue of that day.
 *
 * The list projection decides everything the row draws — the day's issues, their order, the
 * per-language three-state, the current edition and the deleted mark. This component groups by the
 * date it was given and renders those conclusions; it does not re-sort, re-derive a language state,
 * or invent a missing one.
 */

/**
 * 折叠的那一天要自己是一条可读的信息，而不是「共 N 期」加一片空白。
 *
 * 摘要取**最新一期可读的**，不是数组最后一条：最后一条可能是已删除或这次失败的，拿它当脸等于给
 * 折叠行挂一个没有正文的期。那天一期可读的都没有时返回 `undefined`——只显示「共 N 期」，不编。
 */
function collapsedSummary(day: Readonly<{ rows: readonly DailyBriefingEditionSummary[] }>, languages: Readonly<Record<string, string>>, locale: DailyBriefingLocale): Readonly<{ time: string; language: string; direction?: string }> | undefined {
  const readable = day.rows.filter((row) => row.periodDeleted !== true && row.state !== 'missing')
  const latest = readable.at(-1)
  if (!latest) return undefined
  // 折叠行只有三段：时刻 · 语言 · 方向。**标题不进侧栏**——252px 放不下，它属于正文区；
  // 方向缺失时就只出两段，不补一个破折号去凑第三个位置（那会被读成"方向是横线"）。
  return {
    time: latest.scheduledTime ?? '',
    language: languages[latest.locale] ?? latest.locale,
    ...(latest.direction ? { direction: localizedDirectionTerm(latest.direction, locale) } : {})
  }
}

export function DailyBriefingHistoryRail({
  editions, failed = false, loading = false, onRetry, selectedDate, selectedPeriodId, selectedLocale,
  todayDate, locale, text, timeZone, generatingStage, resolveText, onSelect, onSelectLocale, gapCount, onDeletePeriod, onRemovePeriod
}: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  loading?: boolean
  failed?: boolean
  onRetry?: () => void
  selectedDate?: string
  selectedPeriodId?: string
  selectedLocale?: DailyBriefingLocale
  todayDate: string
  locale: DailyBriefingLocale
  text: DailyBriefingText
  timeZone: string
  generatingStage?: string
  resolveText?: (key: string) => string
  onSelect: (date: string) => void
  /** Picking a language badge selects that edition; absent keeps the badges read-only. */
  onSelectLocale?: (selection: BriefingRailSelection) => void
  gapCount?: number
  onDeletePeriod?: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => void | Promise<void>
  /**
   * 删掉这一期的**排期**，不删它的内容：行留着、标成已删除，计划与实际两个时刻都在，正文照旧能读。
   * 与 `onDeletePeriod`（删掉某一语言版的正文）是两层，别把这两件事合并。
   */
  onRemovePeriod?: (input: Readonly<{ date: string; periodId: string }>) => void | Promise<void>
}>): React.ReactElement {
  const confirm = useConfirm()
  const [menu, setMenu] = useState<Readonly<{ date: string; periodId: string; anchor: MenuAnchor }> | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const openMenu = (edition: DailyBriefingEditionSummary, anchor: MenuAnchor): void => setMenu({ date: edition.date, periodId: edition.periodId, anchor })
  // Today opens by default; every other day starts collapsed. Collapsing today is remembered, and
  // opening a past day is remembered too — the reader's shape of the list is not reset by a reload.
  const [closedToday, setClosedToday] = useState(false)
  const [openDays, setOpenDays] = useState<ReadonlySet<string>>(new Set())
  const isOpen = (date: string): boolean => date === todayDate ? !closedToday : openDays.has(date)

  const days = useMemo(() => {
    const order: string[] = []
    const rows = new Map<string, DailyBriefingEditionSummary[]>()
    for (const edition of editions) {
      if (!rows.has(edition.date)) { rows.set(edition.date, []); order.push(edition.date) }
      rows.get(edition.date)!.push(edition)
    }
    return order.map((date) => ({ date, rows: rows.get(date)! }))
  }, [editions])

  const menuRow = menu ? editions.find((edition) => edition.date === menu.date && edition.periodId === menu.periodId) : undefined
  const menuLanguages = [...(menuRow?.availableLocales ?? [])]
  const blocked = Boolean(menu && menu.date === todayDate && generatingStage)
  // 一期一行之后，菜单先说"这一期"再问"哪一个语言版"：整天一期时代的菜单只有语言，读者找不到
  // "把这一期整个删掉"这个动作。
  const deleteWhole = { key: 'delete-period', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.deleteWholePeriod', tone: 'danger' as const }
  const menuItems = blocked
    ? [{ key: 'delete-blocked', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.deletePeriodBlocked', tone: 'danger' as const, disabled: true }]
    : menuLanguages.length === 0
      ? [{ key: 'delete-none', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.deleteNoEdition', tone: 'danger' as const, disabled: true }]
      : [deleteWhole, ...menuLanguages.map((language) => ({ key: `delete:${language}`, labelKey: `pages.intelligence.portal.dashboard.dailyBriefing.history.deleteEdition.${language}`, tone: 'danger' as const }))]
  const closeMenu = (): void => {
    const key = menu ? `${menu.date}:${menu.periodId}` : undefined
    setMenu(null)
    if (key) rowRefs.current.get(key)?.focus()
  }

  const rowSelected = (edition: DailyBriefingEditionSummary): boolean => {
    if (selectedDate === undefined) return false
    if (edition.date !== selectedDate) return false
    // The day alone used to be the selection; a period-aware selection is stricter when it is known.
    if (selectedPeriodId === undefined) return true
    return edition.periodId === selectedPeriodId
  }

  return <aside className="mi-daily-briefing__rail" aria-label={text.history.title}>
    <p className="mi-daily-briefing__rail-title">{text.history.title}</p>
    {loading && editions.length === 0 ? <LoadingState label={text.history.loading} /> : failed && editions.length === 0 && onRetry ? <StateView
      action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }}
      reasonCode="unreadable"
      size="md"
      state="error"
    /> : editions.length === 0 ? <StateView
      state="empty"
      reasonCode="not-yet"
      size="md"
      className="mi-daily-briefing__rail-state"
      productReason={{
        key: 'mi.dailyBriefing.noEditions',
        resolve: (key, params) => resolveBriefingStateReason(text, key, params)
      }}
    /> : null}
    <div className="mi-daily-briefing__rail-list">
      {days.map((day) => <section className="mi-daily-briefing__rail-day" key={day.date} data-day={day.date}>
        <button type="button" className="mi-daily-briefing__rail-day-head" aria-expanded={isOpen(day.date)}
          onClick={() => { day.date === todayDate ? setClosedToday((current) => !current) : setOpenDays((current) => {
            const next = new Set(current)
            if (next.has(day.date)) next.delete(day.date); else next.add(day.date)
            return next
          }) }}>
          <span className="mi-daily-briefing__rail-day-date">{formatDate(day.date, locale)}</span>
          {/* The day head says which day it is, never "本期": the current issue is marked on its row. */}
          {day.date === todayDate ? <em data-today="true">{text.history.today}</em> : null}
          {/* The count stays on the head even when collapsed (A5.2). */}
          <span className="mi-daily-briefing__rail-day-count" data-day-count={day.rows.length}>
            {text.history.periodCount.replace('{count}', String(day.rows.length))}
          </span>
        </button>
        {/* 折叠态：一行摘要，让这一天自己是可读的信息（不是"共 N 期"加一片空白）。 */}
        {isOpen(day.date) ? null : (() => {
          const summary = collapsedSummary(day, text.history.languages as Readonly<Record<string, string>>, locale)
          if (summary === undefined) return null
          const parts = [summary.time, summary.language, summary.direction].filter((part): part is string => part !== undefined && part !== '')
          return <p className="mi-daily-briefing__rail-day-summary" data-day-summary={day.date}>
            <span className="mi-daily-briefing__rail-day-summary-text">{parts.join(' · ')}</span>
          </p>
        })()}
        {isOpen(day.date) ? <div role="list" className="mi-daily-briefing__rail-day-rows">
          {day.rows.map((edition) => {
            const missing = edition.state === 'missing'
            const selected = rowSelected(edition)
            const key = `${edition.date}:${edition.periodId}`
            const active = renderedLanguages(edition).length > 0 || missing
            return <div role="listitem" key={key} className="mi-daily-briefing__rail-item" data-period={edition.periodId}>
              <button type="button"
                aria-current={selected ? 'true' : undefined}
                data-date={edition.date} data-state={edition.state} data-period-id={edition.periodId}
                className="mi-daily-briefing__rail-row"
                ref={(node) => { if (node) rowRefs.current.set(key, node) }}
                onContextMenu={(event) => { event.preventDefault(); openMenu(edition, { x: event.clientX, y: event.clientY }) }}
                onKeyDown={(event) => {
                  if (!(event.shiftKey && event.key === 'F10') && event.key !== 'ContextMenu') return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  openMenu(edition, { x: rect.left + 8, y: rect.top + 8 })
                }}
                onClick={() => onSelect(edition.date)}>
                <span className="mi-daily-briefing__rail-line">
                  {/* 「本期」只属于今天：`isCurrent` 是"那一天完成最晚的一条"，每天各有一条，直接用它
                      会把「本期」标到昨天去。今天没有版次时，今天的占位行才是本期。 */}
                  {edition.isCurrent && edition.date === todayDate ? <em data-is-current="true">{text.history.currentPeriod}</em> : null}
                  {edition.periodDeleted ? <small className="mi-daily-briefing__rail-deleted" data-period-deleted="true">{text.history.deletedPeriod}</small> : null}
                  {edition.state === 'partial' && resolveText
                    ? <StatusPill tone="warn" labelKey="pages.intelligence.portal.dashboard.dailyBriefing.status.partial" resolveText={resolveText} />
                    : null}
                </span>
                {/* 行末：来源词（永远有且只有一个）+ 语言标签（只在真有版次时出现）。 */}
                <span className="mi-daily-briefing__rail-source" data-run-source={edition.state === 'missing' ? 'none' : edition.periodKind === 'manual' ? 'manual' : edition.runTrigger === 'catch-up' || edition.runTrigger === 'retry' ? 'catch-up' : 'scheduled'}>{sourceWord(edition, text)}</span>
                {active ? <span className="mi-daily-briefing__rail-langs" data-briefing-locale-tag={languageTag(edition.availableLocales)}>
                  {/* 一行只有这一枚：该行自己的语言。徽标是标签，不是可切换的开关——没有按钮、没有选中态。 */}
                  <span className="mi-daily-briefing__rail-lang" data-edition-locale={edition.locale}>{text.history.languages[edition.locale] ?? edition.locale}</span>
                </span> : null}
                <small className="mi-daily-briefing__rail-meta">
                  {edition.date === todayDate && generatingStage
                    ? <span className="mi-daily-briefing__rail-fact">{text.generationProgress.railRunning} · {generatingStage}</span>
                    : <>
                      {timeFacts(edition, text, timeZone).map((fact, index) => <span key={`${fact}-${index}`} className="mi-daily-briefing__rail-fact">{fact}</span>)}
                      {typeof edition.windowHours === 'number'
                        ? <span className="mi-daily-briefing__rail-fact" data-window-hours={edition.windowHours}>{text.history.windowHoursShort.replace('{hours}', String(edition.windowHours))}</span>
                        : null}

                    </>}
                </small>
                {missing ? <small className="mi-daily-briefing__rail-missing" data-run-reason={runReasonOf(edition) ?? 'not-run'}>{
                  edition.date === todayDate && generatingStage
                    ? `${text.generationProgress.railRunning} · ${generatingStage}`
                    : runReasonOf(edition) === 'run-interrupted' ? text.history.runInterrupted
                      : runReasonOf(edition) === 'run-failed' ? text.history.runFailed
                        : edition.attemptCount ? `${text.history.generationFailed}${edition.scheduledTime ? ` · ${edition.scheduledTime}` : ''}`
                          : `${text.history.missingRun}${edition.scheduledTime ? ` · ${edition.scheduledTime}` : ''}`
                }</small> : <>
                  {edition.direction
                    ? <span className="mi-daily-briefing__rail-direction" data-direction={edition.direction}>{localizedDirectionTerm(edition.direction, locale)}</span>
                    : <span className="mi-daily-briefing__rail-direction mi-daily-briefing__rail-direction--none" role="img" aria-label={text.history.noConclusion} />}
                  {edition.runTrigger === 'catch-up' || edition.runTrigger === 'retry'
                    ? <small className="mi-daily-briefing__rail-run-trigger" data-run-trigger={edition.runTrigger}>{text.history.runCatchUp}</small>
                    : null}
                  {typeof edition.readingsAvailable === 'number' && edition.readingsAvailable > 0
                    ? <span className="mi-daily-briefing__rail-fact">{edition.readingsAvailable} {text.readingsUnit}</span>
                    : null}
                  {edition.date === selectedDate && (selectedPeriodId === undefined || selectedPeriodId === edition.periodId) && gapCount !== undefined && gapCount > 0
                    ? <span className="mi-daily-briefing__rail-fact" data-briefing-gap-count={gapCount}>{text.history.gapCount.replace('{count}', String(gapCount))}</span>
                    : null}
                </>}
              </button>
            </div>
          })}
        </div> : null}
      </section>)}
    </div>
    <ContextMenu
      anchor={menu?.anchor ?? null}
      ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.history.rowMenu"
      items={menuItems}
      onClose={closeMenu}
      onSelect={(key) => {
        const target = menu
        const languages = menuLanguages
        closeMenu()
        if (key === 'delete-period' && target && onRemovePeriod) {
          // 删的是这一期的**排期**：行留着、标成已删除，正文照旧能读（`A9.8` 删期不删历史版次）。
          confirm({
            title: text.history.deleteWholeTitle.replace('{date}', target.date),
            description: text.history.deleteWholeDescription,
            confirmLabel: text.history.deleteConfirm,
            cancelLabel: text.history.deleteCancel,
            tone: 'danger',
            onConfirm: () => onRemovePeriod({ date: target.date, periodId: target.periodId })
          })
          return
        }
        if (!key.startsWith('delete:') || !target || !onDeletePeriod) return
        const language = key.slice('delete:'.length)
        if (language !== 'zh-CN' && language !== 'en-US') return
        const languageName = text.history.editionLanguages[language === 'en-US' ? 'en' : 'zh']
        confirm({
          title: text.history.deleteTitle.replace('{date}', target.date).replace('{language}', languageName),
          description: text.history.deleteDescription,
          confirmLabel: text.history.deleteConfirm,
          cancelLabel: text.history.deleteCancel,
          tone: 'danger',
          onConfirm: () => onDeletePeriod({ date: target.date, periodId: target.periodId, locale: language })
        })
      }}
      open={menu !== null}
      resolveText={resolveText ?? (() => '')}
    />
  </aside>
}

/** The per-language chips, from the projection's three-state; absent falls back to published rows. */
function renderedLanguages(edition: DailyBriefingEditionSummary): readonly DailyBriefingEditionLanguage[] {
  // 一行只有一枚徽标：**这一行自己的语言**。`languages` 带着这一期所有语言的状态（那是"这一期有
  // 几版"的旧说法），在这里必须按本行的语言过滤——否则两行会各自挂着两枚徽标，看起来又像"可以切"。
  const own = edition.languages?.find((language) => language.locale === edition.locale)
  if (own) return [own]
  return edition.languages === undefined
    ? [Object.freeze({ locale: edition.locale, state: 'published' as const })]
    : []
}

function runReasonOf(edition: DailyBriefingEditionSummary): string | undefined {
  return (edition.languages ?? []).find((language) => language.reason !== undefined)?.reason
}

function LanguageBadge({ language, text, locale, selected, onSelect }: Readonly<{
  language: DailyBriefingEditionLanguage
  text: DailyBriefingText
  locale: DailyBriefingLocale
  selected: boolean
  onSelect?: () => void
}>): React.ReactElement {
  const name = text.history.languages[language.locale]
  if (language.state === 'generating') {
    return <span className="mi-daily-briefing__rail-lang" data-edition-locale={language.locale} data-language-state="generating">
      <LoadingSpinner size="sm" />{name}
    </span>
  }
  if (language.state === 'missing') {
    const reason = language.reason === 'run-interrupted' ? text.history.runInterrupted
      : language.reason === 'run-failed' ? text.history.runFailed
        : text.history.languageNotPublished
    // A grey chip without the reason is exactly what A9.2 forbids: the reader must know why it is grey.
    return <span className="mi-daily-briefing__rail-lang" data-edition-locale={language.locale} data-language-state="missing" data-language-reason={language.reason}>
      {name}<small className="mi-daily-briefing__rail-lang-reason">{reason}</small>
    </span>
  }
  return <button type="button" className="mi-daily-briefing__rail-lang" data-edition-locale={language.locale} data-language-state="published"
    aria-pressed={selected} disabled={!onSelect} onClick={onSelect}>{name}</button>
}

/** `HH:mm` facts: two clocks are both labelled, one clock is not (A9.10). */
/**
 * 第一行最右那一格：这一份是**怎么来的**——一个词，永远有且只有一个。
 *
 * 定时 / 手动 / 补跑 / 未运行 / 这次失败。补跑属于定时那一类，不再重复写「定时」；未运行与失败
 * 那两行没有语言标签（那一版根本不存在），所以这一格是它们唯一的状态词。
 */
function sourceWord(edition: DailyBriefingEditionSummary, text: DailyBriefingText): string {
  if (edition.state === 'missing') return edition.attemptCount ? text.history.runFailed : text.history.missingRun
  if (edition.periodKind === 'manual') return text.history.runManual
  if (edition.runTrigger === 'catch-up' || edition.runTrigger === 'retry') return text.history.runCatchUp
  return text.history.runScheduled
}

function timeFacts(edition: DailyBriefingEditionSummary, text: DailyBriefingText, timeZone: string): readonly string[] {
  if (edition.state === 'missing') return edition.scheduledTime ? [edition.scheduledTime] : []
  const nominal = edition.periodTime ? railClock(edition.periodTime, timeZone) : edition.scheduledTime
  const actual = edition.generatedAt ? railClock(edition.generatedAt, timeZone) : undefined
  // 正常行只说一个时刻 —— 它按点生成的那一期，计划与实际是同一个值，印两个词只是噪音。
  // 「计划/截止 + 实际」只在**非正常期**（补跑、手动、已删除）才成对出现，那时两个时刻真的不同。
  const irregular = edition.periodDeleted === true || edition.periodKind === 'manual' ||
    edition.runTrigger === 'catch-up' || edition.runTrigger === 'retry'
  if (irregular && nominal && actual) return [
    `${edition.periodKind === 'manual' ? text.history.timeCutoff : text.history.timePlanned} ${nominal}`,
    `${text.history.timeActual} ${actual}`
  ]
  return nominal ? [nominal] : []
}

/** Which languages this issue has; absent when it has no edition at all. */
export function languageTag(availableLocales: readonly DailyBriefingLocale[]): 'zh' | 'en' | 'both' | undefined {
  const zh = availableLocales.includes('zh-CN')
  const en = availableLocales.includes('en-US')
  if (zh && en) return 'both'
  if (en) return 'en'
  if (zh) return 'zh'
  return undefined
}

/** `HH:mm` in the reader's zone: the row's date is on the line above, the offset is the setting's. */
export function railClock(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
  } catch {
    return instant.slice(11, 16)
  }
}

export function formatRailDate(date: string, locale: DailyBriefingLocale): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return date
  const value = new Date(parsed)
  const day = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(value)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(value)
  return `${day} ${weekday}`
}

const formatDate = formatRailDate
