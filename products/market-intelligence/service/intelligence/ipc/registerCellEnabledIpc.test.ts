import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProductIpcHandler, ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import { createCellEnabledStore, type CellEnabledStore } from '../application/cellEnabledStore'
import { registerCellEnabledIpc } from './registerCellEnabledIpc'

// 模块加载时会取 `app.getPath`：注册器只跑注册、不碰磁盘。
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

/**
 * 桥的两端：渲染层只认两个操作，主进程共享一个实例。
 *
 * 判据两条：① 写一个格子 → 读回含它（走的是同一份文件）；② 读失败**不在 IPC 层吞掉**，
 * 调用方才能自己决定「按启用处理」还是报错。
 */
const dirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cell-enabled-ipc-'))
  dirs.push(dir)
  return join(dir, 'intelligence-cell-enabled.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function capture(store: CellEnabledStore): Map<string, ProductIpcHandler> {
  const handlers = new Map<string, ProductIpcHandler>()
  const register: ProductIpcRegistrar = (_productId, method, handler) => { handlers.set(method, handler) }
  registerCellEnabledIpc(register, store)
  return handlers
}

describe('the cell-enabled IPC bridge', () => {
  it('round-trips one cell through the registered handlers', async () => {
    const handlers = capture(createCellEnabledStore(tempFile()))

    await handlers.get(INTELLIGENCE_IPC_METHODS.setCellEnabled)!({ cellId: 'quotes:ndx', enabled: false })
    const read = await handlers.get(INTELLIGENCE_IPC_METHODS.readCellEnabled)!(undefined) as Record<string, boolean>

    expect(read).toEqual({ 'quotes:ndx': false })
  })

  it('lets a read failure reject instead of swallowing it', async () => {
    const handlers = capture({
      readCellEnabled: async () => { throw new Error('cell-enabled: unreadable') },
      setCellEnabled: async () => undefined
    })

    await expect(Promise.resolve(handlers.get(INTELLIGENCE_IPC_METHODS.readCellEnabled)!(undefined)))
      .rejects.toThrow('cell-enabled: unreadable')
  })

  it('rejects a malformed write instead of guessing a cell id', async () => {
    const handlers = capture(createCellEnabledStore(tempFile()))

    await expect(Promise.resolve(handlers.get(INTELLIGENCE_IPC_METHODS.setCellEnabled)!({ cellId: '' })))
      .rejects.toThrow('cellId must be a non-empty string')
    await expect(Promise.resolve(handlers.get(INTELLIGENCE_IPC_METHODS.setCellEnabled)!({ cellId: 'a' })))
      .rejects.toThrow('enabled must be a boolean')
  })
})
