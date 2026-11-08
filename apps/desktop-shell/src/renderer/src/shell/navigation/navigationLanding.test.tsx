// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productSettingsEntries } from '@products/generated/shellRegistry'

import { createDefaultAgentPersistentState } from '@platform/ai/agent-platform/store/agentPersistentStore'
import { createDefaultAppSettings, type AppSettings } from '@platform/settings/schema/appSettings'

import { AppShell } from '../AppShell'
import { resolveLocalizedTitle } from './shellIconRegistry'
import { openConversation } from './openConversation'
import { findProductSettingsPanelByIntent, openProductSettingsPanelByIntent } from './openProductSettingsPanel'


/**
 * R87 的**落点**证明：两条封装都走真 `AppShell` 的监听（`applyNavigation`），断言不是
 * 「事件发出去了」，而是「壳层真的切到了那一页」——侧栏高亮的那一项、设置正文挂载的那一块、
 * 以及焦点交接落到了页内（内容挂载后才会发生）。
 *
 * 这一层能证明的到「页面/面板真的换了」为止；「那个面板里的目标控件长什么样」归面板自己的用例，
 * 真机点击归界面设计验收。**不要**把这条改成监听事件、断言 detail 的写法——那只能证明它喊了一声。
 */

function settingsLanguage(): 'zh-CN' | 'en-US' {
  return createDefaultAppSettings().language
}

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'platform')
})

async function settle(turns = 20): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
  })
}

function installShell(): void {
  const current: { settings: AppSettings } = {
    settings: { ...createDefaultAppSettings(), language: settingsLanguage() }
  }
  const context = () => ({
    windowInstanceId: 'main', hostEpoch: 1, role: 'main', mounts: [], layoutRevision: 1,
    pageIds: [], pendingTransfer: null,
    preferences: { language: current.settings.language, theme: 'dark' }
  })
  const snapshot = () => ({
    layoutRevision: 1, activeWorkspaceInstanceKey: 'workspace-main', panels: [], pageLayouts: [], tabs: [],
    persistenceState: 'saved'
  })
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      window: {
        setMinimumSize: async () => undefined,
        resetMinimumSize: async () => undefined
      },
      app: {
        getInfo: async () => ({ name: 'fixture-app', version: '0.0.0' }),
        getProductSummaries: async () => [],
        openExternal: async () => undefined,
        listExternalApps: async () => [],
        launchExternalAppWorkspace: async () => ({ status: 'launched' }),
        onQuotedToMain: () => () => undefined,
        openPath: async () => undefined,
        quoteToMainWindow: async () => undefined,
        readTextFile: async () => '',
        selectDirectory: async () => null,
        selectFiles: async () => []
      },
      settings: {
        get: async () => ({ ...current.settings }),
        update: async (patch: Partial<AppSettings>) => {
          current.settings = { ...current.settings, ...patch }
          return { ...current.settings }
        }
      },
      modelProviders: {
        list: async () => [],
        upsert: async () => null,
        remove: async () => undefined,
        setEnabled: async () => undefined,
        setDefaultChatModel: async () => undefined,
        runRuntimeChecks: async () => [],
        previewModelSync: async () => ({ models: [] }),
        applyModelSync: async () => undefined,
        addOrUpdateModel: async () => undefined,
        removeModel: async () => undefined
      },
      assistants: {
        list: async () => [],
        listTopics: async () => ({ topics: [] }),
        listTopicMessages: async () => ({ messages: [] }),
        streamAttach: async () => ({ snapshot: { topicId: '', status: 'idle', executions: [] } }),
        onStreamChunk: () => () => undefined,
        onStreamDone: () => () => undefined,
        onStreamError: () => () => undefined,
        onStreamStatusChanged: () => () => undefined
      },
      // 对话页挂载期会读这些受控能力：缺一个，真 `AgentPage` 就在 effect 里抛错（按真实 preload 形状补齐）。
      agents: {
        getState: async () => createDefaultAgentPersistentState(),
        replaceState: async () => undefined,
        getRuntimeSnapshot: async () => ({
          sessions: {}, toolApprovals: [], toolApprovalHistory: [], chunksBySessionId: {}, updatedAt: ''
        }),
        getChannelRuntimeSnapshot: async () => ({ channels: [] }),
        getModelGatewayStatus: async () => null,
        onStateChanged: () => () => undefined,
        onRuntimeStateChanged: () => () => undefined,
        onChannelRuntimeStateChanged: () => () => undefined
      },
      workspace: {
        getHostContext: async () => ({ status: 'ok', context: context() }),
        getSnapshot: async () => ({ status: 'ok', snapshot: snapshot() }),
        command: async () => ({ status: 'rejected', errorCode: 'invalid-request' }),
        onEvent: () => () => undefined
      }
    } as unknown as Window['platform']
  })
}

async function renderShell(): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  const reactRoot = createRoot(host)
  root = reactRoot
  container = host
  await act(async () => {
    reactRoot.render(createElement(AppShell))
    await Promise.resolve()
  })
  await settle()
  return host
}

function activeSettingsPanel(host: HTMLElement): string | null {
  return host.querySelector<HTMLElement>('.settings-nav-item.active')?.textContent?.trim() ?? null
}

describe('R87 landing', () => {
  it('openProductSettingsPanelByIntent switches the shell to the page the product declared, and hands focus into it', async () => {
    installShell()
    const host = await renderShell()

    // 目标由**意图**解析出来：用例不写死面板 id，壳层里也没有那张「产品 → 面板」的表。
    const panelKey = findProductSettingsPanelByIntent('resource-sources')
    expect(panelKey).toBeDefined()

    await act(async () => {
      expect(openProductSettingsPanelByIntent('resource-sources')).toBe(true)
    })
    await settle()

    // 面板真的换了（不是只把侧栏点亮）：高亮的就是那一项，名字取自注册表本身。
    const panelEntry = productSettingsEntries.find((entry) => entry.id === panelKey)
    expect(panelEntry).toBeDefined()
    expect(activeSettingsPanel(host)).toBe(
      resolveLocalizedTitle(panelEntry!.title, settingsLanguage())
    )

    // 正文真的挂到这一页上：产品面板宿主已渲染（加载中或已载入），不是只把左侧点亮。
    expect(host.querySelector('.settings-contribution-host, .contribution-loading')).not.toBeNull()

    // 焦点交接：导航后焦点不许留在地里（`body`），必须落在设置正文里。
    const main = host.querySelector('main')
    expect(main).not.toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(main!.contains(document.activeElement)).toBe(true)
  })

  it('openConversation switches the shell to the conversation page', async () => {
    installShell()
    const host = await renderShell()

    await act(async () => {
      openConversation()
    })
    await settle()

    // 离开设置页 ⇒ 设置导航不再渲染，页面正文换成对话页。
    expect(host.querySelector('.settings-nav-item.active')).toBeNull()
    expect(host.querySelector('.settings-layout')).toBeNull()
  })
})
