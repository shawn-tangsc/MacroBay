// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

import { productText } from '../../shared/i18n/productText'
import { DailyBriefingEditionActions } from './DailyBriefingPageActions'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

let host: HTMLDivElement
let root: Root
let callback: IntersectionObserverCallback | undefined
const disconnect = vi.fn()

class FakeObserver {
  constructor(cb: IntersectionObserverCallback) { callback = cb }
  observe(): void { /* nothing: the test drives the callback itself */ }
  unobserve(): void { /* not used */ }
  disconnect(): void { disconnect() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  callback = undefined
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function render(): void {
  act(() => {
    root.render(<ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}><ConfirmProvider>
      <section className="mi-daily-briefing-page__content">
        <DailyBriefingEditionActions
          text={text} resolveText={(key) => key} exportable exportState="idle" copyState="idle" generating={false}
          onExport={() => undefined} onCopy={() => undefined} onRegenerate={() => undefined}
          push={{ state: { kind: 'idle' }, sentence: undefined, onPush: () => undefined, onRetry: () => undefined } as never}
          pushText={{ button: 'b', sending: 's', delivered: 'd', failedTitle: 'f', retry: 'r', disabled: {}, failed: {} } as never}
        />
      </section>
    </ConfirmProvider></ConfigProvider>)
  })
}

describe('the edition bar floats only while the report scrolls under it', () => {
  it('is drawn as part of the report until the sentinel leaves the scroll port', () => {
    // 静止时这条栏是透明的（它就是正文的一部分）；吸住之后才上底色与接缝，否则文字会从按钮下面
    // 穿过去。判定靠哨兵，不靠 scroll 里算 offset。
    render()
    const bar = host.querySelector<HTMLElement>('.mi-daily-briefing-page__report-bar')!
    expect(bar.getAttribute('data-stuck')).toBeNull()
    expect(callback).toBeDefined()
    act(() => { callback!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver) })
    expect(bar.getAttribute('data-stuck')).toBe('true')
    act(() => { callback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver) })
    expect(bar.getAttribute('data-stuck')).toBeNull()
  })

  it('gives every button in the bar a visible label', () => {
    // 空框是"按钮有节点、没有字"：要么 label 键没传进来，要么字被吃掉。这条只判渲染出来的文字，
    // 颜色/对比度归样式那条线——两件事分开判，才知道是哪种。
    render()
    const bar = host.querySelector<HTMLElement>('.mi-daily-briefing-page__report-bar')!
    const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.length).toBeGreaterThanOrEqual(5)
    for (const button of buttons) expect(button.textContent?.trim() ?? '', button.getAttribute('data-toolbar-action') ?? 'push').not.toBe('')
    expect(bar.textContent).toContain(text.regenerate)
    expect(bar.textContent).toContain(text.exportImage)
    expect(bar.textContent).toContain(text.copy)
    expect(bar.textContent).toContain(text.history.deleteEditionConfirm)
  })

  it('keeps the five edition actions and no page-level action in the bar', () => {
    render()
    const bar = host.querySelector<HTMLElement>('.mi-daily-briefing-page__report-bar')!
    expect([...bar.querySelectorAll('[data-toolbar-action]')].map((node) => node.getAttribute('data-toolbar-action')))
      .toEqual(['regenerate-edition', 'export', 'copy', 'delete-edition'])
    // 「发布频道」不是 data-toolbar-action，它在 push 槽里，仍然属于这一组。
    expect(bar.querySelector('.mi-daily-briefing__push-slot')).not.toBeNull()
    // 页面级两颗不在这一组里：今天出不出 ≠ 这一版怎么处置。
    expect(bar.querySelector('[data-toolbar-action="settings"]')).toBeNull()
    expect(bar.querySelector('.mi-daily-briefing-tool__btn--primary')).toBeNull()
  })
})
