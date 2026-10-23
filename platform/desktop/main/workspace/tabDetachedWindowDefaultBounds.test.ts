import { describe, expect, it } from 'vitest'

import type { WorkspaceBounds } from '@platform/workspace/contracts'
import { WorkspaceDetachedWindowPolicy, WorkspaceRegistrationPolicy } from '@platform/workspace/policies'
import { createSecureWindowSecurity } from '../../window/createMainWindow'
import {
  createPanelDetachedWindowHost,
  type DetachedWindowFactory,
  type DetachedWindowHandle
} from './panelDetachedWindowHost'
import { createTabDetachedWindowHost } from './tabDetachedWindowHost'
import type { WorkspaceDisplayInfo } from './workspaceWindowBounds'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（P2-14 focused）。
 * 权威：技术设计 §4「窗口安置策略」、P2-14 真机缺陷「新开的独立页面窗默认太小」。
 *
 * 缺陷（修复前，代码可证）：`tabDetachedWindowHost.toPanelRequest` 把面板注册表的
 * `WorkspaceRegistrationPolicy.preferredSize`（480×360）当成**页面窗**的默认尺寸，于是「独立页面窗」
 * 只有面板那么大 —— 真机上用户看到的就是这个 480×360。
 *
 * 本文件用**真 registry + 真共享宿主 + 真 tabDetachedWindowHost**，只把窗口工厂与定时器换成注入 fake
 * （不启动 Electron），断言的是**最终下发给窗口工厂的 bounds**（真机上 BrowserWindow 的 width/height），
 * 因此不依赖任何内部实现细节：
 *  1) 新开页面窗的默认尺寸 ≥ 页面窗策略下界，且**不得**等于面板注册尺寸；
 *  2) 有源区域信息时按 `sourceAreaScale` 放大，且不超工作区占比/边距上界；
 *  3) 用户已持久化的 bounds **优先**，策略绝不覆盖用户调整过的尺寸；
 *  4) 极小工作区时工作区是硬上界，绝不产生超出工作区的窗口。
 */

const PRELOAD = '/app/preload/index.js'
const APP_ROOT = 'file:///app/renderer'
const ENTRY = 'file:///app/renderer/index.html'
const TAB_WINDOW = { windowInstanceId: 'detached-tab-1', hostEpoch: 2 }
const WORKSPACE_KEY = 'ws-1'

function createHarness(options: { workArea?: WorkspaceBounds } = {}) {
  const created: WorkspaceBounds[] = []
  let webContentsId = 100
  const registry = createWorkspaceWindowRegistry()
  const displays = (): readonly WorkspaceDisplayInfo[] => [
    { id: 'primary', workArea: options.workArea ?? { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 2 }
  ]
  const createWindow: DetachedWindowFactory = (input) => {
    created.push({ ...input.bounds })
    const handle: DetachedWindowHandle = {
      webContentsId: ++webContentsId,
      loadURL: () => Promise.resolve(),
      isDestroyed: () => false,
      destroy: () => undefined,
      focus: () => undefined,
      setWindowOpenHandler: () => undefined,
      isCrashed: () => false
    }
    return handle
  }
  const host = createPanelDetachedWindowHost({
    entryUrl: ENTRY,
    appRoot: APP_ROOT,
    createWindow,
    security: createSecureWindowSecurity({ preload: PRELOAD, openExternal: () => undefined }),
    registry,
    displays,
    timers: { schedule: () => () => undefined }
  })
  const tabHost = createTabDetachedWindowHost({ host, registry })
  // 源宿主必须是 registry 认得的 main 身份（`host.requestDetach` 会 `assertOwner`）；身份由 registry 签发
  const main = registry.registerMainWindow({ webContentsId: 1 })
  return { registry, host, tabHost, created, main }
}

/** 采纳一条页面窗身份后发起真实分离事务，返回下发给窗口工厂的 bounds。 */
async function detachPageWindow(input: {
  workArea?: WorkspaceBounds
  sourceAreaSize?: { width: number; height: number }
  savedBounds?: WorkspaceBounds
} = {}): Promise<{ bounds: WorkspaceBounds; status: string }> {
  const harness = createHarness(input.workArea === undefined ? {} : { workArea: input.workArea })
  const reserved = harness.registry.reserveDetachedTabWindow({
    windowInstanceId: TAB_WINDOW.windowInstanceId, hostEpoch: TAB_WINDOW.hostEpoch, workspaceInstanceKey: WORKSPACE_KEY
  })
  expect(reserved.status).toBe('reserved')
  const outcome = await harness.tabHost.requestTabDetach({
    operationId: 'op-1',
    workspaceInstanceKey: WORKSPACE_KEY,
    pageId: 'market.chart',
    menuKey: '/market/chart',
    title: 'Chart',
    sourceHost: { windowInstanceId: harness.main.windowInstanceId, hostEpoch: harness.main.hostEpoch },
    ...TAB_WINDOW,
    ...(input.sourceAreaSize === undefined ? {} : { sourceAreaSize: input.sourceAreaSize }),
    ...(input.savedBounds === undefined ? {} : { savedBounds: input.savedBounds })
  })
  expect(outcome.status).toBe('awaiting-ready')
  expect(harness.created).toHaveLength(1)
  return { bounds: harness.created[0] as WorkspaceBounds, status: outcome.status }
}

describe('P2-14：独立页面窗默认 bounds（页面窗策略）', () => {
  it('新开页面窗的默认尺寸不得小于策略下界，也不得等于面板注册尺寸', async () => {
    const { bounds } = await detachPageWindow()
    expect(bounds.width).toBeGreaterThanOrEqual(WorkspaceDetachedWindowPolicy.minSize.width)
    expect(bounds.height).toBeGreaterThanOrEqual(WorkspaceDetachedWindowPolicy.minSize.height)
    // 缺陷回归门：页面窗绝不沿用面板注册表 preferredSize（480×360），那正是真机上「太小」的尺寸
    expect({ width: bounds.width, height: bounds.height })
      .not.toEqual({ width: WorkspaceRegistrationPolicy.preferredSize.width, height: WorkspaceRegistrationPolicy.preferredSize.height })
  })

  it('有源区域信息时按源区域 × sourceAreaScale 放大，并受工作区占比与边距夹紧', async () => {
    const sourceAreaSize = { width: 1200, height: 700 }
    const { bounds } = await detachPageWindow({ sourceAreaSize })
    const scaled = {
      width: Math.round(sourceAreaSize.width * WorkspaceDetachedWindowPolicy.sourceAreaScale),
      height: Math.round(sourceAreaSize.height * WorkspaceDetachedWindowPolicy.sourceAreaScale)
    }
    // 1920×1040 工作区：0.80 占比 = 1536×832，边距 8 ⇒ 上界 1536×832（1320×770 不触界）；放大结果必须**真的**跟着源区域走
    expect({ width: bounds.width, height: bounds.height }).toEqual(scaled)
    expect(bounds.width).toBeGreaterThan(sourceAreaSize.width)
  })

  /**
   * PLAT-06（真机观感调参）：默认尺寸**调小一档** —— `sourceAreaScale 1.25→1.10`、`maxWorkAreaRatio 0.9→0.80`。
   * 判据只钉「策略取值」与「占比上界可判别」，**不放宽**下界（`minSize` 960×600）与兜底尺寸（1280×800），
   * 也不放宽下一条「用户已持久化 bounds 优先」的判据。
   */
  it('PLAT-06：策略取值调小一档（1.10 / 0.80），下界 960×600 与兜底 1280×800 逐字不变', () => {
    expect(WorkspaceDetachedWindowPolicy.sourceAreaScale).toBe(1.1)
    expect(WorkspaceDetachedWindowPolicy.maxWorkAreaRatio).toBe(0.8)
    expect(WorkspaceDetachedWindowPolicy.minSize).toEqual({ width: 960, height: 600 })
    expect(WorkspaceDetachedWindowPolicy.defaultSize).toEqual({ width: 1280, height: 800 })
  })

  it('PLAT-06：占比上界随调参收紧且可判别（0.80 ⇒ 960×640；旧值 0.9 ⇒ 1080×720）', async () => {
    const workArea = { x: 0, y: 0, width: 1200, height: 800 }
    const { bounds } = await detachPageWindow({ workArea, sourceAreaSize: { width: 1200, height: 700 } })
    // 候选 = 1200×700 × 1.10 = 1320×770；上界 = min(工作区 × 0.80, 工作区 − 2×8) = 960×640（边距界 1184×784 不生效）
    expect(bounds).toEqual({ x: 120, y: 80, width: 960, height: 640 })
    // 下界未被放宽：占比界仍不得小于 minSize
    expect(bounds.width).toBeGreaterThanOrEqual(WorkspaceDetachedWindowPolicy.minSize.width)
    expect(bounds.height).toBeGreaterThanOrEqual(WorkspaceDetachedWindowPolicy.minSize.height)
  })

  it('用户已持久化的 bounds 优先：策略绝不覆盖用户调整过的尺寸', async () => {
    const savedBounds = { x: 120, y: 80, width: 1100, height: 720 }
    const { bounds } = await detachPageWindow({ savedBounds })
    expect(bounds).toEqual(savedBounds)
  })

  it('极小工作区时工作区是硬上界，绝不产生超出工作区的窗口', async () => {
    const workArea = { x: 0, y: 0, width: 800, height: 500 }
    const { bounds } = await detachPageWindow({ workArea })
    expect(bounds.width).toBeLessThanOrEqual(workArea.width)
    expect(bounds.height).toBeLessThanOrEqual(workArea.height)
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x)
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y)
  })
})
