// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ModelCapabilities } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'
import type { ModelDraft } from '../modelDrafts'
import { ModelServiceModelDrawer } from './ModelServiceModelDrawer'

const labels = platformText['en-US'].models

/** 能力胶囊按可访问名（文字）定位：`FilterChip` 不给逐枚 data 钩子。 */
function capabilityChip(container: HTMLElement, label: string): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>('.filter-chip')]
    .find((chip) => (chip.textContent ?? '') === label) ?? null
}

const draft: ModelDraft = {
  id: 'vendor/model-1',
  name: 'Model 1',
  capabilities: { chat: true }
}

let root: Root | undefined
let copyText = vi.fn(async () => undefined)

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

const drawerSource = readFileSync(resolve(__dirname, './ModelServiceModelDrawer.tsx'), 'utf8')

describe('PLAT-62 模型编辑抽屉', () => {
  it('renders on the narrow drawer tier with the 88/1fr grid, readonly id and ten chips', async () => {
    const container = await mount(createElement(Harness))

    // 平台抽屉只有 420 / 640 / 860 / 1040 四档：原来的 480 落到最近的 narrow（420），
    // 宽度写成 `min(档位, 92vw)`，所以断言的是档位而不是旧的字面值。
    // 宽度归平台抽屉的档位表（420/640/860/1040），这里不再钉 antd 的 style；
    // 能钉的是「它确实换成了平台抽屉、并且是 narrow 档」，以及不再自己写宽度。
    expect(drawerSource).toContain('size="narrow"')
    expect(drawerSource).not.toMatch(/\bwidth=\{/)
    expect(container.querySelector('.model-drawer-grid')).not.toBeNull()
    const idInput = container.querySelector<HTMLInputElement>('[data-model-id]')
    expect(idInput?.readOnly).toBe(true)
    expect(idInput?.value).toBe('vendor/model-1')
    expect(container.querySelector('[data-model-copy]')).not.toBeNull()

    const chips = [...container.querySelectorAll<HTMLElement>('.filter-chip')]
    expect(chips).toHaveLength(10)
    // 图标已按界面设计 2026-11-02 去掉：能力名文字已经写清，图标是第二套语言。
    expect(chips.every((chip) => chip.querySelector('svg') === null)).toBe(true)
    expect(capabilityChip(container, labels.chat)?.getAttribute('aria-pressed')).toBe('true')
    expect(capabilityChip(container, labels.tools)?.getAttribute('aria-pressed')).toBe('false')
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
      capabilityChip(container, labels.tools)?.click()
      await Promise.resolve()
    })
    await act(async () => {
      capabilityChip(container, labels.chat)?.click()
      await Promise.resolve()
    })
    expect(capabilityChip(container, labels.tools)?.getAttribute('aria-pressed')).toBe('true')
    expect(capabilityChip(container, labels.chat)?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-non-chat-hint]')?.textContent).toBe(labels.nonChatModelHint)
  })

  it('uses a standard role=switch control for pinning', async () => {
    const container = await mount(createElement(Harness))
    const pin = container.querySelector<HTMLButtonElement>('[data-model-pin] button[role="switch"]')
    expect(pin?.getAttribute('role')).toBe('switch')
    expect(pin?.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      pin?.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-model-pin] button[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the switch accessible and keyboard-operable, with the row geometry untouched', async () => {
    const container = await mount(createElement(Harness))
    const free = container.querySelector<HTMLButtonElement>('[data-model-free] button[role="switch"]')

    // 可访问名来自 labels（不是空串、也不是键名）。
    expect(free?.getAttribute('aria-label')).toBe(labels.freeModel)

    // 键盘可操作：它是**原生 `<button type="button">`**，Space/Enter 由浏览器原生激活；
    // 方向键归组件（`rc-switch`）。这里钉「可聚焦的真按钮」，不模拟浏览器原生激活——
    // 那验的是 happy-dom，不是我们的代码。
    expect(free?.tagName).toBe('BUTTON')
    expect(free?.getAttribute('type')).toBe('button')
    expect(free?.disabled).toBe(false)
    expect(free?.hasAttribute('tabindex') ? free.getAttribute('tabindex') : '0').not.toBe('-1')

    // 行几何没被动过：开关仍直接挂在同一个行容器里，没有被新增 wrapper 或内联高度包一层。
    const row = container.querySelector('[data-model-free]')?.closest('.model-drawer-switch-row')
    expect(row?.className).toBe('model-drawer-switch-row')
    expect(row?.getAttribute('style')).toBeNull()
    expect(container.querySelector('[data-model-free]')?.getAttribute('style')).toBeNull()
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
    const free = container.querySelector<HTMLButtonElement>('[data-model-free] button[role="switch"]')
    expect(free?.getAttribute('role')).toBe('switch')
    expect(free?.getAttribute('aria-checked')).toBe('false')
    expect(free?.disabled).toBe(false)

    await act(async () => {
      free?.click()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-model-free] button[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
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
    const free = container.querySelector<HTMLButtonElement>('[data-model-free] button[role="switch"]')
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
