// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelProviderInput, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { createDefaultAppSettings } from '@platform/settings/schema/appSettings'

import { platformText } from '../../i18n/platformText'
import { AppShell } from '../AppShell'

/**
 * Owner: apps/desktop-shell renderer / shell。P2-10③ RED（D2 草稿门接线缺口）。
 *
 * 缺陷：`WorkspaceTabStrip.draftGuard` 是**可选** prop，而 `AppShell` 从不传 ⇒
 * `workspaceDraftGate.ts` + `SettingsDraftPrompt` 在生产路径上是**死代码**：Settings 有未保存草稿
 * （模型服务 API Key 输入框）时关闭/切换 Tab 没有三态提示，Tab 直接关闭、草稿随之消失。
 *
 * 判据（真实 AppShell + 真实受控 `.tabs.*` 桥 + 真实草稿 owner，绝不 mock 生产逻辑本身）：
 *  ① 关闭当前 Tab ⇒ 出现 `[data-draft-gate]`，且**不得**发出 `closeTab`（保存后才允许关闭）；
 *  ② 切换 Tab ⇒ 不触发草稿门（非销毁路径），草稿保留、Tab 仍开；
 *  ③ 关闭其他 / 关闭右侧（批量）⇒ 同一草稿门；**取消 ⇒ 零部分关闭**（一条关闭命令都不发）；
 *  ④ 保存失败 ⇒ 保留原窗与草稿 + 可见失败提示；
 *  ⑤ 干净（无草稿）⇒ 静默关闭，绝不弹门。
 */

const labels = platformText['en-US'].workspace
const apiKeyFixture = 'fixture-provider-key-1234567890'

/**
 * PLAT-12：本文件全部用例都渲染**真实 AppShell**（受控 preload + 真实 `.tabs.*` 桥）。
 * 实测（单跑 3 次 / 干净并集）：单用例 0.13–0.38s；10 路 CPU 竞争下 0.6–1.56s（≈4x）。
 * 历史最坏记录是同类真实 shell 用例 0.31s 被外部负载饿到 6.9s（≈22x）⇒ 默认 5s 用例预算会被饿死。
 * 这里给**本文件**（describe 级、非全局）一个有界预算：0.38s × 22 ≈ 8.4s，取 15s（≈1.8x 余量）。
 * 预算仍然有界：真挂起 / 真回归照样在 15s 失败，绝不放宽到「永不超时」。
 */
const SHELL_RENDER_TIMEOUT_MS = 15_000

/** 条件驱动等待的显式有界上界：`vi.waitFor` 默认 1s 在高负载下会先于条件到达而抛错（判据逐字不变）。 */
const CONDITION_TIMEOUT_MS = 5_000

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

describe('P2-10③ AppShell 草稿门接线（D2）', { timeout: SHELL_RENDER_TIMEOUT_MS }, () => {
  it('关闭当前 Tab 前出现真实草稿门（[data-draft-gate]），保存后才真正关闭', async () => {
    const page = await renderShell()
    await enterApiKey(page.container, apiKeyFixture)
    const settingsKey = page.settingsKey()

    await clickTabClose(page.container, settingsKey)

    // RED（当前）：没有 draftGuard ⇒ 无任何提示，closeTab 已发出、Tab 直接关闭
    await vi.waitFor(() => expect(page.container.querySelector('[data-draft-gate]')).not.toBeNull(), { timeout: CONDITION_TIMEOUT_MS })
    expect(page.container.querySelector('[data-draft-gate]')?.getAttribute('data-draft-gate')).toBe('sensitive-draft')
    expect(page.api.tabsCommand).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'closeTab' }))
    expect(page.tabKeys()).toEqual([settingsKey])

    await clickLabel(page.container, labels.draftGateSave)
    await vi.waitFor(() => expect(page.tabKeys()).toEqual([]), { timeout: CONDITION_TIMEOUT_MS })
    expect(page.container.querySelector('[data-draft-gate]')).toBeNull()
    expect(page.api.upsert).toHaveBeenCalledTimes(1)

    await act(async () => page.root.unmount())
  })

  it('切换 Tab 不触发草稿门：草稿保留、Tab 仍开（非销毁路径）', async () => {
    const page = await renderShell({ extraTabs: ['assistants'] })
    await enterApiKey(page.container, apiKeyFixture)
    const settingsKey = page.settingsKey()
    const otherKey = page.tabKeys().find((key) => key !== settingsKey)!

    await clickTab(page.container, otherKey)

    expect(page.container.querySelector('[data-draft-gate]')).toBeNull()
    expect(page.api.commands()).toContain('activateTab')
    expect(page.tabKeys()).toEqual([otherKey, settingsKey])
    // 草稿仍在：切回 Settings 再关闭，依然必须过草稿门（切换**没有**丢草稿），取消后 Tab 仍开
    await clickTab(page.container, settingsKey)
    await clickTabClose(page.container, settingsKey)
    await vi.waitFor(() => expect(page.container.querySelector('[data-draft-gate]')).not.toBeNull(), { timeout: CONDITION_TIMEOUT_MS })
    await clickLabel(page.container, labels.draftGateCancel)
    expect(page.api.commands()).not.toContain('closeTab')
    expect(page.tabKeys()).toEqual([otherKey, settingsKey])

    await act(async () => page.root.unmount())
  })

  it('关闭其他：取消 ⇒ 零部分关闭（一条批量关闭命令都不发、所有 Tab 都还在）', async () => {
    const page = await renderShell({ extraTabs: ['assistants'] })
    await enterApiKey(page.container, apiKeyFixture)
    const settingsKey = page.settingsKey()
    const before = page.tabKeys()
    const otherKey = before.find((key) => key !== settingsKey)!

    await clickTab(page.container, otherKey)
    await chooseAction(page.container, labels.tabCloseOthers)
    await vi.waitFor(() => expect(page.container.querySelector('[data-draft-gate]')).not.toBeNull(), { timeout: CONDITION_TIMEOUT_MS })
    expect(page.api.commands()).not.toContain('closeOthers')

    await clickLabel(page.container, labels.draftGateCancel)
    expect(page.api.commands()).not.toContain('closeOthers')
    expect(page.tabKeys()).toEqual(before)
    expect(page.container.querySelector('[data-draft-gate]')).toBeNull()

    await act(async () => page.root.unmount())
  })

  it('关闭右侧：脏草稿同样过门，取消后右侧 Tab 仍在', async () => {
    const page = await renderShell({ extraTabs: ['assistants'] })
    await enterApiKey(page.container, apiKeyFixture)
    const before = page.tabKeys()
    const leftKey = before[0]!

    await clickTab(page.container, leftKey)
    await chooseAction(page.container, labels.tabCloseRight)
    await vi.waitFor(() => expect(page.container.querySelector('[data-draft-gate]')).not.toBeNull(), { timeout: CONDITION_TIMEOUT_MS })
    expect(page.api.commands()).not.toContain('closeRight')

    await clickLabel(page.container, labels.draftGateCancel)
    expect(page.api.commands()).not.toContain('closeRight')
    expect(page.tabKeys()).toEqual(before)

    await act(async () => page.root.unmount())
  })

  it('保存失败 ⇒ 保留原窗与草稿，并给出可见失败提示（绝不静默关闭）', async () => {
    const page = await renderShell({ upsertError: new Error('provider-secret-vault-write-failed') })
    await enterApiKey(page.container, apiKeyFixture)
    const settingsKey = page.settingsKey()

    await clickTabClose(page.container, settingsKey)
    await vi.waitFor(() => expect(page.container.querySelector('[data-draft-gate]')).not.toBeNull(), { timeout: CONDITION_TIMEOUT_MS })
    await clickLabel(page.container, labels.draftGateSave)

    await vi.waitFor(() => expect(page.container.textContent).toContain(labels.draftGateSaveFailed), { timeout: CONDITION_TIMEOUT_MS })
    expect(page.tabKeys()).toEqual([settingsKey])
    // 草稿仍在：再次关闭依然过门（保存失败绝不静默丢弃）
    await clickTabClose(page.container, settingsKey)
    await vi.waitFor(() => expect(page.container.querySelector('[data-draft-gate]')).not.toBeNull(), { timeout: CONDITION_TIMEOUT_MS })
    expect(page.api.commands()).not.toContain('closeTab')
    expect(page.container.textContent).not.toContain('provider-secret-vault-write-failed')

    await act(async () => page.root.unmount())
  })

  it('干净（无草稿）时静默关闭：不弹门、不保存', async () => {
    const page = await renderShell()
    const settingsKey = page.settingsKey()

    await clickTabClose(page.container, settingsKey)

    await vi.waitFor(() => expect(page.tabKeys()).toEqual([]), { timeout: CONDITION_TIMEOUT_MS })
    expect(page.container.querySelector('[data-draft-gate]')).toBeNull()
    expect(page.api.upsert).not.toHaveBeenCalled()

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

function installPlatform(options: { upsertError?: Error } = {}) {
  const tabs: TabRecord[] = []
  const commands: string[] = []
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
  // 真机等价物：Main 在 applied 命令后发布受控增量事件 ⇒ renderer 重取权威快照（绝不本地推演状态）
  const bump = (type: string) => {
    revision += 1
    for (const listener of [...listeners]) listener({ type, layoutRevision: revision, scope: {} })
  }

  const tabsCommand = vi.fn(async (raw: unknown) => {
    const request = raw as { method?: unknown; workspaceInstanceKey?: unknown; pageId?: unknown; menuKey?: unknown }
    const method = String(request.method ?? '')
    commands.push(method)
    if (method === 'openTab') {
      openTab(pageIdOf(request))
    } else if (method === 'activateTab') {
      active = String(request.workspaceInstanceKey)
    } else if (method === 'closeTab') {
      const target = tabs.find((tab) => tab.workspaceInstanceKey === request.workspaceInstanceKey)
      if (target !== undefined) target.open = false
      const next = tabs.find((tab) => tab.open)
      active = next?.workspaceInstanceKey ?? null
    } else if (method === 'closeOthers') {
      for (const tab of tabs) tab.open = tab.workspaceInstanceKey === request.workspaceInstanceKey
      active = String(request.workspaceInstanceKey)
    } else if (method === 'closeRight') {
      const anchor = tabs.find((tab) => tab.workspaceInstanceKey === request.workspaceInstanceKey)
      for (const tab of tabs) if (anchor !== undefined && tab.order > anchor.order) tab.open = false
    }
    bump(method === 'openTab' ? 'open' : method === 'activateTab' ? 'container-changed' : 'close')
    return { status: 'applied', snapshot: snapshot() }
  })

  const list = vi.fn(async () => [providerFixture])
  const upsert = vi.fn(async (_provider: ModelProviderInput) => {
    if (options.upsertError) throw options.upsertError
    return providerFixture
  })
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
      workspace: {
        tabsGetSnapshot: vi.fn(async () => ({ status: 'ok', snapshot: snapshot() })),
        tabsCommand,
        onEvent: vi.fn((listener: (event: unknown) => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        })
      },
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
  return { list, upsert, tabsCommand, commands: () => commands, openTab }
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

async function renderShell(options: { upsertError?: Error; extraTabs?: readonly string[] } = {}) {
  const api = installPlatform(options)
  for (const pageId of options.extraTabs ?? []) api.openTab(pageId)
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(createElement(AppShell))
    await Promise.resolve()
  })
  await clickButton(container, 'Settings')
  await clickButton(container, 'Model Service')
  await vi.waitFor(() => expect(apiKeyInput(container)).toBeTruthy(), { timeout: CONDITION_TIMEOUT_MS })
  return {
    api, container, root,
    tabKeys: () => Array.from(container.querySelectorAll<HTMLElement>('[data-tab-item]'))
      .map((node) => node.getAttribute('data-tab-item') ?? ''),
    settingsKey: () => Array.from(container.querySelectorAll<HTMLElement>('[data-tab-item]'))
      .find((node) => node.querySelector('[data-page-id="settings"]') !== null)?.getAttribute('data-tab-item') ?? ''
  }
}

/* ────────────────────────── DOM helpers（无 RTL） ────────────────────────── */

async function click(element: Element | null | undefined): Promise<void> {
  if (element === null || element === undefined) throw new Error('expected an element to click')
  await act(async () => { (element as HTMLElement).click() })
}

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

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  await click(button ?? null)
}

/** 三态提示里的动作按钮（保存/丢弃/取消），按可见文案点击。 */
async function clickLabel(container: HTMLElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label)
  await click(button ?? null)
}

async function clickTab(container: HTMLElement, workspaceInstanceKey: string): Promise<void> {
  await click(container.querySelector(`[data-tab-key="${workspaceInstanceKey}"]`))
}

async function clickTabClose(container: HTMLElement, workspaceInstanceKey: string): Promise<void> {
  await click(container.querySelector(`[data-tab-item="${workspaceInstanceKey}"] .workspace-tab-close`))
}

function menuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

async function chooseAction(container: HTMLElement, label: string): Promise<void> {
  if (menuItems(container).length === 0) await click(container.querySelector<HTMLElement>('[data-tab-strip-actions]'))
  await click(menuItems(container).find((node) => node.textContent === label) ?? null)
}
