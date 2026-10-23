// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSystemProviderPresets } from '@platform/ai/providers/providerPresets'
import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import {
  apiKeyFixture,
  apiKeyInput,
  blurElement,
  pageLabels as labels,
  providerFixture,
  renderModelServiceSettings,
  typeInto
} from './modelServicePageHarness'

/**
 * 模型服务 → 供应商配置按工作台形态重构。
 *
 * 只断言**用户可见结构与行为**（DOM + IPC 调用），不 mock 生产逻辑本身：
 *  ① 无「保存」按钮（改动即存）；
 *  ② 右上角单个启用开关，点一下立即保存（payload 只含 providerId + enabled）；
 *  ③ 左栏是供应商列表（搜索 + 行 + 添加）；
 *  ④ 两个端点默认只读 + 预览行（/v1/messages 与 /v1/chat/completions）；
 *  ⑤「点击这里获取密钥」= siliconflow 预设的邀请链接；
 *  ⑥ 模型分组可折叠 + 行内能力 chips/⚙/−；
 *  ⑦ 输入框失焦保存（焦点移出后触发一次 upsert）。
 *
 * 这里只放**布局/结构**判据；保存失败的控件级回滚与「覆盖」编辑见
 * `ModelServiceProviderAutosave.test.tsx`。
 */

const siliconPreset = createSystemProviderPresets().find((preset) => preset.id === 'silicon') ?? ({} as never)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('PLAT-61 模型服务', () => {
  it('① 没有「保存」按钮（改动即存）', async () => {
    const page = await renderModelServiceSettings()
    const saveButtons = [...page.container.querySelectorAll<HTMLButtonElement>('button')].filter((button) => {
      const text = (button.textContent ?? '').trim()
      return text === labels.saveProvider || text === 'Save'
    })

    expect(saveButtons).toEqual([])
    expect(page.container.querySelector('[data-model-service-page]')).not.toBeNull()

    await act(async () => page.root.unmount())
  })

  it('② 右上角启用开关存在且点一下立即保存（payload 只含 providerId + enabled）', async () => {
    const page = await renderModelServiceSettings()
    const api = page.api

    const toggle = page.container.querySelector<HTMLElement>('[data-provider-switch]')
    expect(toggle).not.toBeNull()
    // R2：开关和名称/meta/控制台/⋯ 同在品牌块这一行（右栏顶部，≤48px）。
    expect(toggle?.closest('[data-model-service-brand]')).not.toBeNull()

    const switchButton = toggle?.querySelector<HTMLButtonElement>('button[role="switch"]')
    expect(switchButton).not.toBeNull()
    await act(async () => {
      switchButton?.click()
      await Promise.resolve()
    })

    await vi.waitFor(() => expect(api.setEnabled).toHaveBeenCalledTimes(1))
    expect(api.setEnabled).toHaveBeenCalledWith(providerFixture.id, false)
    expect(api.setEnabled.mock.calls[0]).toHaveLength(2)
    expect(api.upsert).not.toHaveBeenCalled()

    await act(async () => page.root.unmount())
  })

  it('③ 左栏为供应商列表（搜索框 + 供应商行 + 添加）', async () => {
    const page = await renderModelServiceSettings()
    const api = page.api

    const rail = page.container.querySelector('[data-model-provider-rail]')
    expect(rail).not.toBeNull()

    const search = rail?.querySelector<HTMLInputElement>('[data-provider-search]')
    expect(search?.placeholder).toBe(labels.searchProviderPlaceholder)

    const rows = [...(rail?.querySelectorAll('[data-provider-row]') ?? [])]
    // silicon 已启用 ⇒ pinned / relay 两处副本（推荐只影响排序与 ⭐，不再成组）。
    expect(rows.map((row) => row.getAttribute('data-provider-row'))).toEqual([
      providerFixture.id,
      providerFixture.id
    ])
    // 行状态是状态点（不是 ON 文字徽标）。
    for (const row of rows) {
      expect(row.querySelector('[data-provider-status-dot]')).not.toBeNull()
      expect(row.textContent).not.toMatch(/\bON\b/)
    }

    const add = rail?.querySelector<HTMLButtonElement>('[data-provider-add]')
    expect(add).not.toBeNull()
    await act(async () => {
      add?.click()
      await Promise.resolve()
    })
    expect(document.querySelector('[data-add-provider-dialog]')).not.toBeNull()
    expect(api.upsert).not.toHaveBeenCalled()

    await act(async () => page.root.unmount())
  })

  it('④ API 地址只有一个摘要块：标题 + 只读地址 + 齿轮 + 已启用端点标签', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
        ]
      }
    })

    const section = page.container.querySelector('[data-api-address-section]')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain(labels.apiAddress)
    // R3 第二阶段：页面上没有内联端点输入行，编辑只在请求配置抽屉里。
    expect(page.container.querySelectorAll('[data-endpoint-input]')).toHaveLength(0)
    expect(page.container.querySelectorAll('[data-endpoint-row]')).toHaveLength(0)
    expect(section?.querySelector('[data-endpoint-summary-input]')).not.toBeNull()
    expect(section?.querySelector('[data-request-config-open]')).not.toBeNull()
    expect(section?.querySelector('[data-add-endpoint]')).not.toBeNull()
    expect(section?.textContent).not.toContain('https://anthropic.example.com')

    expect(page.container.querySelectorAll('[data-api-address-section]')).toHaveLength(1)

    await act(async () => page.root.unmount())
  })

  it('⑤「点击这里获取密钥」使用 siliconflow 预设的邀请链接，并走既有 openExternal', async () => {
    expect(siliconPreset.websites?.apiKey).toBe('https://cloud.siliconflow.cn/i/9GmeSjFn')

    const page = await renderModelServiceSettings()
    const api = page.api

    const getKey = page.container.querySelector<HTMLElement>('[data-get-api-key]')
    expect(getKey?.textContent?.trim()).toBe(labels.getApiKeyHere)
    await act(async () => {
      getKey?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(api.openExternal).toHaveBeenCalledWith('https://cloud.siliconflow.cn/i/9GmeSjFn'))

    await act(async () => page.root.unmount())
  })

  it('⑤b 主路径：没有邀请链接的家用预设 key 页（不是回落到官网）', async () => {
    const groqPreset = createSystemProviderPresets().find((preset) => preset.id === 'groq') ?? ({} as never)
    expect(groqPreset.websites?.apiKey).toBe('https://console.groq.com/keys')
    expect(groqPreset.websites?.apiKey).not.toBe(groqPreset.websites?.official)

    const page = await renderModelServiceSettings({
      providers: [{ ...(groqPreset as SafeModelProvider), enabled: true, hasApiKey: true, apiKeyPreview: 'gsk-**********7890' }]
    })

    const getKey = page.container.querySelector<HTMLElement>('[data-get-api-key]')
    expect(getKey?.textContent?.trim()).toBe(labels.getApiKeyHere)
    await act(async () => {
      getKey?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(page.api.openExternal).toHaveBeenCalledWith('https://console.groq.com/keys'))

    await act(async () => page.root.unmount())
  })

  it('⑤d 没填 Key 时「供应商控制台」走邀请链接，已填 Key 时走真正的控制台', async () => {
    const siliconPreset = createSystemProviderPresets().find((preset) => preset.id === 'silicon') ?? ({} as never)
    expect(siliconPreset.websites?.apiKey).toBe('https://cloud.siliconflow.cn/i/9GmeSjFn')

    // 没填 Key ⇒ 邀请链接（注册即返利）
    const emptyPage = await renderModelServiceSettings({
      providers: [{ ...(siliconPreset as SafeModelProvider), enabled: true, hasApiKey: false, apiKeyPreview: '' }]
    })
    const emptyConsole = emptyPage.container.querySelector<HTMLElement>('[data-provider-console]')
    await act(async () => {
      emptyConsole?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(emptyPage.api.openExternal).toHaveBeenCalledWith('https://cloud.siliconflow.cn/i/9GmeSjFn'))
    await act(async () => emptyPage.root.unmount())

    // 已填 Key ⇒ 真正的控制台/官网
    const keyedPage = await renderModelServiceSettings({
      providers: [{ ...(siliconPreset as SafeModelProvider), enabled: true, hasApiKey: true, apiKeyPreview: 'sk-9**********sjfn' }]
    })
    const keyedConsole = keyedPage.container.querySelector<HTMLElement>('[data-provider-console]')
    await act(async () => {
      keyedConsole?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() =>
      expect(keyedPage.api.openExternal).toHaveBeenCalledWith(siliconPreset.websites?.official as string)
    )
    await act(async () => keyedPage.root.unmount())
  })

  it('⑤c 极端兜底：本地运行时没有 key 页时回落官网，文案改成「打开控制台获取密钥」', async () => {
    const ollamaPreset = createSystemProviderPresets().find((preset) => preset.id === 'ollama') ?? ({} as never)
    expect(ollamaPreset.websites?.apiKey).toBeUndefined()

    const page = await renderModelServiceSettings({
      providers: [{ ...(ollamaPreset as SafeModelProvider), enabled: true, hasApiKey: false, apiKeyPreview: '' }]
    })

    const getKey = page.container.querySelector<HTMLElement>('[data-get-api-key]')
    expect(getKey?.textContent?.trim()).toBe(labels.getKeyFromConsole)
    await act(async () => {
      getKey?.click()
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(page.api.openExternal).toHaveBeenCalledWith('https://ollama.com/'))

    await act(async () => page.root.unmount())
  })

  it('⑥ 模型分组可折叠，行内有能力 chips + ⚙ + −', async () => {
    const page = await renderModelServiceSettings()

    const groups = [...page.container.querySelectorAll<HTMLElement>('[data-model-group]')]
    expect(groups.length).toBeGreaterThanOrEqual(2)

    const firstGroup = groups[0]
    const header = firstGroup.querySelector<HTMLButtonElement>('[data-model-group-toggle]')
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(firstGroup.querySelectorAll('[data-model-row]').length).toBeGreaterThan(0)

    await act(async () => {
      header?.click()
      await Promise.resolve()
    })
    expect(firstGroup.querySelector('[data-model-group-toggle]')?.getAttribute('aria-expanded')).toBe('false')
    expect(firstGroup.querySelectorAll('[data-model-row]').length).toBe(0)

    const row = page.container.querySelector<HTMLElement>('[data-model-row]')
    expect(row).not.toBeNull()
    const chips = row?.querySelector('[data-model-chips]')
    // PLAT-62：不再显示「聊天」文字，能力改为图标；没有真实信息就不标注。
    expect(chips?.textContent).not.toContain(labels.chat)
    expect(chips?.textContent).not.toContain(labels.tools)
    expect(row?.querySelector('[data-model-row-settings]')).not.toBeNull()
    expect(row?.querySelector('[data-model-row-remove]')).not.toBeNull()

    await act(async () => page.root.unmount())
  })

  it('⑦ 输入框失焦保存：焦点移出后触发一次 upsert（带刚输入的 Key）', async () => {
    const page = await renderModelServiceSettings()
    const api = page.api

    const input = apiKeyInput(page.container)
    await typeInto(input, apiKeyFixture)
    expect(api.upsert).not.toHaveBeenCalled()

    await blurElement(input)

    await vi.waitFor(() => expect(api.upsert).toHaveBeenCalledTimes(1))
    const saved = api.upsert.mock.calls[0]?.[0] as ModelProviderInput
    expect(saved).toMatchObject({ id: providerFixture.id, apiKey: apiKeyFixture })

    await act(async () => page.root.unmount())
  })
})

describe('协议声明提示（列表拿不到协议时）', () => {
  it('在 DeepSeek 这类"说了等于没说"的供应商顶部显示黄条，并可关闭', async () => {
    const page = await renderModelServiceSettings({ provider: { id: 'deepseek', name: 'deepseek' } })
    const notice = page.container.querySelector('[data-protocol-notice]')
    expect(notice).not.toBeNull()
    // 该用例的 harness 用 en-US 文案。
    expect(notice?.textContent).toContain('Detect models')

    const dismiss = page.container.querySelector<HTMLButtonElement>('[data-protocol-notice-dismiss]')
    await act(async () => dismiss?.click())
    expect(page.container.querySelector('[data-protocol-notice]')).toBeNull()

    await act(async () => page.root.unmount())
  })

  it('LANYUN 这类列表直接给协议的供应商不显示提示', async () => {
    const page = await renderModelServiceSettings({ provider: { id: 'lanyun', name: '蓝耘' } })
    expect(page.container.querySelector('[data-protocol-notice]')).toBeNull()
    await act(async () => page.root.unmount())
  })

  it('未测供应商在同步后仍无协议声明时提示（硅基流动这种）', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        id: 'silicon',
        name: 'Silicon',
        models: [{ id: 'Qwen3-8B', name: 'Qwen3-8B', capabilities: { chat: true } }]
      }
    })
    expect(page.container.querySelector('[data-protocol-notice]')).not.toBeNull()
    await act(async () => page.root.unmount())
  })

  it('未测且还没同步的供应商不提示（不凭空断言）', async () => {
    const page = await renderModelServiceSettings({ provider: { id: 'silicon', name: 'Silicon', models: [] } })
    expect(page.container.querySelector('[data-protocol-notice]')).toBeNull()
    await act(async () => page.root.unmount())
  })
})
