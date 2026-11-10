import { join } from 'node:path'

import { app } from 'electron'

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import { createCellEnabledStore, type CellEnabledStore } from '../application/cellEnabledStore'

const PRODUCT_ID = 'market-intelligence'

/**
 * 「格级启用」的 IPC：两个操作、一个共享实例。
 *
 * 存储只在主进程：渲染层拿不到路径、也不许自己拼文件。读失败**原样 reject**，
 * 不在 IPC 层吞掉——调用方按「启用」处理是它的显式决定，不是这里替它决定。
 */
export function registerCellEnabledIpc(register: ProductIpcRegistrar, store: CellEnabledStore): void {
  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.readCellEnabled, async () => store.readCellEnabled())
  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.setCellEnabled, async (payload) => {
    const parsed = parseCellEnabledWrite(payload)
    await store.setCellEnabled(parsed.cellId, parsed.enabled)
  })
}

/** 写入参数：`cellId` 必须是非空字符串、`enabled` 必须是布尔；坏参数直接抛，不猜。 */
export function parseCellEnabledWrite(payload: unknown): { cellId: string; enabled: boolean } {
  const record = (payload ?? {}) as { cellId?: unknown; enabled?: unknown }
  if (typeof record.cellId !== 'string' || record.cellId.length === 0) {
    throw new Error('cell-enabled: cellId must be a non-empty string')
  }
  if (typeof record.enabled !== 'boolean') {
    throw new Error('cell-enabled: enabled must be a boolean')
  }
  return { cellId: record.cellId, enabled: record.enabled }
}

let sharedStore: CellEnabledStore | undefined

/** 主进程唯一的那个实例：路径跟产品其它小文档同一个 userData 目录。 */
export function getCellEnabledStore(): CellEnabledStore {
  sharedStore ??= createCellEnabledStore(
    join(app.getPath('userData'), 'products', PRODUCT_ID, 'intelligence-cell-enabled.json')
  )
  return sharedStore
}
