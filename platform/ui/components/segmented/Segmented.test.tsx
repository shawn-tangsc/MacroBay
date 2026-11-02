// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Segmented } from './Segmented'

const key = (value: string): string => value
const items = [
  { value: 'day', labelKey: 'ui.test.day' },
  { value: 'week', labelKey: 'ui.test.week' },
  { value: 'month', labelKey: 'ui.test.month', disabled: true }
]

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(value = 'day'): Promise<{ host: HTMLElement; onChange: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div')
  document.body.append(host)
  const onChange = vi.fn()
  root = createRoot(host)
  await act(async () => {
    root!.render(<Segmented ariaLabelKey="ui.test.range" items={items} onChange={onChange} resolveText={key} value={value} />)
  })
  return { host, onChange }
}

describe('Segmented', () => {
  it('is a group of pressed values, not a tablist', async () => {
    const { host } = await mount()

    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('ui.test.range')
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(host.querySelector('[role="tab"]')).toBeNull()
  })

  it('moves focus with arrows but only selects on Enter or Space', async () => {
    const { host, onChange } = await mount()
    const first = host.querySelector<HTMLElement>('[aria-pressed="true"]')!

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    // 只移焦，不换值：同一块内容换取值时，读者往往要先看两三个再定。
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent).toBe('ui.test.week')

    const second = host.querySelector<HTMLElement>('[aria-pressed="false"]') as HTMLElement
    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('week')
  })

  it('skips disabled values in the arrow sequence and keeps them out of the tab order', async () => {
    const { host } = await mount('week')
    const disabled = host.querySelector<HTMLButtonElement>('button[disabled]')!
    expect(disabled.getAttribute('tabindex')).toBe('-1')

    const pressed = host.querySelector<HTMLElement>('[aria-pressed="true"]')!
    await act(async () => {
      pressed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(document.activeElement?.textContent).toBe('ui.test.day')
  })

  it('selects on click', async () => {
    const { host, onChange } = await mount()
    const second = host.querySelectorAll<HTMLButtonElement>('button')[1]!
    await act(async () => {
      second.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('week')
  })
})
