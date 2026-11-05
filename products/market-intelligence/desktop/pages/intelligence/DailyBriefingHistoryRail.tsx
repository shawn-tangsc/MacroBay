import { useMemo, useRef, useState } from 'react'

import { useConfirm } from '@platform/ui/components/confirm'
import { ContextMenu, type MenuAnchor } from '@platform/ui/components/menu'
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import type {
  DailyBriefingEditionSummary,
  DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

/** Which edition is on screen: one identity, shared by the rail and the page. */
export type BriefingRailSelection = Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>

/**
 * The history rail: one section per day, one row per edition of that day.
 *
 * A row is two lines, and the split is the design: line one answers "when, which window, which
 * direction, who produced it, which language" and line two answers "what is it about". The numbers a
 * reader does not scan for — readings, gaps, "this issue" — are not on the row at all; they belong to
 * the edition that line two opens. The list projection decides every value here: this component
 * groups by date and draws those conclusions, it never re-derives one.
 */

/** How this edition came to exist. Exactly one per row, five in total (`02` A5.4b). */
type RailSourceKind = 'scheduled' | 'manual' | 'catch-up' | 'not-run' | 'failed'


/**
 * Which of the five source words this row gets. `catch-up` is a scheduled run that came late, so it
 * says 补跑 instead of a second 定时 — one word, never two.
 */
function sourceKindOf(edition: DailyBriefingEditionSummary): RailSourceKind {
  if (edition.state === 'missing') {
    // An interrupted run did start, so it is neither "failed" nor "never ran": line two says which.
    return runReasonOf(edition) === 'run-interrupted' ? 'not-run' : edition.attemptCount ? 'failed' : 'not-run'
  }
  if (edition.periodKind === 'manual') return 'manual'
  if (edition.runTrigger === 'catch-up' || edition.runTrigger === 'retry') return 'catch-up'
  return 'scheduled'
}

function sourceLabelOf(kind: RailSourceKind, text: DailyBriefingText): string {
  if (kind === 'manual') return text.history.runManual
  if (kind === 'catch-up') return text.history.runCatchUp
  if (kind === 'failed') return text.history.runFailed
  if (kind === 'not-run') return text.history.missingRun
  return text.history.runScheduled
}

/**
 * The one clock a row prints (`02` A5.4b: the twice-recorded time does not live on the row).
 *
 * A period that ran on time has the same nominal and actual minute, so the second clock was noise and
 * its label pushed everything else out of a 252px row. Only a manual run keeps a prefix: 截止 carries
 * something the time alone does not say.
 */
function clockOf(edition: DailyBriefingEditionSummary, text: DailyBriefingText, timeZone: string): string | undefined {
  if (edition.state === 'missing') return edition.scheduledTime
  const nominal = edition.periodTime ? railClock(edition.periodTime, timeZone) : edition.scheduledTime
  if (!nominal) return undefined
  return edition.periodKind === 'manual' ? `${text.history.timeCutoff} ${nominal}` : nominal
}

export function DailyBriefingHistoryRail({
  editions, failed = false, loading = false, onRetry, selectedDate, selectedPeriodId, selectedLocale,
  todayDate, locale, text, timeZone, generatingStage, resolveText, onSelect, onSelectLocale, onDeletePeriod, onRemovePeriod,
  onRegeneratePeriod
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
  /** Picking a row selects that edition: one row is one period in one language, so the row is the choice. */
  onSelectLocale?: (selection: BriefingRailSelection) => void
  onDeletePeriod?: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => void | Promise<void>
  /**
   * 删掉这一期的**排期**，不删它的内容：行留着、标成已删除，正文照旧能读。
   * 与 `onDeletePeriod`（删掉某一语言版的正文）是两层，别把这两件事合并。
   */
  onRemovePeriod?: (input: Readonly<{ date: string; periodId: string }>) => void | Promise<void>
  /** Run this period again. Absent when the host cannot spend a run (the menu item is then disabled). */
  onRegeneratePeriod?: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => void | Promise<void>
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
  // 重新生成只对本日成立：服务端按"今天"解析期号，历史那天不能补跑（`backfillBlocked` 就是那句话）。
  // 有入口但被禁，比"菜单里根本没有这个动作"诚实——读者至少知道这一版能重跑。
  const regenerate = menu?.date === todayDate
    ? onRegeneratePeriod
      ? [{ key: 'regenerate-period', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.regeneratePeriod' }]
      : []
    : [{ key: 'regenerate-blocked', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.backfillBlocked', disabled: true }]
  const menuItems = blocked
    ? [{ key: 'regenerate-blocked-running', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.deletePeriodBlocked', disabled: true }]
    : menuLanguages.length === 0
      ? [...regenerate, { key: 'delete-none', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.deleteNoEdition', tone: 'danger' as const, disabled: true }]
      : [...regenerate, deleteWhole, ...menuLanguages.map((language) => ({ key: `delete:${language}`, labelKey: `pages.intelligence.portal.dashboard.dailyBriefing.history.deleteEdition.${language}`, tone: 'danger' as const }))]
  const closeMenu = (): void => {
    const key = menu ? `${menu.date}:${menu.periodId}` : undefined
    setMenu(null)
    if (key) rowRefs.current.get(key)?.focus()
  }

  const rowSelected = (edition: DailyBriefingEditionSummary): boolean => {
    if (selectedDate === undefined) return false
    if (edition.date !== selectedDate) return false
    // One row is one (period, language): without both in the test, every edition of the same period
    // would light up as "the one on screen".
    if (selectedPeriodId !== undefined && edition.periodId !== selectedPeriodId) return false
    if (selectedLocale !== undefined && edition.locale !== selectedLocale) return false
    return true
  }

  /**
   * One run, one row. The projection says which edition is in flight (`languages` carries the
   * generating state); without that, today's first row with no body is the one being written.
   *
   * Picking it once matters: a day can hold several periods, and painting every empty row of the day
   * as "generating" would claim several runs at once — and would hide a failed row behind a spinner.
   */
  const waitingKey = useMemo(() => {
    const explicit = editions.find((row) => (row.languages ?? []).some((language) => language.state === 'generating'))
    if (explicit) return `${explicit.date}:${explicit.periodId}:${explicit.locale}`
    if (generatingStage === undefined) return undefined
    // 没有显式在跑的那一行时，取"今天还没跑过的那一期"——失败过的那一期此刻不是空的，它有自己的原因。
    const missingToday = editions.filter((row) => row.date === todayDate && row.state === 'missing')
    const fallback = missingToday.find((row) => !row.attemptCount) ?? missingToday[0]
    return fallback ? `${fallback.date}:${fallback.periodId}:${fallback.locale}` : undefined
  }, [editions, generatingStage, todayDate])

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
          {/* 「今天」是副标签：和「共 N 期」同档同色（CSS 里是同一条规则），不许比日期更显眼。
              **没有「本期」这个词**：是不是今天由这个标签说，哪一份最新由排序说。 */}
          {day.date === todayDate ? <em className="mi-daily-briefing__rail-day-today" data-today="true">{text.history.today}</em> : null}
          {/* The count stays on the head even when collapsed (A5.2). */}
          <span className="mi-daily-briefing__rail-day-count" data-day-count={day.rows.length}>
            {text.history.periodCount.replace('{count}', String(day.rows.length))}
          </span>
          {/* 折叠箭头：没有它读者不知道这一天能点开。纯文本字形，不占排版宽度，也不需要新样式。 */}
          <span className="mi-daily-briefing__rail-day-caret" aria-hidden="true" data-day-caret={isOpen(day.date) ? 'open' : 'closed'}>{isOpen(day.date) ? '▾' : '▸'}</span>
        </button>
        {/* 折叠行代表的是**这一天**，不是某一期：所以只留 `11/03 周二 · 共 2 期 ▸`，
            不带时刻、不带语言——那两样是期级别的属性，挂在"这一天"上就是维度错误。 */}
        {isOpen(day.date) ? <div role="list" className="mi-daily-briefing__rail-day-rows">
          {day.rows.map((edition) => {
            const key = `${edition.date}:${edition.periodId}:${edition.locale}`
            const missing = edition.state === 'missing'
            const running = key === waitingKey
            // 生成中不是第六种来源：这一格仍是"这份是机器按时出的、还是我点出来的"。
            // 那一行此刻没有正文，但它的来源没变，所以不能借机写成「未运行」。
            const kind = running ? (edition.periodKind === 'manual' ? 'manual' : 'scheduled') : sourceKindOf(edition)
            const clock = clockOf(edition, text, timeZone)
            const title = edition.summaryLine ?? ''
            return <div role="listitem" key={key} className="mi-daily-briefing__rail-item" data-period={edition.periodId}>
              <button type="button"
                aria-current={rowSelected(edition) ? 'true' : undefined}
                // 生成中的那一行不可点：它还没有内容可开。原因写在行内第二行，读屏顺着行拿得到。
                {...(running ? { 'aria-busy': 'true', 'aria-disabled': 'true' } : {})}
                data-date={edition.date} data-state={edition.state} data-period-id={edition.periodId}
                {...(edition.periodDeleted ? { 'data-period-deleted': 'true' } : {})}
                className="mi-daily-briefing__rail-row"
                ref={(node) => { if (node) rowRefs.current.set(key, node) }}
                onContextMenu={(event) => { event.preventDefault(); openMenu(edition, { x: event.clientX, y: event.clientY }) }}
                onKeyDown={(event) => {
                  if (!(event.shiftKey && event.key === 'F10') && event.key !== 'ContextMenu') return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  openMenu(edition, { x: rect.left + 8, y: rect.top + 8 })
                }}
                onClick={() => {
                  if (running) return
                  // 点一行 = 选那一版（日期 + 期号 + 语言）。只给日期的话，同期中英两行会开同一份。
                  if (onSelectLocale) onSelectLocale({ date: edition.date, periodId: edition.periodId, locale: edition.locale })
                  else onSelect(edition.date)
                }}>
                {/* 第一行：时刻 → 窗口 → 方向点 → 来源徽标 → · → 语言标签。从左往右读，语序就是扫视顺序。 */}
                <span className="mi-daily-briefing__rail-line">
                  {clock ? <span className="mi-daily-briefing__rail-fact">{clock}</span> : null}
                  {typeof edition.windowHours === 'number'
                    ? <span className="mi-daily-briefing__rail-fact" data-window-hours={edition.windowHours}>{text.history.windowHoursShort.replace('{hours}', String(edition.windowHours))}</span>
                    : null}
                  {/* 方向只用颜色说：一行里只有它有颜色，扫一眼就够；词留给读屏。 */}
                  {missing
                    ? null
                    : <i className="mi-daily-briefing__rail-dot" data-direction={edition.direction ?? 'none'} role="img"
                      aria-label={edition.direction ? localizedDirectionTerm(edition.direction, locale) : text.history.noConclusion} />}
                  {/* 这一格永远有且只有一个：定时 / 手动 / 补跑 / 未运行 / 这次失败。 */}
                  <span className="mi-daily-briefing__rail-source" data-run-source={kind}>{sourceLabelOf(kind, text)}</span>
                  {/* 一行一期一种语言，所以只有这一枚；它不是可切的东西，只是这一行的语言标识。 */}
                  {missing ? null : <>
                    <span className="mi-daily-briefing__rail-sep" aria-hidden="true">·</span>
                    <span className="mi-daily-briefing__rail-lang" data-edition-locale={edition.locale}>{text.history.languages[edition.locale] ?? edition.locale}</span>
                  </>}
                  {/* 失败那一行只有它：没有正文可开，行内直接给一条出路，不必先点开再看。 */}
                  {kind === 'failed' && edition.date === todayDate && onRegeneratePeriod
                    ? <button type="button" className="mi-daily-briefing__rail-retry" data-rail-retry="true"
                      onClick={(event) => { event.stopPropagation(); void onRegeneratePeriod({ date: edition.date, periodId: edition.periodId, locale: edition.locale }) }}>
                      {text.history.retryOne}
                    </button>
                    : null}
                </span>
                {/* 第二行：这一份在讲什么。标题给全文，裁剪交给 CSS；悬停给完整的一句。
                    没有正文的那两行写**为什么没有**——空行会被读成"还在加载"。 */}
                {running
                  ? <span className="mi-daily-briefing__rail-row-title" data-rail-title="running">
                    <LoadingSpinner size="sm" /><span>{text.generationProgress.railRunning}</span>
                  </span>
                  : missing
                    ? <span className="mi-daily-briefing__rail-row-title" data-rail-title="reason">{reasonOf(edition, text)}</span>
                    : <span className="mi-daily-briefing__rail-row-title" data-rail-title="summary" title={title === '' ? undefined : title}>
                      {edition.periodDeleted ? `${text.history.deletedPeriod} · ` : ''}{title}
                    </span>}
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
        if (key === 'regenerate-period' && target && onRegeneratePeriod && menuRow) {
          void onRegeneratePeriod({ date: target.date, periodId: target.periodId, locale: menuRow.locale })
          return
        }
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

function runReasonOf(edition: DailyBriefingEditionSummary): string | undefined {
  return (edition.languages ?? []).find((language) => language.reason !== undefined)?.reason
}

/**
 * 没有正文的那一行，第二行写的是**为什么没有**——空行会被读成"还在加载"。
 *
 * 中断过的、失败过的、从没跑过的不是同一件事：一个还可以再试，一个这次没生成出来，一个是根本没开始。
 */
function reasonOf(edition: DailyBriefingEditionSummary, text: DailyBriefingText): string {
  const reason = runReasonOf(edition)
  if (reason === 'run-interrupted') return text.history.runInterrupted
  if (reason === 'run-failed') return text.history.railFailedReason
  return text.history.railNotRun
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
