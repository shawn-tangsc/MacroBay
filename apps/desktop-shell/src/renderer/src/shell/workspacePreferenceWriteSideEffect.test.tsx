// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings, type AppSettings } from '@platform/settings/schema/appSettings'
import { platformText } from '@renderer/i18n/platformText'
import { AppShell } from './AppShell'

/**
 * Owner: apps/desktop-shell renderer / shell（**PLAT-36**：S1 残留清理）。
 *
 * 权威：本文与 `workspace/workspaceWindowPreferenceFollow.test.tsx` 的文件尾护栏、以及
 * `platform/desktop/main/workspace/workspacePreferenceNotificationSeam.test.ts`（Main 侧显式通知）共同取证。
 *
 * 缺陷（PLAT-32/S1 之后仍残留）：偏好写入成功后，`AppShell` 仍**单飞调用一次** `workspace.getHostContext()`
 * 去触发 Main 侧的偏好对账。S1 已把对账点改为 `settingsUpdate` 成功路径里的**显式通知**
 * （`app.ts`：`panelWorkspaceForDisposal?.notifyPreferencesChanged()`），受控读取**不再带副作用** ⇒
 * 残留调用只是一次无产出的额外 IPC（每次语言/主题切换 +1 条）。
 *
 * 本文件取证的那一半（渲染侧，不启动 Electron）：
 *  ① 语言切换（走真实 shell 的 settings.update 路径）后，`workspace.getHostContext` 的调用次数
 *     **不再增加**（= 恰好等于角色解析那一次）；
 *  ② 正向不回归：这次切换确实发生了（settings.update 被调用一次且 shell 采用返回值），
 *     所以「没有额外读取」不是「什么都没做」；
 *  ③ 跟随语义仍由 Main 的显式通知承担（见上面引用的两份取证），渲染侧不再自建第二个触发点。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const en = platformText['en-US']

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

async function settle(turns = 16): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
  })
}

type FakeShell = { calls: { getHostContext: number; settingsUpdate: number } }

/**
 * 主窗 fake preload：与真机同形（同一个 `platform.workspace` 受控面 + 既有 `platform.settings`）。
 * 计数 getter 是本文件的**有界性观测面**，不给生产代码加测试出口。
 */
function installShell(): FakeShell {
  const current: { settings: AppSettings } = { settings: { ...createDefaultAppSettings(), language: 'en-US' } }
  const calls = { getHostContext: 0, settingsUpdate: 0 }
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
      app: {
        getInfo: async () => ({ name: 'fixture-app', version: '0.0.0' }),
        getProductSummaries: async () => [],
        openExternal: async () => undefined
      },
      settings: {
        get: async () => ({ ...current.settings }),
        update: async (patch: Partial<AppSettings>) => {
          calls.settingsUpdate += 1
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
      workspace: {
        getHostContext: async () => {
          calls.getHostContext += 1
          return { status: 'ok', context: context() }
        },
        getSnapshot: async () => ({ status: 'ok', snapshot: snapshot() }),
        command: async () => ({ status: 'rejected', errorCode: 'invalid-request' }),
        onEvent: () => () => undefined
      }
    } as unknown as Window['platform']
  })
  return { calls }
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

/** 走 shell 自己的导航事件进入「基础设置」；不依赖侧栏文案，也不绕过任何生产路径。 */
async function openPreferences(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('app-shell:navigate', { detail: { navKey: 'settings', settingsPanelKey: 'preferences' } }))
  })
  await settle()
}

/** 语言 Segmented 的 radio：只点真实 DOM 控件（antd Segmented 的输入面），不调用内部函数。 */
function languageOption(host: HTMLElement, label: string): HTMLInputElement {
  const labels = [...host.querySelectorAll<HTMLElement>('.ant-segmented-item-label')]
  const item = labels.find((candidate) => candidate.textContent?.trim() === label)
  const input = item?.closest('label')?.querySelector<HTMLInputElement>('input[type="radio"]')
  if (!input) throw new Error(`Expected language option: ${label}`)
  return input
}

describe('PLAT-36：偏好写入后不再有额外的 getHostContext 调用', () => {
  it('切换语言成功后 getHostContext 调用次数不增加（对账只由 Main 的显式通知触发）', async () => {
    const fake = installShell()
    const host = await renderShell()

    // ① 角色解析恰好一次受控读取（此后不应再有任何「顺带」读取）
    const baseline = fake.calls.getHostContext
    expect(baseline).toBe(1)

    await openPreferences()
    const option = languageOption(host, en.preferences.chinese)
    await act(async () => {
      option.click()
    })
    await settle()

    // ② 正向不回归：偏好写入确实发生了（否则「没有额外读取」是空断言）
    expect(fake.calls.settingsUpdate).toBe(1)
    expect(host.textContent).toContain(en.status.saved)

    // ③ 本项判据：偏好写入后不再多出一次受控读取
    expect(fake.calls.getHostContext).toBe(baseline)
  })
})
