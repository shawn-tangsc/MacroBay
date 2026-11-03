import { useRef, useState } from 'react'

import { useConfirm } from '@platform/ui/components/confirm'
import { ContextMenu, type MenuAnchor } from '@platform/ui/components/menu'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'
import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

/**
 * The history rail: one row per (day, issue), the languages of that issue switching in place.
 *
 * The grouping is done by the service — this component never decides which rows belong together,
 * which languages an issue has, or whether an issue is incomplete. It renders what the list says;
 * the attempt trail belongs to the edition on screen and lives in the detail column, so a row here
 * stays one line of facts.
 */
export function DailyBriefingHistoryRail({ editions, failed = false, loading = false, onRetry, selectedDate, todayDate, locale, text, timeZone, generatingStage, resolveText, onSelect, deleteLocale, onDeletePeriod }: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  /** True until the list has been read once: an empty rail then means "not read yet", not "none". */
  loading?: boolean
  /** True when the read itself failed: an empty rail then means "could not read", not "none". */
  failed?: boolean
  /** Reads the list again; only used by the failure state. */
  onRetry?: () => void
  selectedDate?: string
  todayDate: string
  locale: DailyBriefingLocale
  text: DailyBriefingText
  /** The reader's display zone; the row shows only HH:mm, so the date and the offset stay out. */
  timeZone: string
  /** Set while today's edition is being generated, so the rail never says "not generated" then. */
  generatingStage?: string
  /** Product text resolver for the status pill's key; absent means no pill. */
  resolveText?: (key: string) => string
  onSelect: (date: string) => void
  /**
   * The language a delete removes: the one the reader is reading. The rail does not decide it —
   * deleting an issue used to mean every language at once, and that is no longer the action.
   */
  deleteLocale: DailyBriefingLocale
  /** 删除某一天的一版；缺省时菜单项仍在但点了不做任何事（由宿主决定能不能删）。 */
  onDeletePeriod?: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => void | Promise<void>
}>): React.ReactElement {
  // The row menu: opened by right-click or by Shift+F10 / the menu key, and focus returns to the row.
  const confirm = useConfirm()
  const [menu, setMenu] = useState<Readonly<{ date: string; periodId: string; anchor: MenuAnchor }> | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const openMenu = (edition: DailyBriefingEditionSummary, anchor: MenuAnchor): void => setMenu({ date: edition.date, periodId: edition.periodId, anchor })
  const closeMenu = (): void => {
    const date = menu?.date
    setMenu(null)
    if (date) rowRefs.current.get(date)?.focus()
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
    <div role="list" className="mi-daily-briefing__rail-list">
      {editions.map((edition) => {
        const missing = edition.state === 'missing'
        // One row is one issue, whatever language of it is on screen: the row stays current when the
        // reader switches language in place, and the pressed language follows what is shown.
        const selected = edition.date === selectedDate
        const key = `${edition.date}:${edition.periodId}:${edition.locale}`
        return <div role="listitem" key={key} className="mi-daily-briefing__rail-item" data-period={edition.periodId}>
          {/* A day with no edition can still be selected: the pane then says whether it never ran
              or failed, which is exactly what the rail's one word cannot carry. */}
          <button type="button"
            aria-current={selected ? 'true' : undefined}
            data-date={edition.date} data-state={edition.state}
            className="mi-daily-briefing__rail-row"
            ref={(node) => { if (node) rowRefs.current.set(edition.date, node) }}
            onContextMenu={(event) => { event.preventDefault(); openMenu(edition, { x: event.clientX, y: event.clientY }) }}
            onKeyDown={(event) => {
              // Shift+F10 and the dedicated menu key are the keyboard equivalents of right-click.
              if (!(event.shiftKey && event.key === 'F10') && event.key !== 'ContextMenu') return
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              openMenu(edition, { x: rect.left + 8, y: rect.top + 8 })
            }}
            onClick={() => onSelect(edition.date)}>
            <span className="mi-daily-briefing__rail-line">
              <span className="mi-daily-briefing__rail-date">{formatDate(edition.date, locale)}</span>
              {edition.date === todayDate ? <em>{text.history.today}</em> : null}
              {edition.state === 'partial' && resolveText
                ? <StatusPill tone="warn" labelKey="pages.intelligence.portal.dashboard.dailyBriefing.status.partial" resolveText={resolveText} />
                : null}
            </span>
            {missing ? <small className="mi-daily-briefing__rail-missing">{
              // Four states, one line each: a run in flight names its stage; a run that failed says
              // so (its reason lives in the attempt list); a day that did not run says only that.
              edition.date === todayDate && generatingStage
                ? `${text.generationProgress.railRunning} · ${generatingStage}`
                : edition.attemptCount
                  ? `${text.history.generationFailed}${edition.scheduledTime ? ` · ${edition.scheduledTime}` : ''}`
                  : `${text.history.missingRun}${edition.date === todayDate && edition.scheduledTime ? ` · ${edition.scheduledTime}` : ''}`
            }</small> : <>
              {edition.direction
                // A direction, when present, is the row's word; when absent the dot alone carries
                // it, with the word for screen readers instead of repeating "no conclusion" daily.
                ? <span className="mi-daily-briefing__rail-direction" data-direction={edition.direction}>{localizedDirectionTerm(edition.direction, locale)}</span>
                : <span className="mi-daily-briefing__rail-direction mi-daily-briefing__rail-direction--none" role="img" aria-label={text.history.noConclusion} />}
              {edition.summaryLine ? <span className="mi-daily-briefing__rail-summary">{edition.summaryLine}</span> : null}
              <small className="mi-daily-briefing__rail-meta">
                {edition.date === todayDate && generatingStage
                  ? <span className="mi-daily-briefing__rail-fact">{text.generationProgress.railRunning} · {generatingStage}</span>
                  : <>
                {/* Segments never break mid-word: the width is the fix, these keep each fact whole.
                    A count nobody recorded is not zero: print it only when the list carries one. */}
                {typeof edition.readingsAvailable === 'number'
                  ? <span className="mi-daily-briefing__rail-fact">{edition.readingsAvailable} {text.readingsUnit}</span>
                  : null}
                {edition.generatedAt ? <>
                  <span className="mi-daily-briefing__rail-sep" aria-hidden="true">·</span>
                  <span className="mi-daily-briefing__rail-fact">{railClock(edition.generatedAt, timeZone)}</span>
                </> : null}
                  </>}
              </small>
              {/* Read-only fact about this issue, not a control: it stays flat and out of Tab order. */}
              {languageTag(edition.availableLocales) ? <span className="mi-daily-briefing__rail-edition-lang" data-edition-languages={languageTag(edition.availableLocales)}>
                {text.history.editionLanguages[languageTag(edition.availableLocales)!]}
              </span> : null}
            </>}
          </button>
        </div>
      })}
    </div>
    <ContextMenu
      anchor={menu?.anchor ?? null}
      ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.history.rowMenu"
      items={[{
        key: 'delete-period',
        // The menu names the edition it removes: "delete this issue" no longer describes the action.
        labelKey: menu && editions.some((edition) => edition.date === menu.date && edition.date === todayDate && generatingStage)
          ? 'pages.intelligence.portal.dashboard.dailyBriefing.history.deletePeriodBlocked'
          : `pages.intelligence.portal.dashboard.dailyBriefing.history.deleteEdition.${deleteLocale}`,
        tone: 'danger',
        disabled: Boolean(menu && editions.some((edition) => edition.date === menu.date && edition.date === todayDate && generatingStage))
      }]}
      onClose={closeMenu}
      onSelect={(key) => {
        const target = menu
        closeMenu()
        if (key !== 'delete-period' || !target || !onDeletePeriod) return
        const language = text.history.editionLanguages[deleteLocale === 'en-US' ? 'en' : 'zh']
        confirm({
          title: text.history.deleteTitle.replace('{date}', target.date).replace('{language}', language),
          description: text.history.deleteDescription,
          confirmLabel: text.history.deleteConfirm,
          cancelLabel: text.history.deleteCancel,
          tone: 'danger',
          onConfirm: () => onDeletePeriod({ date: target.date, periodId: target.periodId, locale: deleteLocale })
        })
      }}
      open={menu !== null}
      resolveText={resolveText ?? (() => '')}
    />
  </aside>
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
