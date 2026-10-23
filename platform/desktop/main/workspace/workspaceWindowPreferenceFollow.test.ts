import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProductManifest } from '@platform/product-manifest'
import type { WorkspaceEvent } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import { composePanelWorkspace } from './composePanelWorkspace'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-10** focused）。回归：本文件。
 *
 * `context.preferences.{language,theme}`，主窗之后切换语言/主题时已打开的页窗不跟随（P2-04 集成项）。
 *
 * 本文件的判据（Main 侧那一半，不启动 Electron）：
 *  ① `getHostContext` 是偏好的**唯一受控读取点**（只拿值，**不带副作用**）；对账点是**显式通知**
 *     `notifyPreferencesChanged()`（PLAT-32/S1：`app.ts` 的 `settingsUpdate` 成功后调用一行）——
 *     通知用**既有事件词汇**（`snapshot`）定向投递给已订阅的**页面窗**：不新增通道、不新增事件词汇、
 *     不新增 preload 方法；
 *  ② 主题与语言同源：页窗随后重取一次 `getHostContext` 就能拿到新值（本文件用受控读取取证）；
 *  ③ **有界**：一次切换恰好一条广播；页窗/主窗随后任何次数的重取都**不再**广播（绝不回声风暴、
 *     绝不自持环）；两次切换恰好两条；任意次重复通知也是 0 增量；
 *  ④ 未归属/错误路径**显式**：未登记宿主、被拒的读取、没有页窗、页窗未订阅 —— 一律 0 投递，
 *     且**绝不影响主窗自身**（主窗不因为这个广播收到任何 `snapshot`）。
 *
 * 真机口径（本包不跑 Electron）：跨进程的可见文案/根属性跟随由 renderer 侧 focused 用例
 * （`workspaceWindowPreferenceFollow.test.tsx`）取证；本文件只固定 Main 的投递语义与有界性。
 */

const PAGE_ID = 'sample.overview'
const MAIN_WEBCONTENTS = 1
const PAGE_WEBCONTENTS = 100
const PAGE_WINDOW_INSTANCE_ID = 'window-page-1'
const PAGE_HOST_EPOCH = 2

const composeManifest = {
  id: 'sample', name: 'Sample', version: '1.0.0',
  shellContributions: {
    menuPages: [{
      id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 1,
      module: './desktop/pages/overview'
    }],
    settingsSections: [], panels: []
  },
  routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
  agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
} as unknown as ProductManifest

const roots: string[] = []
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

type SentEvent = { webContentsId: number; event: WorkspaceEvent }

async function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'plat-10-preference-follow-'))
  roots.push(root)
  let sequence = 0
  const sent: SentEvent[] = []
  let language = 'en-US'
  let theme = 'dark'

  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: { handle: () => undefined },
    layoutFilePath: join(root, 'workspace', 'panel-layout.json'),
    sendToHost: (webContentsId, event) => { sent.push({ webContentsId, event }); return true },
    preferences: {
      getLanguage: async () => language,
      getTheme: async () => theme,
      getTimeZone: async () => 'UTC'
    },
    windowRegistry: registry
  })
  if (composition.status !== 'ready') throw new Error(`composition disabled: ${composition.reason}`)

  const event = (webContentsId: number) => ({
    senderFrame: { parent: null }, sender: { id: webContentsId, isDestroyed: () => false }
  })
  const settle = async (): Promise<void> => {
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
  }

  /** 真机 boot：先注册受控通道（建窗之前）+ 建立偏好基线，再登记/受控挂载主窗。 */
  await composition.registerChannels()
  await composition.start()
  const mainWindow = composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
  if (!composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS }).attached) {
    throw new Error('main window not attached')
  }

  /** 打开一个一级菜单页 Tab（真机由 `.tabs.openTab` 受理；本文件只关心偏好的投递语义）。 */
  const openTab = async (): Promise<string> => {
    const result = await composition.tabStore.openTab({
      requestId: 'req-open',
      expectedRevision: composition.tabStore.getSnapshot().layoutRevision,
      hostEpoch: WorkspaceOwnershipPolicy.initialHostEpoch,
      pageId: PAGE_ID
    })
    if (result.status !== 'applied' || result.workspaceInstanceKey === undefined) {
      throw new Error(`openTab failed: ${JSON.stringify(result)}`)
    }
    return result.workspaceInstanceKey
  }

  /**
   * 把该 Tab 分离到独立页面窗（身份采纳 + webContents 绑定 + 受控挂载 + **角色解析读取**）。
   * 这里刻意**不**走 detach 事务：事务语义由 `tabWorkspaceDetachCommit.test.ts`（P2-07）取证；
   * 本文件只消费同一条**受控归属链**（registry 的 `detached-tab` 记录 + router 的 `attachHost`），
   * 因此偏好投递的归属判定与真机逐字一致。
   */
  const openPageWindow = async (workspaceInstanceKey: string): Promise<void> => {
    const reserved = registry.reserveDetachedTabWindow({
      windowInstanceId: PAGE_WINDOW_INSTANCE_ID, hostEpoch: PAGE_HOST_EPOCH, workspaceInstanceKey
    })
    if (reserved.status !== 'reserved') throw new Error(`reserve failed: ${reserved.errorCode}`)
    const attached = registry.attachWebContents({
      windowInstanceId: PAGE_WINDOW_INSTANCE_ID, webContentsId: PAGE_WEBCONTENTS
    })
    if (attached.status !== 'attached') throw new Error(`attach failed: ${attached.errorCode}`)
    if (!composition.attachHostWindow({ webContentsId: PAGE_WEBCONTENTS }).subscribed) {
      throw new Error('page window not subscribed')
    }
    // 真机：窗口创建时页窗自己读一次受控上下文（角色解析）——它同时建立偏好对账的基线
    await readContext(PAGE_WEBCONTENTS)
  }

  const readContext = async (webContentsId: number) => {
    const outcome = await composition.handlers.getHostContext(event(webContentsId))
    await settle()
    return outcome
  }

  /** 真机时序：主窗加载后先读一次上下文（角色解析）。S1 之后基线在注册通道时建立，读取本身只拿值。 */
  const baseline = await readContext(MAIN_WEBCONTENTS)
  if (baseline.status !== 'ok') throw new Error('main window context rejected')

  return {
    composition, registry, sent, mainWindow, event, settle, openTab, openPageWindow, readContext,
    /** PLAT-32/S1：偏好的唯一对账入口（真机由 `app.ts` 的 settingsUpdate 成功路径调用一行）。 */
    notify: () => composition.notifyPreferencesChanged(),
    setPreferences: (next: { language?: string; theme?: string }) => {
      if (next.language !== undefined) language = next.language
      if (next.theme !== undefined) theme = next.theme
    },
    /** 主窗/页窗收到的 `snapshot` 事件（本包唯一的广播词汇）。 */
    snapshotsTo: (webContentsId: number) => sent.filter((entry) => entry.webContentsId === webContentsId
      && entry.event.type === 'snapshot'),
    resetSent: () => { sent.length = 0 }
  }
}

describe('PLAT-10 ①：偏好变更经**显式通知**对账（S1），用既有事件词汇定向投递给已打开页窗', () => {
  it('显式通知一次 ⇒ 恰好一条 snapshot 定向到该页窗，且绝不投给主窗；受控读取本身 0 投递', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    // S1：读取是纯读（真机窗口 boot 时也会读一次上下文）——读取绝不转发
    const mainRead = await harness.readContext(MAIN_WEBCONTENTS)
    expect(mainRead.status).toBe('ok')
    expect(harness.sent).toEqual([])

    await expect(harness.notify()).resolves.toBe(true)

    const toPage = harness.snapshotsTo(PAGE_WEBCONTENTS)
    expect(toPage).toHaveLength(1)
    expect(toPage[0]?.event.scope).toEqual({ workspaceInstanceKey })
    expect(toPage[0]?.event.layoutRevision).toBe(harness.composition.tabStore.getSnapshot().layoutRevision)
    // 不得影响主窗自身渲染时机：主窗不是该作用域的承载者，绝不收到这条定向事件
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])
  })

  it('② 页窗重取一次上下文即可拿到新语言/新主题（通知后同一次受控读取的投影）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)

    const before = await harness.readContext(PAGE_WEBCONTENTS)
    if (before.status !== 'ok') throw new Error('page context rejected')
    expect(before.context.preferences).toEqual({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })

    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    await harness.notify()
    const after = await harness.readContext(PAGE_WEBCONTENTS)
    if (after.status !== 'ok') throw new Error('page context rejected')
    expect(after.context.preferences).toEqual({ language: 'zh-CN', theme: 'light', timeZone: 'UTC' })
    // 身份不变：页窗的上下文重取绝不改判归属
    expect(after.context.windowInstanceId).toBe(PAGE_WINDOW_INSTANCE_ID)
    expect(after.context.role).toBe('panel')
  })
})

describe('PLAT-10 ③：一次切换的广播次数有上界，且不自持环', () => {
  it('一次切换恰一条；页窗与主窗随后任意次重取/重复通知都不再广播', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    await harness.notify()
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(1)

    // 页窗收到通知后的真实反应：重取一次上下文（可能还有一次 `.tabs.getSnapshot`），绝不回声
    await harness.readContext(PAGE_WEBCONTENTS)
    await harness.readContext(PAGE_WEBCONTENTS)
    await harness.readContext(MAIN_WEBCONTENTS)
    await expect(harness.notify()).resolves.toBe(false)
    await harness.settle()
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(1)
    expect(harness.sent).toHaveLength(1)
  })

  it('连续两次切换恰两条（每次切换有界，绝不按读取/通知次数放大）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN' })
    await harness.notify()
    harness.setPreferences({ theme: 'light' })
    await harness.notify()
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(2)

    // 同一份偏好再读 5 次、再通知 5 次：0 增量（有界性不随读取/通知次数增长）
    for (let turn = 0; turn < 5; turn += 1) await harness.readContext(MAIN_WEBCONTENTS)
    for (let turn = 0; turn < 5; turn += 1) await harness.notify()
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(2)
  })

  it('没有页窗时 0 投递：绝不猜测受众，也绝不让主窗代收', async () => {
    const harness = await createHarness()
    harness.resetSent()
    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    await harness.notify()
    expect(harness.sent).toEqual([])

    // 之后打开页窗：它自己那次受控读取就能拿到当前偏好（绝不依赖广播补发）
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    const pageRead = await harness.readContext(PAGE_WEBCONTENTS)
    if (pageRead.status !== 'ok') throw new Error('page context rejected')
    expect(pageRead.context.preferences).toEqual({ language: 'zh-CN', theme: 'light', timeZone: 'UTC' })
  })

  it('已预留但尚未挂载的页窗 0 投递（未订阅 ⇒ 绝不猜测受众）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    const reserved = harness.registry.reserveDetachedTabWindow({
      windowInstanceId: 'window-page-pending', hostEpoch: PAGE_HOST_EPOCH, workspaceInstanceKey
    })
    expect(reserved.status).toBe('reserved')
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    await harness.notify()
    expect(harness.sent).toEqual([])
  })
})

describe('PLAT-10 ④：未归属与错误路径行为显式（不静默不一致）', () => {
  it('未登记宿主读取被拒，且不触发任何广播', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    const rejected = await harness.readContext(9999)
    expect(rejected.status).toBe('rejected')
    // 被拒的读取绝不是对账点：绝不据此广播（错误壳窗口因此被显式排除在跟随之外）
    expect(harness.sent).toEqual([])

    // 恢复路径：下一次**成功读取**只拿值（0 投递），显式通知照常对账（偏好不会永久丢失）
    await harness.readContext(MAIN_WEBCONTENTS)
    expect(harness.sent).toEqual([])
    await expect(harness.notify()).resolves.toBe(true)
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(1)
  })

  it('页窗登记被回收后不再收到任何投递（陈旧身份零投递，绝不误投）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.registry.markDestroyed({ webContentsId: PAGE_WEBCONTENTS })
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    await harness.notify()
    expect(harness.sent).toEqual([])
  })
})
