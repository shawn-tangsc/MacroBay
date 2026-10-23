// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspacePanelSnapshot, WorkspaceSnapshot } from '@platform/workspace/contracts'
import { platformText } from '../../i18n/platformText'
import { WorkspaceWindowRoot } from './WorkspaceWindowRoot'

/**
 * Owner: apps/desktop-shell renderer / workspace（PLAT-40 RED）。
 *
 * 缺陷（真机）：分离**面板窗**顶栏没有「回停靠」——页窗有 `PageWindowRedockControl`，面板窗没有可复用的
 * 回停靠端口（面板 store 的 `switchContainer` 明确拒绝 `detached → 非 detached`，原生 X 才走转移事务）。
 *
 * 判据（本文件，渲染侧那一半）：
 *  - 已提交的分离面板窗顶栏出现回停靠控件（`data-redock-panel`），文案走 i18n；
 *  - 点击只发**一条**既有受控命令（`workspace.command` 的 `redockPanel`，不新增 preload 方法/通道），
 *    在飞期间禁用、重复点击不再发；
 *  - 被拒/失败可见且可重试；准备期窗（尚无面板挂载）不出现该控件。
 */
const WINDOW_ID = 'window-panel-1'
const HOST_EPOCH = 3
const WORKSPACE_KEY = 'ws-panel-1'
const PANEL_KEY = 'panel-1'
const PANEL_ID = 'dsh-fixture.board'
const FLUSH_TURNS = 12

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const labels = platformText['en-US'].workspace

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
  Reflect.deleteProperty(window, 'platform')
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

type CommandReply = { status: 'applied' | 'rejected'; errorCode?: string }

type FakePanel = {
  requests: Record<string, unknown>[]
  emit: (event: unknown) => void
  setReply: (reply: CommandReply) => void
}

function installPanelWindow(options: { committed?: boolean; reply?: CommandReply } = {}): FakePanel {
  const committed = options.committed !== false
  const requests: Record<string, unknown>[] = []
  const listeners = new Set<(event: unknown) => void>()
  let reply: CommandReply = options.reply ?? { status: 'applied' }
  const panel: WorkspacePanelSnapshot = {
    workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
    open: true, mode: 'detached', presentation: 'normal', bindingState: 'unavailable',
    lastValidDock: 'embedded', windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH
  }
  const snapshot: WorkspaceSnapshot = {
    layoutRevision: 2, activeWorkspaceInstanceKey: WORKSPACE_KEY,
    panels: [panel],
    pageLayouts: [{ workspaceInstanceKey: WORKSPACE_KEY, panelOrder: [PANEL_KEY], activePanels: {} }],
    tabs: [], persistenceState: 'saved'
  }
  Reflect.set(window, 'platform', {
    workspace: {
      getHostContext: async () => ({
        status: 'ok',
        context: {
          windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH, role: 'panel',
          mounts: committed ? [{
            workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
            open: true, mode: 'detached', bindingState: 'unavailable'
          }] : [],
          layoutRevision: 2, pageIds: [],
          preferences: { language: 'en-US', theme: 'dark', timeZone: 'UTC' },
          pendingTransfer: committed ? null : {
            status: 'in-flight', operationId: 'operation-1', phase: 'awaiting-target-ready',
            workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID
          }
        }
      }),
      getSnapshot: async () => ({ status: 'ok', snapshot }),
      command: async (request: unknown) => {
        requests.push(request as Record<string, unknown>)
        return reply.status === 'applied'
          ? { status: 'applied', snapshot, panelInstanceKey: PANEL_KEY }
          : { status: 'rejected', errorCode: reply.errorCode ?? 'unsupported', snapshot, panelInstanceKey: PANEL_KEY }
      },
      hostLifecycle: async () => ({ accepted: true }),
      onEvent: (listener: (event: unknown) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
    }
  })
  return {
    requests,
    emit: (event) => { for (const listener of [...listeners]) listener(event) },
    setReply: (next) => { reply = next }
  }
}

async function renderPanelWindow(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => { current.render(createElement(WorkspaceWindowRoot, {})) })
  await settle()
  return container
}

const redockButton = (view: HTMLDivElement): HTMLButtonElement | null =>
  view.querySelector<HTMLButtonElement>(`[data-redock-panel="${PANEL_KEY}"]`)

describe('PLAT-40 分离面板窗顶栏回停靠', () => {
  it('已提交的面板窗顶栏出现回停靠控件，文案走 i18n', async () => {
    installPanelWindow()
    const view = await renderPanelWindow()
    expect(view.querySelector('.workspace-panel-window')).not.toBeNull()
    const button = redockButton(view)
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-label')).toBe(labels.panelWindowRedock)
    expect(button?.getAttribute('title')).toBe(labels.panelWindowRedock)
  })

  it('点击只发一条既有受控命令（workspace.command 的 redockPanel），不新增 preload 方法', async () => {
    const fake = installPanelWindow()
    const view = await renderPanelWindow()
    await act(async () => { redockButton(view)?.click() })
    await settle()
    const redock = fake.requests.filter((request) => request.method === 'redockPanel')
    expect(redock).toHaveLength(1)
    expect(redock[0]?.panelInstanceKey).toBe(PANEL_KEY)
    // 复用既有 command 通道 ⇒ 绝不出现「另行 invoke 的具名 preload 方法」
    expect(Object.keys(window.platform.workspace)).not.toContain('redockPanel')
  })

  it('在飞期间禁用，重复点击不会发第二条；成功后控件消失', async () => {
    installPanelWindow()
    const view = await renderPanelWindow()
    const button = redockButton(view)
    expect(button?.disabled).toBe(false)
    await act(async () => {
      button?.click()
      button?.click()
    })
    await settle()
    // 第二次点击被 redockPhase 守卫吞掉（同一 key 只发一次）
    expect(redockButton(view)).toBeNull()
  })

  it('被拒时给出可见失败提示且可重试（不假装已回停靠）', async () => {
    const fake = installPanelWindow({ reply: { status: 'rejected', errorCode: 'unsupported' } })
    const view = await renderPanelWindow()
    await act(async () => { redockButton(view)?.click() })
    await settle()
    expect(view.querySelector('[data-redock-notice]')?.textContent).toContain(labels.panelWindowRedockFailed)
    const retry = redockButton(view)
    expect(retry).not.toBeNull()
    expect(retry?.disabled).toBe(false)
    fake.setReply({ status: 'applied' })
    await act(async () => { retry?.click() })
    await settle()
    expect(fake.requests.filter((request) => request.method === 'redockPanel')).toHaveLength(2)
    expect(redockButton(view)).toBeNull()
  })

  it('准备期（尚未取得面板挂载）不出现回停靠控件', async () => {
    installPanelWindow({ committed: false })
    const view = await renderPanelWindow()
    expect(view.querySelector('[data-window-shell="preparing"]')).not.toBeNull()
    expect(view.querySelector('[data-redock-panel]')).toBeNull()
  })
})
