// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DashboardSourcesPanel } from './DashboardSourcesPanel'
import { ProcessingSettingsPanel } from './ProcessingSettingsPanel'

/**
 * 「翻译只留在内容处理屏」的**行为**证明（`abeebc1` 的源码级棘轮之外那一档）。
 *
 * - 反：抽屉来源屏渲染后 `.intelligence-translation-preferences` 为 **null**（没画出来，不是隐藏）；
 * - 正：抽屉内容处理屏同一套 mock 下该节点**存在**。
 *
 * 一正一反放同一个文件、共用一套 mock：两份 mock 各写一遍，迟早不同步，红起来分不清是代码变了还是
 * mock 变了。断言用**稳定类名**，不用中文文案——改一句文案不该让这条红。
 */
vi.mock('../../settings/intelligence-sources/useIntelligenceTranslationSettings', () => ({
  useIntelligenceTranslationSettings: () => ({
    settings: { autoTranslateEnabled: true, targetLocales: ['en-US'], modelProviderId: 'provider-a', modelId: 'model-a', defaultModelId: 'model-a', fields: { title: true, summary: true, evidence: true } },
    loading: false,
    moduleStatus: 'ready',
    modelProviders: [],
    saving: false,
    savedThisSession: false,
    queuing: false,
    notice: undefined,
    errorMessage: undefined,
    updateSettings: async () => undefined,
    queueMissing: async () => undefined
  })
}))

vi.mock('../../settings/intelligence-sources/useIntelligenceSourcesSettings', () => ({
  useIntelligenceSourcesSettings: () => ({
    settingsView: {
      groups: [{
        category: 'crypto',
        providers: [{
          providerId: 'coindesk',
          displayName: 'CoinDesk',
          category: 'crypto',
          credential: 'none',
          healthMarker: 'none',
          sources: [{
            sourceId: 'coindesk-rss',
            providerId: 'coindesk',
            displayName: 'CoinDesk RSS',
            agents: ['crypto'],
            panels: [],
            visibility: 'visible',
            collection: 'adapter',
            kind: 'feed',
            capabilities: { runNow: 'adapter', testConnection: false },
            readiness: 'live',
            enabled: true,
            healthState: 'healthy',
            healthMarker: 'none'
          }]
        }]
      }],
      counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
    },
    loading: false,
    errorCode: undefined,
    reload: () => undefined,
    profiles: [{
      profileId: 'p1',
      sourceId: 'coindesk-rss',
      enabled: true,
      collectionPreset: 'balanced',
      includeInSentiment: false,
      scopePolicy: 'all',
      rawArchiveEnabled: false,
      retentionMode: 'balanced',
      autoReplayAfterParserUpgrade: false,
      updatedAt: '2026-11-01T00:00:00.000Z'
    }],
    definitions: [{ sourceId: 'coindesk-rss', supportsSentiment: false, supportsRunNow: true }],
    updateSourceProfile: () => undefined,
    runSourceNow: async () => undefined,
    toggleSourceEnabled: async () => undefined,
    setDraftDirty: () => undefined,
    reloadSettings: () => undefined
  })
}))

/**
 * mock 必须与真实调用面一致，否则测的是失败路径。
 *
 * 内容处理屏的评分模型格调的是 `newsSentimentClient.getSettings()` / `saveSettings(patch)`
 * （`ProcessingSettingsPanel.tsx:312/328`）；早先这里给的是 `getSentimentModelFact`——名字对不上，
 * 于是每次渲染都走 catch 落到「读不到」，用例只判翻译区块在不在所以没暴露。以后谁加一条跟评分有关的
 * 断言就会踩进去，所以按真实方法名给。
 */
vi.mock('../../shared/ipc/newsSentimentClient', () => {
  const view = {
    settings: { modelScoringEnabled: false },
    resolution: { source: 'rule' },
    defaultFastModel: undefined
  }
  return {
    newsSentimentClient: {
      getSettings: async () => view,
      saveSettings: async () => view
    }
  }
})

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

async function render(element: React.ReactElement): Promise<HTMLElement> {
  const invoke = vi.fn(async () => undefined)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(element); await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

describe('translation lives on the content screen only', () => {
  it('does not draw the translation block on the drawer sources screen', async () => {
    const host = await render(<DashboardSourcesPanel />)
    // 行为证明：界面上没有这块，不是 `hidden` / `display:none`。
    expect(host.querySelector('[data-processing-section="translation"]')).toBeNull()
  })

  it('still draws it on the drawer content screen', async () => {
    const host = await render(<ProcessingSettingsPanel />)
    // 内容处理屏自己一份实现（不再借设置页那张卡），所以钉的是新屏的稳定钩子：区块容器在。
    expect(host.querySelector('[data-processing-section="translation"]')).not.toBeNull()
  })
})
