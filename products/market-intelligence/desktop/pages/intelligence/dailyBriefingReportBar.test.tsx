// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { WINDOW_ANTD_BUTTON_CONFIG } from '@platform/ui/theme/windowAntdTheme'

import { productText } from '../../shared/i18n/productText'
import { DailyBriefingEditionActions } from './DailyBriefingPageActions'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(): void {
  act(() => {
    root.render(<ConfigProvider button={WINDOW_ANTD_BUTTON_CONFIG}><ConfirmProvider>
      <DailyBriefingEditionActions
        text={text} resolveText={(key) => key} exportable exportState="idle" copyState="idle" generating={false}
        onExport={() => undefined} onCopy={() => undefined} onRegenerate={() => undefined}
        push={{ state: { kind: 'idle' }, sentence: undefined, onPush: () => undefined, onRetry: () => undefined } as never}
        pushText={{ button: 'b', sending: 's', delivered: 'd', failedTitle: 'f', retry: 'r', disabled: {}, failed: {} } as never}
      />
    </ConfirmProvider></ConfigProvider>)
  })
}

describe('the edition bar belongs to the card, not to the scrolling sheet', () => {
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
    expect(bar.querySelector('.mi-briefing-tool__btn--primary')).toBeNull()
  })

  it('has no scroll state at all: the bar does not move, so nothing may change with scrolling', () => {
    // 结构改成"工具栏固定 + 只包纸的滚动区"之后，`sticky`、`data-stuck`、零高哨兵与
    // `IntersectionObserver` 全都不需要了。留着就是两套外观：静止一套、滚动中一套。
    render()
    const bar = host.querySelector<HTMLElement>('.mi-daily-briefing-page__report-bar')!
    expect(bar.getAttribute('data-stuck')).toBeNull()
    expect(host.querySelector('.mi-daily-briefing-page__report-sentinel')).toBeNull()
  })
})
