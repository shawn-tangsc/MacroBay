import { describe, expect, it } from 'vitest'

import type { WorkspacePageRegistration } from '../contracts'
import { createWorkspacePageRegistry } from '../registry/workspacePageRegistry'
import { createWorkspaceTabStore } from './workspaceTabStore'

/**
 * Owner: platform/workspace/runtime（PLAT-04 focused）。权威：技术设计 §7 Storage Plan / §5.4 与清单 PLAT-04。
 *
 * 缺陷（修复前，代码可证）：`WorkspaceTabLayoutRecord` 有 `detachedBounds`，但 `TabRecord` 没有该字段 ⇒
 * `_restoreTabs` 收到即丢、`exportLayoutTabs` 永不输出 ⇒ 运行期**没有任何受控状态**承载页窗尺寸。
 *
 * 本文件的判据（全部只读受控 API，不碰窗口/Electron）：
 *  1) Main 侧权威观察（`_observeDetachedBounds`）把页窗 bounds 记进受控状态，并能被单写出口导出；
 *  2) 身份不匹配（未知窗口 / 陈旧 epoch / 非 detached）与畸形 bounds 一律 fail closed：不写、不抬 revision；
 *  3) 同值重复观察不抬 revision（拖拽静止绝不形成写风暴）；
 *  4) `_restoreTabs` 保留文档里的 bounds（降级为 main 也不丢用户尺寸），export → restore → export 逐字一致；
 *  5) 回停靠后再分离仍保留上次 bounds（用户尺寸是布局数据，不属于容器身份）。
 */

const BOUNDS = { x: 120, y: 80, width: 1280, height: 800 }

function registration(pageId: string, overrides: Partial<WorkspacePageRegistration> = {}): WorkspacePageRegistration {
  const [productId] = pageId.split('.')
  return {
    pageId,
    menuKey: `/${pageId.split('.').join('/')}`,
    title: { 'zh-CN': pageId, 'en-US': pageId },
    icon: 'home',
    module: pageId,
    productId,
    supportsDetached: true,
    allowMultipleInstances: false,
    binding: { persistence: 'none', maxKeyBytes: 256 },
    ...overrides
  }
}

function createStore(pages: readonly WorkspacePageRegistration[] = [registration('sample.alpha')]) {
  let sequence = 0
  const registry = createWorkspacePageRegistry({
    moduleIds: pages.map((page) => page.module),
    productIds: [...new Set(pages.flatMap((page) => (page.productId === undefined ? [] : [page.productId])))]
  })
  pages.forEach((page) => registry.register(page))
  registry.seal()
  const store = createWorkspaceTabStore({
    pageRegistry: registry,
    createOpaqueId: (prefix = 'id') => `${prefix}-${++sequence}`
  })
  return { store, rev: () => store.getSnapshot().layoutRevision }
}

/** 打开一个 Tab 并真实分离，返回该 Tab 当前的容器身份（store 权威）。 */
async function detachedTab() {
  const { store, rev } = createStore()
  const opened = await store.openTab({ requestId: 'open', hostEpoch: 1, expectedRevision: rev(), pageId: 'sample.alpha' })
  if (opened.workspaceInstanceKey === undefined) throw new Error('openTab failed')
  const workspaceInstanceKey = opened.workspaceInstanceKey
  const detached = await store.detachTab({
    requestId: 'detach', hostEpoch: 1, expectedRevision: rev(), workspaceInstanceKey
  })
  expect(detached.status).toBe('applied')
  const tab = store.getSnapshot().tabs.find((entry) => entry.workspaceInstanceKey === workspaceInstanceKey)
  if (tab === undefined) throw new Error('tab missing')
  return {
    store, rev, workspaceInstanceKey,
    identity: { windowInstanceId: tab.windowInstanceId, hostEpoch: tab.hostEpoch },
    revisionAfterDetach: store.getSnapshot().layoutRevision
  }
}

describe('PLAT-04 Tab detachedBounds：受控采集 → 单写导出', () => {
  it('①（当前：字段缺失）Main 侧观察到的 bounds 进入受控状态，并出现在 exportLayoutTabs 载荷里', async () => {
    const harness = await detachedTab()
    const before = harness.store.getSnapshot().layoutRevision

    const observed = harness.store._observeDetachedBounds({ ...harness.identity, bounds: BOUNDS })

    expect(observed.status).toBe('applied')
    expect(observed.workspaceInstanceKey).toBe(harness.workspaceInstanceKey)
    expect(harness.store.getSnapshot().layoutRevision).toBe(before + 1)
    expect(harness.store.detachedBoundsOf(harness.workspaceInstanceKey)).toEqual(BOUNDS)
    expect(harness.store.exportLayoutTabs().tabs.find((tab) => tab.workspaceInstanceKey === harness.workspaceInstanceKey)?.detachedBounds)
      .toEqual(BOUNDS)
  })

  it('身份不匹配 / 畸形 bounds 一律 fail closed：不写、不抬 revision', async () => {
    const harness = await detachedTab()
    const before = harness.store.getSnapshot().layoutRevision

    const rejected = [
      harness.store._observeDetachedBounds({ windowInstanceId: 'window-unknown', hostEpoch: harness.identity.hostEpoch, bounds: BOUNDS }),
      harness.store._observeDetachedBounds({ windowInstanceId: harness.identity.windowInstanceId, hostEpoch: harness.identity.hostEpoch + 9, bounds: BOUNDS }),
      harness.store._observeDetachedBounds({ ...harness.identity, bounds: { ...BOUNDS, x: Number.NaN } }),
      harness.store._observeDetachedBounds({ ...harness.identity, bounds: { ...BOUNDS, y: Number.POSITIVE_INFINITY } }),
      harness.store._observeDetachedBounds({ ...harness.identity, bounds: { ...BOUNDS, width: -1 } }),
      harness.store._observeDetachedBounds({ ...harness.identity, bounds: { ...BOUNDS, height: 0 } })
    ]

    expect(rejected.map((entry) => entry.status)).toEqual(['ignored', 'ignored', 'ignored', 'ignored', 'ignored', 'ignored'])
    expect(harness.store.getSnapshot().layoutRevision).toBe(before)
    expect(harness.store.detachedBoundsOf(harness.workspaceInstanceKey)).toBeUndefined()
    expect(harness.store.exportLayoutTabs().tabs.every((tab) => tab.detachedBounds === undefined)).toBe(true)
  })

  it('同值重复观察不抬 revision（拖拽静止绝不形成写风暴）；不同值才推进一次', async () => {
    const harness = await detachedTab()
    const first = harness.store._observeDetachedBounds({ ...harness.identity, bounds: BOUNDS })
    const revisionAfterFirst = harness.store.getSnapshot().layoutRevision
    const again = harness.store._observeDetachedBounds({ ...harness.identity, bounds: { ...BOUNDS } })

    expect([first.status, again.status]).toEqual(['applied', 'ignored'])
    expect(harness.store.getSnapshot().layoutRevision).toBe(revisionAfterFirst)

    const moved = harness.store._observeDetachedBounds({ ...harness.identity, bounds: { ...BOUNDS, x: 200 } })
    expect(moved.status).toBe('applied')
    expect(harness.store.getSnapshot().layoutRevision).toBe(revisionAfterFirst + 1)
  })

  it('非页窗身份（面板窗 / 主窗哨兵 / 已回停靠的 Tab）一律 ignored ⇒ 面板链 bounds 语义零触碰', async () => {
    const harness = await detachedTab()
    // 面板窗的身份也由同一注册表签发：它可能（在采集端口接线后）产生 bounds 广播，
    // 但页窗采集入口只认「正 detached 的 Tab」⇒ 面板尺寸绝不会被这里改写（P1 面板链零触碰）。
    const foreign = [
      harness.store._observeDetachedBounds({ windowInstanceId: 'detached-panel-1', hostEpoch: 2, bounds: BOUNDS }),
      harness.store._observeDetachedBounds({ windowInstanceId: 'main', hostEpoch: 1, bounds: BOUNDS })
    ]
    expect(foreign.map((entry) => entry.status)).toEqual(['ignored', 'ignored'])

    // 已回停靠：容器身份不再是页窗 ⇒ 迟到广播绝不复活尺寸记录（也绝不重开/改容器）
    const redocked = await harness.store.redockTab({
      requestId: 'redock', hostEpoch: 1, expectedRevision: harness.rev(), windowInstanceId: 'main',
      workspaceInstanceKey: harness.workspaceInstanceKey
    })
    expect(redocked.status).toBe('applied')
    const late = harness.store._observeDetachedBounds({ ...harness.identity, bounds: BOUNDS })
    expect(late.status).toBe('ignored')
    expect(late.reason).toBe('unknown-identity')
    expect(harness.store.detachedBoundsOf(harness.workspaceInstanceKey)).toBeUndefined()
    expect(harness.store.getSnapshot().tabs[0]?.mode).toBe('main')
  })

  it('Main 侧观察是内部权威路径：绝不需要 renderer 上报，也不新增通道/preload 方法', async () => {
    const harness = await detachedTab()
    // 观察入口只接受（窗口身份, bounds）：没有 method/requestId/expectedRevision ⇒ 它不是 renderer 命令
    expect(harness.store._observeDetachedBounds.length).toBe(1)
    harness.store._observeDetachedBounds({ ...harness.identity, bounds: BOUNDS })
    expect(harness.store.exportLayoutTabs().tabs).toHaveLength(1)
  })
})

describe('PLAT-04 Tab detachedBounds：恢复保留与往返一致', () => {
  it('_restoreTabs 保留文档里的 bounds（降级为 main 也不丢用户尺寸）', async () => {
    const { store, rev } = createStore()
    const applied = await store._restoreTabs({
      requestId: 'restore', hostEpoch: 1, expectedRevision: rev(),
      tabs: [{
        workspaceInstanceKey: 'workspace_restored', pageId: 'sample.alpha', open: true, order: 0, mode: 'main',
        detachedBounds: BOUNDS
      }],
      activeWorkspaceInstanceKey: 'workspace_restored'
    })
    expect(applied.status).toBe('applied')
    expect(store.detachedBoundsOf('workspace_restored')).toEqual(BOUNDS)
    expect(store.exportLayoutTabs().tabs[0]).toMatchObject({
      workspaceInstanceKey: 'workspace_restored', mode: 'main', detachedBounds: BOUNDS
    })
  })

  it('畸形 bounds 在恢复路径上也 fail closed（只丢尺寸，Tab 本身照常恢复）', async () => {
    const { store, rev } = createStore()
    const applied = await store._restoreTabs({
      requestId: 'restore', hostEpoch: 1, expectedRevision: rev(),
      tabs: [{
        workspaceInstanceKey: 'workspace_restored', pageId: 'sample.alpha', open: true, order: 0, mode: 'main',
        // 纵深防御：绕过文档校验直接注入畸形值
        detachedBounds: { x: Number.NaN, y: 0, width: 1280, height: 800 }
      }],
      activeWorkspaceInstanceKey: 'workspace_restored'
    })
    expect(applied.status).toBe('applied')
    expect(applied.restoredTabs).toBe(1)
    expect(store.detachedBoundsOf('workspace_restored')).toBeUndefined()
  })

  it('export → _restoreTabs → export 逐字一致（单写往返不丢尺寸、不重编号）', async () => {
    const source = await detachedTab()
    source.store._observeDetachedBounds({ ...source.identity, bounds: BOUNDS })
    const exported = source.store.exportLayoutTabs()

    const target = createStore()
    const applied = await target.store._restoreTabs({
      requestId: 'restore', hostEpoch: 1, expectedRevision: target.rev(),
      tabs: exported.tabs, activeWorkspaceInstanceKey: source.workspaceInstanceKey
    })
    expect(applied.status).toBe('applied')
    expect(target.store.exportLayoutTabs().tabs).toEqual(exported.tabs)
  })

  it('回停靠后再分离仍保留上次 bounds（尺寸随 Tab 逻辑实例，不随容器身份）', async () => {
    const harness = await detachedTab()
    harness.store._observeDetachedBounds({ ...harness.identity, bounds: BOUNDS })
    const redocked = await harness.store.redockTab({
      requestId: 'redock', hostEpoch: 1, expectedRevision: harness.rev(), windowInstanceId: 'main',
      workspaceInstanceKey: harness.workspaceInstanceKey
    })
    expect(redocked.status).toBe('applied')
    expect(harness.store.detachedBoundsOf(harness.workspaceInstanceKey)).toEqual(BOUNDS)

    const again = await harness.store.detachTab({
      requestId: 'detach-again', hostEpoch: 1, expectedRevision: harness.rev(),
      workspaceInstanceKey: harness.workspaceInstanceKey
    })
    expect(again.status).toBe('applied')
    expect(harness.store.detachedBoundsOf(harness.workspaceInstanceKey)).toEqual(BOUNDS)
  })

  it('显式关闭的 Tab 不因 bounds 采集而重开（关闭仍只落盘 open=false）', async () => {
    const harness = await detachedTab()
    harness.store._observeDetachedBounds({ ...harness.identity, bounds: BOUNDS })
    const closed = await harness.store.closeTab({
      requestId: 'close', hostEpoch: 1, expectedRevision: harness.rev(),
      workspaceInstanceKey: harness.workspaceInstanceKey
    })
    expect(closed.status).toBe('applied')
    expect(harness.store.recentlyClosed()).toHaveLength(1)
    expect(harness.store.exportLayoutTabs().tabs[0]).toMatchObject({ open: false, detachedBounds: BOUNDS })
  })
})
