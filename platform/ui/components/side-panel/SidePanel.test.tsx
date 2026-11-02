// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SidePanel, SIDE_PANEL_SIZES } from './SidePanel'
import { PANEL_COLLAPSE_KEY, resolvePanelText } from './panelText'

const css = readFileSync(join(__dirname, 'sidePanel.css'), 'utf8')
const key = (value: string): string => value

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(overrides: Partial<Parameters<typeof SidePanel>[0]> = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <SidePanel
        onClose={() => undefined}
        open
        resolveText={key}
        size="rail"
        titleKey="ui.test.panelTitle"
        {...overrides}>
        <button type="button" data-inner>
          inner
        </button>
      </SidePanel>
    )
  })
  return host
}

describe('SidePanel', () => {
  it('offers exactly two sizes and takes no pixel width', async () => {
    expect(SIDE_PANEL_SIZES).toEqual(['rail', 'flex'])

    const host = await mount({ size: 'rail' })
    const panel = host.querySelector<HTMLElement>('.side-panel')!
    expect(panel.style.getPropertyValue('--side-panel-width')).toBe('282px')
    expect(css).not.toMatch(/\.side-panel[^{]*\{[^}]*\bwidth:\s*\d+px/)
  })

  it('keeps the ratio cap inside the component for the flex size', async () => {
    const host = await mount({ size: 'flex' })
    const panel = host.querySelector<HTMLElement>('.side-panel')!
    expect(panel.style.getPropertyValue('--side-panel-width')).toBe('min(480px, 46vw)')
  })

  it('has no mask and does not lock focus', async () => {
    const host = await mount()
    expect(host.querySelector('.side-panel')).not.toBeNull()
    // 没有遮罩元素；也没有 role="dialog"——它不是模态。
    expect(document.querySelector('[class*="mask"]')).toBeNull()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(css).not.toContain('overscroll')
  })

  it('moves focus into the panel when it opens, and does not trap it', async () => {
    await mount()
    expect(document.activeElement?.hasAttribute('data-inner')).toBe(true)
    expect(css).not.toContain('focus-trap')
  })

  it('renders no footer row when the caller passes none', async () => {
    const host = await mount()
    expect(host.querySelector('.side-panel__footer')).toBeNull()
  })

  it('renders the footer it is given, word for word', async () => {
    const host = await mount({ footer: <button type="button">save</button> })
    expect(host.querySelector('.side-panel__footer')?.textContent).toBe('save')
  })

  it('names the collapse control from its own copy table, never an empty string', async () => {
    const host = await mount()
    const collapse = host.querySelector<HTMLButtonElement>('.side-panel__header button')!
    expect(collapse.getAttribute('aria-label')).toBe(resolvePanelText('zh-CN', PANEL_COLLAPSE_KEY))
    expect(collapse.getAttribute('aria-label')).toBe('收起面板')
  })

  it('fades in over 120ms and stops when the system asks for reduced motion', () => {
    expect(css).toContain('animation: side-panel-fade 120ms')
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*?animation: none/)
    // 宽度不参与过渡：那会连续重排主内容。
    expect(css).not.toMatch(/transition:[^;]*width/)
  })

  it('renders nothing at all while closed, leaving no empty shell', async () => {
    const host = await mount({ open: false })
    expect(host.querySelector('.side-panel')).toBeNull()
  })
})
