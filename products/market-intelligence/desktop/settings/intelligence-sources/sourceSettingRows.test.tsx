// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { settingRegistry } from '../../shared/settings/registry'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import { visibleSourceRows } from './sourceSettingRows'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * C2 · 来源屏：菜单 1 的三行**由声明决定**（值、可见性、行键），行长什么样住在 `SourceRows`。
 *
 * 三条判据（Chief 2026-11-10 改动后）：
 * ① 行的存在与顺序由 `SOURCE_ROWS` 决定；
 * ② 行的值与可见性读声明（`read.select` / `visibleWhen`）；
 * ③ 写入仍走宿主那一条，页面里没有按 key 手写的 if、也没有字面量键。
 *
 * 这套用例是**双向**的：声明里对这份视图成立的行必须在 DOM 上（少画会红），
 * 画出来的每个键也必须是真的菜单 1 声明且只给设置页（多画会红）。
 */
const settingsText = productText['zh-CN'].settings.intelligenceSources

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function labels(): ProviderDetailLabels {
  return {
    sourceNames: {}, providerNames: {}, panelNames: settingsText.panelNames, badges: settingsText.sourceBadges,
    status: settingsText.status, capabilities: settingsText.providerSummary, toggleSource: settingsText.toggleSource,
    credentials: settingsText.credentialsRequired, website: settingsText.website, signup: settingsText.signup,
    inviteNote: settingsText.inviteNote, testConnection: settingsText.testConnection, jobRegistered: settingsText.jobRegistered,
    jobNotRegistered: settingsText.jobNotRegistered, connectionSucceeded: settingsText.connectionSucceeded,
    connectionFailed: settingsText.connectionFailed, connectionUnsupported: settingsText.connectionUnsupported,
    apiKey: settingsText.apiKey, unavailableReasonCode: settingsText.unavailableReasonCode,
    unavailableReasonCodeAria: settingsText.unavailableReasonCodeAria,
    automaticSyncStopped: settingsText.automaticSyncStopped, lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

function source(overrides: Partial<SourceView>): SourceView {
  return {
    sourceId: 's1', providerId: 'p1', displayName: 'S1', agents: ['crypto'], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: { runNow: 'adapter', testConnection: true },
    readiness: 'live', enabled: true, healthState: 'healthy', healthMarker: 'none',
    ...overrides
  }
}

function provider(): ProviderView {
  return {
    providerId: 'p1', displayName: 'P1', category: 'macro', credential: 'none', healthMarker: 'none',
    sources: [
      source({ sourceId: 's1', displayName: 'S1' }),
      // 待接入的源：启用开关仍要画（禁用），否则「为什么这一条没有」只能是悬案。
      source({ sourceId: 's2', displayName: 'S2', visibility: 'pending' })
    ]
  }
}

const SUPPORTS_SENTIMENT: Readonly<Record<string, boolean>> = { s1: true, s2: false }

/** 页面把它交给两行策略行的同一份 profile（值从声明读，但视图必须给到）。 */
const PROFILES: Readonly<Record<string, { collectionPreset?: string; includeInSentiment?: boolean }>> = {
  s1: { collectionPreset: 'balanced', includeInSentiment: true },
  s2: { collectionPreset: 'manual', includeInSentiment: false }
}

function policy(): NonNullable<Parameters<typeof ProviderDetail>[0]['policy']> {
  return {
    onChange: () => undefined,
    profiles: PROFILES as never,
    supportsSentimentById: SUPPORTS_SENTIMENT,
    labels: {
      title: 'p', collectionPreset: 'c', manualPresetNote: 'm', includeInSentiment: 'i',
      presets: { manual: '手动', balanced: '均衡', frequent: '频繁' }
    }
  }
}

/** 一个源的完整视图：三行各自的 `read.select` / `visibleWhen` 都从这一份里取。 */
function viewOf(entry: SourceView): unknown {
  return {
    ...entry,
    displayName: entry.displayName,
    profile: PROFILES[entry.sourceId],
    supportsSentiment: SUPPORTS_SENTIMENT[entry.sourceId] === true
  }
}

async function mount(enabledWrite = vi.fn(async () => true)): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ProviderDetail
      labels={labels()}
      onToggleSource={enabledWrite}
      policy={policy()}
      provider={provider()}
      showSourceDetails
      surface="settings"
    />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container
}

function renderedKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-setting-key]')]
    .map((node) => node.getAttribute('data-setting-key') ?? '')
}

describe('the source screen renders menu 1 from the declarations (C2)', () => {
  it('renders the declared rows, in declaration order, and hides what visibleWhen hides', async () => {
    const container = await mount()
    const expected = provider().sources.flatMap((entry) => visibleSourceRows(viewOf(entry))
      .map((row) => row.template.replace('<sourceId>', entry.sourceId)))

    // ① 顺序取自声明（先启用、再预设、再情绪），不是页面自己排的；② 不可见的行不出现。
    expect(renderedKeys(container)).toEqual(expected)
    expect(expected.filter((key) => key.startsWith('setting:sources.include-in-sentiment'))).toEqual([
      'setting:sources.include-in-sentiment@s1'
    ])
  })

  it('renders nothing that is not a menu 1 declaration for the settings surface', async () => {
    const container = await mount()
    for (const key of renderedKeys(container)) {
      const template = key.replace(/@[^@]+$/, '@<sourceId>')
      const declared = settingRegistry.sources.find((row) => row.key === template)
      expect(declared?.surfaces).toEqual(['settings'])
    }
  })

  it('keeps every key literal out of the screen files (no hand-written per-key ifs)', () => {
    for (const file of ['ProviderDetail.tsx', 'CollectionPolicySection.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).not.toContain('setting:sources.')
    }
  })

  it('leaves enabling to the card switch: no switch on this screen writes anything', async () => {
    // 用户 2026-11-11：启停的编辑入口只在「采集与数据」的卡片项；这一屏的开关（页头组开关与能力行）
    // 都是只读展示。点它们不产生任何写入，也不会走 IPC。
    const invoke = vi.fn(async (_productId: string, _method: string) => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const write = vi.fn(async () => true)
    const container = await mount(write)

    // 只看「启停」类开关：页头组开关 + 能力行的 `setting:sources.enabled@…`。
    // 「纳入情绪分析」那颗不属于启停，仍是可编辑的，别把它算进来。
    const switches = [...container.querySelectorAll<HTMLButtonElement>(
      '.source-provider-detail__group-toggle button[role="switch"], [data-setting-key^="setting:sources.enabled"] button[role="switch"]'
    )]
    expect(switches.length).toBeGreaterThan(0)
    for (const control of switches) {
      expect(control.disabled).toBe(true)
      await act(async () => { control.click() })
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(write).not.toHaveBeenCalled()
    expect(invoke.mock.calls.some(([, method]) => method === 'intelligenceSources.setEnabled')).toBe(false)
  })
})
