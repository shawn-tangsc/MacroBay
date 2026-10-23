// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { renderModelServiceSettings } from './modelServicePageHarness'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const labels = platformText['en-US'].models

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

async function openMenu(container: HTMLElement): Promise<void> {
  const row = container.querySelector<HTMLElement>('[data-provider-row]')
  await act(async () => {
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 120, clientY: 200 }))
    await Promise.resolve()
  })
}

describe('PLAT-62 provider row context menu', () => {
  it('opens menu, deletes custom providers after confirmation, and closes on Escape', async () => {
    const page = await renderModelServiceSettings({ provider: { id: 'custom', name: 'Custom', isSystem: false } })
    await openMenu(page.container)
    expect(document.querySelector('[data-provider-context-menu]')).not.toBeNull()
    expect(document.querySelector('[data-provider-context-open]')?.textContent).toContain(labels.providerContextOpen)
    const customDelete = document.querySelector<HTMLElement>('[data-provider-context-delete]')
    expect(customDelete?.textContent).toBe(labels.providerContextDelete)
    expect(document.querySelector('[data-provider-context-toggle]')?.textContent).toMatch(/Disable|Enable/)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.querySelector('[data-provider-context-menu]')).toBeNull()

    await openMenu(page.container)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-provider-context-delete]')?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(document.querySelector('[data-remove-provider-confirm]')).not.toBeNull())
    expect(document.querySelector('[data-remove-provider-confirm]')?.textContent).toContain('Custom')
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-remove-provider-cancel]')?.click()
    })
    expect(page.api.remove).not.toHaveBeenCalled()

    await openMenu(page.container)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-provider-context-delete]')?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(document.querySelector('[data-remove-provider-confirm-button]')).not.toBeNull())
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-remove-provider-confirm-button]')?.click()
      await Promise.resolve()
    })
    expect(page.api.remove).toHaveBeenCalledWith('custom')
    await vi.waitFor(() => expect(page.container.querySelectorAll('[data-provider-row]')).toHaveLength(0))
    await act(async () => page.root.unmount())
  })

  it('disables delete for system providers', async () => {
    const page = await renderModelServiceSettings()
    await openMenu(page.container)
    const deleteItem = document.querySelector<HTMLButtonElement>('[data-provider-context-delete]')
    expect(deleteItem?.disabled).toBe(true)
    expect(deleteItem?.textContent).toContain(labels.providerContextDelete)
    expect(deleteItem?.textContent).toContain(labels.systemProviderCannotDelete)
    expect(deleteItem?.style.display).toBe('flex')
    expect(deleteItem?.style.height).toBe('28px')
    expect(deleteItem?.style.whiteSpace).toBe('nowrap')
    expect(document.querySelector('[data-provider-context-menu]')?.getAttribute('style')).toContain('width: 260px')
    expect(document.querySelector('[data-provider-context-toggle]')?.textContent).toMatch(/Disable|Enable/)
    await act(async () => page.root.unmount())
  })
})
