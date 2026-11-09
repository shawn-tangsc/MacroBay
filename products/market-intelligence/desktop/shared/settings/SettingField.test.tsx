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
const resolveOptionLabel = (source: SettingOptionsSource, value: string | number): string => `${source}:${String(value)}`

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
    expect(rowNode?.textContent).toContain(`t:${SWITCH_ROW.copy.labelKey}`)
    expect(rowNode?.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    // ⓘ 的读屏名也来自 copy，不是硬编码。
    const infoButton = [...(rowNode?.querySelectorAll('button[aria-label]') ?? [])]
      .find((button) => button.getAttribute('aria-label') === `t:${SWITCH_ROW.copy.helpKey}`)
    expect(infoButton).toBeTruthy()
  })

  it('does not render at all when visibleWhen is false (no disabled row)', async () => {
    const hidden = await mount(renderField(CONDITIONAL_ROW, { view: { enabled: false } }))
    expect(hidden.querySelector('[data-setting-key]')).toBeNull()
    act(() => root?.unmount())
    const shown = await mount(renderField(CONDITIONAL_ROW, { view: { enabled: true }, value: 60 }))
    expect(shown.querySelector('[data-setting-key="setting:notifications.calendar.lead"]')).not.toBeNull()
  })

  it('renders a select with option values from the registry and labels from the caller', async () => {
    const container = await mount(renderField(SELECT_ROW, { value: 'medium' }))
    const control = container.querySelector('[data-setting-key="setting:notifications.push-threshold"]')
    expect(control).not.toBeNull()
    expect(control?.querySelector('.ant-select')).not.toBeNull()
    expect(control?.textContent).toContain('news-push-thresholds:medium')
  })

  it('multiSelect keeps a locked option checked, disabled and present in the emitted value', async () => {
    const onChange = vi.fn()
    const container = await mount(renderField(SURFACES_ROW, {
      value: ['center', 'channel'],
      onChange,
      view: { selection: { center: true, channel: true, toast: false } }
    }))
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(4)
    const center = boxes.find((box) => box.closest('label')?.textContent?.includes('notification-surfaces:center'))
    expect(center?.checked).toBe(true)
    expect(center?.disabled).toBe(true)

    const toast = boxes.find((box) => box.closest('label')?.textContent?.includes('notification-surfaces:toast'))
    await act(async () => { toast?.click() })
    // 中心恒收：勾一个别的面时，值里仍然带着它。
    expect(onChange).toHaveBeenCalledWith(['center', 'channel', 'toast'])
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
