// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_LANDED_COUNTRIES, type CalendarLandedCountrySelection } from '../../../contracts/calendarLandedCountries'
import type { CalendarReminderClient, CalendarReminderSettingsView } from '../../shared/ipc/intelligenceReminderClient'
import { CalendarLandedCountriesRow } from './calendarLandedCountriesRow'
import { intelligenceNotificationText } from './text'
import { useCalendarReminderSettings } from './useCalendarReminderSettings'

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

function mount(element: React.ReactElement): void {
  act(() => root.render(element))
}

/** 让挂起的 promise（读、写回调）落地。 */
async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

/** 只渲染、不写：用来走各选择态。 */
function staticRow(selection: CalendarLandedCountrySelection, text = zh) {
  return <CalendarLandedCountriesRow
    onChange={() => undefined}
    resolveText={(key) => text[key] ?? ''}
    saveFailedField={undefined}
    saving={false}
    selection={selection}
    text={text}
  />
}

/** 模拟真实接线：写失败时服务端的值不变，组件必须保留读者刚选的（草稿）。 */
function FailingHarness(props: Readonly<{ initial: CalendarLandedCountrySelection; text?: Readonly<Record<string, string>> }>) {
  const text = props.text ?? zh
  const [selection] = useState(props.initial)
  const [saveFailedField, setSaveFailedField] = useState<string>()
  return <CalendarLandedCountriesRow
    onChange={() => setSaveFailedField('landedCountries')}
    resolveText={(key) => text[key] ?? ''}
    saveFailedField={saveFailedField}
    saving={false}
    selection={selection}
    text={text}
  />
}

const selectText = (): string => container.querySelector('.ant-select-selection-item')?.textContent ?? ''

/** 服务端每次回的都是**新对象**（真实链路每次过一遍 IPC 反序列化），引用一定会变。 */
function freshCopy(view: CalendarReminderSettingsView): CalendarReminderSettingsView {
  return {
    ...view,
    importance: [...view.importance],
    landedCountries: { codes: [...view.landedCountries.codes], scope: view.landedCountries.scope }
  }
}

/** 真接线：页面用的那个 hook + 那一行，写失败/写成功都按真实链路回（含新对象）。 */
function HookHarness(props: Readonly<{ client: CalendarReminderClient }>): React.ReactElement | null {
  const reminder = useCalendarReminderSettings(props.client)
  const [text] = useState(zh)
  if (reminder.status !== 'ready' || reminder.value === undefined) return null
  return <>
    <button onClick={() => reminder.update({ leadMinutes: 30 })} type="button">改提前量</button>
    <CalendarLandedCountriesRow
      onChange={(next) => reminder.update({ landedCountries: next })}
      resolveText={(key) => text[key] ?? ''}
      saveFailedField={reminder.saveFailedField}
      saving={reminder.saving}
      selection={reminder.value.landedCountries}
      text={text}
    />
  </>
}

/**
 * 一条只让「国家」写失败的假服务端：别的字段照常存上并回一个新对象。
 * 这正是缺陷的形状——国家没存上，读者去改别的字段，那一次成功会把国家草稿抹掉。
 */
function clientWhereCountriesFailToSave(initial: CalendarReminderSettingsView): CalendarReminderClient {
  let held = initial
  return {
    read: async () => freshCopy(held),
    write: async (patch) => {
      if ('landedCountries' in patch) return { settings: freshCopy(held), state: 'not-saved' }
      held = { ...held, ...patch }
      return { settings: freshCopy(held), state: 'saved' }
    }
  }
}

describe('calendar landed countries row', () => {
  it('opens on US only and shows no country list', () => {
    mount(staticRow(DEFAULT_CALENDAR_LANDED_COUNTRIES))
    expect(selectText()).toBe(zh['pages.intelligence.notification.countries.us'])
    expect(container.textContent).not.toContain(zh['pages.intelligence.notification.countries.customTitle'])
    // 判据 1：默认值不变；判据 2：只有三项，且「美国与主要经济体」这个说法不存在。
    expect(container.textContent).not.toContain('美国与主要经济体')
    expect(en['pages.intelligence.notification.countries.major']).toBeUndefined()
  })

  it('adds the unknown-country sentence only when "all" is chosen', () => {
    mount(staticRow({ scope: 'all', codes: [] }))
    expect(container.textContent?.split(zh['pages.intelligence.notification.countries.allNote'])).toHaveLength(2)
    expect(container.textContent).not.toContain(zh['pages.intelligence.notification.countries.customCost'])
  })

  it('shows the custom cost sentence only for a custom selection, exactly once', () => {
    mount(staticRow({ scope: 'custom', codes: [] }))
    expect(container.textContent?.split(zh['pages.intelligence.notification.countries.customCost'])).toHaveLength(2)
    expect(container.textContent).not.toContain(zh['pages.intelligence.notification.countries.allNote'])
  })

  it('never leaves an empty custom box: count and guidance appear together', () => {
    mount(staticRow({ scope: 'custom', codes: [] }))
    expect(container.textContent).toContain('0 / 8')
    expect(container.textContent).toContain(zh['pages.intelligence.notification.countries.emptyHint'])
    // 判据 5：只有计数没有指路句即红。
    expect(container.querySelector('[data-count="0/8"]')).not.toBeNull()
  })

  it('counts against 8 and greys the unchecked ones only when full', () => {
    mount(staticRow({ scope: 'custom', codes: ['CN', 'DE', 'US'] }))
    expect(container.textContent).toContain('3 / 8')
    expect(container.textContent).not.toContain(zh['pages.intelligence.notification.countries.fullHint'])
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => !input.disabled)).toBe(true)

    mount(staticRow({ scope: 'custom', codes: ['CN', 'DE', 'US', 'CA', 'GB', 'FR', 'IT', 'JP'] }))
    expect(container.textContent).toContain('8 / 8')
    expect(container.textContent).toContain(zh['pages.intelligence.notification.countries.fullHint'])
    // 上限与名单同源，所以「满了」时八个全勾上——没有未选项可以点，也就没有可点的第九个。
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(8)
    expect(boxes.every((input) => input.checked)).toBe(true)
  })

  it('keeps the chosen value on screen when the save fails, and never toasts', () => {
    mount(<FailingHarness initial={{ scope: 'custom', codes: [] }} />)
    const firstCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    act(() => firstCheckbox.click())
    act(() => { /* 让失败回调落地 */ })

    // 判据 7：值不回退（草稿仍勾着），只多一句「这次没存上」，且没有 role=alert 的 toast。
    expect(selectText()).toBe(zh['pages.intelligence.notification.countries.custom'])
    expect(container.textContent).toContain('1 / 8')
    expect(container.textContent).toContain(zh['pages.intelligence.notification.countries.saveFailed'])
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('disables the controls while saving', () => {
    mount(<CalendarLandedCountriesRow
      onChange={() => undefined}
      resolveText={(key) => zh[key] ?? ''}
      saveFailedField={undefined}
      saving
      selection={{ scope: 'custom', codes: [] }}
      text={zh}
    />)
    expect(container.querySelector('.ant-select-disabled')).not.toBeNull()
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.disabled)).toBe(true)
  })

  it('keeps the country draft when another field saves afterwards', async () => {
    // 缺陷（界面自查退回 ①）：国家没存上 → 读者改另一个字段并保存成功 → 服务端回新对象 →
    // 旧写法按**引用**重置草稿，读者刚选的三个国家被无声抹掉，失败提示也在下一次写入开头被清掉。
    mount(<HookHarness client={clientWhereCountriesFailToSave({
      enabled: true,
      importance: ['high'],
      landedCountries: { codes: [], scope: 'custom' },
      landedFilter: 'surprise-only',
      leadMinutes: 60
    })} />)
    await flush()

    const boxes = (): HTMLInputElement[] => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes()).toHaveLength(8)
    for (const index of [0, 1, 2]) {
      const input = boxes()[index]!
      act(() => input.click())
      await flush()
    }
    expect(container.textContent).toContain('3 / 8')
    expect(container.textContent).toContain(zh['pages.intelligence.notification.countries.saveFailed'])

    // 改「提前多久」并保存成功——这一次不碰国家，草稿与失败提示都必须留着。
    act(() => {
      const changeLead = [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '改提前量')
      changeLead!.click()
    })
    await flush()

    expect(boxes().filter((input) => input.checked)).toHaveLength(3)
    expect(container.textContent).toContain('3 / 8')
    expect(container.textContent).toContain(zh['pages.intelligence.notification.countries.saveFailed'])
  })

  it('names the country checkbox group for screen readers', () => {
    // 缺陷（界面自查退回 ②）：role="group" 没有可访问名，读屏只念「组」。
    mount(staticRow({ codes: ['CN', 'US'], scope: 'custom' }))
    const group = container.querySelector('[role="group"].intelligence-notification-form-checks')
    expect(group?.getAttribute('aria-label')).toBe(zh['pages.intelligence.notification.countries.customTitle'])
  })

  it('speaks both languages from the same keys', () => {
    mount(staticRow({ scope: 'all', codes: [] }, en))
    expect(selectText()).toBe(en['pages.intelligence.notification.countries.all'])
    expect(container.textContent).toContain(en['pages.intelligence.notification.countries.allNote'])
  })
})
