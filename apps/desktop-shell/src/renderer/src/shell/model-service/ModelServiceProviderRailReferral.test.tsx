// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'

import { ModelServiceProviderRail } from './ModelServiceProviderRail'

/**
 * 左栏「推荐」组（位于「已启用」与分类组之间）：
 * - 只收「未启用 + 有邀请链接 + 有明确奖励规则」的供应商；
 * - 启用后进入「已启用」并离开推荐；
 * - 组内按 `ProviderReferralProgram.rank`（越小越好）排序，同级保持源顺序；
 * - 行内不再有邀请星标。
 */
const labels = platformText['en-US'].models

type Fixture = Pick<SafeModelProvider, 'id' | 'name' | 'enabled'>

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mountRail(props: {
  providers: Fixture[]
  search?: string
  selectedProviderId?: string | null
  inactiveReferralIds?: readonly string[]
  onSelect?: (providerId: string) => void
}): Promise<HTMLElement> {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceProviderRail, {
      labels,
      providers: props.providers as unknown as SafeModelProvider[],
      totalProviderCount: props.providers.length,
      selectedProviderId: props.selectedProviderId ?? null,
      search: props.search ?? '',
      onSearchChange: () => undefined,
      onSelect: props.onSelect ?? (() => undefined),
      onAdd: () => undefined,
      ...(props.inactiveReferralIds ? { inactiveReferralIds: props.inactiveReferralIds } : {})
    }))
  })
  return container
}

function headerIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-provider-group-header]')]
    .map((header) => header.getAttribute('data-provider-group') ?? '')
}

function groupRows(container: HTMLElement, groupId: string): string[] {
  return [...container.querySelectorAll(`[data-provider-group="${groupId}"] [data-provider-row]`)]
    .map((row) => row.getAttribute('data-provider-row') ?? '')
}

function rowCopies(container: HTMLElement, providerId: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-provider-row="${providerId}"]`)]
}

describe('PLAT-62 左栏推荐组', () => {
  it('places 推荐 between 已启用 and the category groups', async () => {
    const container = await mountRail({
      providers: [
        { id: 'silicon', name: 'Silicon', enabled: true },
        { id: 'mimo', name: 'MiMo', enabled: false }
      ]
    })

    expect(headerIds(container)).toEqual(['pinned', 'recommended', 'relay', 'domestic'])
    expect(groupRows(container, 'recommended')).toEqual(['mimo'])
  })

  it('moves a recommended provider into 已启用 and out of 推荐 once enabled', async () => {
    const disabled = await mountRail({ providers: [{ id: 'qiniu', name: 'Qiniu', enabled: false }] })
    expect(groupRows(disabled, 'recommended')).toEqual(['qiniu'])
    expect(headerIds(disabled)).toEqual(['recommended', 'domestic'])

    const enabled = await mountRail({ providers: [{ id: 'qiniu', name: 'Qiniu', enabled: true }] })
    expect(headerIds(enabled)).not.toContain('recommended')
    expect(groupRows(enabled, 'pinned')).toEqual(['qiniu'])
  })

  it('sorts 推荐 by reward rule quality, not by source order', async () => {
    const container = await mountRail({
      providers: [
        { id: 'silicon', name: 'Silicon', enabled: false },
        { id: 'zai', name: 'Z.AI', enabled: false },
        { id: 'cephalon', name: 'Cephalon', enabled: false },
        { id: 'aionly', name: 'AIOnly', enabled: false },
        { id: 'lanyun', name: 'Lanyun', enabled: false },
        { id: 'tokenrhythm', name: 'TokenRhythm', enabled: false },
        { id: 'dashscope', name: 'DashScope', enabled: false },
        { id: 'qiniu', name: 'Qiniu', enabled: false },
        { id: 'mimo', name: 'MiMo', enabled: false },
        // 有规则但没链接 / 有链接但没规则 / 规则太虚（AIOnly/Cephalon/Z.ai）⇒ 都不进推荐。
        { id: 'hyperbolic', name: 'Hyperbolic', enabled: false },
        { id: 'openai', name: 'OpenAI', enabled: false },
        { id: 'burncloud', name: 'BurnCloud', enabled: false }
      ]
    })

    expect(groupRows(container, 'recommended')).toEqual([
      'mimo',
      'qiniu',
      'dashscope',
      'tokenrhythm',
      'lanyun',
      'silicon'
    ])
  })

  it('only recommends providers that have both a link and an explicit program', async () => {
    const container = await mountRail({
      providers: [
        { id: 'mimo', name: 'MiMo', enabled: false },
        { id: 'openai', name: 'OpenAI', enabled: false },
        { id: 'burncloud', name: 'BurnCloud', enabled: false },
        { id: 'ph8', name: 'PH8', enabled: false }
      ]
    })

    expect(groupRows(container, 'recommended')).toEqual(['mimo'])
  })

  it('drops an injected inactive id from 推荐', async () => {
    const providers: Fixture[] = [
      { id: 'qiniu', name: 'Qiniu', enabled: false },
      { id: 'deepseek', name: 'DeepSeek', enabled: true }
    ]

    const active = await mountRail({ providers })
    expect(groupRows(active, 'recommended')).toEqual(['qiniu'])

    const inactive = await mountRail({ providers, inactiveReferralIds: ['qiniu'] })
    expect(headerIds(inactive)).not.toContain('recommended')
  })

  it('renders no referral stars and keeps active marks on every copy', async () => {
    const container = await mountRail({
      providers: [
        { id: 'openai', name: 'OpenAI', enabled: true },
        { id: 'qiniu', name: 'Qiniu', enabled: false }
      ],
      selectedProviderId: 'openai'
    })

    expect(container.querySelectorAll('[data-provider-referral-icon]')).toHaveLength(0)
    // qiniu：推荐组 + 分类组各一份。
    expect(rowCopies(container, 'qiniu')).toHaveLength(2)
    const activeCopies = rowCopies(container, 'openai')
    expect(activeCopies).toHaveLength(2)
    for (const copy of activeCopies) {
      expect(copy.className).toContain('active')
      expect(copy.getAttribute('aria-current')).toBe('true')
    }
  })
})
