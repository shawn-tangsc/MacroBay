// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'
import type { ModelSyncPreview } from '@platform/ai/providers/providerModelSync'

import { platformText } from '../i18n/platformText'
import { ProviderModelSyncDrawer, type ProviderModelSyncSelection } from './ProviderModelSyncDrawer'

/**
 * PLAT-63 C：同步预览的第三组「本地多余（预设已变更）」。
 * 默认勾选（应用即清理）、用户可取消、组内全选/全不选都可用。
 */
const models = platformText['en-US'].models
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined

const labels = {
  title: models.modelSyncTitle,
  added: models.modelSyncAdded,
  missing: models.modelSyncMissing,
  localSurplus: models.modelSyncLocalSurplus,
  localSurplusHint: models.modelSyncLocalSurplusHint,
  upToDate: models.modelSyncUpToDate,
  upToDateHint: models.modelSyncUpToDateHint,
  removedHint: models.modelSyncRemovedHint,
  selectAll: models.selectAll,
  deselectAll: models.deselectAll,
  cancel: models.cancel,
  apply: models.modelSyncApply,
  addSummary: (selected: number, total: number) => `${selected}/${total}`,
  removeSummary: (selected: number, total: number) => `${selected}/${total}`
}

function model(id: string): ModelDefinition {
  return { id, name: id, capabilities: { chat: true } }
}

const preview: ModelSyncPreview = {
  added: [model('remote-new')],
  updated: [],
  missing: [],
  stale: [model('stale-preset'), model('stale-preset-2')]
}

function selection(overrides: Partial<ProviderModelSyncSelection> = {}): ProviderModelSyncSelection {
  return {
    addedIds: new Set(['remote-new']),
    missingIds: new Set(),
    staleIds: new Set(['stale-preset', 'stale-preset-2']),
    ...overrides
  }
}

type Handlers = {
  onToggleStale?: (modelId: string) => void
  onToggleAllStale?: () => void
}

async function mount(next: ProviderModelSyncSelection = selection(), handlers: Handlers = {}): Promise<void> {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ProviderModelSyncDrawer, {
      open: true,
      preview,
      selection: next,
      isApplying: false,
      labels,
      onClose: () => undefined,
      onApply: () => undefined,
      onToggleAdded: () => undefined,
      onToggleMissing: () => undefined,
      onToggleAllAdded: () => undefined,
      onToggleAllMissing: () => undefined,
      onToggleStale: handlers.onToggleStale ?? (() => undefined),
      onToggleAllStale: handlers.onToggleAllStale ?? (() => undefined)
    }))
  })
}

// antd Drawer 渲染在 portal 里：统一从 document 查询。
function staleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-model-sync-type="stale"]')]
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('ProviderModelSyncDrawer local surplus group', () => {
  it('renders the third group with a count and every stale model checked by default', async () => {
    await mount()

    const header = document.querySelector('[data-model-sync-group="stale"]')
    expect(header?.textContent).toContain(labels.localSurplus)
    expect(header?.textContent).toContain('(2)')
    expect(header?.textContent).toContain(labels.deselectAll)
    expect(staleRows().map((row) => row.getAttribute('data-model-sync-row')))
      .toEqual(['stale-preset', 'stale-preset-2'])
    for (const row of staleRows()) {
      expect(row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)
    }
    expect(document.body.textContent).toContain(labels.localSurplusHint)
  })

  it('reports a per-row toggle and the group toggle to the parent', async () => {
    const onToggleStale = vi.fn()
    const onToggleAllStale = vi.fn()
    await mount(selection(), { onToggleStale, onToggleAllStale })

    await act(async () => {
      staleRows()[1]?.click()
    })
    expect(onToggleStale).toHaveBeenCalledWith('stale-preset-2')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-model-sync-group="stale"] button')?.click()
    })
    expect(onToggleAllStale).toHaveBeenCalledTimes(1)
  })

  it('shows an unchecked stale row after the user unchecks it and re-enables apply when only that group is left', async () => {
    await mount(selection({ addedIds: new Set(), staleIds: new Set(['stale-preset']) }))

    const rows = staleRows()
    expect(rows[0]?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)
    expect(rows[1]?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    // 仍有一条勾选 ⇒ 应用按钮可用。
    expect(document.querySelector<HTMLButtonElement>('.ant-primary-button')?.disabled).toBe(false)
  })

  it('keeps the apply action disabled when nothing is selected at all', async () => {
    await mount(selection({ addedIds: new Set(), staleIds: new Set() }))

    expect(document.querySelector<HTMLButtonElement>('.ant-primary-button')?.disabled).toBe(true)
  })

  it('shows the up-to-date state when there is no diff at all', async () => {
    document.body.replaceChildren()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderModelSyncDrawer, {
        open: true,
        preview: { added: [], updated: [], missing: [], stale: [] },
        selection: selection({ addedIds: new Set(), staleIds: new Set() }),
        isApplying: false,
        labels,
        onClose: () => undefined,
        onApply: () => undefined,
        onToggleAdded: () => undefined,
        onToggleMissing: () => undefined,
        onToggleAllAdded: () => undefined,
        onToggleAllMissing: () => undefined,
        onToggleStale: () => undefined,
        onToggleAllStale: () => undefined
      }))
    })

    expect(document.body.textContent).toContain(labels.upToDate)
    expect(document.querySelector('[data-model-sync-group="stale"]')).toBeNull()
  })
})
