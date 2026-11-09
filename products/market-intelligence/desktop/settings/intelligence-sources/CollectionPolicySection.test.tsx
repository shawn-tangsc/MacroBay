// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { IntelligenceSourceProfile } from '../../../service/intelligence/schema/intelligenceSource'
import { CollectionPolicySection } from './CollectionPolicySection'

const labels = {
  title: 'Collection policy',
  collectionPreset: 'Collection preset',
  manualPresetNote: 'Manual mode does not collect automatically.',
  includeInSentiment: 'Include in sentiment',
  plannedNotConfigurable: 'This source is not implemented yet and cannot be enabled or configured.',
  productOwnedNote: 'A product-owned job collects this source; the switch at the end of its row controls it.',
  presets: { manual: 'Manual', balanced: 'Balanced', frequent: 'Frequent' }
}

let root: Root | undefined

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('CollectionPolicySection', () => {
  it('leaves enable to the row switch: the policy group carries no second enable control', async () => {
    // 缺陷（用户实测 2026-11-10）：组内那颗「启用」读 profile.enabled、写 setEnabled，行尾那颗读
    // source.enabled——同一个事实两份副本。动组内那颗，上面整行就被关掉，组内自己又弹回去。
    // 启用只由行尾那颗承担，所以这里**一颗开关都不该有**。
    const container = await render({ configurable: true, supportsSentiment: false })

    expect(switchControls(container)).toHaveLength(0)
  })

  it('keeps the sentiment switch as the only switch in the group', async () => {
    // 删的是「启用」那颗，不是整组开关：纳入情绪分析仍然只在这里改。
    const changes: Array<Partial<IntelligenceSourceProfile>> = []
    const container = await render({ configurable: true, supportsSentiment: true, onChange: (patch) => changes.push(patch) })

    const controls = switchControls(container)
    expect(controls).toHaveLength(1)
    expect(container.textContent).toContain(labels.includeInSentiment)

    await act(async () => { controls[0]!.click() })

    expect(changes).toContainEqual({ includeInSentiment: true })
  })

  it('fails closed with a note for a source that is not implemented yet', async () => {
    const container = await render({ configurable: false, enabledConfigurable: false, supportsSentiment: false })

    expect(container.textContent).toContain(labels.plannedNotConfigurable)
    expect(container.textContent).not.toContain(labels.productOwnedNote)
    expect(switchControls(container)).toHaveLength(0)
  })

  it('points a product-owned source at its row switch instead of offering a second one', async () => {
    const container = await render({ configurable: false, enabledConfigurable: true, supportsSentiment: false })

    expect(container.textContent).toContain(labels.productOwnedNote)
    expect(container.textContent).not.toContain(labels.plannedNotConfigurable)
    expect(switchControls(container)).toHaveLength(0)
  })
})

async function render(props: {
  configurable: boolean
  enabledConfigurable?: boolean
  supportsSentiment: boolean
  onChange?: (patch: Partial<IntelligenceSourceProfile>) => void
}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<CollectionPolicySection
    configurable={props.configurable}
    enabledConfigurable={props.enabledConfigurable}
    draftProfile={profile()}
    labels={labels}
    supportsSentiment={props.supportsSentiment}
    onChange={props.onChange ?? (() => undefined)}
  />))
  return container
}

function switchControls(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="switch"]')]
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
