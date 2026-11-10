// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const dataText = productText['zh-CN'].pages.intelligence.portal.data

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
const switchRow = (): HTMLElement => host!.querySelector('[data-drawer-row="sentimentScoring"]') as HTMLElement
const modelRow = (): HTMLElement | null => host!.querySelector('[data-drawer-row="sentimentModel"]') as HTMLElement | null
const modelSelect = (): HTMLElement | null => modelRow()?.querySelector('.ant-select') as HTMLElement | null
const scoringSwitch = (): HTMLInputElement | null => switchRow().querySelector('.ant-switch') as HTMLInputElement | null

describe('ProcessingSettingsPanel · 区块容器的框只由平台组件给', () => {
  it('屏里不再写第二份边框/圆角/底色（两套数必然一处改、另一处不跟）', () => {
    const root = process.cwd()
    const panel = readFileSync(join(root, 'products/market-intelligence/desktop/pages/intelligence/ProcessingSettingsPanel.tsx'), 'utf8')
    expect(panel).toContain("from '@platform/ui/components/settings-section'")

    const css = readFileSync(join(root, 'products/market-intelligence/desktop/pages/intelligence/ProcessingSettingsPanel.css'), 'utf8')
    // 只许写平台那件表达不了的（对齐、状态小字位置）；`.settings-section` 本体一条规则都不许有。
    expect(css).not.toMatch(/\.settings-section(?!__)\s*\{/)
    expect(css).not.toMatch(/\.settings-section__(header|body)\s*\{/)
  })
})

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
    // 读失败也是红色提示条（保存/读失败同一档），不是行内自绘的一行小字。
    expect(host!.querySelector('[data-inline-notice="danger"]')?.textContent).toContain(labels.loadFailed)
  })
})

describe('ProcessingSettingsPanel · 控制件一律从控件列左缘起', () => {
  it('同一屏所有控制件都在控件列里、且是列里第一个元素；只有行尾动作靠右', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    await mount()

    const controls = [...host!.querySelectorAll('.ant-switch, .ant-select, .ant-segmented')]
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      // 按容器类判断左缘，不量像素：控制件必须落在控件列里，并且是这一列的第一个元素——
      // 它前面若有文字，控制件就被顶离左缘，这正是用户看到的「一个靠左、一个到行最右」。
      const column = control.closest('.config-drawer__value')
      expect(column).not.toBeNull()
      expect(column!.firstElementChild).toBe(control)
    }

    // 行尾动作允许靠右：它不在控件列里，且是所在行的最后一个元素。
    const action = [...host!.querySelectorAll('button')]
      .find((button) => button.textContent === labels.queueMissing)
    expect(action).not.toBeUndefined()
    expect(action!.closest('.config-drawer__value')).toBeNull()
    expect(action!.parentElement?.lastElementChild).toBe(action)

    // 行容器上不许再用内联样式把控制件顶开。
    for (const rowElement of host!.querySelectorAll<HTMLElement>('.config-drawer__row')) {
      expect(rowElement.style.justifyContent).toBe('')
    }

    // 同一份 CSS 也不许给控件列或行加「顶到最右」的写法。
    const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/ProcessingSettingsPanel.css'), 'utf8')
    // 注释里提到这两句是**说明**，只在规则里禁：先剥注释再比。
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).not.toMatch(/margin-left:\s*auto/)
    expect(rules).not.toMatch(/justify-content:\s*space-between/)
  })
})

describe('ProcessingSettingsPanel · 情绪评分（开关一行、模型一行）', () => {
  it('是两行、各自有标签：上「用模型判断情绪」，下「用哪个模型」', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    await mount()

    expect(switchRow().textContent).toContain(copy.rows.sentimentModelSwitch)
    expect(switchRow().querySelector('.ant-switch')).not.toBeNull()
    expect(modelRow()?.textContent).toContain(copy.rows.sentimentModel)
    expect(modelSelect()).not.toBeNull()
    // 两行是两个行元素，不是一行里挤两个标签。
    expect(switchRow()).not.toBe(modelRow())
  })

  it('开关关掉时「用哪个模型」这一行**不存在**（不是禁用），值位只说「规则判断」', async () => {
    getSettings.mockResolvedValue(RULE_ONLY)
    await mount()

    expect(modelRow()).toBeNull()
    expect(host!.querySelector('[data-drawer-row="sentimentModel"] .ant-select')).toBeNull()
    expect(switchRow().textContent).toContain(copy.values.sentimentRuleOnly)
    // 开关本身仍在：读者要能把它打开。
    expect(scoringSwitch()).not.toBeNull()
    // 消掉「关着却还留着灰下拉」的可能：全屏一个 select 都没有（翻译模型那个除外，它在另一块）。
    expect(host!.querySelector('[data-processing-section="sentiment"] .ant-select')).toBeNull()
  })

  it('开关是那颗总开关：写的是 modelScoringEnabled，不是把模型行当附属', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    saveSettings.mockResolvedValue(RULE_ONLY)
    await mount()

    await act(async () => {
      (scoringSwitch() as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})

    expect(saveSettings).toHaveBeenCalledTimes(1)
    // 存储键就是「是否用模型判断情绪」，不带 providerId/modelId。
    expect(saveSettings).toHaveBeenCalledWith({ modelScoringEnabled: false })
    // 关掉之后模型行当场消失。
    expect(modelRow()).toBeNull()
  })

  it('打开后模型行出下拉：跟随快速模型带名字，其余是各供应商可用的聊天模型', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    await mount()

    expect(modelSelect()).not.toBeNull()
    await act(async () => {
      (modelRow()!.querySelector('.ant-select-selector') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const options = [...document.querySelectorAll('.ant-select-item-option')].map((node) => node.textContent)
    expect(options).toContain(settingsText.followFast.replace('{name}', 'Provider · Fast'))
    expect(options).toContain('Provider · Chat')
  })

  it('选中即保存：模型行写的是 providerId/modelId', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    saveSettings.mockResolvedValue(EXPLICIT)
    await mount()

    await act(async () => {
      (modelRow()!.querySelector('.ant-select-selector') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const target = [...document.querySelectorAll('.ant-select-item-option')]
      .find((node) => node.textContent === 'Provider · Chat') as HTMLElement
    await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {})

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith({ providerId: 'p', modelId: 'chat' })
  })

  it('保存失败当场可见（红色提示条），并且控件回到原值——不许静默当成功', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    saveSettings.mockRejectedValue(new Error('write failed'))
    await mount()

    await act(async () => {
      (modelRow()!.querySelector('.ant-select-selector') as HTMLElement)
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    const target = [...document.querySelectorAll('.ant-select-item-option')]
      .find((node) => node.textContent === 'Provider · Chat') as HTMLElement
    await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => {})

    const notice = host!.querySelector('[data-inline-notice="danger"]') as HTMLElement
    expect(notice).not.toBeNull()
    expect(notice.getAttribute('role')).toBe('alert')
    expect(notice.textContent).toContain(settingsText.failed)
    const retry = [...notice.querySelectorAll('button')]
      .find((button) => button.textContent === dataText.retry)
    expect(retry).not.toBeUndefined()

    // 控件回到原值：没写成就不能显示成写成了。
    expect(modelRow()!.querySelector('.ant-select-selection-item')?.textContent)
      .toBe(settingsText.followFast.replace('{name}', 'Provider · Fast'))

    // 「再试一次」重放的是同一次写。
    saveSettings.mockResolvedValue(EXPLICIT)
    await act(async () => { retry?.click() })
    await act(async () => {})
    expect(saveSettings).toHaveBeenCalledTimes(2)
    expect(saveSettings).toHaveBeenLastCalledWith({ providerId: 'p', modelId: 'chat' })
  })

  it('保存中不许连点：请求在飞时控件禁用，第 N 次操作不再发第二次写', async () => {
    getSettings.mockResolvedValue(FOLLOW_FAST)
    let resolveSave: (value: NewsSentimentSettingsView) => void = () => undefined
    saveSettings.mockImplementation(() => new Promise<NewsSentimentSettingsView>((resolve) => { resolveSave = resolve }))
    await mount()

    await act(async () => {
      (scoringSwitch() as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(switchRow().querySelector('.ant-switch-disabled')).not.toBeNull()
    await act(async () => { resolveSave(RULE_ONLY) })
  })

  it('读不到时两行都没有控件：开关行「未知」+ 原因进 ⓘ，模型行不存在', async () => {
    getSettings.mockRejectedValue(new Error('read failed'))
    await mount()

    expect(switchRow().textContent).toContain(copy.values.autoUnknown)
    expect(switchRow().textContent).not.toContain(copy.values.sentimentRuleOnly)
    expect(switchRow().querySelector('[aria-label], button[aria-label]')).not.toBeNull()
    expect(scoringSwitch()).toBeNull()
    expect(modelRow()).toBeNull()

    // 读不到是黄灯（不是失败）：短句 + 动作「去模型服务」，原因仍在行的 ⓘ 里。
    const notice = host!.querySelector('[data-inline-notice="caution"]') as HTMLElement
    expect(notice).not.toBeNull()
    expect(notice.getAttribute('role')).toBe('status')
    expect(notice.textContent).toContain(copy.unreadable)

    const jump = [...notice.querySelectorAll('button')]
      .find((button) => button.textContent === copy.openModelService)
    expect(jump).not.toBeUndefined()
    const navigations: unknown[] = []
    const listener = (event: Event): void => { navigations.push((event as CustomEvent).detail) }
    window.addEventListener('app-shell:navigate', listener)
    await act(async () => { jump?.click() })
    window.removeEventListener('app-shell:navigate', listener)
    expect(navigations).toContainEqual({ navKey: 'settings', settingsPanelKey: 'models' })
    // 同一时刻只出一条提示条。
    expect(host!.querySelectorAll('[data-inline-notice]')).toHaveLength(1)
  })
})
