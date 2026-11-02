// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { CredentialsSection, resolveCredentialActionLabel } from './CredentialsSection'

let root: Root | null = null
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('CredentialsSection', () => {
  it.each([
    ['zh-CN', '保存 API Key', '保存并验证连接'],
    ['en-US', 'Save API Key', 'Save And Verify Connection']
  ] as const)('uses accurate 0xRouter save copy in %s while retaining generic provider verification copy', (locale, saveCopy, verifyCopy) => {
    const labels = productText[locale].settings.intelligenceSources.credentials

    expect(resolveCredentialActionLabel('0xrouter-aggregate-provider', labels)).toBe(saveCopy)
    expect(resolveCredentialActionLabel('fred', labels)).toBe(verifyCopy)
  })

  it('retains the draft after an unverified save failure and clears it only after a successful save', async () => {
    const onTest = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const labels = productText['en-US'].settings.intelligenceSources.credentials
    await render({ sourceId: '0xrouter-aggregate-provider', labels: { ...labels, testCredentials: resolveCredentialActionLabel('0xrouter-aggregate-provider', labels) }, onTest })
    const input = document.body.querySelector<HTMLInputElement>('input')!
    const button = document.body.querySelector<HTMLButtonElement>('button')!

    await setInputValue(input, 'router-draft')
    await act(async () => button.click())
    await flush()
    expect(input.value).toBe('router-draft')

    await act(async () => button.click())
    await flush()
    expect(input.value).toBe('')
    expect(button.textContent).toBe('Save API Key')
    expect(document.body.textContent).not.toContain('Verify')
  })

  it.each([
    ['zh-CN', '请求额度：10 次 / 60 秒'],
    ['en-US', 'Request budget: 10 requests / 60 seconds']
  ] as const)('renders the localized %s read-only request budget without queue details or controls', async (locale, expected) => {
    const labels = productText[locale].settings.intelligenceSources.credentials
    await render({
      sourceId: '0xrouter-aggregate-provider', labels,
      requestBudget: { maxRequests: 10, windowSeconds: 60 }, onTest: vi.fn(async () => false)
    })

    expect(document.body.textContent).toContain(expected)
    expect(document.body.textContent).not.toMatch(/scope|queue|remaining|digest/i)
  })
})

async function render(props: Parameters<typeof CredentialsSection>[0]): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<CredentialsSection visible maskedPreview="ro****et" testing={false} {...props} />))
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
  })
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
