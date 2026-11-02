// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderModelServiceSettings } from './modelServicePageHarness'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

const models = [
  { id: 'm-1', name: 'M 1', capabilities: { chat: true } },
  { id: 'm-2', name: 'M 2', capabilities: { chat: true } }
]

describe('PLAT-62 model removal', () => {
  it('removes a model and shows a notice', async () => {
    const page = await renderModelServiceSettings({ provider: { models } })
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-model-row="m-1"] [data-model-row-remove]')?.click()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(page.api.removeModel).toHaveBeenCalledWith('silicon', 'm-1')
    await expect.poll(() => page.container.querySelector('[data-models-notice]')?.textContent).toContain('Removed 1')
    await act(async () => page.root.unmount())
  })

  it('shows an inline error when removal fails', async () => {
    const page = await renderModelServiceSettings({
      provider: { models },
      removeModel: async () => {
        throw new Error('remove failed')
      }
    })
    await act(async () => {
      page.container.querySelector<HTMLButtonElement>('[data-model-row="m-1"] [data-model-row-remove]')?.click()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await expect.poll(() => page.container.querySelector('[data-models-error]')).not.toBeNull()
    await act(async () => page.root.unmount())
  })
})
