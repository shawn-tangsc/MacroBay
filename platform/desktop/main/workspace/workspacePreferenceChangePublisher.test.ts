import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceEvent } from '@platform/workspace/contracts'
import {
  createWorkspacePreferenceChangePublisher,
  listPanelWindowTargets,
  type WorkspacePreferencePanelView
} from './workspacePreferenceChangePublisher'
import { createWorkspaceEventRouter } from './workspaceEventRouter'
import { createWorkspaceWindowRegistry, type WorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-30** focused）。回归：本文件。
 *
 * 结构判据（PLAT-30①）：偏好 producer 抽到独立模块后，`workspaceEventRouter.ts` 与
 * `composePanelWorkspace.ts` 都必须回到 500 行以下（抽取前 532 / 560）。
 *
 * 行为判据（PLAT-30②）：抽取**不得**改变任何偏好转发语义 —— 词汇仍是既有 `snapshot`、
 * 「先记录后转发 ⇒ 一次真实切换恰一次」、被拒/未登记的读取不参与对账、页窗用 Tab 的真实 revision、
 * 面板窗的 revision 有意缺省（由 router 注入的面板 store 值）、每个受众恰一条作用域、错误隔离不中断投递。
 */

const ROUTER_FILE = new URL('./workspaceEventRouter.ts', import.meta.url)
const COMPOSE_FILE = new URL('./composePanelWorkspace.ts', import.meta.url)
const PUBLISHER_FILE = new URL('./workspacePreferenceChangePublisher.ts', import.meta.url)
const MAX_LINES = 500

function lineCount(file: URL): number {
  return readFileSync(file, 'utf8').split('\n').length
}

type PublishedPreferenceEvent = {
  type: WorkspaceEvent['type']
  scope?: { workspaceInstanceKey?: string; panelInstanceKey?: string }
  layoutRevision?: number
}

function createPreferenceHarness(options: {
  pageWindows?: readonly { workspaceInstanceKey: string | null; webContentsId: number | null }[]
  panelWindows?: readonly { workspaceInstanceKey: string | null; panelInstanceKey: string | null; webContentsId: number | null }[]
  getTabRevision?: () => number
} = {}) {
  const published: PublishedPreferenceEvent[] = []
  const publisher = createWorkspacePreferenceChangePublisher({
    listPageWindows: () => options.pageWindows ?? [],
    listPanelWindows: () => options.panelWindows ?? [],
    getTabRevision: options.getTabRevision ?? (() => 31),
    publish: (input) => { published.push(input as PublishedPreferenceEvent) }
  })
  return { publisher, published }
}

describe('PLAT-30① 偏好 producer 抽取：结构判据（行数 < 500 且新模块独立存在）', () => {
  it('workspaceEventRouter.ts 与 composePanelWorkspace.ts 均 < 500 行，且 producer 已在独立模块里', () => {
    // 抽取前：workspaceEventRouter.ts = 532 行、composePanelWorkspace.ts = 560 行 ⇒ RED
    expect(lineCount(ROUTER_FILE)).toBeLessThan(MAX_LINES)
    expect(lineCount(COMPOSE_FILE)).toBeLessThan(MAX_LINES)
    expect(lineCount(PUBLISHER_FILE)).toBeLessThan(220)
  })
})

describe('PLAT-30② 偏好 producer 行为：抽取后逐字不变', () => {
  it('页窗受众用 Tab 的真实 revision + 工作区级 scope；面板窗 revision 有意缺省（由 router 注入面板 store 值）', () => {
    const { publisher, published } = createPreferenceHarness({
      pageWindows: [{ workspaceInstanceKey: 'workspace-1', webContentsId: 101 }],
      panelWindows: [{ workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-1', webContentsId: 201 }],
      getTabRevision: () => 31
    })

    expect(publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })).toBe(false)
    expect(published).toEqual([])
    expect(publisher.reconcile({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })).toBe(true)
    expect(published).toEqual([
      { type: 'snapshot', scope: { workspaceInstanceKey: 'workspace-1' }, layoutRevision: 31 },
      { type: 'snapshot', scope: { workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-1' } }
    ])
  })

  it('显示时区变化也算真实漂移：一次切换恰一次转发（否则分离窗会继续用旧时区）', () => {
    const { publisher, published } = createPreferenceHarness({
      pageWindows: [{ workspaceInstanceKey: 'workspace-1', webContentsId: 101 }],
      getTabRevision: () => 7
    })

    expect(publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })).toBe(false)
    expect(published).toEqual([])
    expect(publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'Asia/Shanghai' })).toBe(true)
    expect(published).toEqual([{ type: 'snapshot', scope: { workspaceInstanceKey: 'workspace-1' }, layoutRevision: 7 }])
    // 同值重复对账绝不再转发
    expect(publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'Asia/Shanghai' })).toBe(false)
    expect(published).toHaveLength(1)
  })

  it('同一时刻同一身份只转发一条作用域（不按受众数放大）；无关受众（null 键/未绑定 webContents）绝不猜测', () => {
    const { publisher, published } = createPreferenceHarness({
      pageWindows: [
        { workspaceInstanceKey: 'workspace-1', webContentsId: 101 },
        { workspaceInstanceKey: 'workspace-1', webContentsId: 102 },
        { workspaceInstanceKey: null, webContentsId: 103 },
        { workspaceInstanceKey: 'workspace-1', webContentsId: null }
      ],
      panelWindows: [
        { workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-1', webContentsId: 201 },
        { workspaceInstanceKey: null, panelInstanceKey: 'panel-2', webContentsId: 202 },
        { workspaceInstanceKey: 'workspace-1', panelInstanceKey: null, webContentsId: 203 },
        { workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-3', webContentsId: null }
      ]
    })

    publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    expect(publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })).toBe(false)
    expect(published).toEqual([])

    publisher.reconcile({ language: 'zh-CN', theme: 'system', timeZone: 'UTC' })
    expect(published).toEqual([
      { type: 'snapshot', scope: { workspaceInstanceKey: 'workspace-1' }, layoutRevision: 31 },
      { type: 'snapshot', scope: { workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-1' } }
    ])
  })

  it('一次真实切换恰一次转发、无自持环：任意次重复 reconcile 返回 false 且 0 增量；两次切换恰两条', () => {
    const { publisher, published } = createPreferenceHarness({
      pageWindows: [{ workspaceInstanceKey: 'workspace-1', webContentsId: 101 }]
    })

    publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    expect(published).toHaveLength(0)

    expect(publisher.reconcile({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })).toBe(true)
    expect(published).toHaveLength(1)
    for (let round = 0; round < 10; round += 1) {
      expect(publisher.reconcile({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })).toBe(false)
    }
    expect(published).toHaveLength(1)

    expect(publisher.reconcile({ language: 'en-US', theme: 'light', timeZone: 'UTC' })).toBe(true)
    expect(published).toHaveLength(2)
  })

  it('错误隔离：转发抛错不影响对账结论，也不中断其余受众的投递（绝不把失败当成功）', () => {
    const attempted: string[] = []
    const publisher = createWorkspacePreferenceChangePublisher({
      listPageWindows: () => [{ workspaceInstanceKey: 'workspace-1', webContentsId: 101 }],
      listPanelWindows: () => [{ workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-1', webContentsId: 201 }],
      getTabRevision: () => 31,
      publish: (input) => {
        const key = input.scope?.panelInstanceKey ?? 'page'
        attempted.push(key)
        if (key === 'page') throw new Error('send failed')
      }
    })

    publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    expect(publisher.reconcile({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })).toBe(true)
    // 页窗那条抛错不阻断面板窗那条；也不影响本次 reconcile 的「已转发」结论
    expect(attempted).toEqual(['page', 'panel-1'])
  })

  it('与既有 router 串联：一次切换恰 1 次 publish（受众数不放大）；无订阅者时投递 0 条且不猜受众', () => {
    const sent: string[] = []
    const router = createWorkspaceEventRouter({
      getLayoutRevision: () => 7,
      getSnapshot: () => ({
        layoutRevision: 7, activeWorkspaceInstanceKey: 'workspace-1', panels: [], pageLayouts: [],
        tabs: [] as readonly [], persistenceState: 'saved' as const
      }),
      send: (windowInstanceId) => { sent.push(windowInstanceId) },
      maxTargets: 4
    })
    const publish = vi.fn((input: {
      type: WorkspaceEvent['type']
      scope?: { workspaceInstanceKey?: string; panelInstanceKey?: string }
      layoutRevision?: number
    }) => { router.publish(input) })
    const publisher = createWorkspacePreferenceChangePublisher({
      listPageWindows: () => [{ workspaceInstanceKey: 'workspace-1', webContentsId: 101 }],
      getTabRevision: () => 7,
      publish
    })

    publisher.reconcile({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    publisher.reconcile({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({ type: 'snapshot', scope: { workspaceInstanceKey: 'workspace-1' }, layoutRevision: 7 })
    expect(sent).toEqual([])
  })
})

/**
 * PLAT-30 并入项 1：面板窗受众投影从 compose 抽进同一模块（**纯函数**，判据只来自 registry + 权威快照），
 * 使 compose 只剩接线，且「未提交的预留目标 / 未绑定 webContents / 归属已回主窗 / 登记已回收」四类
 * 一律 fail closed（既不误投主窗，也不假装目标已跟随）。
 */
describe('PLAT-30 并入项 1：面板窗受众投影（纯函数）', () => {
  /** 权威快照里的面板记录（真实 `WorkspacePanelSnapshot` 形状；投影判据只用到 key/window/epoch）。 */
  const panelView = (input: {
    panelInstanceKey: string
    workspaceInstanceKey: string
    windowInstanceId: string | null
    hostEpoch: number
  }): WorkspacePreferencePanelView => ({
    ...input, panelId: 'sample.inspector', open: true, mode: 'detached', presentation: 'normal',
    bindingState: 'bound', lastValidDock: 'docked-right'
  })

  function setup() {
    let sequence = 0
    const windowRegistry: WorkspaceWindowRegistry = createWorkspaceWindowRegistry({
      createOpaqueId: (prefix) => `${prefix}-${++sequence}`,
      maxDetachedHosts: 8
    })
    const reserved = windowRegistry.reserveDetachedWindow({
      hostEpoch: 2, panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1'
    })
    if (reserved.status !== 'reserved') throw new Error('reservation rejected')
    windowRegistry.attachWebContents({ windowInstanceId: reserved.record.windowInstanceId, webContentsId: 201 })
    const panels: WorkspacePreferencePanelView[] = [panelView({
      panelInstanceKey: 'panel-1', workspaceInstanceKey: 'workspace-1',
      windowInstanceId: reserved.record.windowInstanceId, hostEpoch: 2
    })]
    return { windowRegistry, panels, record: reserved.record }
  }

  it('已提交面板窗投影为一条受众；面板已回主窗（归属不再一致）或登记已回收 ⇒ 0 条', () => {
    const { windowRegistry, panels, record } = setup()
    expect(listPanelWindowTargets(windowRegistry, panels)).toEqual([{
      workspaceInstanceKey: 'workspace-1', panelInstanceKey: 'panel-1', webContentsId: 201
    }])
    // 面板已回到主窗承载 ⇒ ownsPanel 为假 ⇒ 绝不投影
    expect(listPanelWindowTargets(windowRegistry, [{
      ...panels[0] as WorkspacePreferencePanelView, windowInstanceId: 'main', hostEpoch: 1
    }])).toEqual([])
    // 登记已回收 ⇒ 没有受众
    windowRegistry.markDestroyed({ windowInstanceId: record.windowInstanceId })
    expect(listPanelWindowTargets(windowRegistry, panels)).toEqual([])
  })

  it('未绑定 webContents 的预留目标绝不投影（既不误投主窗，也不假装目标已跟随）', () => {
    const { windowRegistry, panels } = setup()
    const reserved = windowRegistry.reserveDetachedWindow({
      hostEpoch: 3, panelInstanceKey: 'panel-2', workspaceInstanceKey: 'workspace-2'
    })
    if (reserved.status !== 'reserved') throw new Error('reservation rejected')
    const withPanel2: WorkspacePreferencePanelView[] = [...panels, panelView({
      panelInstanceKey: 'panel-2', workspaceInstanceKey: 'workspace-2',
      windowInstanceId: reserved.record.windowInstanceId, hostEpoch: 3
    })]
    expect(listPanelWindowTargets(windowRegistry, withPanel2).map((entry) => entry.panelInstanceKey)).toEqual(['panel-1'])
    // 绑定 webContents 之后才成为受众（身份与 epoch 逐字一致才投影）
    windowRegistry.attachWebContents({ windowInstanceId: reserved.record.windowInstanceId, webContentsId: 202 })
    expect(listPanelWindowTargets(windowRegistry, withPanel2).map((entry) => entry.panelInstanceKey))
      .toEqual(['panel-1', 'panel-2'])
  })
})
