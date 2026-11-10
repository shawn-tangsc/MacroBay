// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import { productText } from '../../../shared/i18n/productText'
import { CalendarInspector } from './CalendarInspector'

// 宽度由调用点给 `size`，组件那张表里出现一次：断言**抽屉收到的 props**，不用量像素。
const captured = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('@platform/ui/components/drawer', async () => {
  const actual = await vi.importActual<typeof import('@platform/ui/components/drawer')>('@platform/ui/components/drawer')
  return {
    ...actual,
    Drawer: (props: Record<string, unknown>) => {
      captured.props.push(props)
      return actual.Drawer(props as never)
    }
  }
})

const DETAIL_TITLE = productText['zh-CN'].pages.intelligence.portal.calendar.details.title

async function mount(host: HTMLDivElement, element: React.ReactElement): Promise<ReturnType<typeof createRoot>> {
  const root = createRoot(host)
  await act(async () => root.render(element))
  return root
}

function detail(content = 'Derived detail') {
  return <p>{content}</p>
}

it('opens the platform drawer: wide-but-not-modal, no mask, no focus theft', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const close = vi.fn()
  const root = await mount(host, <CalendarInspector contentId="US.CPI.AUGUST" onClose={close} open when="20:30 GMT+8">{detail()}</CalendarInspector>)
  try {
    // 承载归平台：抽屉是 `inline` + `large`（640），宽度只在组件那张表里出现一次。
    // 判据看抽屉收到的 props（换成 `large` 就是三条变化），不量像素。
    const props = captured.props.at(-1)!
    expect(props.size).toBe('large')
    expect(props.mode).toBe('inline')
    expect(props.side).toBe('left')
    expect(props.contentPadding).toBe('flush')
    expect(props.header).toBe('titled')
    expect(props.titleKey).toBe('pages.intelligence.portal.calendar.details.title')
    const layer = host.querySelector<HTMLElement>('[data-calendar-detail-layer]')
    expect(layer, 'the drawer sits in its own overlay layer, not in the calendar column').not.toBeNull()
    const drawer = layer!.querySelector('.drawer--inline')
    expect(drawer?.classList.contains('drawer--large')).toBe(true)
    expect(drawer?.classList.contains('drawer--left')).toBe(true)
    // 无遮罩、不锁背景：读者点日历上的另一行就是换内容，不需要先关掉什么。
    expect(host.querySelector('.ant-drawer-mask')).toBeNull()
    // 面板仍是那只带 token 的 `mi-calendar-detail`，正文容器一字未改。
    const panel = layer!.querySelector('.ant-drawer-content')
    expect(panel?.classList.contains('mi-calendar-detail')).toBe(true)
    expect(layer!.querySelector('[data-calendar-detail-container]')?.textContent).toContain('Derived detail')
    // 正文容器是 `flush`：抽屉自己不引入内距，20px 由容器给（与旧面板 10+10 一致）。
    expect(layer!.querySelector('.ant-drawer-body')?.classList.contains('ant-drawer-body')).toBe(true)
    // 一个可见的出口，名字来自平台抽屉的文案表。
    const closeControl = layer!.querySelector<HTMLButtonElement>('button[aria-label]')!
    expect(closeControl).not.toBeNull()
    await act(async () => closeControl.click())
    expect(close).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('keeps nothing of the detail mounted while the drawer is closed', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const root = await mount(host, <CalendarInspector contentId="US.CPI.AUGUST" onClose={() => {}} open={false} when="20:30 GMT+8">{detail()}</CalendarInspector>)
  try {
    expect(host.querySelector('[data-calendar-detail-layer]')).toBeNull()
    expect(host.querySelector('[data-calendar-detail-container]')).toBeNull()
    expect(host.textContent).not.toContain('Derived detail')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('closes on Escape from anywhere, and hands the focus back to the row it was opened from', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const row = document.createElement('button'); row.textContent = 'event row'; document.body.append(row)
  const close = vi.fn()
  const returnFocusTo = vi.fn((id: string) => (id === 'US.CPI.AUGUST' ? row : null))
  const root = createRoot(host)
  try {
    await act(async () => root.render(
      <CalendarInspector contentId="US.CPI.AUGUST" onClose={close} open={false} returnFocusTo={returnFocusTo} when="20:30 GMT+8">List</CalendarInspector>
    ))
    await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).not.toHaveBeenCalled()

    await act(async () => root.render(
      <CalendarInspector contentId="US.CPI.AUGUST" onClose={close} open returnFocusTo={returnFocusTo} when="20:30 GMT+8">{detail('Event detail')}</CalendarInspector>
    ))
    // `inline` 不抢焦点：读者在列表里连着选，打开抽屉不许把他拽走。
    expect(document.activeElement).not.toBe(host.querySelector('button[aria-label]'))
    // Esc 挂在 document：焦点在页面别处时也要能关。
    await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(close).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove(); row.remove() }
})

// 焦点只在**关闭**时归还。换内容是「翻下一行」，把焦点拽走会让读者连读中断。
it('returns focus on close, and leaves it alone when the reader switches to another event', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const rows = ['US.CPI.AUGUST', 'US.FOMC.SEPTEMBER'].map(key => {
    const button = document.createElement('button'); button.textContent = key; button.dataset.eventKey = key; document.body.append(button)
    return button
  })
  const returnFocusTo = (id: string) => rows.find(button => button.dataset.eventKey === id) ?? null
  const root = createRoot(host)
  const render = async (contentId: string, open: boolean): Promise<void> => {
    await act(async () => root.render(
      <CalendarInspector contentId={contentId} onClose={() => undefined} open={open} returnFocusTo={returnFocusTo} when="20:30 GMT+8">{detail()}</CalendarInspector>
    ))
  }
  try {
    await render('US.CPI.AUGUST', true)
    rows[0]!.focus()
    // 换内容：另一行被选中，焦点停在读者手上，不被拽到新行也不被拽进抽屉。
    await render('US.FOMC.SEPTEMBER', true)
    expect(document.activeElement).toBe(rows[0])
    // 关闭：焦点回到「被点的那一行」——这里是当前选中的那条。
    await render('US.FOMC.SEPTEMBER', false)
    expect(document.activeElement).toBe(rows[1])
  } finally { await act(async () => root.unmount()); host.remove(); for (const row of rows) row.remove() }
})

it('announces which row is showing, with its moment, once for a burst of picks', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const render = async (contentId: string, when: string): Promise<void> => {
    await act(async () => {
      root.render(
        <CalendarInspector contentId={contentId} onClose={() => undefined} open when={when}>{detail('Event detail')}</CalendarInspector>
      )
    })
  }
  try {
    await render('US.CPI.AUGUST', '20:30 GMT+8')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    const first = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(first).toContain(DETAIL_TITLE)
    expect(first).toContain('20:30 GMT+8')
    // A template that was never filled also "contains the title", so the placeholder check is the
    // one that catches an empty `when`.
    expect(first).not.toContain('{')

    // Two picks inside the debounce window: the reader wants "where did I land", not a transcript.
    await render('US.FOMC.SEPTEMBER', '21:00 GMT+8')
    await render('US.NFP.SEPTEMBER', '21:30 GMT+8')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    const status = host.querySelector('[role="status"]')?.textContent ?? ''
    expect(status).toContain('21:30 GMT+8')
    expect(status).not.toContain('21:00 GMT+8')
  } finally { vi.useRealTimers(); await act(async () => root.unmount()); host.remove() }
})
