import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ProductManifest } from '@platform/product-manifest'
import type { WorkspaceEvent } from '@platform/workspace/contracts'
import { WorkspaceOwnershipPolicy } from '@platform/workspace/policies'
import { composePanelWorkspace } from './composePanelWorkspace'
import { createWorkspaceWindowRegistry } from './workspaceWindowRegistry'

/**
 * Owner: platform/desktop/main/workspace（**PLAT-32 / S1** focused）。回归：本文件。
 *
 * 现状把偏好对账**挂在受控读取上**（`getHostContext` 成功即 `reconcile`）⇒ **读带副作用**。
 * S1 把它改成**显式通知**：`app.ts` 的 `settingsUpdate` 成功路径加一行
 * `panelWorkspaceForDisposal?.notifyPreferencesChanged()`，对账/定向投递仍由 PLAT-30 抽出的
 * `workspacePreferenceChangePublisher` 负责。
 *
 * 本文件固定两条判据（**语义与 PLAT-10/PLAT-28 逐字一致，判据绝不放宽**）：
 *  ① 受控读取**不再**产生任何投递（读是纯读；页窗/面板窗自己那次读取只是拿值）；
 *  ② 显式通知**才是**唯一对账点：一次真实切换恰 1 条、主窗 0 条、无自持环、无受众时 0 条。
 *
 * 真机口径（本包不跑 Electron）：跨进程的可见文案/根属性跟随由 renderer focused 用例取证；
 * 本文件只固定 Main 的投递语义与有界性。
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
  const root = mkdtempSync(join(tmpdir(), 'plat-32-s1-notification-'))
  roots.push(root)
  let sequence = 0
  const sent: SentEvent[] = []
  let language = 'en-US'
  let theme = 'light'

  const registry = createWorkspaceWindowRegistry({ createOpaqueId: (prefix) => `${prefix}-${++sequence}` })
  const composition = composePanelWorkspace({
    productManifests: [composeManifest],
    ipcMain: { handle: () => undefined },
    layoutFilePath: join(root, 'workspace', 'panel-layout.json'),
    sendToHost: (webContentsId, event) => { sent.push({ webContentsId, event }); return true },
    preferences: { getLanguage: async () => language, getTheme: async () => theme , getTimeZone: async () => 'UTC'},
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

  // 真机 boot：先注册通道（建窗之前）+ 建立偏好基线，再登记/挂载主窗
  composition.registerChannels()
  await composition.start()
  composition.registerMainWindow({ webContentsId: MAIN_WEBCONTENTS })
  if (!composition.attachMainWindow({ webContentsId: MAIN_WEBCONTENTS }).attached) {
    throw new Error('main window not attached')
  }

  const readContext = async (webContentsId: number) => {
    const outcome = await composition.handlers.getHostContext(event(webContentsId))
    await settle()
    return outcome
  }

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
    // 真机：窗口创建时页窗自己读一次受控上下文（角色解析）——它只拿值，绝不触发对账
    await readContext(PAGE_WEBCONTENTS)
  }

  await readContext(MAIN_WEBCONTENTS)

  return {
    composition, registry, sent, settle, event, readContext, openTab, openPageWindow,
    setPreferences: (next: { language?: string; theme?: string }) => {
      if (next.language !== undefined) language = next.language
      if (next.theme !== undefined) theme = next.theme
    },
    notify: async () => composition.notifyPreferencesChanged(),
    snapshotsTo: (webContentsId: number) => sent.filter((entry) => entry.webContentsId === webContentsId
      && entry.event.type === 'snapshot'),
    resetSent: () => { sent.length = 0 }
  }
}

describe('S1 ①：受控读取是纯读（不再偷偷对账）', () => {
  it('偏好已切换但只发生受控读取 ⇒ 0 投递（主窗/页窗任意次读取都不触发转发）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'dark' })
    await expect(harness.readContext(MAIN_WEBCONTENTS)).resolves.toMatchObject({ status: 'ok' })
    await harness.readContext(PAGE_WEBCONTENTS)
    await harness.readContext(MAIN_WEBCONTENTS)
    await harness.settle()

    expect(harness.sent).toEqual([])
  })
})

describe('S1 ②：显式通知是唯一对账点（一次切换恰 1 条、主窗 0 条、无自持环）', () => {
  it('notifyPreferencesChanged() ⇒ 恰 1 条定向通知给已打开页窗，主窗 0 条，revision 取 Tab 真实值', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.resetSent()

    harness.setPreferences({ language: 'zh-CN', theme: 'light' })
    await expect(harness.notify()).resolves.toBe(true)

    const toPage = harness.snapshotsTo(PAGE_WEBCONTENTS)
    expect(toPage).toHaveLength(1)
    expect(toPage[0]?.event.scope).toEqual({ workspaceInstanceKey })
    expect(toPage[0]?.event.layoutRevision).toBe(harness.composition.tabStore.getSnapshot().layoutRevision)
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])

    // 页窗的真实反应：重取上下文 + 通知自身幂等 ⇒ 绝不回声、绝不放大
    await harness.readContext(PAGE_WEBCONTENTS)
    await expect(harness.notify()).resolves.toBe(false)
    await harness.readContext(MAIN_WEBCONTENTS)
    await harness.settle()
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(1)
    expect(harness.sent).toHaveLength(1)

    // 两次切换恰两条
    harness.setPreferences({ theme: 'dark' })
    await expect(harness.notify()).resolves.toBe(true)
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(2)
    for (let turn = 0; turn < 5; turn += 1) await harness.notify()
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(2)
  })

  it('页窗随后自己那次受控读取就拿得到新偏好（通知不承载值，值仍由受控读取提供）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)

    harness.setPreferences({ language: 'zh-CN', theme: 'dark' })
    await harness.notify()
    const after = await harness.readContext(PAGE_WEBCONTENTS)
    if (after.status !== 'ok') throw new Error('page context rejected')
    expect(after.context.preferences).toEqual({ language: 'zh-CN', theme: 'dark', timeZone: 'UTC' })
    expect(after.context.windowInstanceId).toBe(PAGE_WINDOW_INSTANCE_ID)
    expect(after.context.role).toBe('panel')
  })

  it('没有受众时 0 投递（未挂载/未登记的宿主绝不代收）', async () => {
    const harness = await createHarness()
    harness.resetSent()
    harness.setPreferences({ language: 'zh-CN', theme: 'dark' })
    await expect(harness.notify()).resolves.toBe(true)
    expect(harness.sent).toEqual([])
  })
})

describe('S1 ④：OS 外观变化（nativeTheme updated）与设置切换同一口径（PM 裁决②）', () => {
  it('一次 OS 外观变化 ⇒ 恰 1 条通知、主窗 0 条、重复 updated 0 增量（无自持环）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)
    harness.resetSent()

    // themeMode==='system'：用户在系统里切深浅色 ⇒ 受控上下文的**解析值**变化（settings 未变）。
    // 真机由 app.ts 的 `nativeTheme.on('updated')` 调用同一入口 notifyPreferencesChanged()。
    harness.setPreferences({ theme: 'dark' })
    await expect(harness.notify()).resolves.toBe(true)
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(1)
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])

    // 同一次 OS 变化的重复 updated + 窗口随后重取上下文 ⇒ 0 增量（绝不回声、绝不按 updated 次数放大）
    await expect(harness.notify()).resolves.toBe(false)
    await harness.readContext(PAGE_WEBCONTENTS)
    await harness.readContext(MAIN_WEBCONTENTS)
    await harness.settle()
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(1)
    expect(harness.sent).toHaveLength(1)

    // 切回浅色 ⇒ 又一次恰 1 条（两次 OS 变化恰 2 条）；主窗仍 0 条
    harness.setPreferences({ theme: 'light' })
    await expect(harness.notify()).resolves.toBe(true)
    expect(harness.snapshotsTo(PAGE_WEBCONTENTS)).toHaveLength(2)
    expect(harness.snapshotsTo(MAIN_WEBCONTENTS)).toEqual([])
  })

  it('页窗随后自己那次受控读取拿到已解析的新主题（通知不承载值，与设置切换同源）', async () => {
    const harness = await createHarness()
    const workspaceInstanceKey = await harness.openTab()
    await harness.openPageWindow(workspaceInstanceKey)

    harness.setPreferences({ theme: 'dark' })
    await harness.notify()
    const after = await harness.readContext(PAGE_WEBCONTENTS)
    if (after.status !== 'ok') throw new Error('page context rejected')
    expect(after.context.preferences).toEqual({ language: 'en-US', theme: 'dark', timeZone: 'UTC' })
  })
})

describe('S1 ③：seam 结构判据（读取侧副作用移除 + app.ts 显式通知一行）', () => {
  const composeSource = readFileSync(resolve(__dirname, './composePanelWorkspace.ts'), 'utf8')
  const appSource = readFileSync(resolve(__dirname, '../app.ts'), 'utf8')

  it('compose 的受控读取包装里不再出现 reconcile（读带副作用已移除）', () => {
    expect(composeSource).not.toContain('preferenceChanges.reconcile(outcome.context.preferences)')
    expect(composeSource).not.toContain('rawHandlers.getHostContext(event, payload)')
    expect(composeSource).toContain('notifyPreferencesChanged')
    expect(composeSource).toContain('await preferenceFollow.ensureBaseline()')
  })

  it('app.ts 的 settingsUpdate 成功路径含显式通知（唯一调用点）', () => {
    const start = appSource.indexOf('ipcMain.handle(IpcChannels.settingsUpdate')
    expect(start).toBeGreaterThan(-1)
    const end = appSource.indexOf('ipcMain.handle(', start + 10)
    const block = appSource.slice(start, end === -1 ? undefined : end)

    expect(block).toContain('const next = await settingsStore.update(patch)')
    expect(block).toContain('panelWorkspaceForDisposal?.notifyPreferencesChanged()')
    expect(block).toContain('return next')
  })

  it('app.ts 把 OS 外观变化接到同一对账入口（nativeTheme 复用既有 import，不新增通道）', () => {
    expect(appSource).toContain(
      "nativeTheme.on('updated', () => { void panelWorkspaceForDisposal?.notifyPreferencesChanged() })"
    )
    // 既有 import 风格：nativeTheme 来自 electron 的那一条 import（不新增依赖、不新增通道/preload
    // 方法）。成员列表会随功能增减（例如 Windows 菜单条引入的 Menu），所以只断言这条 import 里有
    // nativeTheme，而不是锁死整行文本。
    expect(appSource).toMatch(/import \{[^}]*\bnativeTheme\b[^}]*\} from 'electron'/)
    // 恰两处显式通知：设置写入（settingsUpdate 成功路径）+ OS 外观变化；没有第三条对账链
    expect(appSource.split('notifyPreferencesChanged()').length - 1).toBe(2)
  })
})
