// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_CALENDAR_LANDED_COUNTRIES, type CalendarLandedCountrySelection } from '../../../contracts/calendarLandedCountries'
import { CalendarLandedCountriesRow } from './calendarLandedCountriesRow'
import { intelligenceNotificationText } from './text'

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

  it('speaks both languages from the same keys', () => {
    mount(staticRow({ scope: 'all', codes: [] }, en))
    expect(selectText()).toBe(en['pages.intelligence.notification.countries.all'])
    expect(container.textContent).toContain(en['pages.intelligence.notification.countries.allNote'])
  })
})
