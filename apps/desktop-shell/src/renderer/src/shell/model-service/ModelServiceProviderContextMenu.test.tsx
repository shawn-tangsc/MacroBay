// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { renderModelServiceSettings } from './modelServicePageHarness'

const confirmSpy = vi.hoisted(() => vi.fn())
vi.mock('@platform/ui/components/confirm', () => ({
  // 页面用 `useConfirm()` 取宿主；这组用例只验「菜单把哪些参数交给了确认框」，所以直接给一个 spy。
  useConfirm: () => confirmSpy,
  ConfirmProvider: ({ children }: { children: unknown }) => children
}))

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
  it('opens menu, asks the platform confirm before deleting, and closes on Escape', async () => {
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

    // 二次确认改由平台 `confirm` 承担。这里断言的是「菜单把正确的参数交给了它」：
    // 标题/正文带着供应商名、危险档、按钮文案。对话框本身的真渲染由清空模型那组用例覆盖，
    // 两边各守一段，不重复也不留空档。
    confirmSpy.mockClear()
    await openMenu(page.container)
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-provider-context-delete]')?.click()
      await Promise.resolve()
    })

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    const props = confirmSpy.mock.calls[0]?.[0] as {
      title: string
      description: string
      confirmLabel: string
      tone: string
      onConfirm: () => Promise<void>
    }
    expect(props.title).toBe(labels.removeProvider)
    expect(props.description).toContain('Custom')
    expect(props.tone).toBe('danger')
    expect(props.confirmLabel).toBe(labels.removeProvider)
    // 没有确认就绝不删除。
    expect(page.api.remove).not.toHaveBeenCalled()

    await act(async () => {
      await props.onConfirm()
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
