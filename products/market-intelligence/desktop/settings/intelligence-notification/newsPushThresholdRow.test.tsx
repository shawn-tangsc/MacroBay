// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NewsPushThresholdRow } from './newsPushThresholdRow'
import { intelligenceNotificationText } from './text'
import type { NewsPushThresholdRowState } from './useNewsPushThreshold'

const zh = intelligenceNotificationText['zh-CN'] as unknown as Readonly<Record<string, string>>
const en = intelligenceNotificationText['en-US'] as unknown as Readonly<Record<string, string>>

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(state: NewsPushThresholdRowState, text = zh): void {
  act(() => root.render(createElement(NewsPushThresholdRow, {
    resolveText: (key) => text[key] ?? '',
    state,
    text
  })))
}

const errorState = (): NewsPushThresholdRowState => ({
  reload: () => undefined,
  saveFailed: false,
  saving: false,
  setThreshold: () => undefined,
  status: 'error',
  value: 'medium'
})

describe('news push threshold row', () => {
  it('says the threshold cannot be read, instead of showing the default as if it were configured', () => {
    // 缺陷：读失败时屏上仍显示「中」，读者点保存才知道没存上，却看不出为什么。
    mount(errorState())

    // 值的位置是状态，不是档位：整枚分段控件不出现（也就没有把「中」画成已配置）。
    expect(container.querySelector('.ant-segmented')).toBeNull()
    expect(container.textContent).toContain(zh['pages.intelligence.notification.threshold.unreadable'])
    // fail-open 必须说出来：读者要知道现在不是他设的那个值。
    expect(container.textContent).toContain(zh['pages.intelligence.notification.threshold.unreadableNote'])
  })

  it('speaks the same two sentences in English', () => {
    mount(errorState(), en)
    expect(container.textContent).toContain(en['pages.intelligence.notification.threshold.unreadable'])
    expect(container.textContent).toContain(en['pages.intelligence.notification.threshold.unreadableNote'])
  })
})
