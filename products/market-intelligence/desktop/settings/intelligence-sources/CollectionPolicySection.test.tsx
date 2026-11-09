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
  presets: { manual: 'Manual', balanced: 'Balanced', frequent: 'Frequent' }
}

/** 这两条只经 ⓘ 解析，不当作正文标签传进来——所以键必须真的能被解析到。 */
const copy: Record<string, string> = {
  'settings.intelligenceSources.collectionPolicy.productOwnedNote':
    'A product-owned job collects this source; the switch at the end of its row controls it.',
  'settings.intelligenceSources.collectionPolicy.productOwnedNoteAria': 'About collection policy'
}
const resolveText = (key: string): string => copy[key] ?? key

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
    // 「尚未实现，暂不可启用或配置」是**状态**，留在正文（读者要知道为什么这颗开关是灰的）。
    const container = await render({ configurable: false, enabledConfigurable: false, supportsSentiment: false })

    expect(container.textContent).toContain(labels.plannedNotConfigurable)
    expect(container.textContent).not.toContain(copy['settings.intelligenceSources.collectionPolicy.productOwnedNote'])
    expect(infoTriggers(container)).toHaveLength(0)
    expect(switchControls(container)).toHaveLength(0)
  })

  it('explains a product-owned source in a field-level info trigger, not in the body prose', async () => {
    // 界面设计 2026-11-10：那句是**说明**（讲它怎么工作），正文只留字段名与控件；它挂在字段名旁的 ⓘ 里。
    // 折叠头那格放不下 ⓘ——组件契约禁止头行出现可聚焦元素。
    const container = await render({ configurable: false, enabledConfigurable: true, supportsSentiment: false })

    const note = copy['settings.intelligenceSources.collectionPolicy.productOwnedNote']!
    expect(container.textContent).not.toContain(note)
    expect(container.textContent).not.toContain(labels.plannedNotConfigurable)
    // 恰一颗，名字是它自己的（说明不继承字段名，否则读屏会念两遍）。
    expect(infoTriggers(container)).toHaveLength(1)
    expect(infoTriggers(container)[0]!.getAttribute('aria-label')).toBe(
      copy['settings.intelligenceSources.collectionPolicy.productOwnedNoteAria']
    )
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
    resolveText={resolveText}
    supportsSentiment={props.supportsSentiment}
    onChange={props.onChange ?? (() => undefined)}
  />))
  return container
}

function switchControls(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="switch"]')]
}

/** ⓘ：字段名旁那颗只说明、不承载动作的图标按钮。 */
function infoTriggers(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[aria-label="${copy['settings.intelligenceSources.collectionPolicy.productOwnedNoteAria']}"]`)]
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
