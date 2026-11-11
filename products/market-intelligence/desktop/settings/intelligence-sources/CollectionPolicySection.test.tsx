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
  presets: { manual: 'Manual', balanced: 'Balanced', frequent: 'Frequent' }
}

const NOT_CONFIGURABLE_ARIA_KEY = 'settings.intelligenceSources.collectionPolicy.notConfigurableAria'
const PLANNED_NOTE_KEY = 'settings.intelligenceSources.collectionPolicy.plannedNotConfigurable'
const PLANNED_NOTE = 'This source is not implemented yet and cannot be enabled or configured.'
const NOT_CONFIGURABLE = { ariaLabelKey: NOT_CONFIGURABLE_ARIA_KEY, labelKey: PLANNED_NOTE_KEY }

/** 行名与 ⓘ 的句子都经 `resolveText` 解析（注册表只持键）；这里给真句子，不给键本身。 */
const copy: Record<string, string> = {
  'settings.intelligenceSources.collectionPolicy.includeInSentiment': labels.includeInSentiment,
  'settings.intelligenceSources.collectionPolicy.collectionPreset': labels.collectionPreset,
  'settings.intelligenceSources.collectionPolicy.productOwnedNote':
    'A product-owned job collects this source; the switch at the end of its row controls it.',
  'settings.intelligenceSources.collectionPolicy.productOwnedNoteAria': 'About collection policy',
  [NOT_CONFIGURABLE_ARIA_KEY]: 'About why this row cannot be changed',
  [PLANNED_NOTE_KEY]: PLANNED_NOTE
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

  it('renders nothing at all when the only remaining row (sentiment) does not apply', async () => {
    // 采集预设移走后，这一块只剩「纳入情绪分析」这一条条件行（用户 2026-11-12）：
    // 不支持情绪的源**整块不渲染**，不留空标题、不留空网格。
    const container = await render({ configurable: false, enabledConfigurable: false, supportsSentiment: false })

    expect(container.querySelector('.intelligence-policy-rows')).toBeNull()
    expect(container.querySelector('.intelligence-setting-grid')).toBeNull()
    expect(container.textContent).not.toContain(labels.title)
    expect(container.textContent).not.toContain(PLANNED_NOTE)
    expect(switchControls(container)).toHaveLength(0)
    expect(infoTriggers(container)).toHaveLength(0)
  })

  it('keeps only the sentiment row for a source that supports it', async () => {
    const container = await render({ configurable: false, enabledConfigurable: true, supportsSentiment: true })

    expect(container.textContent).toContain(labels.includeInSentiment)
    // 预设那一行（含它自己的 ⓘ 与控件）不再出现在这里——它归「采集与数据」。
    expect(container.textContent).not.toContain(labels.collectionPreset)
    expect(infoTriggers(container)).toHaveLength(0)
    expect(switchControls(container)).toHaveLength(1)
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
    sourceId="s1"
    configurable={props.configurable}
    enabledConfigurable={props.enabledConfigurable}
    draftProfile={profile()}
    labels={labels}
    /* 这一行不能改时，原因（键）由调用方给——正文里没有它的位置。 */
    {...(props.enabledConfigurable === false ? { notConfigurable: NOT_CONFIGURABLE } : {})}
    resolveText={resolveText}
    supportsSentiment={props.supportsSentiment}
    onChange={props.onChange ?? (() => undefined)}
  />))
  return container
}

function switchControls(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="switch"]')]
}

/** ⓘ：字段名旁那颗只说明、不承载动作的图标按钮（按它的读屏名取，不按位置）。 */
function infoTriggers(
  container: HTMLElement,
  ariaLabel = copy['settings.intelligenceSources.collectionPolicy.productOwnedNoteAria']!
): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[aria-label="${ariaLabel}"]`)]
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
