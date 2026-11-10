import { useState, type ReactElement } from 'react'

import './sourceFilterList.css'

/**
 * 来源列表的六筛选 + 分组/平铺（C5）。
 *
 * 形状照 `docs-private/05-desktop/ui-audit/prototypes/2026-11-11-c5-source-list-shape.html`：
 * 六筛选（全部 / 日历 / 看板 / 舆情 / 待接入 / 进阶）同一时刻只有一块可见；切到「看板」自动用平铺；
 * 空结果只有一套文案、一颗「清除筛选」。文案全部由宿主给（键与解析归 i18n，组件里零字面量）。
 */
export type SourceFilterTab = 'all' | 'calendar' | 'dashboard' | 'sentiment' | 'pending' | 'advanced'

export const SOURCE_FILTER_TABS: readonly SourceFilterTab[] = ['all', 'calendar', 'dashboard', 'sentiment', 'pending', 'advanced']

export type SourceListMode = 'grouped' | 'tiles'

export type SourceFilterItem = Readonly<{
  id: string
  name: string
  /** 行尾状态词（已经解析好的读者用词）。 */
  status: string
  /** 这一项属于哪几个筛选；`all` 不用写。 */
  tabs: readonly Exclude<SourceFilterTab, 'all'>[]
  /** 行内标签（类别 / 采集方式之类），已解析。 */
  tags?: readonly string[]
}>

export type SourceFilterListText = Readonly<{
  filters: Readonly<Record<SourceFilterTab, string>>
  filterGroupLabel: string
  grouped: string
  tiles: string
  layoutGroupLabel: string
  emptyTitle: string
  emptyBody: string
  clear: string
}>

export function SourceFilterList({ items, text }: {
  items: readonly SourceFilterItem[]
  text: SourceFilterListText
}): ReactElement {
  const [tab, setTab] = useState<SourceFilterTab>('all')
  const [mode, setMode] = useState<SourceListMode>('grouped')

  const visible = tab === 'all' ? items : items.filter((item) => item.tabs.includes(tab))
  // 「看板」筛选自动切平铺：读者在那里的任务是横向比卡片，不是读长列表。手切之后仍然尊重手切。
  const effectiveMode: SourceListMode = tab === 'dashboard' ? 'tiles' : mode

  return (
    <section className="source-filter-list">
      <div aria-label={text.filterGroupLabel} className="source-filter-list__filters" role="group">
        {SOURCE_FILTER_TABS.map((value) => (
          <button
            aria-pressed={tab === value}
            className="source-filter-list__filter"
            key={value}
            onClick={() => setTab(value)}
            type="button">
            {text.filters[value]}
          </button>
        ))}
      </div>

      <div className="source-filter-list__toolbar">
        <span className="source-filter-list__count">{visible.length}</span>
        <div aria-label={text.layoutGroupLabel} className="source-filter-list__modes" role="group">
          {(['grouped', 'tiles'] as const).map((value) => (
            <button
              aria-pressed={effectiveMode === value}
              className="source-filter-list__mode"
              key={value}
              onClick={() => setMode(value)}
              type="button">
              {value === 'grouped' ? text.grouped : text.tiles}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="source-filter-list__empty" role="status">
          <strong>{text.emptyTitle}</strong>
          <p>{text.emptyBody}</p>
          {/* 空态只有这一颗；左侧筛选仍在一屏内可见，所以不再放第二颗「清除筛选」。 */}
          <button className="source-filter-list__clear" onClick={() => { setTab('all'); setMode('grouped') }} type="button">
            {text.clear}
          </button>
        </div>
      ) : effectiveMode === 'tiles' ? (
        <ul className="source-filter-list__tiles">
          {visible.map((item) => (
            <li className="source-filter-list__tile" data-source-id={item.id} key={item.id}>
              <strong>{item.name}</strong>
              <span className="source-filter-list__status">{item.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="source-filter-list__rows">
          {visible.map((item) => (
            <li className="source-filter-list__row" data-source-id={item.id} key={item.id}>
              <span className="source-filter-list__name">{item.name}</span>
              {item.tags?.map((tag) => <span className="source-filter-list__tag" key={tag}>{tag}</span>)}
              <span className="source-filter-list__status">{item.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
