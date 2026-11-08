// @vitest-environment happy-dom

/**
 * 守卫：设置行的正文里只允许出现**字段名、当前值、控件**。
 *
 * 用户 2026-11-08 第三次为这件事发火（原话：「描述性说明要我说几次啊？不要直接这么显示在我的界面上啊」）：
 * 说明是给我们自己看的，读者要的是「这一项是什么、我现在选的是什么」。所以
 * **任何说明性 / 范围性 / 代价性的整句，一律住进 ⓘ，正文一个字都不留**。
 *
 * 这条用例就是那句话的机械判据：
 * - ⓘ 没打开时，正文（`textContent`）里不许出现那些句子；
 * - 打开 ⓘ 之后，句子必须在 `[data-popover-content]` 里——说明不是被删掉，是被收起来了。
 *
 * 它能红：把任一句改回 `note` 渲染（正文行），第一组断言立刻失败。
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CalendarReminderSettingsView } from '../../shared/ipc/intelligenceReminderClient'
import { CalendarDetail } from './calendarDetail'
import { CalendarLandedCountriesRow } from './calendarLandedCountriesRow'
import { intelligenceNotificationText } from './text'

const zh = intelligenceNotificationText['zh-CN'] as unknown as Readonly<Record<string, string>>

const key = (name: string): string => zh[`pages.intelligence.notification.${name}`] ?? ''

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

async function mount(element: React.ReactElement): Promise<void> {
  await act(async () => { root.render(element) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const selectText = (): string => container.querySelector('.ant-select-selection-item')?.textContent ?? ''

function reminderView(overrides: Partial<CalendarReminderSettingsView> = {}): CalendarReminderSettingsView {
  return {
    enabled: true,
    importance: ['high'],
    landedCountries: { codes: [], scope: 'us' },
    landedFilter: 'surprise-only',
    leadMinutes: 60,
    ...overrides
  }
}

function calendarDetail(view: CalendarReminderSettingsView): React.ReactElement {
  return <CalendarDetail
    reminder={{
      reload: () => undefined,
      saveFailed: false,
      saving: false,
      status: 'ready',
      update: () => undefined,
      value: view
    }}
    resolveText={(name) => zh[name] ?? ''}
    surfaces={{
      available: ['channel', 'toast'],
      conflict: false,
      reload: () => undefined,
      saveFailed: false,
      saving: false,
      selection: {},
      status: 'ready',
      toastMasterOff: false,
      toggle: () => undefined
    }}
    text={zh}
  />
}

/**
 * 点开一行上的 ⓘ，读**这一颗触发器自己**指向的浮层内容（`aria-describedby` 是浮层给的 id）。
 * 不用「DOM 里第一个浮层」：关着的浮层还留在文档里，那样会读到上一颗的内容。
 */
async function openInfo(ariaLabel: string): Promise<string> {
  const trigger = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.getAttribute('aria-label') === ariaLabel)
  expect(trigger).toBeDefined()
  await act(async () => { trigger!.click() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const describedBy = trigger!.getAttribute('aria-describedby') ?? ''
  const content = describedBy.split(' ').map((id) => document.getElementById(id)).find((node) => node !== null)
  return content?.textContent ?? ''
}

describe('settings rows carry no explanatory sentence in the body', () => {
  it('keeps the country scope and its costs inside the ⓘ, not under the control', async () => {
    await mount(<CalendarLandedCountriesRow
      onChange={() => undefined}
      resolveText={(name) => zh[name] ?? ''}
      saving={false}
      selection={{ codes: ['CN', 'DE', 'US'], scope: 'custom' }}
      text={zh}
    />)

    // 正文：字段名 + 当前值 + 控件，一个说明句都没有。
    expect(container.textContent).toContain(key('countries.row'))
    expect(selectText()).toBe(key('countries.custom'))
    expect(container.textContent).toContain('3 / 8')
    expect(container.textContent).not.toContain(key('countries.scopeNote'))
    expect(container.textContent).not.toContain(key('countries.allNote'))
    expect(container.textContent).not.toContain(key('countries.customCost'))
    // 不是「被 CSS 藏起来」：这四个句子在**整页 DOM** 里都还不存在（浮层没打开就还没渲染）。
    // 也就是说它们是**没进 DOM**，不是 `display:none` 或 `opacity:0`。
    for (const sentence of [
      key('countries.scopeNote'),
      key('countries.allNote'),
      key('countries.customCost'),
      // 第四句：自选为空时的指路句，正文只留状态「还没有选任何国家」。
      key('countries.emptyHint')
    ]) {
      expect(document.body.textContent).not.toContain(sentence)
    }

    // 说明没有消失，只是收进了 ⓘ。
    const scopeInfo = await openInfo(key('countries.rowInfoAria'))
    expect(scopeInfo).toContain(key('countries.scopeNote'))
    expect(scopeInfo).toContain(key('countries.allNote'))

    const customInfo = await openInfo(key('countries.customInfoAria'))
    expect(customInfo).toContain(key('countries.customCost'))
  })

  it('keeps the "also matched" cost inside the ⓘ of that row', async () => {
    await mount(calendarDetail(reminderView({ landedFilter: 'also-matched' })))

    expect(container.textContent).toContain(key('calendar.landedRow'))
    expect(container.textContent).not.toContain(key('landed.cost'))

    const info = await openInfo(key('calendar.landedInfoAria'))
    expect(info).toContain(key('landed.cost'))
  })
})
