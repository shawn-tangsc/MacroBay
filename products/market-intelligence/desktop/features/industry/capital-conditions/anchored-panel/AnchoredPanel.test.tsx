// @vitest-environment happy-dom
import { act, createElement, useRef, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { AnchoredPanel } from './AnchoredPanel'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function rect(left: number, top: number, bottom: number, height = bottom - top): DOMRect {
  return { left, top, width: 200, height, bottom, right: left + 200, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

/** A host with an anchor element and a trigger, the shape the flow card uses. */
function Harness({ withAnchor = true, onClose }: { withAnchor?: boolean; onClose?: () => void } = {}): ReactElement {
  const anchor = useRef<HTMLDivElement>(null)
  return createElement('div', { id: 'host' },
    createElement('div', { ref: anchor, id: 'anchor' }),
    createElement(AnchoredPanel, {
      anchor: withAnchor ? anchor : undefined,
      labelKey: 'panel.label',
      resolveText: (key: string) => (key === 'panel.label' ? '逐日数据' : ''),
      // Same mapping the card uses: aria attributes are explicit, the panel's props are not spread raw.
      trigger: (props) => createElement('button', {
        ref: props.ref,
        onClick: props.onSelect,
        onKeyDown: props.onKeyDown,
        'aria-expanded': props.expanded,
        'aria-haspopup': props.hasPopup,
        ...(props.controls === undefined ? {} : { 'aria-controls': props.controls }),
        id: 'trigger'
      }, 'open'),
      children: createElement('table', { id: 'content' }, createElement('tbody', null, createElement('tr', null, createElement('td', { tabIndex: 0, id: 'cell' }, '+$1M'))))
    })
  )
}

async function mount(element: ReactElement = createElement(Harness)): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
  const anchor = document.querySelector<HTMLElement>('#anchor')
  if (anchor) anchor.getBoundingClientRect = () => rect(100, 100, 220)
  const trigger = document.querySelector<HTMLElement>('#trigger')!
  trigger.getBoundingClientRect = () => rect(100, 20, 40)
  return container
}

const trigger = (): HTMLButtonElement => document.querySelector('#trigger')!
const panel = (): HTMLElement | null => document.querySelector('[role="dialog"]')

function mouseClick(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
}

describe('AnchoredPanel', () => {
  it('opens on the trigger and keeps the panel out of the host subtree', async () => {
    await mount()
    expect(panel()).toBeNull()
    await act(async () => mouseClick(trigger()))
    const opened = panel()!
    expect(opened).not.toBeNull()
    expect(opened.getAttribute('aria-modal')).toBe('false')
    expect(opened.getAttribute('aria-label')).toBe('逐日数据')
    expect(document.querySelector('#host')!.contains(opened)).toBe(false)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(opened.id)
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('closes when the trigger is pressed again', async () => {
    await mount()
    await act(async () => mouseClick(trigger()))
    await act(async () => mouseClick(trigger()))
    expect(panel()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(trigger().hasAttribute('aria-controls')).toBe(false)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    await mount()
    const button = trigger()
    button.focus()
    await act(async () => mouseClick(button))
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('closes on an outside mousedown without stealing focus', async () => {
    await mount()
    await act(async () => mouseClick(trigger()))
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    await act(async () => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(outside)
  })

  it('does not close when the pointer leaves a panel anchored away from its trigger', async () => {
    await mount()
    await act(async () => mouseClick(trigger()))
    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
      panel()!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
    })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(panel()).not.toBeNull()
  })

  it('stays below the anchor and never flips above it', async () => {
    await mount()
    await act(async () => mouseClick(trigger()))
    // The anchor bottom sits at 220 of a 768-tall viewport: the panel starts below it.
    expect(panel()!.style.top).toBe('224px')
    expect(panel()!.style.maxHeight).not.toBe('')
  })

  it('closes itself when the anchor node goes away', async () => {
    await mount()
    await act(async () => mouseClick(trigger()))
    expect(panel()).not.toBeNull()
    document.querySelector('#anchor')!.remove()
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(panel()).toBeNull()
  })

  it('takes focus into the panel when opened from the keyboard', async () => {
    await mount()
    const button = trigger()
    button.focus()
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    })
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
    expect(panel()!.contains(document.activeElement)).toBe(true)
  })

  it('bridges Tab from the trigger into the panel so the table is reachable', async () => {
    await mount()
    const button = trigger()
    button.focus()
    await act(async () => mouseClick(button))
    expect(document.activeElement).toBe(button)
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(panel()!.contains(document.activeElement)).toBe(true)
  })

  it('leaves the host markup unchanged apart from the trigger state', async () => {
    await mount()
    const strip = (): string => document.querySelector('#host')!.outerHTML
      .replace(/aria-expanded="(true|false)"/g, '')
      .replace(/ aria-controls="[^"]*"/g, '')
    const before = strip()
    await act(async () => mouseClick(trigger()))
    expect(strip()).toBe(before)
  })
})
