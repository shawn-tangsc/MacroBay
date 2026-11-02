// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { renderModelServiceSettings } from './modelServicePageHarness'

/**
 * PLAT-63 C：`presetStale` 模型「排除显示但保留数据」。
 * - 模型计数不含它、列表不渲染它（探测候选因此也不含它）；
 * - 模型计数旁给一行 11px muted 提示，告诉用户可在「获取模型列表」里清理。
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const labels = platformText['en-US'].models

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

const models = [
  { id: 'live-model', name: 'Live Model', capabilities: { chat: true } },
  { id: 'stale-preset', name: 'Stale Preset', presetModel: true, presetStale: true, capabilities: { chat: true } }
]

describe('PLAT-63 C stale preset hint', () => {
  it('excludes stale models from the count and list but keeps a visible cleanup hint', async () => {
    const page = await renderModelServiceSettings({ provider: { models } })

    expect(page.container.querySelector('[data-models-count]')?.textContent).toBe('1')
    expect(page.container.querySelector('[data-model-row="live-model"]')).not.toBeNull()
    expect(page.container.querySelector('[data-model-row="stale-preset"]')).toBeNull()

    const hint = page.container.querySelector('[data-models-stale-hint]')
    expect(hint?.textContent).toBe(labels.modelSyncStaleHint(1))
    expect(hint?.textContent).toContain('1')

    await act(async () => page.root.unmount())
  })

  it('renders no hint when every model still belongs to the current preset', async () => {
    const page = await renderModelServiceSettings({ provider: { models: [models[0]] } })

    expect(page.container.querySelector('[data-models-stale-hint]')).toBeNull()
    expect(page.container.querySelector('[data-models-count]')?.textContent).toBe('1')

    await act(async () => page.root.unmount())
  })
})
