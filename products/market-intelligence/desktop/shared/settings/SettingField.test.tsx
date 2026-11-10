// @vitest-environment happy-dom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SettingDescriptor, SettingOptionsSource } from './descriptorTypes'
import { settingRegistry } from './registry'
import { SettingField } from './SettingField'

const row = (key: string): SettingDescriptor =>
  settingRegistry.notifications.find((entry) => entry.key === key) as SettingDescriptor

const SWITCH_ROW = row('setting:notifications.calendar.enabled')
const SELECT_ROW = row('setting:notifications.push-threshold')
const MULTI_ROW = row('setting:notifications.calendar.importance')
const SURFACES_ROW = row('setting:notifications.surfaces')
const CONDITIONAL_ROW = row('setting:notifications.calendar.lead')

const resolveText = (key: string): string => `t:${key}`
const resolveOptionLabel = (value: string | number, source?: SettingOptionsSource): string => `${source ?? 'view'}:${String(value)}`

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.innerHTML = ''
})

async function mount(node: ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root?.render(node) })
  await act(async () => {})
  return container
}

function renderField(
  descriptor: SettingDescriptor,
  options: Partial<Parameters<typeof SettingField>[0]> = {}
): ReactElement {
  return <SettingField
    copyClassName="copy"
    descriptor={descriptor}
    labelTextClassName="label-text"
    onChange={() => undefined}
    resolveOptionLabel={resolveOptionLabel}
    resolveText={resolveText}
    rowClassName="row"
    value={undefined}
    view={{}}
    {...options}
  />
}

describe('SettingField', () => {
  it('renders a switch row with data-setting-key and the label/ⓘ from copy keys', async () => {
    const container = await mount(renderField(SWITCH_ROW, { value: true }))
    const rowNode = container.querySelector('[data-setting-key="setting:notifications.calendar.enabled"]')
    expect(rowNode).not.toBeNull()
    expect(rowNode?.textContent).toContain(`t:${SWITCH_ROW.copy?.labelKey ?? ''}`)
    expect(rowNode?.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    // ⓘ 的读屏名也来自 copy，不是硬编码。
    const infoButton = [...(rowNode?.querySelectorAll('button[aria-label]') ?? [])]
      .find((button) => button.getAttribute('aria-label') === `t:${SWITCH_ROW.copy?.helpKey ?? ''}`)
    expect(infoButton).toBeTruthy()
  })

  it('uses labelText(view) for keyed rows and the concrete instance key on the row', async () => {
    const enabled = settingRegistry.sources.find(
      (row) => row.key === 'setting:sources.enabled@<sourceId>'
    ) as SettingDescriptor
    const container = await mount(renderField(enabled, {
      view: { sourceId: 'coindesk-rss', displayName: 'CoinDesk RSS', enabled: true },
      instanceKey: 'setting:sources.enabled@coindesk-rss',
      value: true
    }))
    const node = container.querySelector('[data-setting-key="setting:sources.enabled@coindesk-rss"]')
    expect(node).not.toBeNull()
    // 行名是数据（来源名），不是文案键。
    expect(node?.textContent).toContain('CoinDesk RSS')
    expect(node?.textContent).not.toContain('setting:sources.enabled')
  })

  it('takes the capability fact from the view: the row disappears when the fact is absent', async () => {
    // 能力事实进视图，`visibleWhen(view)` 只读视图；缺这条事实 ⇒ 整行不渲染，
    // 不许默认 true，也不许由渲染层另传一份上下文。
    const include = settingRegistry.sources.find(
      (row) => row.key === 'setting:sources.include-in-sentiment@<sourceId>'
    ) as SettingDescriptor
    const view = (supportsSentiment?: boolean) => ({
      sourceId: 'coindesk-rss',
      profile: { includeInSentiment: true },
      ...(supportsSentiment === undefined ? {} : { supportsSentiment })
    })
    const hidden = await mount(renderField(include, { view: view(false) }))
    expect(hidden.querySelector('[data-setting-key]')).toBeNull()
    act(() => root?.unmount())
    const missing = await mount(renderField(include, { view: view() }))
    expect(missing.querySelector('[data-setting-key]')).toBeNull()
    act(() => root?.unmount())
    const shown = await mount(renderField(include, { view: view(true) }))
    expect(shown.querySelector('[data-setting-key]')).not.toBeNull()
  })

  it('does not render at all when visibleWhen is false (no disabled row)', async () => {
    const hidden = await mount(renderField(CONDITIONAL_ROW, { view: { enabled: false } }))
    expect(hidden.querySelector('[data-setting-key]')).toBeNull()
    act(() => root?.unmount())
    const shown = await mount(renderField(CONDITIONAL_ROW, { view: { enabled: true }, value: 60 }))
    expect(shown.querySelector('[data-setting-key="setting:notifications.calendar.lead"]')).not.toBeNull()
  })

  it('draws a declared segmented select with the platform Segmented', async () => {
    const onChange = vi.fn()
    const container = await mount(renderField(SELECT_ROW, { value: 'medium', onChange }))
    const group = container.querySelector('.segmented')
    expect(group).not.toBeNull()
    expect(group?.getAttribute('role')).toBe('group')
    const high = [...(group?.querySelectorAll('button') ?? [])]
      .find((button) => button.textContent === 'news-push-thresholds:high')
    await act(async () => { high?.click() })
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('takes multiSelect options from the view when the declaration says so', async () => {
    const onChange = vi.fn()
    const descriptor: SettingDescriptor = {
      ...SURFACES_ROW,
      key: 'setting:test.view-options',
      field: { kind: 'multiSelect', optionsFrom: { kind: 'view', field: 'available' } }
    }
    const container = await mount(renderField(descriptor, {
      value: ['channel'],
      onChange,
      view: { available: ['channel', 'toast'] }
    }))
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    // 只有视图给的两项；静态集合的四项（含 center）不许冒出来。
    expect(boxes).toHaveLength(2)
    const toast = boxes.find((box) => box.closest('label')?.textContent?.includes('view:toast'))
    await act(async () => { toast?.click() })
    expect(onChange).toHaveBeenCalledWith(['channel', 'toast'])
  })

  it('renders every help line of a declaration into the same ⓘ trigger', async () => {
    const descriptor: SettingDescriptor = {
      ...SWITCH_ROW,
      key: 'setting:test.multi-help',
      copy: { helpKeys: ['help.one', 'help.two'], helpAriaKey: 'help.aria' }
    }
    const container = await mount(renderField(descriptor, { value: true }))
    const trigger = [...(container.querySelectorAll('button[aria-label]') ?? [])]
      .find((button) => button.getAttribute('aria-label') === 't:help.aria')
    expect(trigger).toBeTruthy()
  })

  it('renders an undeclared select as antd Select, with labels from the caller', async () => {
    // 国家范围这一行没声明 presentation，默认就是 antd Select（与现状一致）。
    const scope = settingRegistry.notifications.find(
      (row) => row.key === 'setting:notifications.calendar.landed-countries.scope'
    ) as SettingDescriptor
    const container = await mount(renderField(scope, { value: 'us' }))
    const control = container.querySelector('[data-setting-key="setting:notifications.calendar.landed-countries.scope"]')
    expect(control).not.toBeNull()
    expect(control?.querySelector('.ant-select')).not.toBeNull()
    expect(control?.textContent).toContain('calendar-landed-scopes:us')
  })


  it('multiSelect toggles a plain option off and on', async () => {
    const onChange = vi.fn()
    const container = await mount(renderField(MULTI_ROW, { value: ['high'], onChange, view: { enabled: true } }))
    const medium = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((box) => box.closest('label')?.textContent?.includes('calendar-reminder-importance:medium'))
    await act(async () => { medium?.click() })
    expect(onChange).toHaveBeenCalledWith(['high', 'medium'])
  })

  it('renders unimplemented as one explanation line with no control', async () => {
    const unimplemented: SettingDescriptor = { ...SWITCH_ROW, availability: 'unimplemented' }
    const container = await mount(renderField(unimplemented, { unimplementedText: 'not built yet' }))
    const node = container.querySelector('[data-setting-key]')
    expect(node?.textContent).toContain('not built yet')
    expect(node?.querySelector('button[role="switch"]')).toBeNull()
  })

  it('leaves row-level status to the page: children render after the control, never owned here', async () => {
    const container = await mount(renderField(SWITCH_ROW, {
      value: true,
      children: <span data-testid="status">save failed</span>
    }))
    const status = container.querySelector('[data-testid="status"]')
    expect(status).not.toBeNull()
    expect(status?.parentElement).toBe(container.querySelector('[data-setting-key]'))
  })

  it('renders readonly as text and number as an input', async () => {
    const readonly: SettingDescriptor = { ...SWITCH_ROW, key: 'setting:test.readonly', field: { kind: 'readonly' } }
    const readContainer = await mount(renderField(readonly, { value: '平台默认' }))
    expect(readContainer.querySelector('[data-setting-key]')?.textContent).toContain('平台默认')

    const number: SettingDescriptor = { ...SWITCH_ROW, key: 'setting:test.number', field: { kind: 'number', min: 1, max: 9 } }
    const numberContainer = await mount(renderField(number, { value: 3 }))
    expect(numberContainer.querySelector('[data-setting-key] input')).not.toBeNull()
  })
})
