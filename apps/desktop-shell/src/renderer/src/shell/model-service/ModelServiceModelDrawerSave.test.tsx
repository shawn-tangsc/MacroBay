// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { renderModelServiceSettings } from './modelServicePageHarness'

/**
 * PLAT-62：编辑模型抽屉保存走既有 addOrUpdateModel，载荷包含所选能力。
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

describe('PLAT-62 模型编辑抽屉保存', () => {
  it('saves the edited capabilities through addOrUpdateModel once', async () => {
    const page = await renderModelServiceSettings()
    const row = page.container.querySelector<HTMLElement>('[data-model-row]')
    const modelId = row?.getAttribute('data-model-row') ?? ''
    expect(modelId).not.toBe('')

    await act(async () => {
      row?.querySelector<HTMLButtonElement>('[data-model-row-settings]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-model-capability="tools"]')?.click()
      await Promise.resolve()
    })

    expect(document.querySelector<HTMLInputElement>('[data-model-id]')?.readOnly).toBe(true)
    expect(document.querySelector('[data-model-pin]')?.getAttribute('role')).toBe('switch')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.model-drawer-save')?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(page.api.addOrUpdateModel).toHaveBeenCalledTimes(1))
    const [providerId, model] = page.api.addOrUpdateModel.mock.calls[0] as [string, ModelDefinition]
    expect(providerId).toBe('silicon')
    expect(model.id).toBe(modelId)
    // 能力目录默认已把 tools 标为 true，点一下是「关掉」；断言切换确实生效。
    expect(model.capabilities).toMatchObject({ chat: true })
    expect(model.capabilities.tools).not.toBe(true)
    await act(async () => page.root.unmount())
  })
  it('preserves agentRuntimes even though the drawer no longer edits them', async () => {
    const models = [{
      id: 'agent-model',
      name: 'Agent Model',
      capabilities: {
        chat: true,
        agentRuntimes: { claudeCode: true, openaiAgents: true }
      }
    }]
    const page = await renderModelServiceSettings({ provider: { models } })
    const row = page.container.querySelector<HTMLElement>('[data-model-row="agent-model"]')
    await act(async () => {
      row?.querySelector<HTMLButtonElement>('[data-model-row-settings]')?.click()
      await Promise.resolve()
    })
    expect(document.querySelectorAll('[data-model-agent-runtime]')).toHaveLength(0)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.model-drawer-save')?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(page.api.addOrUpdateModel).toHaveBeenCalledTimes(1))
    const [, model] = page.api.addOrUpdateModel.mock.calls[0] as [string, ModelDefinition]
    expect(model.capabilities.agentRuntimes).toEqual({ claudeCode: true, openaiAgents: true })
    await act(async () => page.root.unmount())
  })

})
