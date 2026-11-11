import { Button } from 'antd'
import { MoreVertical } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingSpinner } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { NewsSentimentFilters } from './useNewsSentiment'
import type { NewsSentimentItemView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { createIconTextResolver, hasIconText } from './newsSentimentIconText'
import { labelText, sentimentIcon } from './newsSentimentPresentation'
import type { NewsSentimentText } from './NewsSentimentCard'
import type { StateViewTextKey } from '@platform/ui/components/state'

/**
 * 抽屉左栏：列表区的全部「没有行」分支 + 行本身（含整行即动作、行内「更多」）。
 *
 * 从 `NewsSentimentDrawer` 抽出来（那个文件超过体积线：501 → 约 420），行为零改动：
 * 抽出的只是一个自洽的渲染块，状态仍由抽屉持有，这里只接它算好的东西。
 */
export function NewsSentimentDrawerList(props: Readonly<{
  text: NewsSentimentText
  resolveStateText: (key: StateViewTextKey) => string
  failed: boolean
  loading: boolean
  hasView: boolean
  rows: readonly NewsSentimentItemView[]
  filtered: boolean
  translationEnabled: boolean
  translationStates: Readonly<Record<string, string>>
  translatedTitles: Readonly<Record<string, string>>
  activeId?: string
  onOpenRow: (row: NewsSentimentItemView) => void
  onRowContextMenu: (itemId: string, x: number, y: number) => void
  onRefresh: () => void
  onClearFilters: () => void
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const { text } = props
  const resolveIconText = createIconTextResolver(text)
  return (
          <div className="mi-news-drawer__list" role="list">
            {props.failed && props.rows.length === 0 ? (
              // Nothing was ever read here: error plus the way out.
              <StateView
                action={{ labelKey: 'ui.state.action.retry', onSelect: props.onRefresh }}
                reasonCode="unreadable"
                resolveText={props.resolveStateText}
                size="md"
                state="error"
              />
            ) : null}
            {props.failed && props.rows.length > 0 ? (
              // A failed refresh keeps the rows this drawer already had; the note says so instead
              // of replacing a still-true reading with an error panel.
              <p className="mi-news-drawer__stale-read" data-news-sentiment-stale-read role="status">
                <span>{text.staleRead}</span>
                <button type="button" className="text-action" onClick={props.onRefresh}>{text.retry}</button>
              </p>
            ) : null}
            {!props.failed && props.loading && !props.hasView ? (
              // First read in flight: "not yet" would claim the window is empty before we know.
              <StateView resolveText={props.resolveStateText} size="md" state="loading" />
            ) : null}
            {!props.failed && !props.loading && props.rows.length === 0 ? (
              props.filtered
                ? <StateView
                    action={{ labelKey: 'ui.state.action.clear-filter', onSelect: () => props.onClearFilters() }}
                    reasonCode="filtered-out"
                    resolveText={props.resolveStateText}
                    size="md"
                    state="empty"
                  />
                // 成因不可知（抽屉拿不到「从没跑过 / 采集失败」），故不断言窗口内确实为空：
                // `not-yet` 不承担结论，`nothing-in-window` 会替这个窗口下「确实没有」的判断。
                : <StateView reasonCode="not-yet" resolveText={props.resolveStateText} size="md" state="empty" />
            ) : null}
            {props.rows.map((row) => {
              const rowState = props.translationStates[row.itemId] ?? row.bodyTranslationState ?? 'missing'
              return (
              <div
                className={`mi-news-drawer__row${row.itemId === props.activeId ? ' is-selected' : ''}`}
                key={row.itemId}
                role="listitem"
              >
              <button
                aria-current={row.itemId === props.activeId}
                // 整行即动作（ui-spec「可点击行」）：原生 button 保留，antd `Button` 表达不了这种
                // 多行富内容；可访问名说明点开哪一条，键盘与焦点环由原生 button + 全仓 `:focus-visible` 提供。
                aria-label={text.openItem.replace('{title}', props.translatedTitles[row.itemId] ?? row.displayTitle ?? row.title)}
                className="mi-news-drawer__row-open"
                onClick={() => { props.onOpenRow(row) }}
                onContextMenu={props.translationEnabled ? (event) => { event.preventDefault(); props.onRowContextMenu(row.itemId, event.clientX, event.clientY) } : undefined}
                onKeyDown={props.translationEnabled ? (event) => {
                  // A context menu reachable only by right-click is unreachable from the keyboard.
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  props.onRowContextMenu(row.itemId, rect.left + 8, rect.top + 8)
                } : undefined}
                type="button"
              >
                <span className="mi-news-drawer__row-top">
                  <time>{formatTime(row.publishedAt, 'minute')}</time>
                  <span className={`mi-news-sentiment__pill is-${row.polarity}`}>
                    {sentimentIcon(row.polarity)}{labelText(text, row.polarity)}
                  </span>
                  {props.translationEnabled && rowState === 'waiting' ? (
                    <span className="mi-news-drawer__row-waiting">
                      {text.drawer.translationStatus?.waiting}
                    </span>
                  ) : null}
                  {props.translationEnabled && rowState === 'translating' ? (
                    <span className="mi-news-drawer__row-loading" role="status" aria-label={text.drawer.translationStatus?.translating}>
                      <LoadingSpinner size="sm" />
                    </span>
                  ) : null}
                  {props.translationEnabled && rowState === 'failed' ? <span className="mi-news-drawer__row-failed">{text.drawer.translationStatus?.failed}</span> : null}
                  <small className="mi-news-drawer__source">{row.sourceName}</small>
                  <span className="mi-news-drawer__symbols">
                    {row.symbols.map((symbol: string) => <i key={symbol}>{symbol}</i>)}
                  </span>
                </span>
                <span className="mi-news-drawer__title">{props.translatedTitles[row.itemId] ?? row.displayTitle ?? row.title}</span>
              </button>
              {props.translationEnabled && hasIconText(text, 'news.sentiment.more') ? (
                <IconButton
                  ariaLabelKey="news.sentiment.more"
                  icon={MoreVertical}
                  onSelect={() => {
                    const rect = (document.activeElement as HTMLElement | null)?.getBoundingClientRect()
                    props.onRowContextMenu(row.itemId, rect?.left ?? 0, (rect?.bottom ?? 0) + 4)
                  }}
                  resolveText={resolveIconText}
                  size="sm"
                  tooltipKey="news.sentiment.more"
                />
              ) : null}
              </div>
              )
            })}

          </div>

  )
}
