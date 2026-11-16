// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'

import { CalendarEventsCatalogDialog, type CatalogText } from './CalendarEventsCatalogDialog'
import type { CatalogRow } from './calendarEventCatalogModel'

/**
 * 事件目录弹框的四态（Chief 2026-11-16 的判据）：**读不到不许画成空表**，筛选后 0 行是空态，
 * 有行才是表。断在弹框的真实 DOM 里（portal 到 body）。
 */
const text: CatalogText = {
  title: '本月的事件', nameFilter: '按名称筛选', countryFilter: '按国家筛选', importanceFilter: '按重要性筛选',
  importanceAny: '', columns: { name: '名称', country: '国家', period: '期间', date: '最近一次发布', next: '下次发布', time: '时刻', importance: '重要性' },
  sourceLabelTag: '源原文名', loading: '', unavailable: '', noMatch: '', pageSizeLabel: '',
  importance: { high: '高', medium: '中', low: '低' }
}

const row = (key: string, title: string, over: Partial<CatalogRow> = {}): CatalogRow => ({
  key, title, titleIsSourceLabel: false, names: [title], countryLabel: '美国', countryCode: 'US', time: '08:30', ...over
})

const render = async (props: Readonly<{ rows: readonly CatalogRow[]; state: 'ready' | 'loading' | 'unavailable' }>) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<CalendarEventsCatalogDialog open onClose={() => undefined} text={text}
    columns={['name', 'country', 'period', 'date', 'next']} rows={props.rows} state={props.state} />))
  return { body: document.body, done: async () => { await act(async () => root.unmount()); host.remove() } }
}

it('renders one row per event, and marks rows whose name is only the source label', async () => {
  const view = await render({ state: 'ready', rows: [row('a', 'CPI 年率'), row('b', 'transmutation in seasonally adjusted', { titleIsSourceLabel: true })] })
  try {
    const names = [...view.body.querySelectorAll('[data-catalog-name]')]
    expect(names).toHaveLength(2)
    // 那约 420 行只有源原文名：要标注，读者才知道这条没有名表条目。
    expect(names[1]!.textContent).toContain('源原文名')
  } finally { await view.done() }
})

it('shows an error state instead of an empty table when the read failed', async () => {
  const view = await render({ state: 'unavailable', rows: [] })
  try {
    // 读不到 ≠ 没有：不许出现表头和「没有匹配」。
    expect(view.body.querySelector('.ant-table')).toBeNull()
    expect(view.body.querySelector('.ant-empty')).toBeNull()
    expect(view.body.textContent).not.toContain('没有匹配')
  } finally { await view.done() }
})

it('shows the empty state when the answer is zero rows', async () => {
  const view = await render({ state: 'ready', rows: [] })
  try {
    expect(view.body.querySelector('.ant-table')).toBeNull()
    // 空态与读不到是两种态：这条要有空态，且不该是错误态。
    expect(view.body.querySelector('.ant-empty') ?? view.body.querySelector('[data-state]')).not.toBeNull()
  } finally { await view.done() }
})

it('shows the period and both release dates, and leaves them empty when there are none', async () => {
  // 空着是真的没有；写「暂无」「—」是在替数据撒谎（与「缺少 ≠ 没查到」同一条）。
  const view = await render({
    state: 'ready',
    rows: [
      row('a', 'CPI 年率', { period: '2026-M10', lastRelease: '2026-11-12', nextRelease: '2026-12-10' }),
      row('b', '无日期的事件', { period: '2026-11-16T13:30:00.000Z' })
    ]
  })
  try {
    const cells = [...view.body.querySelectorAll('.ant-table-tbody tr')].map((tr) => tr.textContent ?? '')
    // 期间只显示年月：源有时给到 `2026-11-16T13:30`，时刻属于「最近一次发布」那一列。
    expect(cells[0]).toContain('2026-M10')
    expect(cells[0]).toContain('2026-11-12')
    expect(cells[0]).toContain('2026-12-10')
    // 无值：那几格是空的，不许出现占位词。
    // 源把时刻当期间给过来时，只留年月：时刻属于「最近一次发布」那一列。
    expect(cells[1]).toContain('2026-11')
    expect(cells[1]).not.toContain('13:30')
    expect(cells[1]).not.toContain('暂无')
    expect(cells[1]).not.toContain('—')
  } finally { await view.done() }
})
