// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { ModelServiceAddProviderDialog } from './ModelServiceAddProviderDialog'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const labels = platformText['en-US'].models
let root: Root | undefined

function setValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function mount(onAdd = vi.fn(async () => undefined), providers = [{ id: 'openai', name: 'OpenAI', capabilities: { chat: true } }]): Promise<{ container: HTMLElement; onAdd: typeof onAdd; onCancel: ReturnType<typeof vi.fn> }> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const onCancel = vi.fn()
  await act(async () => {
    root?.render(createElement(ModelServiceAddProviderDialog, {
      open: true,
      labels,
      // 只为重名校验提供名称。
      providers: providers as never,
      onCancel,
      onAdd
    }))
  })
  return { container, onAdd, onCancel }
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('PLAT-62 add provider dialog', () => {
  it('renders all fields and never creates provider by opening', async () => {
    const { container, onAdd } = await mount()
    expect(document.querySelector('[data-add-provider-dialog]')).not.toBeNull()
    for (const attr of ['name', 'key', 'base', 'anthropic', 'preset']) {
      expect(document.querySelector(`[data-add-provider-${attr}]`), attr).not.toBeNull()
    }
    expect(onAdd).not.toHaveBeenCalled()
    // 未填写时提交按钮禁用。
    expect(document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')?.disabled).toBe(true)
    expect(container).not.toBeNull()
  })

  it('cancels without creating anything', async () => {
    const { onAdd, onCancel } = await mount()
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn')?.click()
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('blocks duplicate and invalid input, then submits valid fields', async () => {
    const onAdd = vi.fn(async () => undefined)
    await mount(onAdd)

    const name = document.querySelector<HTMLInputElement>('[data-add-provider-name]')!
    const base = document.querySelector<HTMLInputElement>('[data-add-provider-base]')!
    const submit = document.querySelector<HTMLButtonElement>('.ant-modal-footer .ant-btn-primary')!

    await act(async () => setValue(name, 'OpenAI'))
    expect(document.querySelector('[data-add-provider-error]')?.textContent).toContain('already exists')
    expect(submit.disabled).toBe(true)

    await act(async () => setValue(name, 'My Provider'))
    await act(async () => setValue(base, 'not-a-url'))
    expect(submit.disabled).toBe(true)

    await act(async () => setValue(base, 'https://example.com/'))
    expect(document.querySelector('[data-add-provider-url-preview]')?.textContent).toContain('https://example.com/v1/chat/completions')
    expect(submit.disabled).toBe(false)

    await act(async () => submit.click())
    expect(onAdd).toHaveBeenCalledWith({
      name: 'My Provider',
      endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://example.com/' }]
    })
  })
})
