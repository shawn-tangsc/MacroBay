// @vitest-environment happy-dom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelCapabilities } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'
import type { ModelDraft } from '../modelDrafts'
import { ModelServiceModelDrawer } from './ModelServiceModelDrawer'

const labels = platformText['en-US'].models

const draft: ModelDraft = {
  id: 'vendor/model-1',
  name: 'Model 1',
  capabilities: { chat: true }
}

let root: Root | undefined
let copyText = vi.fn(async () => undefined)

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: copyText }
})

beforeEach(() => {
  copyText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: copyText }
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function Harness({
  initial = draft,
  isEditing = true,
  onSave = vi.fn()
}: {
  initial?: ModelDraft
  isEditing?: boolean
  onSave?: () => void
}): React.ReactElement {
  const [value, setValue] = useState(initial)
  const [pinned, setPinned] = useState(true)
  return createElement(ModelServiceModelDrawer, {
    open: true,
    labels,
    draft: value,
    isEditing,
    isSaving: false,
    pinned,
    onChange: setValue,
    onTogglePin: () => setPinned((current) => !current),
    onSave,
    onClose: () => undefined
  })
}

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(element)
    await Promise.resolve()
  })
  return document.body
}

describe('PLAT-62 模型编辑抽屉', () => {
  it('renders a 480px drawer with the 88/1fr grid, readonly id and ten chips', async () => {
    const container = await mount(createElement(Harness))

    expect(container.querySelector<HTMLElement>('.ant-drawer-content-wrapper')?.style.width).toBe('480px')
    expect(container.querySelector('.model-drawer-grid')).not.toBeNull()
    const idInput = container.querySelector<HTMLInputElement>('[data-model-id]')
    expect(idInput?.readOnly).toBe(true)
    expect(idInput?.value).toBe('vendor/model-1')
    expect(container.querySelector('[data-model-copy]')).not.toBeNull()

    const chips = [...container.querySelectorAll<HTMLElement>('[data-model-capability]')]
    expect(chips).toHaveLength(10)
    expect(chips.every((chip) => chip.querySelector('svg') !== null)).toBe(true)
    expect(container.querySelector('[data-model-capability="chat"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-model-capability="tools"]')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('copies the model id and shows 已复制 for 1.5s', async () => {
    const container = await mount(createElement(Harness))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-model-copy]')?.click()
      await Promise.resolve()
    })
    expect(copyText).toHaveBeenCalledWith('vendor/model-1')
    expect(container.querySelector('[data-model-copied]')?.textContent).toBe(labels.copied)
  })

  it('toggles capability chips as multi-select and shows the non-chat hint', async () => {
    const container = await mount(createElement(Harness))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-model-capability="tools"]')?.click()
      await Promise.resolve()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-model-capability="chat"]')?.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-model-capability="tools"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-model-capability="chat"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-non-chat-hint]')?.textContent).toBe(labels.nonChatModelHint)
  })

  it('uses a standard role=switch control for pinning', async () => {
    const container = await mount(createElement(Harness))
    const pin = container.querySelector<HTMLButtonElement>('[data-model-pin]')
    expect(pin?.getAttribute('role')).toBe('switch')
    expect(pin?.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      pin?.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-model-pin]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('hides the pin row for a new model and saves once', async () => {
    const onSave = vi.fn()
    const container = await mount(createElement(Harness, { isEditing: false, onSave }))
    expect(container.querySelector('[data-model-pin]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.model-drawer-save')?.click()
      await Promise.resolve()
    })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('marks the model free from the drawer', async () => {
    const container = await mount(createElement(Harness))
    const free = container.querySelector<HTMLButtonElement>('[data-model-free]')
    expect(free?.getAttribute('role')).toBe('switch')
    expect(free?.getAttribute('aria-checked')).toBe('false')
    expect(free?.disabled).toBe(false)

    await act(async () => {
      free?.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-model-free]')?.getAttribute('aria-checked')).toBe('true')
    expect(container.querySelector('[data-model-free-hint]')?.textContent).toBe(labels.freeModelHint)
  })

  it('hides the free switch when adding a new model', async () => {
    const container = await mount(createElement(Harness, { isEditing: false }))
    expect(container.querySelector('[data-model-free]')).toBeNull()
  })

  it('locks the free switch when the model price is already zero', async () => {
    const container = await mount(createElement(Harness, {
      initial: {
        ...draft,
        pricing: { currency: 'USD', promptPerMillion: 0, completionPerMillion: 0 }
      }
    }))
    const free = container.querySelector<HTMLButtonElement>('[data-model-free]')
    expect(free?.getAttribute('aria-checked')).toBe('true')
    expect(free?.disabled).toBe(true)
    expect(container.querySelector('[data-model-free-hint]')?.textContent).toBe(labels.freeModelAutoHint)
  })

  it('does not render the Agent protocol row (data stays on the model)', async () => {
    const withRuntimes: ModelDraft = {
      ...draft,
      capabilities: { chat: true, agentRuntimes: { claudeCode: true } }
    }
    const container = await mount(createElement(Harness, { initial: withRuntimes }))
    expect(container.querySelectorAll('[data-model-agent-runtime]')).toHaveLength(0)
    expect(container.textContent).not.toContain(labels.agentProtocolSupport)
  })
})
