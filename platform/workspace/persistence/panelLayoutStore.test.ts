import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { WorkspacePanelRegistration } from '../contracts'
import { createPanelRegistry } from '../registry/panelRegistry'
import { createPanelWorkspaceStore } from '../runtime/panelWorkspaceStore'
import { createJsonFileStorage, type JsonFileStorage } from '../../storage/jsonFileStorage'
import { WorkspaceLayoutBudgetPolicy } from './panelLayoutDocument'
import { buildWorkspaceLayoutDocumentV2, toPanelLayoutDocumentV1, type WorkspaceLayoutDocumentV2 } from './workspaceLayoutDocument'
import { createPanelLayoutStore, type PanelLayoutDiagnostic } from './panelLayoutStore'

/**
 * Owner: platform/workspace/persistence。权威：技术设计 §7/§8（WorkspaceWritePolicy / WorkspaceRestorePolicy）。
 * 全部使用 os.tmpdir() 下的真实临时目录；绝不触碰真实 userData/profile。
 */

let directory = ''
let filePath = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'p1-05-layout-'))
  filePath = join(directory, 'layout.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

/** P2-04：写路径只有 v2；这里的 fixture 就是升级完成后的 v2 形状（含 tabs 与活动 tab）。 */
function document(overrides: Partial<WorkspaceLayoutDocumentV2> = {}): WorkspaceLayoutDocumentV2 {
  return {
    schemaVersion: 2, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 7,
    workspaces: [{ workspaceInstanceKey: 'workspace_1', pageId: 'sample.page-a', panelOrder: ['panel_1'], activePanels: { embedded: 'panel_1' } }],
    panels: [{
      panelInstanceKey: 'panel_1', workspaceInstanceKey: 'workspace_1', panelId: 'sample.inspector',
      open: true, mode: 'docked-right', lastValidDock: 'docked-right', dockSize: { width: 480, height: 360 }
    }],
    tabs: [{ workspaceInstanceKey: 'workspace_1', pageId: 'sample.page-a', open: true, order: 0, mode: 'main' }],
    activeWorkspaceInstanceKey: 'workspace_1',
    ...overrides
  }
}

function createTimers() {
  const entries: { delayMs: number; run: () => void; cancelled: boolean }[] = []
  return {
    port: {
      schedule: (delayMs: number, run: () => void) => {
        const entry = { delayMs, run, cancelled: false }
        entries.push(entry)
        return () => { entry.cancelled = true }
      }
    },
    fire: (index = 0) => {
      const entry = entries.filter((candidate) => !candidate.cancelled)[index]
      if (!entry) throw new Error('no pending timer')
      entry.cancelled = true
      entry.run()
    },
    pending: () => entries.filter((entry) => !entry.cancelled).map((entry) => entry.delayMs)
  }
}

function countingStorage(inner: JsonFileStorage<unknown>): { storage: JsonFileStorage<unknown>; counters: { reads: number; writes: number } } {
  const counters = { reads: 0, writes: 0 }
  const storage: JsonFileStorage<unknown> = {
    read: async () => { counters.reads += 1; return inner.read() },
    write: async (value) => { counters.writes += 1; await inner.write(value) }
  }
  return { storage, counters }
}

describe('panel layout store persistence', () => {
  it('writes a real temp file and restores it from a fresh store instance', async () => {
    expect(filePath.startsWith(tmpdir())).toBe(true)
    const first = createPanelLayoutStore({ filePath })
    first.schedule(document())
    await expect(first.flush()).resolves.toMatchObject({ outcome: 'saved' })
    expect(first.persistenceState()).toBe('saved')
    expect((await stat(filePath)).isFile()).toBe(true)
    const raw = await readFile(filePath, 'utf8')
    expect(raw).not.toContain('windowInstanceId')
    expect(raw).not.toContain('sessionKey')

    const second = createPanelLayoutStore({ filePath })
    const restored = await second.load()
    expect(restored.outcome).toBe('loaded')
    expect(restored.mayOverwrite).toBe(true)
    expect(restored.document).toEqual(document())
    expect(restored.document.panels[0]?.dockSize).toEqual({ width: 480, height: 360 })
    expect(restored.document.workspaces[0]?.activePanels).toEqual({ embedded: 'panel_1' })
  })

  it('falls back to a safe default when nothing was ever saved', async () => {
    const store = createPanelLayoutStore({ filePath })
    const result = await store.load()
    expect(result).toMatchObject({ outcome: 'default', reason: 'missing', mayOverwrite: true })
    expect(result.document.panels).toEqual([])
  })

  it('refuses to read an oversized file instead of parsing it', async () => {
    await writeFile(filePath, `{"schemaVersion":1,"padding":"${'x'.repeat(WorkspaceLayoutBudgetPolicy.maxDocumentBytes)}"}`, 'utf8')
    const inner = createJsonFileStorage<unknown>(filePath, document())
    const { storage, counters } = countingStorage(inner)
    const store = createPanelLayoutStore({ filePath, storage })

    const result = await store.load()
    expect(result).toMatchObject({ outcome: 'default', reason: 'too-large', mayOverwrite: false })
    expect(counters.reads).toBe(0) // 大小判定先于读取与解析
  })

  it('keeps the previous successful file and reports failed instead of claiming saved', async () => {
    const store = createPanelLayoutStore({ filePath })
    store.schedule(document())
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'saved' })
    const before = await readFile(filePath, 'utf8')

    const failing = createPanelLayoutStore({ filePath, storage: { read: async () => document(), write: async () => { throw new Error('disk-full') } } })
    failing.schedule(document({ savedAt: '2026-10-05T01:00:00.000Z' }))
    await expect(failing.flush()).resolves.toMatchObject({ outcome: 'failed', reason: 'write-failed' })
    expect(failing.persistenceState()).toBe('failed') // 不得伪报 saved
    expect(await readFile(filePath, 'utf8')).toBe(before) // 上一份成功文件仍在
  })

  it('treats a rename failure as failed and never loads the stale .next file', async () => {
    const store = createPanelLayoutStore({ filePath })
    store.schedule(document())
    await store.flush()
    const before = await readFile(filePath, 'utf8')

    // 模拟 jsonFileStorage 的 .next → rename：临时文件写成功、rename 失败
    const renameFailing: JsonFileStorage<unknown> = {
      read: async () => document(),
      write: async (value) => { await writeFile(`${filePath}.next`, JSON.stringify(value), 'utf8'); throw new Error('rename-failed') }
    }
    const failing = createPanelLayoutStore({ filePath, storage: renameFailing })
    failing.schedule(document({ savedAt: '2026-10-05T02:00:00.000Z' }))
    await expect(failing.flush()).resolves.toMatchObject({ outcome: 'failed', reason: 'write-failed' })
    expect(failing.persistenceState()).toBe('failed')
    expect(await readFile(filePath, 'utf8')).toBe(before)

    const reloaded = await createPanelLayoutStore({ filePath }).load()
    expect(reloaded.outcome).toBe('loaded')
    expect(reloaded.document.savedAt).toBe('2026-10-05T00:00:00.000Z') // 陈旧 .next 不参与恢复
  })

  it('refuses to write an out-of-budget document and keeps the existing file', async () => {
    const store = createPanelLayoutStore({ filePath })
    store.schedule(document())
    await store.flush()
    const before = await readFile(filePath, 'utf8')

    const tooMany = document({ panels: Array.from({ length: WorkspaceLayoutBudgetPolicy.maxPanels + 1 }, (_, index) => ({ ...document().panels[0]!, panelInstanceKey: `panel_${index}` })) })
    const rejected = createPanelLayoutStore({ filePath })
    rejected.schedule(tooMany)
    await expect(rejected.flush()).resolves.toMatchObject({ outcome: 'failed', reason: 'invalid-document' })
    expect(rejected.persistenceState()).toBe('failed')
    expect(await readFile(filePath, 'utf8')).toBe(before)
  })

  it('coalesces ten thousand resizes into one bounded latest-pending write', async () => {
    const timers = createTimers()
    const inner = createJsonFileStorage<unknown>(filePath, document())
    const { storage, counters } = countingStorage(inner)
    const store = createPanelLayoutStore({ filePath, storage, timers: timers.port })

    for (let index = 0; index < 10_000; index += 1) {
      store.schedule(document({ layoutRevision: index, savedAt: `2026-10-05T00:00:${String(index % 60).padStart(2, '0')}.000Z` }))
      expect(store.pendingWriteCount()).toBeLessThanOrEqual(1) // 待写状态有界
    }
    expect(store.persistenceState()).toBe('pending')
    expect(counters.writes).toBe(0)
    expect(timers.pending()).toEqual([250])

    timers.fire()
    await store.flush()
    expect(counters.writes).toBe(1) // 合并成单次写入
    expect(store.pendingWriteCount()).toBe(0)
    expect(store.persistenceState()).toBe('saved')
    const restored = await createPanelLayoutStore({ filePath }).load()
    expect(restored.document.layoutRevision).toBe(9_999) // latest-pending 胜出
  })

  it('degrades a corrupt file to a safe default and never overwrites it without an explicit reset', async () => {
    await writeFile(filePath, '{ this is not json', 'utf8')
    const store = createPanelLayoutStore({ filePath })
    const result = await store.load()
    expect(result).toMatchObject({ outcome: 'default', reason: 'corrupt', mayOverwrite: false })
    expect(result.document.panels).toEqual([])

    store.schedule(document())
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'failed', reason: 'reset-required' })
    expect(await readFile(filePath, 'utf8')).toBe('{ this is not json')

    store.reset()
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'saved' })
    expect((await createPanelLayoutStore({ filePath }).load()).outcome).toBe('loaded')
  })

  it('keeps an unknown (future) schema version intact and requires an explicit reset before rewriting', async () => {
    // v2 已是本平台布局版本：未知版本用 v3 表示，读路径必须保护它、绝不覆写
    const future = { ...document(), schemaVersion: 3 }
    await writeFile(filePath, `${JSON.stringify(future, null, 2)}\n`, 'utf8')
    const store = createPanelLayoutStore({ filePath })
    const result = await store.load()
    expect(result).toMatchObject({ outcome: 'default', reason: 'unknown-schema-version', mayOverwrite: false, convertedFromV1: false })

    store.schedule(document())
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'failed', reason: 'reset-required' })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 3 })

    store.reset()
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'saved' })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 2 })
  })

  it('resolves a hanging read with a safe default inside the read budget', async () => {
    const timers = createTimers()
    await writeFile(filePath, '{"schemaVersion":1}', 'utf8') // 文件存在才会进入读取预算
    const store = createPanelLayoutStore({
      filePath, timers: timers.port,
      storage: { read: () => new Promise<unknown>(() => undefined), write: async () => undefined }
    })
    const pending = store.load()
    // 等 stat 完成后读取预算定时器才会注册（条件等待，不用固定 sleep）
    for (let attempt = 0; attempt < 50 && timers.pending().length === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(timers.pending()).toEqual([200]) // WorkspaceRestorePolicy.readBudgetMs
    timers.fire()
    await expect(pending).resolves.toMatchObject({ outcome: 'default', reason: 'timeout', mayOverwrite: false })
  })

  it('never claims saved while a newer update is still pending and drains it without an extra flush', async () => {
    const timers = createTimers()
    const written: number[] = []
    const releases: (() => void)[] = []
    const storage: JsonFileStorage<unknown> = {
      read: async () => document(),
      write: async (value) => { written.push((value as WorkspaceLayoutDocumentV2).layoutRevision); await new Promise<void>((resolve) => { releases.push(resolve) }) }
    }
    const store = createPanelLayoutStore({ filePath, storage, timers: timers.port })

    store.schedule(document({ layoutRevision: 1 }))
    timers.fire() // 合并窗口到点 ⇒ 第一次写（挂起在飞）
    expect(written).toEqual([1])

    store.schedule(document({ layoutRevision: 2 }))
    expect(store.persistenceState()).toBe('pending') // 在飞期间绝不得报 saved
    expect(store.pendingWriteCount()).toBe(1)
    expect(timers.pending()).toEqual([250]) // 更新到达必须重新排入写入
    timers.fire()
    await Promise.resolve()
    expect(store.persistenceState()).not.toBe('saved')

    releases.shift()?.() // 放行第一次写：不需要任何额外 flush，rev2 必须继续被写出
    for (let attempt = 0; attempt < 50 && written.length < 2; attempt += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(written).toEqual([1, 2])
    releases.shift()?.()
    for (let attempt = 0; attempt < 50 && store.pendingWriteCount() > 0; attempt += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(store.pendingWriteCount()).toBe(0)
    expect(store.persistenceState()).toBe('saved')
  })

  it('drains the last change within a single app-exit flush', async () => {
    const written: number[] = []
    const releases: (() => void)[] = []
    const storage: JsonFileStorage<unknown> = {
      read: async () => document(),
      write: async (value) => { written.push((value as WorkspaceLayoutDocumentV2).layoutRevision); await new Promise<void>((resolve) => { releases.push(resolve) }) }
    }
    const store = createPanelLayoutStore({ filePath, storage })
    store.schedule(document({ layoutRevision: 1 }))
    const exiting = store.flush()
    store.schedule(document({ layoutRevision: 2 }))
    releases.shift()?.() // 放行第一次写
    for (let attempt = 0; attempt < 50 && written.length < 2; attempt += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(written).toEqual([1, 2]) // 同一次 flush 调用必须继续写出最后一次变更
    releases.shift()?.()

    await expect(exiting).resolves.toMatchObject({ outcome: 'saved' })
    expect(store.pendingWriteCount()).toBe(0)
    expect(store.persistenceState()).toBe('saved')
  })

  it('rechecks the pending document after an in-flight write settles', async () => {
    const timers = createTimers()
    const written: number[] = []
    const releases: ((fail?: boolean) => void)[] = []
    const storage: JsonFileStorage<unknown> = {
      read: async () => document(),
      write: async (value) => {
        written.push((value as WorkspaceLayoutDocumentV2).layoutRevision)
        await new Promise<void>((resolve, reject) => { releases.push((fail) => { if (fail === true) reject(new Error('disk-full')); else resolve() }) })
      }
    }
    const store = createPanelLayoutStore({ filePath, storage, timers: timers.port })
    store.schedule(document({ layoutRevision: 1 }))
    const first = store.flush()
    store.schedule(document({ layoutRevision: 2 }))
    const second = store.flush() // 在飞期间调用：必须等在飞落定后重查待写
    releases.shift()?.(true) // 第一次写失败

    await expect(first).resolves.toMatchObject({ outcome: 'failed' })
    for (let attempt = 0; attempt < 50 && written.length < 2; attempt += 1) await new Promise((resolve) => setImmediate(resolve))
    expect(written).toEqual([1, 2]) // 无需额外 flush：第二次调用必须把最新待写落盘
    releases.shift()?.()
    await expect(second).resolves.toMatchObject({ outcome: 'saved' })
    expect(store.persistenceState()).toBe('saved')
    expect(store.pendingWriteCount()).toBe(0)
  })

  it('retries the pending document after a write failure instead of dropping it', async () => {
    let failNext = true
    const written: number[] = []
    const storage: JsonFileStorage<unknown> = {
      read: async () => document(),
      write: async (value) => { if (failNext) { failNext = false; throw new Error('disk-full') } written.push((value as WorkspaceLayoutDocumentV2).layoutRevision) }
    }
    const store = createPanelLayoutStore({ filePath, storage })
    store.schedule(document({ layoutRevision: 1 }))
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'failed' })

    expect(store.persistenceState()).toBe('failed')
    expect(store.pendingWriteCount()).toBe(1) // 失败必须保留用户布局，不得丢
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'saved', revision: 1 })
    expect(written).toEqual([1])
    expect(store.persistenceState()).toBe('saved')
  })

  it('keeps the pending state instead of claiming saved when reset happens with a pending write', async () => {
    const store = createPanelLayoutStore({ filePath })
    store.schedule(document({ layoutRevision: 1 }))
    store.reset()
    expect(store.persistenceState()).toBe('pending') // reset 不得把未写出的布局报成 saved
    expect(store.pendingWriteCount()).toBe(1)
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'saved' })
  })

  it('clears the overwrite protection after a later load validates the file', async () => {
    await writeFile(filePath, '{ broken', 'utf8')
    const store = createPanelLayoutStore({ filePath })
    expect(await store.load()).toMatchObject({ outcome: 'default', reason: 'corrupt', mayOverwrite: false })
    expect(store.canOverwrite()).toBe(false)

    const good = document()
    await writeFile(filePath, `${JSON.stringify(good, null, 2)}\n`, 'utf8')
    const second = await store.load()
    expect(second).toMatchObject({ outcome: 'loaded', mayOverwrite: true })
    expect(store.canOverwrite()).toBe(true) // mayOverwrite === canOverwrite 恒成立
    store.schedule(good)
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'saved' })
  })

  it('degrades to a safe default when the injected timer port cannot schedule the read budget', async () => {
    await writeFile(filePath, `${JSON.stringify(document(), null, 2)}\n`, 'utf8')
    const store = createPanelLayoutStore({
      filePath,
      timers: { schedule: () => { throw new Error('scheduler-unavailable') } },
      storage: { read: async () => document(), write: async () => undefined }
    })
    await expect(store.load()).resolves.toMatchObject({ outcome: 'default', reason: 'timeout', mayOverwrite: false })
  })

  it('rejects accessor properties instead of letting a throwing getter escape the writer', async () => {
    const store = createPanelLayoutStore({ filePath })
    const hostile = { ...document() } as Record<string, unknown>
    Object.defineProperty(hostile, 'panels', { enumerable: true, get: () => { throw new Error('getter-exploded') } })
    store.schedule(hostile as unknown as WorkspaceLayoutDocumentV2)
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'failed', reason: 'invalid-document' })
    expect(store.persistenceState()).toBe('failed')
  })

  it('emits bounded diagnostics without document content', async () => {
    const diagnostics: PanelLayoutDiagnostic[] = []
    const store = createPanelLayoutStore({ filePath, onDiagnostics: (event) => diagnostics.push(event) })
    store.schedule(document())
    await store.flush()
    await store.load()

    expect(diagnostics.map((event) => event.kind)).toEqual(['save', 'load'])
    for (const event of diagnostics) {
      expect(Object.keys(event).sort()).toEqual(['bytes', 'durationMs', 'kind', 'outcome'])
      expect(JSON.stringify(event)).not.toContain('panel_1')
      expect(JSON.stringify(event)).not.toContain('sample.inspector')
    }
    expect(diagnostics[0]?.outcome).toBe('saved')
    expect(diagnostics[1]?.outcome).toBe('loaded')
  })

  it('keeps a single writer and exposes no timer job of its own', async () => {
    const timers = createTimers()
    const store = createPanelLayoutStore({ filePath, timers: timers.port })
    store.schedule(document())
    store.schedule(document({ layoutRevision: 8 }))
    expect(timers.pending()).toEqual([250]) // 只保留一个待写窗口，不新开定时 job
    timers.fire()
    await store.flush()
    expect(store.persistenceState()).toBe('saved')
    expect(timers.pending()).toEqual([]) // 不注册后台定时 job
    store.schedule(document({ layoutRevision: 9 }))
    expect(timers.pending()).toEqual([250]) // 需要时只arm一个待写窗口
  })
})

describe('cross-instance layout restore', () => {
  function registration(): WorkspacePanelRegistration {
    return {
      panelId: 'sample.inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
      module: 'sample.inspector', pageIds: ['sample.page-a'], supportedModes: ['embedded', 'docked-right', 'docked-bottom'],
      defaultMode: 'embedded', allowMultipleInstances: false,
      minSize: { width: 320, height: 240 }, preferredSize: { width: 480, height: 360 },
      binding: { persistence: 'durable', maxKeyBytes: 256 }, lifecycleEvents: ['open', 'close']
    }
  }

  it('restores the saved layout into a fresh runtime store after a real file round-trip', async () => {
    const registry = createPanelRegistry({ pageIds: ['sample.page-a'], moduleIds: ['sample.inspector'] })
    registry.register(registration())
    registry.seal()
    let created = 0
    const createOpaqueId = (prefix = 'id') => { created += 1; return `${prefix}_00000000-0000-4000-8000-${String(created).padStart(12, '0')}` }
    const source = createPanelWorkspaceStore({ panelRegistry: registry, pageIds: ['sample.page-a'], createOpaqueId })

    const page = await source.openWorkspace({ requestId: 'workspace', expectedRevision: 0, pageId: 'sample.page-a' })
    const panel = await source.openPanel({ requestId: 'open', expectedRevision: 1, hostEpoch: 1, workspaceInstanceKey: page.workspaceInstanceKey, panelId: 'sample.inspector', bindingKey: 'durable-key-a' })
    await source.resizePanel({ requestId: 'resize', expectedRevision: 2, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, dockSize: { width: 500, height: 400 } })
    await source.switchContainer({ requestId: 'dock', expectedRevision: 3, hostEpoch: 1, panelInstanceKey: panel.panelInstanceKey, mode: 'docked-bottom' })
    const before = source.getSnapshot()
    const exported = source.exportLayoutDocument({ savedAt: '2026-10-05T00:00:00.000Z' })
    expect(exported.status).toBe('ok')
    if (exported.status !== 'ok') return

    // P2-04：写路径只有 v2（面板载荷来自 runtime store，Tab 载荷由 P2-04 合成出口给出）
    const merged = buildWorkspaceLayoutDocumentV2({
      savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: exported.document.layoutRevision,
      panelDocument: exported.document,
      tabs: [{ workspaceInstanceKey: page.workspaceInstanceKey, pageId: 'sample.page-a', open: true, order: 0, mode: 'main' }],
      activeWorkspaceInstanceKey: page.workspaceInstanceKey
    })
    expect(merged.status).toBe('ok')
    if (merged.status !== 'ok') return
    const writer = createPanelLayoutStore({ filePath })
    writer.schedule(merged.document)
    await expect(writer.flush()).resolves.toMatchObject({ outcome: 'saved' })

    // 全新实例（等价于重启）：新 persistence store 读同一文件，新 runtime store 应用恢复
    const reader = createPanelLayoutStore({ filePath })
    const loaded = await reader.load()
    expect(loaded.outcome).toBe('loaded')
    expect(loaded.convertedFromV1).toBe(false)
    const target = createPanelWorkspaceStore({ panelRegistry: registry, pageIds: ['sample.page-a'], createOpaqueId })
    const applied = await target._restoreLayout({ requestId: 'restore', expectedRevision: 0, document: toPanelLayoutDocumentV1(loaded.document) })

    expect(applied.status).toBe('applied')
    const after = target.getSnapshot()
    expect(after.pageLayouts[0]?.panelOrder).toEqual(before.pageLayouts[0]?.panelOrder)
    expect(after.pageLayouts[0]?.activePanels).toEqual(before.pageLayouts[0]?.activePanels)
    expect(after.panels[0]).toMatchObject({ open: true, mode: 'docked-bottom', lastValidDock: 'docked-bottom', dockSize: { width: 500, height: 400 } })

    const raw = await readFile(filePath, 'utf8')
    expect(raw).not.toMatch(/windowInstanceId|hostEpoch|sessionKey|prompt|messages/)
    expect(raw).toContain('durable-key-a')
    // 单写证据：磁盘上只有 v2，绝不残留 v1 形状（无双写）
    const onDisk = JSON.parse(raw) as { schemaVersion: number; tabs: readonly unknown[] }
    expect(onDisk.schemaVersion).toBe(2)
    expect(onDisk.tabs).toHaveLength(1)
  })
})

/**
 * P2-04（用户批准的**唯一** v1→v2 转换例外）：写路径只有 v2；读到已 Accepted 的 v1 时
 * **一次性**升级并立刻压入待写槽，写完不再旧格式双写；未知版本一律保护原文件。
 */
describe('P2-04 v1→v2 一次性转换写', () => {
  function legacyFile(): string {
    return `${JSON.stringify({
      schemaVersion: 1, savedAt: '2026-10-05T00:00:00.000Z', layoutRevision: 4,
      workspaces: [
        { workspaceInstanceKey: 'workspace_legacy', pageId: 'sample.page-a', panelOrder: ['panel_legacy'], activePanels: { embedded: 'panel_legacy' } },
        { workspaceInstanceKey: 'workspace_second', pageId: 'sample.page-b', panelOrder: [], activePanels: {} }
      ],
      panels: [{
        panelInstanceKey: 'panel_legacy', workspaceInstanceKey: 'workspace_legacy', panelId: 'sample.inspector',
        binding: { key: 'durable-key-a' }, open: true, mode: 'docked-bottom', lastValidDock: 'docked-bottom',
        dockSize: { width: 500, height: 400 }
      }]
    }, null, 2)}\n`
  }

  it('读到 v1：同 panel ID 升为 v2、Tab 顺序与活动项确定性、并立刻有待写转换', async () => {
    await writeFile(filePath, legacyFile(), 'utf8')
    const store = createPanelLayoutStore({ filePath })
    const loaded = await store.load()

    expect(loaded).toMatchObject({ outcome: 'loaded', convertedFromV1: true, mayOverwrite: true })
    expect(loaded.document.schemaVersion).toBe(2)
    expect(loaded.document.panels[0]).toMatchObject({
      panelInstanceKey: 'panel_legacy', panelId: 'sample.inspector', binding: { key: 'durable-key-a' },
      mode: 'docked-bottom', lastValidDock: 'docked-bottom', dockSize: { width: 500, height: 400 }
    })
    expect(loaded.document.tabs.map((tab) => [tab.workspaceInstanceKey, tab.order, tab.open, tab.mode])).toEqual([
      ['workspace_legacy', 0, true, 'main'], ['workspace_second', 1, true, 'main']
    ])
    expect(loaded.document.activeWorkspaceInstanceKey).toBe('workspace_legacy')
    // 转换写已经在待写槽里（有界 0/1），还没落盘
    expect(store.persistenceState()).toBe('pending')
    expect(store.pendingWriteCount()).toBe(1)
  })

  it('flush 之后磁盘上只有 v2（无双写、可再次读入且不再触发转换）', async () => {
    await writeFile(filePath, legacyFile(), 'utf8')
    const store = createPanelLayoutStore({ filePath })
    await store.load()
    await expect(store.flush()).resolves.toMatchObject({ outcome: 'saved' })

    const raw = await readFile(filePath, 'utf8')
    const onDisk = JSON.parse(raw) as { schemaVersion: number; tabs: readonly { workspaceInstanceKey: string }[]; panels: readonly { panelInstanceKey: string }[] }
    expect(onDisk.schemaVersion).toBe(2)
    expect(onDisk.tabs.map((tab) => tab.workspaceInstanceKey)).toEqual(['workspace_legacy', 'workspace_second'])
    expect(onDisk.panels[0]?.panelInstanceKey).toBe('panel_legacy')
    expect(raw).not.toMatch(/"schemaVersion": 1/u)

    const again = await createPanelLayoutStore({ filePath }).load()
    expect(again.convertedFromV1).toBe(false) // v2 直通：绝不重复转换
    expect(again.document.tabs).toHaveLength(2)
  })

  it('损坏的 v1 不触发转换写：原文件逐字保留，直到显式 reset', async () => {
    await writeFile(filePath, '{ "schemaVersion": 1, broken', 'utf8')
    const store = createPanelLayoutStore({ filePath })
    const loaded = await store.load()
    expect(loaded).toMatchObject({ outcome: 'default', reason: 'corrupt', convertedFromV1: false, mayOverwrite: false })
    expect(store.pendingWriteCount()).toBe(0)
    expect(await readFile(filePath, 'utf8')).toBe('{ "schemaVersion": 1, broken')
  })

  it('v1 里的 session 残留 key 不会随转换写落盘（持久化语义由 registry 决定）', async () => {
    const legacy = JSON.parse(legacyFile()) as Record<string, unknown>
    ;(legacy.panels as Record<string, unknown>[])[0]!.binding = { key: 'session-leftover' }
    await writeFile(filePath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    const store = createPanelLayoutStore({ filePath })
    const loaded = await store.load()
    // store 只做形状转换；语义剪裁在 restore 端按注册表执行（见 workspaceLayoutV1Upgrade.test.ts）
    expect(loaded.convertedFromV1).toBe(true)
    expect(loaded.document.panels[0]?.binding).toEqual({ key: 'session-leftover' })
    await store.flush()
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({ schemaVersion: 2 })
  })
})
