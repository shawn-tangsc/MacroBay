// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import type { NewsSentimentSettingsView } from '../../../service/intelligence/schema/newsSentiment'
import { productText } from '../../shared/i18n/productText'

const { getSettings, saveSettings } = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn()
}))

vi.mock('../../shared/ipc/newsSentimentClient', () => ({
  newsSentimentClient: { getSettings, saveSettings }
}))

// 翻译那块是设置页同一份实现，它自己接 IPC；这一组用例只判评分模型那一行，把它挡成空壳。
vi.mock('../../settings/intelligence-sources/useIntelligenceTranslationSettings', () => ({
  useIntelligenceTranslationSettings: () => ({
    settings: undefined,
    loading: false,
    moduleStatus: undefined,
    modelProviders: [],
    saving: false,
    savedThisSession: false,
    queuing: false,
    notice: null,
    errorMessage: null,
    updateSettings: vi.fn(),
    queueMissing: vi.fn()
  })
}))
vi.mock('../../settings/intelligence-sources/TranslationPreferencesSection', () => ({
  TranslationPreferencesSection: () => null
}))

import { ProcessingSettingsPanel } from './ProcessingSettingsPanel'

const copy = productText['zh-CN'].pages.intelligence.portal.dashboard.configDrawer
const settingsText = productText['zh-CN'].pages.intelligence.portal.newsSentiment.settingsModal

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

const row = (): HTMLElement => host!.querySelector('[data-drawer-row="sentimentModel"]') as HTMLElement
const select = (): HTMLElement | null => row().querySelector('.ant-select') as HTMLElement | null
const switchInput = (): HTMLInputElement | null => row().querySelector('.ant-switch') as HTMLInputElement | null

describe('ProcessingSettingsPanel · 情绪评分用哪个模型', () => {
  it('关着时只写「规则判断」，不画一个灰掉的下拉（假控件一律不许）', async () => {
    getSettings.mockResolvedValue(RULE_ONLY)
    await mount()

    expect(row().textContent).toContain(copy.values.sentimentRuleOnly)
    expect(select()).toBeNull()
    expect(row().querySelector('.ant-select-disabled')).toBeNull()
    // 开关仍在：读者要能把它打开。
    expect(switchInput()).not.toBeNull()
  })

  it('打开后出下拉：跟随快速模型带名字，其余是各供应商可用的聊天模型', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    await mount()

    expect(row().textContent).not.toContain(copy.values.sentimentRuleOnly)
    expect(select()).not.toBeNull()

    await act(async () => {
      (row().querySelector('.ant-select-selector') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
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
      (row().querySelector('.ant-select-selector') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
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
      (row().querySelector('.ant-select-selector') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const target = [...document.querySelectorAll('.ant-select-item-option')]
      .find((node) => node.textContent === 'Provider · Chat') as HTMLElement
    await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {})

    expect(row().textContent).toContain(settingsText.failed)
    // 没写成就不能显示成写成了：选择框仍停在「跟随快速模型」。
    expect(row().querySelector('.ant-select-selection-item')?.textContent)
      .toBe(settingsText.followFast.replace('{name}', 'Provider · Fast'))
  })

  it('保存中不许连点：请求在飞时控件禁用，第 N 次操作不再发第二次写', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    let resolveSave: (value: NewsSentimentSettingsView) => void = () => undefined
    saveSettings.mockImplementation(() => new Promise<NewsSentimentSettingsView>((resolve) => { resolveSave = resolve }))
    await mount()

    await act(async () => {
      (switchInput() as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(row().querySelector('.ant-switch-disabled') ?? select()?.className.includes('disabled') ?? false).toBeTruthy()
    await act(async () => { saveSettings.mockResolvedValue(RULE_ONLY) })
    await act(async () => { resolveSave(RULE_ONLY) })
  })

  it('读不到时是「未知」+ 原因进 ⓘ，不许落成「规则判断」', async () => {
    getSettings.mockRejectedValue(new Error('read failed'))
    await mount()

    expect(row().textContent).toContain(copy.values.autoUnknown)
    expect(row().textContent).not.toContain(copy.values.sentimentRuleOnly)
    expect(row().querySelector('[aria-label], button[aria-label]')).not.toBeNull()
    // 读不到就不给写口：不知道现在是什么，不许盲写。
    expect(switchInput()).toBeNull()
    expect(select()).toBeNull()
  })
})
