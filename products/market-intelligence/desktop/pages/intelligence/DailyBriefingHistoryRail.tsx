import { useMemo, useRef, useState } from 'react'

import { useConfirm } from '@platform/ui/components/confirm'
import { ContextMenu, type MenuAnchor, type MenuItem } from '@platform/ui/components/menu'
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import type {
  DailyBriefingEditionSummary,
  DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'
import { briefingEditionDeleteCopy } from './briefingEditionDeleteConfirm'
import { formatDuration } from './DailyBriefingGenerationTimeline'

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
  editions, dates, failed = false, loading = false, onRetry, selectedDate, selectedPeriodId, selectedLocale,
  todayDate, locale, text, timeZone, generatingStage, generatingElapsedMs, resolveText, onSelect, onSelectLocale, onDeletePeriod,
  onRegeneratePeriod
}: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  /**
   * 天头要画哪些日子。**有版次、或有过运行记录（任何状态）、或是今天**才算一天；仅仅"被排期覆盖"
   * 不算——排期每天都配，按它算等于 14 天全铺出来（`02` v2.87）。
   * 省略时退回"有天头的日子来自版次"，即旧行为。
   */
  dates?: readonly string[]
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
  /**
   * How long this run has been going, when the progress poll can answer it.
   *
   * Absent means "cannot tell": the row then says only「生成中」— a stage name or a duration we do not
   * have would be invented, and the reader would read it as fact.
   */
  generatingElapsedMs?: number
  resolveText?: (key: string) => string
  onSelect: (date: string) => void
  /** Picking a row selects that edition: one row is one period in one language, so the row is the choice. */
  onSelectLocale?: (selection: BriefingRailSelection) => void
  /** 删这一版。`clock` 跟着一起来：成功那句要点名 `日期 · 时刻 · 语言`。 */
  onDeletePeriod?: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale; clock?: string }>) => void | Promise<void>
  /** Run this period again. Absent when the host cannot spend a run (the menu item is then disabled). */
  /**
   * 重跑这一行。**带上它自己的时刻与窗口**：手动期没有期配置可依据，只给期号语言的话，
   * 服务会按排期时刻重跑——读者看到的就不是他当初选的那一期。
   */
  onRegeneratePeriod?: (input: Readonly<{
    date: string
    periodId: string
    locale: DailyBriefingLocale
    generation?: Readonly<{ asOf: string; windowHours?: 12 | 24 | 48 }>
  }>) => void | Promise<void>
}>): React.ReactElement {
  const confirm = useConfirm()
  // 右键指向的是**你点中的那一行**，身份是 `(日期, 期号, 语言)` 三元组。少了语言，同一天的中英两行
  // 会找到同一行：右键点英文那行、删掉的却是中文那行。这不是"删错了"，是行身份写错。
  const [menu, setMenu] = useState<Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale; anchor: MenuAnchor }> | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const openMenu = (edition: DailyBriefingEditionSummary, anchor: MenuAnchor): void =>
    setMenu({ date: edition.date, periodId: edition.periodId, locale: edition.locale, anchor })
  /**
   * 默认**只展开今天**，其余折叠（`02` A5.3 / `01` §124 / 原型 v6 三处一致）。
   *
   * 理由是长度：一天多期之后把 14 天全摊开就是好几屏，读者要滚很久才看得到今天。折叠不是藏起来
   * ——天头写着「共 N 期」、点一下就开。这里记的是**读者明确表过态的那几天**，没表过态的一律
   * 按默认（今天开、其余折），所以他折了今天、或开过某一天，都会一直记住。
   */
  const [openByDate, setOpenByDate] = useState<ReadonlyMap<string, boolean>>(new Map())
  const isOpen = (date: string): boolean => openByDate.get(date) ?? date === todayDate

  const days = useMemo(() => {
    const rows = new Map<string, DailyBriefingEditionSummary[]>()
    for (const edition of editions) {
      const list = rows.get(edition.date) ?? []
      list.push(edition)
      rows.set(edition.date, list)
    }
    const order = dates === undefined ? [...rows.keys()] : [...dates]
    return order.map((date) => ({ date, rows: rows.get(date) ?? [] }))
  }, [editions, dates])

  const menuRow = menu
    ? editions.find((edition) => edition.date === menu.date && edition.periodId === menu.periodId && edition.locale === menu.locale)
    : undefined
  const closeMenu = (): void => {
    const open = menu
    setMenu(null)
    if (open) rowRefs.current.get(`${open.date}:${open.periodId}:${open.locale}`)?.focus()
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

  const rowKey = (row: Readonly<{ date: string; periodId: string; locale: string }>): string =>
    `${row.date}:${row.periodId}:${row.locale}`
  /**
   * 只有**右键的那一行自己**在跑才拦。以前写成"今天只要有一期在跑，今天每一行都不许删"——
   * 别的期在写，读者对自己看完的那一版连删除都点不了。
   */
  const blocked = menu !== null && waitingKey !== undefined && rowKey(menu) === waitingKey
  const hasEdition = menuRow !== undefined && menuRow.state !== 'missing'
  // 行菜单**恰一项**：删除这一版（正文 + 它的会话）。期级动作不在这张菜单里——重跑在工具栏与
  // 行内「重试」，删排期在设置页，两件事不混。
  // 0 项时**不渲染**：`ContextMenu` 只挡 `!open || anchor === null`，空数组会画出一块盖住列表的
  // 空白浮层——读者看到的就是"右键出来什么都没有"。
  const menuItems: readonly MenuItem[] = blocked
    ? [{ key: 'delete-blocked', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.deletePeriodBlocked', tone: 'danger', disabled: true }]
    : hasEdition
      ? [{ key: 'delete-edition', labelKey: 'pages.intelligence.portal.dashboard.dailyBriefing.history.deleteEditionCurrent', tone: 'danger' }]
      : []
  // 打开之前就问"这张菜单有没有东西"：正在跑的那一行弹一项禁用的原因，没有版次的行干脆不弹。
  const canOpenMenu = (edition: DailyBriefingEditionSummary): boolean =>
    edition.state !== 'missing' || rowKey(edition) === waitingKey

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
          onClick={() => {
            // 天头可点（`02` `A9.14`）：点开那天 **`periodTime` 最晚**的一版——与列表排序同一口径
            // （`A5.1`：名义时刻升序、同刻按期号稳定序）。选中态落在那一行，日期本身不变色。
            const opening = !isOpen(day.date)
            setOpenByDate((current) => {
              const next = new Map(current)
              next.set(day.date, opening)
              return next
            })
            // 只在"展开这一天"时顺带打开最近一版；再点一次是收起来，不改变右边在看的哪一版。
            if (!opening) return
            const selectedInDay = day.rows.some((edition) => rowSelected(edition))
            if (selectedInDay || day.rows.length === 0) return
            const latest = [...day.rows].sort((left, right) => {
              const moment = (row: DailyBriefingEditionSummary): string => row.periodTime ?? row.generatedAt ?? ''
              const leftAt = moment(left)
              const rightAt = moment(right)
              if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1
              return left.periodId < right.periodId ? -1 : left.periodId > right.periodId ? 1 : 0
            }).at(-1)!
            if (onSelectLocale) onSelectLocale({ date: latest.date, periodId: latest.periodId, locale: latest.locale })
            else onSelect(latest.date)
          }}>
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
            // 「重试」不能放在行按钮里：`<button>` 里套 `<button>` 是无效 HTML，键盘用户在无障碍树里
            // 会遇到一行两个按钮、焦点顺序说不清。它放在行按钮**之外**、同一条目内，视觉上仍落在行内。
            const retryable = kind === 'failed' && edition.date === todayDate && onRegeneratePeriod !== undefined
            return <div role="listitem" key={key} className="mi-daily-briefing__rail-item" data-period={edition.periodId}>
              <button type="button"
                {...(retryable ? { 'data-has-retry': 'true' } : {})}
                aria-current={rowSelected(edition) ? 'true' : undefined}
                // 生成中那一行**可以点**：点它打开这一期的生成界面（进度按它自己的期号取）。
                // 以前这里写死"不可点"，读者点了没反应，只能右键或等它跑完。
                {...(running ? { 'aria-busy': 'true' } : {})}
                data-date={edition.date} data-state={edition.state} data-period-id={edition.periodId}
                {...(edition.periodDeleted ? { 'data-period-deleted': 'true' } : {})}
                className="mi-daily-briefing__rail-row"
                ref={(node) => { if (node) rowRefs.current.set(key, node) }}
                onContextMenu={(event) => { event.preventDefault(); if (canOpenMenu(edition)) openMenu(edition, { x: event.clientX, y: event.clientY }) }}
                onKeyDown={(event) => {
                  if (!(event.shiftKey && event.key === 'F10') && event.key !== 'ContextMenu') return
                  event.preventDefault()
                  if (!canOpenMenu(edition)) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  openMenu(edition, { x: rect.left + 8, y: rect.top + 8 })
                }}
                onClick={() => {
                  // 点一行 = 选那一版（日期 + 期号 + 语言）。只给日期的话，同期中英两行会开同一份。
                  // 生成中的行同样走这里：屏幕上切到它自己的生成界面，而不是点了没反应。
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
                  {/* 语言标签贴行右端：它与来源徽标之间不再有 `·`——两者天各一方，中间那段弹性留白
                      就是右对齐本身（`02` v2.43）。 */}
                  {missing ? null
                    : <span className="mi-daily-briefing__rail-lang" data-edition-locale={edition.locale}>{text.history.languages[edition.locale] ?? edition.locale}</span>}
                </span>
                {/* 第二行：这一份在讲什么。标题给全文，裁剪交给 CSS；悬停给完整的一句。
                    没有正文的那两行写**为什么没有**——空行会被读成"还在加载"。 */}
                {running
                  ? <span className="mi-daily-briefing__rail-row-title" data-rail-title="running">
                    {/* 第二行说"卡在哪、跑了多久"：阶段名 + 已用时（同一套时长格式化）。
                        拿不到进度就只写「生成中」——不编阶段、不编秒数。整句替换，不做会跳的徽标。 */}
                    <LoadingSpinner size="sm" /><span>{runningLine(generatingStage, generatingElapsedMs, text)}</span>
                  </span>
                  : missing
                    ? <span className="mi-daily-briefing__rail-row-title" data-rail-title="reason">
                      {/* 所属期已删且这一版没有正文：第二行只有这枚标记（`02` v2.77），仍然非空。 */}
                      {edition.periodDeleted ? <span className="mi-daily-briefing__rail-tag" data-period-deleted-tag="true">{text.history.deletedPeriod}</span> : reasonOf(edition, text)}
                    </span>
                    : <span className="mi-daily-briefing__rail-row-title" data-rail-title="summary" title={title === '' ? undefined : title}>
                      {/* 「该期已删除」是**第二行开头的 chip**（`02` v2.77）：第一行放不下（中文最坏 250/252、
                          英文约 376，行是 nowrap+hidden，先被裁的就是它），第二行单行省略时裁的是标题尾巴，
                      标记永远可见。不加 `·`（行内 `·` 命中 0）。 */}
                      {edition.periodDeleted ? <span className="mi-daily-briefing__rail-tag" data-period-deleted-tag="true">{text.history.deletedPeriod}</span> : null}
                      {title
                        // 没有摘要时先给**方向词**（读者真正想知道的是这一版怎么判断），连方向都没有
                        // 才给一句操作提示。列表上不写"没有"——那是在陈述缺失，不是在说值不值得点开。
                        || (edition.direction ? localizedDirectionTerm(edition.direction, locale) : text.history.railNoTitle)}
                    </span>}
              </button>
              {retryable
                ? <button type="button" className="mi-daily-briefing__rail-retry" data-rail-retry="true"
                  onClick={() => {
                    void onRegeneratePeriod?.({
                      date: edition.date,
                      periodId: edition.periodId,
                      locale: edition.locale,
                      // 这一行自己的截止与窗口：手动期的 periodTime 就是读者当初选的时刻。
                      ...(edition.periodTime === undefined
                        ? {}
                        : {
                          generation: {
                            asOf: edition.periodTime,
                            ...(typeof edition.windowHours === 'number'
                              ? { windowHours: edition.windowHours as 12 | 24 | 48 }
                              : {})
                          }
                        })
                    })
                  }}>
                  {text.history.retryOne}
                </button>
                : null}
            </div>
          })}
          {/* 这一天没有任何可显示的行时给**一个**兜底项（`02` v2.86）：它不是版次行（无时刻/窗口/
              方向/来源/语言），点它才把右侧切到空态。有失败行或生成中行时不出——那两类本身就是
              "发生过的事"，同屏两套说法只会让人困惑。 */}
          {day.rows.length === 0
            ? <button type="button" className="mi-daily-briefing__rail-item mi-daily-briefing__rail-fallback" data-rail-fallback="true"
              onClick={() => onSelect(day.date)}>
              <span className="mi-daily-briefing__rail-fallback-text">{text.history.dayEmpty}</span>
              {/* 单行 + `›`（`02` v2.89）：箭头说的是"点它会切到右边的空态"，不是"出错可重试"。 */}
              <span className="mi-daily-briefing__rail-fallback-caret" aria-hidden="true" data-rail-fallback-caret="true">›</span>
            </button>
            : null}
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
        const row = menuRow
        closeMenu()
        if (key !== 'delete-edition' || !target || !row || !onDeletePeriod) return
        // 与工具栏第五颗**同一个确认框、同一句话**：这条路径不另写一套文案。
        const clock = clockOf(row, text, timeZone)
        const copy = briefingEditionDeleteCopy(text, {
          date: row.date, language: row.locale,
          ...(clock === undefined ? {} : { clock })
        })
        confirm({
          title: copy.title,
          description: copy.description,
          confirmLabel: copy.confirmLabel,
          cancelLabel: copy.cancelLabel,
          tone: 'danger',
          onConfirm: () => onDeletePeriod({ date: target.date, periodId: target.periodId, locale: target.locale, ...(clock === undefined ? {} : { clock }) })
        })
      }}
      open={menu !== null && menuItems.length > 0}
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

/**
 * The running row's sentence: `{stage} · 已 {duration}`, or the plain word when either half is unknown.
 *
 * The stage arrives already resolved (the page maps the progress to a display name); this function
 * only decides whether both halves exist. Composing a sentence with an unknown half is how a row
 * starts claiming a duration it never measured.
 */
export function runningLine(stage: string | undefined, elapsedMs: number | undefined, text: DailyBriefingText): string {
  if (stage === undefined || stage === '' || elapsedMs === undefined) return text.generationProgress.railRunning
  return text.generationProgress.railStageWithElapsed
    .replace('{stage}', stage)
    .replace('{duration}', formatDuration(elapsedMs, text))
}
