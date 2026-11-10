// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { NewsSentimentSettingsView } from '../../../service/intelligence/schema/newsSentiment'
import { productText } from '../../shared/i18n/productText'

const { getSettings, saveSettings, translationState } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  translationState: { current: {} as Record<string, unknown> }
}))

vi.mock('../../shared/ipc/newsSentimentClient', () => ({
  newsSentimentClient: { getSettings, saveSettings }
}))
vi.mock('../../settings/intelligence-sources/useIntelligenceTranslationSettings', () => ({
  useIntelligenceTranslationSettings: () => translationState.current
}))

import { ProcessingSettingsPanel } from './ProcessingSettingsPanel'

const copy = productText['zh-CN'].pages.intelligence.portal.dashboard.configDrawer
const settingsText = productText['zh-CN'].pages.intelligence.portal.newsSentiment.settingsModal
const labels = productText['zh-CN'].settings.intelligenceSources.translationPreferences

const PROVIDERS: SafeModelProvider[] = [
  {
    id: 'p',
    name: 'Provider',
    models: [
      { id: 'fast', name: 'Fast', capabilities: { chat: true } },
      { id: 'chat', name: 'Chat', capabilities: { chat: true } }
    ]
  }
] as unknown as SafeModelProvider[]

const TRANSLATION_SETTINGS = {
  autoTranslateEnabled: true,
  targetLocale: 'zh-CN' as const,
  resolvedTargetLocale: 'zh-CN' as const,
  translateTitle: true,
  translateSummary: true,
  translateEvidenceExcerpt: false,
  providerId: '',
  modelId: '',
  defaultModelId: '',
  updatedAt: '2026-11-10T00:00:00.000Z'
}

const RULE_ONLY: NewsSentimentSettingsView = {
  settings: { modelScoringEnabled: false, providerId: '', modelId: '', updatedAt: '2026-11-10T00:00:00.000Z' },
  resolution: { source: 'platform-fast', defaultModelState: 'ready', providerId: 'p', modelId: 'fast' },
  defaultFastModel: { providerId: 'p', modelId: 'fast', name: 'Provider · Fast' }
}
const FOLLOW_FAST: NewsSentimentSettingsView = {
  ...RULE_ONLY,
  settings: { ...RULE_ONLY.settings, modelScoringEnabled: true }
}
const EXPLICIT: NewsSentimentSettingsView = {
  ...FOLLOW_FAST,
  settings: { ...FOLLOW_FAST.settings, providerId: 'p', modelId: 'chat' },
  resolution: { source: 'explicit', defaultModelState: 'ready', providerId: 'p', modelId: 'chat' }
}

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  ;(window as unknown as { platform: unknown }).platform = {
    modelProviders: { list: vi.fn(async () => PROVIDERS) }
  }
  translationState.current = {
    settings: TRANSLATION_SETTINGS,
    loading: false,
    moduleStatus: { pendingCount: 20, failedCount: 7, translatedCount: 427 },
    modelProviders: PROVIDERS,
    saving: false,
    savedThisSession: false,
    queuing: false,
    notice: null,
    errorMessage: null,
    updateSettings: vi.fn(async () => TRANSLATION_SETTINGS),
    queueMissing: vi.fn(async () => undefined)
  }
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

async function mount(): Promise<HTMLElement> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(<ProcessingSettingsPanel />) })
  await act(async () => {})
  return host
}

const row = (key: string): HTMLElement =>
  host!.querySelector(`[data-drawer-row="${key}"]`) as HTMLElement
const sentimentRow = (): HTMLElement => row('sentimentModel')
const sentimentSelect = (): HTMLElement | null => sentimentRow().querySelector('.ant-select') as HTMLElement | null
const sentimentSwitch = (): HTMLInputElement | null => sentimentRow().querySelector('.ant-switch') as HTMLInputElement | null

describe('ProcessingSettingsPanel · 一个区块一个圆角容器', () => {
  it('整屏只有区块容器这一层：两个区块、行里没有第二个带边框的盒子', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    await mount()

    expect(host!.querySelectorAll('.settings-section')).toHaveLength(2)
    // 旧卡片那套「每字段一个边框盒子」一个都不许剩。
    expect(host!.querySelectorAll('.intelligence-section')).toHaveLength(0)
    expect(host!.querySelectorAll('.intelligence-setting-row')).toHaveLength(0)
    // 每一行都落在某个区块容器里，且行本身是抽屉那套无底色的行。
    const rows = [...host!.querySelectorAll('.config-drawer__row')]
    expect(rows.length).toBeGreaterThanOrEqual(8)
    for (const candidate of rows) expect(candidate.closest('[data-settings-section-block="true"]')).not.toBeNull()
  })

  it('翻译偏好：一行一个字段，六个字段之后是统计与动作那一行', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    await mount()

    const translationSection = host!.querySelectorAll('.settings-section')[0] as HTMLElement
    expect(translationSection.querySelector('.settings-section__title')?.textContent).toBe(labels.title)
    for (const label of [
      labels.autoTranslateEnabled,
      labels.targetLocale,
      labels.translationModel,
      labels.translateTitle,
      labels.translateSummary,
      labels.translateEvidenceExcerpt
    ]) expect(translationSection.textContent).toContain(label)

    expect(row('translationStats').textContent).toContain(
      `${labels.pendingCount} 20${labels.joiner}${labels.failedCount} 7${labels.joiner}${labels.translatedCount} 427`
    )
    const action = [...row('translationStats').querySelectorAll('button')]
      .find((button) => button.textContent === labels.queueMissing)
    expect(action).not.toBeUndefined()
    await act(async () => { action?.click() })
    expect(translationState.current.queueMissing).toHaveBeenCalledWith([])
  })

  it('统计读不到时是「读不到」+ 原因，不画 0', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    translationState.current = {
      ...translationState.current,
      moduleStatus: undefined,
      errorMessage: labels.loadFailed
    }
    await mount()

    const stats = row('translationStats')
    expect(stats.textContent).toContain('读不到')
    expect(stats.textContent).not.toContain('0')
    expect(stats.querySelector('[aria-label], button[aria-label]')).not.toBeNull()
  })
})

describe('ProcessingSettingsPanel · 情绪评分用哪个模型', () => {
  it('关着时只写「规则判断」，不画一个灰掉的下拉（假控件一律不许）', async () => {
    getSettings.mockResolvedValue(RULE_ONLY)
    await mount()

    expect(sentimentRow().textContent).toContain(copy.values.sentimentRuleOnly)
    expect(sentimentSelect()).toBeNull()
    expect(sentimentRow().querySelector('.ant-select-disabled')).toBeNull()
    expect(sentimentSwitch()).not.toBeNull()
  })

  it('打开后出下拉：跟随快速模型带名字，其余是各供应商可用的聊天模型', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    await mount()

    expect(sentimentRow().textContent).not.toContain(copy.values.sentimentRuleOnly)
    expect(sentimentSelect()).not.toBeNull()

    await act(async () => {
      (sentimentRow().querySelector('.ant-select-selector') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const options = [...document.querySelectorAll('.ant-select-item-option')].map((node) => node.textContent)
    expect(options).toContain(settingsText.followFast.replace('{name}', 'Provider · Fast'))
    expect(options).toContain('Provider · Chat')
  })

  it('选中即保存：写口只有 saveSettings，参数是 providerId/modelId', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    saveSettings.mockResolvedValue(EXPLICIT)
    await mount()

    await act(async () => {
      (sentimentRow().querySelector('.ant-select-selector') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const target = [...document.querySelectorAll('.ant-select-item-option')]
      .find((node) => node.textContent === 'Provider · Chat') as HTMLElement
    await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {})

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith({ providerId: 'p', modelId: 'chat' })
  })

  it('保存失败当场可见，并且控件回到原值——不许静默当成功', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    saveSettings.mockRejectedValue(new Error('write failed'))
    await mount()

    await act(async () => {
      (sentimentRow().querySelector('.ant-select-selector') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const target = [...document.querySelectorAll('.ant-select-item-option')]
      .find((node) => node.textContent === 'Provider · Chat') as HTMLElement
    await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {})

    expect(sentimentRow().textContent).toContain(settingsText.failed)
    expect(sentimentRow().querySelector('.ant-select-selection-item')?.textContent)
      .toBe(settingsText.followFast.replace('{name}', 'Provider · Fast'))
  })

  it('保存中不许连点：请求在飞时控件禁用，第 N 次操作不再发第二次写', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    let resolveSave: (value: NewsSentimentSettingsView) => void = () => undefined
    saveSettings.mockImplementation(() => new Promise<NewsSentimentSettingsView>((resolve) => { resolveSave = resolve }))
    await mount()

    await act(async () => {
      (sentimentSwitch() as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(sentimentRow().querySelector('.ant-switch-disabled')).not.toBeNull()
    await act(async () => { resolveSave(RULE_ONLY) })
  })

  it('读不到时是「未知」+ 原因进 ⓘ，不许落成「规则判断」', async () => {
    getSettings.mockRejectedValue(new Error('read failed'))
    await mount()

    expect(sentimentRow().textContent).toContain(copy.values.autoUnknown)
    expect(sentimentRow().textContent).not.toContain(copy.values.sentimentRuleOnly)
    expect(sentimentRow().querySelector('[aria-label], button[aria-label]')).not.toBeNull()
    // 读不到就不给写口：不知道现在是什么，不许盲写。
    expect(sentimentSwitch()).toBeNull()
    expect(sentimentSelect()).toBeNull()
  })
})
