// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveStateViewText, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'

import { platformText } from '../../../i18n/platformText'

vi.mock('./AssistantTemplateCard', () => ({
  AssistantTemplateCard: ({ item }: { item: { templateId: string } }) =>
    createElement('div', { 'data-template': item.templateId })
}))

import { AssistantTemplateGrid } from './AssistantTemplateGrid'

const labels = platformText['en-US'].assistants.library

function renderGrid(overrides: Partial<Parameters<typeof AssistantTemplateGrid>[0]> = {}): {
  container: HTMLElement
  root: ReturnType<typeof createRoot>
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(AssistantTemplateGrid, {
        labels,
        items: [],
        loading: false,
        loadingLabel: platformText['en-US'].status.loading,
        onInstall: vi.fn(),
        onOpen: vi.fn(),
        onClearFilters: vi.fn(),
        loadFailed: false,
        onRetry: vi.fn(),
        ...overrides
      })
    )
  })
  return { container, root }
}

describe('AssistantTemplateGrid first paint', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('shows the loading surface, never the empty state, before the catalog arrives', () => {
    // 初值那一帧：还没读到，就不能说「被筛选挡住了」——那句话把没读到说成筛选的错。
    const { container, root } = renderGrid({ loading: true })
    expect(container.querySelector('.loading-state')).not.toBeNull()
    expect(container.querySelector('[data-state="empty"]')).toBeNull()
    act(() => root.unmount())
  })

  it('shows the shared error view with a retry when the read failed and nothing is in hand', () => {
    const onRetry = vi.fn()
    const { container, root } = renderGrid({ loadFailed: true, onRetry })

    expect(container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(container.querySelector('[data-state="empty"]')).toBeNull()

    const retryLabel = resolveStateViewText('zh-CN', STATE_VIEW_ACTION_KEYS.retry)
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === retryLabel)
    expect(retry).toBeTruthy()
    act(() => {
      retry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onRetry).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })

  it('keeps the rows on screen when a refresh fails after data arrived', () => {
    const { container, root } = renderGrid({
      loadFailed: true,
      items: [{ templateId: 'tpl-1' } as Parameters<typeof AssistantTemplateGrid>[0]['items'][number]]
    })
    expect(container.querySelector('[data-state="error"]')).toBeNull()
    expect(container.querySelector('[data-template="tpl-1"]')).not.toBeNull()
    act(() => root.unmount())
  })
})

export type { ReactNode }
