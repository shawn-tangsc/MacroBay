// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openProviderMoreMenu, renderModelServiceSettings } from './modelServicePageHarness'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function setValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function click(element: Element | null | undefined): Promise<void> {
  await act(async () => {
    ;(element as HTMLElement | null)?.click()
    await Promise.resolve()
  })
}

describe('PLAT-62 add provider flow', () => {
  it('only opens a dialog and does not create a provider on add/cancel', async () => {
    const page = await renderModelServiceSettings()
    const before = page.container.querySelectorAll('[data-provider-row]').length

    await click(page.container.querySelector('[data-provider-add]'))
    expect(document.querySelector('[data-add-provider-dialog]')).not.toBeNull()
    expect(page.api.upsert).not.toHaveBeenCalled()
    expect(page.container.querySelectorAll('[data-provider-row]')).toHaveLength(before)

    await click(document.querySelector<HTMLButtonElement>('[data-add-provider-cancel]'))
    expect(page.api.upsert).not.toHaveBeenCalled()

    await act(async () => page.root.unmount())
  })

  it('creates one provider with the entered name/base and blocks duplicates', async () => {
    const page = await renderModelServiceSettings()
    await click(page.container.querySelector('[data-provider-add]'))

    const name = document.querySelector<HTMLInputElement>('[data-add-provider-name]')!
    const base = document.querySelector<HTMLInputElement>('[data-add-provider-base]')!
    const submit = document.querySelector<HTMLButtonElement>('[data-add-provider-submit]')!

    await act(async () => setValue(name, 'Silicon'))
    expect(document.querySelector('[data-add-provider-error]')?.textContent).toContain('already exists')
    expect(submit.disabled).toBe(true)

    await act(async () => setValue(name, 'My Gateway'))
    await act(async () => setValue(base, 'https://gateway.example.com'))
    expect(submit.disabled).toBe(false)
    await click(submit)

    expect(page.api.upsert).toHaveBeenCalledTimes(1)
    expect(page.api.upsert.mock.calls[0]?.[0]).toMatchObject({
      name: 'My Gateway',
      // 自建供应商的端点清单：Chat 在前 = 默认端点。
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://gateway.example.com' }],
      models: []
    })
    await act(async () => page.root.unmount())
  })

  it('confirms deletion for custom providers and disables it for system providers', async () => {
    const custom = await renderModelServiceSettings({
      provider: { id: 'custom', name: 'Custom', isSystem: false }
    })
    expect(custom.container.querySelector('[data-provider-delete]')).toBeNull()
    await openProviderMoreMenu(custom.container)
    const remove = custom.container.querySelector<HTMLButtonElement>('[data-remove-provider]')
    expect(remove?.disabled).toBe(false)
    await click(remove)
    await vi.waitFor(() => expect(document.querySelector('[data-remove-provider-confirm]')).not.toBeNull())
    expect(document.querySelector('[data-remove-provider-confirm]')?.textContent).toContain('Custom')
    const confirm = document.querySelector<HTMLButtonElement>('[data-remove-provider-confirm-button]')
    await click(confirm)
    expect(custom.api.remove).toHaveBeenCalledWith('custom')
    await vi.waitFor(() => expect(custom.container.querySelectorAll('[data-provider-row]')).toHaveLength(0))
    await act(async () => custom.root.unmount())
    document.body.replaceChildren()

    const system = await renderModelServiceSettings()
    expect(system.container.querySelector('[data-provider-delete]')).toBeNull()
    await openProviderMoreMenu(system.container)
    expect(system.container.querySelector<HTMLButtonElement>('[data-remove-provider]')?.disabled).toBe(true)
    expect(system.container.textContent).toContain('System providers cannot be deleted')
    await act(async () => system.root.unmount())
  })
  it('cancels deletion and surfaces removal failures', async () => {
    const cancelled = await renderModelServiceSettings({ provider: { id: 'custom', name: 'Custom', isSystem: false } })
    await openProviderMoreMenu(cancelled.container)
    await click(cancelled.container.querySelector('[data-remove-provider]'))
    await vi.waitFor(() => expect(document.querySelector('[data-remove-provider-cancel]')).not.toBeNull())
    await click(document.querySelector('[data-remove-provider-cancel]'))
    expect(cancelled.api.remove).not.toHaveBeenCalled()
    await act(async () => cancelled.root.unmount())
    document.body.replaceChildren()

    const failing = await renderModelServiceSettings({
      provider: { id: 'custom', name: 'Custom', isSystem: false },
      remove: async () => { throw new Error('remove-failed') }
    })
    await openProviderMoreMenu(failing.container)
    await click(failing.container.querySelector('[data-remove-provider]'))
    await vi.waitFor(() => expect(document.querySelector('[data-remove-provider-confirm-button]')).not.toBeNull())
    await click(document.querySelector('[data-remove-provider-confirm-button]'))
    await vi.waitFor(() => expect(failing.container.querySelector('[data-provider-delete-error]')).not.toBeNull())
    await act(async () => failing.root.unmount())
  })

})
