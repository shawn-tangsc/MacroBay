import { describe, expect, it } from 'vitest'

import type { WorkspacePanelRegistration } from '../contracts'
import { createPanelRegistry } from '../registry/panelRegistry'
import { createPanelWorkspaceStore } from './panelWorkspaceStore'

/**
 * Owner: platform/workspace/runtime（PLAT-35 RED）。
 *
 * 缺陷（真机 A-T05）：Tab 链与面板链**各自**铸造 `workspaceInstanceKey`。`openWorkspace` 永远新建一个
 * workspace 记录，renderer 又没有任何调用方把它与主窗正在显示的 Tab 页对齐 ⇒ 停靠面板所在 workspace
 * 永远不是主窗当前页 ⇒ 主窗 DOM 里没有面板帧。
 *
 * 判据（本文件）：面板 store 必须支持由 Main **采纳**一个既有键（Tab 链的 `workspaceInstanceKey`）：
 *  - 采纳后该键可被 `openPanel` 直接使用（页面 + 面板在同一 workspace 上）；
 *  - 重复采纳幂等（**不抬 revision**，否则每次重连都会把所有宿主判成 stale）；
 *  - 同一键不同 pageId ⇒ `invalid-request`（绝不把两个页面实例混成一个）；
 *  - 未注册页面 ⇒ `registration-missing`（与 `openWorkspace` 同一准入）。
 */
const PAGE_ID = 'sample.page-a'
const PANEL_ID = 'sample.inspector'
const ADOPTED_KEY = 'workspace-tab-chain-1'

function panelRegistration(): WorkspacePanelRegistration {
  return {
    panelId: PANEL_ID,
    title: { 'zh-CN': '检查器', 'en-US': 'Inspector' },
    icon: 'file-text',
    module: PANEL_ID,
    pageIds: [PAGE_ID],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
    defaultMode: 'docked-right',
    allowMultipleInstances: false,
    minSize: { width: 320, height: 240 },
    preferredSize: { width: 480, height: 360 },
    binding: { persistence: 'none', maxKeyBytes: 256 },
    lifecycleEvents: ['open', 'close']
  }
}

function storeFixture() {
  const registry = createPanelRegistry({ pageIds: [PAGE_ID], moduleIds: [PANEL_ID] })
  registry.register(panelRegistration())
  registry.seal()
  return createPanelWorkspaceStore({ panelRegistry: registry, pageIds: [PAGE_ID, 'sample.page-b'] })
}

describe('panel workspace store: PLAT-35 采纳 Tab 链的 workspace 键', () => {
  it('采纳既有键后，openPanel 落在同一 workspace，且页面布局包含该面板', async () => {
    const store = storeFixture()
    const adopted = await store.adoptWorkspace({ workspaceInstanceKey: ADOPTED_KEY, pageId: PAGE_ID })
    expect(adopted.status).toBe('applied')
    expect(adopted.workspaceInstanceKey).toBe(ADOPTED_KEY)

    const opened = await store.openPanel({
      requestId: 'open-panel', expectedRevision: adopted.snapshot.layoutRevision,
      hostEpoch: adopted.hostEpoch, workspaceInstanceKey: ADOPTED_KEY, panelId: PANEL_ID
    })
    expect(opened.status).toBe('applied')
    const snapshot = store.getSnapshot()
    const layout = snapshot.pageLayouts.find((entry) => entry.workspaceInstanceKey === ADOPTED_KEY)
    expect(layout?.panelOrder).toEqual([opened.panelInstanceKey])
    expect(layout?.activePanels['docked-right']).toBe(opened.panelInstanceKey)
    // 面板链的活动 workspace 也是该键（面板窗按它取宿主页面）
    expect(snapshot.activeWorkspaceInstanceKey).toBe(ADOPTED_KEY)
  })

  it('幂等采纳：同键同页不抬 revision，也不产生第二条 workspace 记录', async () => {
    const store = storeFixture()
    const first = await store.adoptWorkspace({ workspaceInstanceKey: ADOPTED_KEY, pageId: PAGE_ID })
    const revisionAfterFirst = first.snapshot.layoutRevision
    const second = await store.adoptWorkspace({ workspaceInstanceKey: ADOPTED_KEY, pageId: PAGE_ID })
    expect(second.status).toBe('applied')
    expect(second.snapshot.layoutRevision).toBe(revisionAfterFirst)
    expect(second.snapshot.pageLayouts).toHaveLength(1)
  })

  it('同键不同页 ⇒ invalid-request，且为零触碰（revision 不变）', async () => {
    const store = storeFixture()
    const first = await store.adoptWorkspace({ workspaceInstanceKey: ADOPTED_KEY, pageId: PAGE_ID })
    const revision = first.snapshot.layoutRevision
    const mismatched = await store.adoptWorkspace({ workspaceInstanceKey: ADOPTED_KEY, pageId: 'sample.page-b' })
    expect(mismatched.status).toBe('rejected')
    expect(mismatched.errorCode).toBe('invalid-request')
    expect(store.getSnapshot().layoutRevision).toBe(revision)
  })

  it('未注册页面 ⇒ registration-missing（与 openWorkspace 同一准入）', async () => {
    const store = storeFixture()
    const rejected = await store.adoptWorkspace({ workspaceInstanceKey: ADOPTED_KEY, pageId: 'not-registered' })
    expect(rejected.status).toBe('rejected')
    expect(rejected.errorCode).toBe('registration-missing')
    expect(store.getSnapshot().pageLayouts).toHaveLength(0)
  })
})
