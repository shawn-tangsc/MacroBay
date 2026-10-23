// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { CollectionPolicySection } from './CollectionPolicySection'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const labels = {
  title: 'Collection policy',
  enabled: 'Enable',
  collectionPreset: 'Collection preset',
  manualPresetNote: 'Manual mode does not collect automatically.',
  includeInSentiment: 'Include in sentiment',
  scopePolicy: 'Scope policy',
  plannedNotConfigurable: 'This source is not implemented yet and cannot be enabled or configured.',
  productOwnedNote: 'A product-owned job collects this source; the enable switch below controls it.',
  presets: { manual: 'Manual', balanced: 'Balanced', frequent: 'Frequent' },
  scopePolicies: { all: 'All', 'watchlist-priority': 'Watchlist' }
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('CollectionPolicySection', () => {
  it('fails closed for a planned source that no product job collects', async () => {
    const container = await render({ configurable: false, enabledConfigurable: false })

    expect(switchControl(container).disabled).toBe(true)
    expect(container.textContent).toContain(labels.plannedNotConfigurable)
    expect(container.textContent).not.toContain(labels.productOwnedNote)
  })

  it('lets a product-owned source store its enable preference while the preset stays advisory', async () => {
    const container = await render({ configurable: false, enabledConfigurable: true })

    expect(switchControl(container).disabled).toBe(false)
    expect(container.textContent).toContain(labels.productOwnedNote)
    expect(container.textContent).not.toContain(labels.plannedNotConfigurable)
  })

  it('keeps the whole collection policy configurable for a live source', async () => {
    const container = await render({ configurable: true })

    expect(switchControl(container).disabled).toBe(false)
    expect(container.textContent).not.toContain(labels.productOwnedNote)
    expect(container.textContent).not.toContain(labels.plannedNotConfigurable)
  })
})

async function render(props: { configurable: boolean; enabledConfigurable?: boolean }): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<CollectionPolicySection
    configurable={props.configurable}
    enabledConfigurable={props.enabledConfigurable}
    draftProfile={profile()}
    labels={labels}
    supportsSentiment={false}
    onChange={() => undefined}
    onEnabledChange={() => undefined}
  />))
  return container
}

function switchControl(container: HTMLElement): HTMLButtonElement {
  const control = container.querySelector<HTMLButtonElement>('[role="switch"]')
  if (!control) throw new Error('enabled switch not found')
  return control
}

function profile(): IntelligenceSourceProfile {
  return {
    profileId: 'twelve-data-market-profile',
    sourceId: 'twelve-data-market',
    enabled: false,
    collectionPreset: 'frequent',
    includeInSentiment: false,
    scopePolicy: 'all',
    rawArchiveEnabled: true,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: true,
    updatedAt: '2026-10-14T00:00:00.000Z'
  }
}
