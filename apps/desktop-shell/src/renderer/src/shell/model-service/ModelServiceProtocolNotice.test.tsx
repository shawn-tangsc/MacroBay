// @vitest-environment happy-dom

import { createElement } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { ModelServiceProtocolNotice } from './ModelServiceProtocolNotice'

const labels = platformText['zh-CN'].models

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(onDismiss = (): void => undefined): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceProtocolNotice, {
      labels,
      providerName: '测试供应商',
      onDismiss
    }))
  })
  return container
}

describe('ModelServiceProtocolNotice', () => {
  it('explains the sync → detect → agent flow for providers without protocol info', async () => {
    const container = await mount()
    const notice = container.querySelector('[data-protocol-notice]')
    expect(notice).not.toBeNull()
    expect(notice?.textContent).toContain('测试供应商')
    expect(notice?.textContent).toContain('检测模型')
    expect(notice?.textContent).toContain('智能体')
  })

  it('dismisses through the close button', async () => {
    let dismissed = 0
    const container = await mount(() => { dismissed += 1 })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-protocol-notice-dismiss]')?.click()
    })
    expect(dismissed).toBe(1)
  })
})
