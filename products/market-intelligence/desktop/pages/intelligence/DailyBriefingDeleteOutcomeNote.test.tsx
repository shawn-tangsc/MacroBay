// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { DailyBriefingDeleteOutcomeNote } from './DailyBriefingDeleteOutcomeNote'

/**
 * 删除后那一行：半成功时带一个「重试」。
 *
 * 判两件读者看得见的事：这句话说的是「还剩几条」（不是零，也不是「已删除」），以及那颗动作是
 * 平台唯一的句内文字动作（antd 文本档 + `.text-action`），不是链接档——链接档的 `colorLink`
 * 不在 token 里，会在一页里冒出第二个交互色。
 */
const zh = productText['zh-CN'].pages.intelligence.portal.dashboard.dailyBriefing

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

describe('the line a half-finished delete leaves behind', () => {
  it('says how many rows remain and offers retry as the platform text action', () => {
    const onRetry = vi.fn()
    act(() => root.render(<DailyBriefingDeleteOutcomeNote
      outcome={{ kind: 'partial', remaining: 2, target: { date: '2026-11-05', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' } }}
      text={zh}
      onRetry={onRetry} />))
    const note = host.querySelector('[data-delete-outcome="partial"]')
    expect(note?.textContent).toContain(zh.history.deletePartial.replace('{count}', '2'))
    const retry = note?.querySelector('button') as HTMLButtonElement
    expect(retry.textContent).toBe(zh.history.deleteRetry)
    expect(retry.className).toContain('text-action')
    expect(retry.className).toContain('ant-btn-text')
    expect(retry.className).not.toContain('ant-btn-link')
    act(() => { retry.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
