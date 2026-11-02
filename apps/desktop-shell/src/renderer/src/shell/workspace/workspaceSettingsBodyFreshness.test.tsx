// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { AppShell } from '../AppShell'

/**
 * Owner: apps/desktop-shell renderer / shell。P2-11 RED（P2-10 发现的用户可见独立缺陷）。
 *
 * 缺陷：`AppShell.pageContentProvider` 的 useMemo 里 `mounts.settings: () => renderSettings()` 是**闭包**，
 * 依赖数组 `[settings, providers, pinnedModelIds, assistantOpenRequest]` 不含 Settings 正文自身状态
 * （如 `apiKeyDraft`、`settingsPanelKey`）⇒ 在有 Tab 桥的生产路径（P2-03 起）下，Tab 正文冻结在
 * memo 创建时那一次渲染：受控 API Key 输入框的 `value` 被旧闭包重置、失焦保存闭包（PLAT-61 起保存
 * 边界是「密钥输入框失焦」，不再是表单提交）读到旧草稿 ⇒ 用户**输入看不见、保存存不下**。
 *
 * 判据（真实 AppShell + 真实受控 `.tabs.*` 桥 + 真实 provider 表单，绝不 mock 生产逻辑本身）：
 *  (a) tabs 桥路径：真实输入 API Key 后，输入框的值**保持**为刚输入的值；
 *  (b) tabs 桥路径：失焦保存后 `modelProviders.upsert` 收到**含该输入值**的 `apiKey`；
 *  (c) 反向对照：**无** tabs 桥的旧路径行为不变（输入可见 + 失焦保存带上输入值）。
 */

const apiKeyFixture = 'fixture-provider-key-1234567890'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('P2-11 Tab 路径下 Settings 正文新鲜度', () => {
  it('(a) 有 Tab 桥：真实输入后 API Key 输入框的值保持为输入值', async () => {
    const page = await renderShell({ withTabsBridge: true })

    await enterApiKey(page.container, apiKeyFixture)

    // RED（当前）：memo 冻结的正文用旧闭包（apiKeyDraft = ''）重渲染受控输入 ⇒ 值被重置为 ''
    expect(apiKeyInput(page.container).value).toBe(apiKeyFixture)

    await act(async () => page.root.unmount())
  })

  it('(b) 有 Tab 桥：失焦保存时 upsert 收到含输入值的 apiKey', async () => {
    const page = await renderShell({ withTabsBridge: true })

    await enterApiKey(page.container, apiKeyFixture)
    await blurApiKey(page.container)

    await vi.waitFor(() => expect(page.api.upsert).toHaveBeenCalledTimes(1))
    const savedInput = page.api.upsert.mock.calls[0]?.[0] as ModelProviderInput | undefined
    // RED（当前）：冻结闭包里的提交处理器读到旧草稿 ⇒ apiKey 为 '' / undefined
    expect(savedInput?.apiKey).toBe(apiKeyFixture)

    await act(async () => page.root.unmount())
  })

  it('(c) 反向对照：无 Tab 桥的旧路径行为不变（输入保持 + 失焦保存带上输入值）', async () => {
    const page = await renderShell({ withTabsBridge: false })

    await enterApiKey(page.container, apiKeyFixture)
    expect(apiKeyInput(page.container).value).toBe(apiKeyFixture)

    await blurApiKey(page.container)

    await vi.waitFor(() => expect(page.api.upsert).toHaveBeenCalledTimes(1))
    const savedInput = page.api.upsert.mock.calls[0]?.[0] as ModelProviderInput | undefined
    expect(savedInput?.apiKey).toBe(apiKeyFixture)

    await act(async () => page.root.unmount())
  })
})

/* ────────────────────────── 真实 AppShell + 受控 .tabs.* 桥 ────────────────────────── */

type TabRecord = {
  workspaceInstanceKey: string
  pageId: string
  menuKey: string
  open: boolean
  order: number
  mode: 'main'
  bindingState: 'bound'
  windowInstanceId: string
  hostEpoch: number
}

function installPlatform(options: { withTabsBridge: boolean }) {
  const tabs: TabRecord[] = []
  const listeners = new Set<(event: unknown) => void>()
  let revision = 1
  let active: string | null = null
  let sequence = 0
  const pageIdOf = (request: { pageId?: unknown; menuKey?: unknown }): string =>
    String(request.pageId ?? request.menuKey ?? '')

  const openTab = (pageId: string): TabRecord => {
    const existing = tabs.find((tab) => tab.pageId === pageId)
    if (existing !== undefined) {
      existing.open = true
      active = existing.workspaceInstanceKey
      return existing
    }
    const tab: TabRecord = {
      workspaceInstanceKey: `tab-${++sequence}-${pageId}`,
      pageId, menuKey: pageId, open: true, order: tabs.length,
      mode: 'main', bindingState: 'bound', windowInstanceId: 'main', hostEpoch: 1
    }
    tabs.push(tab)
    active = tab.workspaceInstanceKey
    return tab
  }
  const snapshot = () => ({
    layoutRevision: revision,
    activeWorkspaceInstanceKey: active,
    tabs: tabs.map((tab) => ({ ...tab }))
  })
  const bump = (type: string) => {
    revision += 1
    for (const listener of [...listeners]) listener({ type, layoutRevision: revision, scope: {} })
  }

  const tabsCommand = vi.fn(async (raw: unknown) => {
    const request = raw as { method?: unknown; workspaceInstanceKey?: unknown; pageId?: unknown; menuKey?: unknown }
    const method = String(request.method ?? '')
    if (method === 'openTab') openTab(pageIdOf(request))
    else if (method === 'activateTab') active = String(request.workspaceInstanceKey)
    else if (method === 'closeTab') {
      const target = tabs.find((tab) => tab.workspaceInstanceKey === request.workspaceInstanceKey)
      if (target !== undefined) target.open = false
      active = tabs.find((tab) => tab.open)?.workspaceInstanceKey ?? null
    }
    bump(method === 'openTab' ? 'open' : method === 'activateTab' ? 'container-changed' : 'close')
    return { status: 'applied', snapshot: snapshot() }
  })

  const list = vi.fn(async () => [providerFixture])
  const upsert = vi.fn(async (_provider: ModelProviderInput) => providerFixture)
  const workspace = options.withTabsBridge
    ? {
        tabsGetSnapshot: vi.fn(async () => ({ status: 'ok', snapshot: snapshot() })),
        tabsCommand,
        onEvent: vi.fn((listener: (event: unknown) => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        })
      }
    : undefined
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      app: {
        getInfo: vi.fn(async () => null),
        getProductSummaries: vi.fn(async () => []),
        openExternal: vi.fn(async () => undefined)
      },
      settings: { get: vi.fn(async () => ({ ...createDefaultAppSettings(), language: 'en-US' })) },
      modelProviders: { list, upsert },
      ...(workspace === undefined ? {} : { workspace }),
      assistants: {
        list: vi.fn(async () => []),
        listTopics: vi.fn(async () => ({ topics: [] })),
        listTopicMessages: vi.fn(async () => ({ messages: [] })),
        streamAttach: vi.fn(async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } })),
        onStreamChunk: vi.fn(() => () => undefined),
        onStreamDone: vi.fn(() => () => undefined),
        onStreamError: vi.fn(() => () => undefined),
        onStreamStatusChanged: vi.fn(() => () => undefined)
      }
    } as unknown as Window['platform']
  })
  return { list, upsert, tabsCommand, openTab }
}

const providerFixture: SafeModelProvider = {
  id: 'provider-local',
  name: 'Local Provider',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.example.test/v1' }
  ],
  enabled: true,
  baseUrl: 'https://api.example.test/v1',
  hasApiKey: false,
  apiKeyPreview: '',
  connectionStatus: 'unavailable',
  models: [{
    id: 'chat-model',
    name: 'Chat Model',
    capabilities: { chat: true, vision: false, embedding: false, tools: true }
  }],
  defaultChatModelId: 'chat-model'
}

async function renderShell(options: { withTabsBridge: boolean }) {
  const api = installPlatform(options)
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(createElement(AppShell))
    await Promise.resolve()
  })
  await clickButton(container, 'Settings')
  await clickButton(container, 'Model Service')
  await vi.waitFor(() => expect(apiKeyInput(container)).toBeTruthy())
  return { api, container, root }
}

/* ────────────────────────── DOM helpers（无 RTL） ────────────────────────── */

function apiKeyInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('.provider-api-key-input input')
  if (!input) throw new Error('Expected API Key input.')
  return input
}

async function enterApiKey(container: HTMLElement, value: string): Promise<void> {
  const input = apiKeyInput(container)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** PLAT-61：保存边界是「密钥输入框失焦」（React onBlur → focusout）。 */
async function blurApiKey(container: HTMLElement): Promise<void> {
  const input = apiKeyInput(container)
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    await Promise.resolve()
  })
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`Expected ${label} button.`)
  await act(async () => button.click())
}
