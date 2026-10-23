// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { systemTimeZoneSetting } from '@platform/settings/schema/appSettings'
import { formatShellTimeZoneLabel, resolveSystemTimeZone } from '@platform/ui/time/shellTimeFormat'

import { platformText } from '../../i18n/platformText'
import { TimeZonePreference, supportedTimeZoneOptions } from './TimeZonePreference'

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
})

async function mount(value: string, onChange = vi.fn()): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(createElement(TimeZonePreference, { language: 'zh-CN', value, onChange })))
  return container
}

describe('time zone preference', () => {
  it('offers following the system first, with the resolved zone named', async () => {
    const container = await mount(systemTimeZoneSetting)
    const text = platformText['zh-CN'].preferences
    const combobox = container.querySelector('.ant-select-selector')

    expect(container.textContent).toContain(text.timeZone)
    expect(container.textContent).toContain(text.timeZoneFollowSystem)
    // 选项标签给出当前偏移（GMT±n）而不是裸时区 id，避免同名缩写歧义。
    expect(container.textContent).toContain(formatShellTimeZoneLabel(resolveSystemTimeZone(), 'zh-CN'))
    expect(combobox).not.toBeNull()
  })

  it('lists real IANA time zones and nothing invented when the runtime cannot list them', () => {
    const options = supportedTimeZoneOptions()

    expect(options.length).toBeGreaterThan(0)
    for (const option of options) expect(() => new Intl.DateTimeFormat('en-US', { timeZone: option })).not.toThrow()
  })

  it('does not warn while the runtime resolves a real system zone', async () => {
    const container = await mount(systemTimeZoneSetting)
    // 只有在系统时区都拿不到时才提示按 UTC 显示；正常运行不得出现这条噪音。
    if (resolveSystemTimeZone() !== 'UTC') expect(container.textContent).not.toContain(platformText['zh-CN'].preferences.timeZoneUnavailable)
  })
})
