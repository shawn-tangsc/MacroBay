import { join } from 'node:path'

import { app } from 'electron'

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import {
  createCoreIndicatorSourcePrefsStore,
  type CoreIndicatorSourcePrefs
} from '../application/coreIndicatorSourcePrefsStore'

const PRODUCT_ID = 'market-intelligence'

/**
 * 「指标 × 源」第二层配置的 IPC：两个操作、一个共享实例。
 *
 * 存储只在主进程；读失败**原样 reject**（调用方按「开」处理是它的显式决定，不是这里替它决定）。
 */
export function registerCoreIndicatorSourcePrefsIpc(
  register: ProductIpcRegistrar,
  store: CoreIndicatorSourcePrefs
): void {
  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.readCoreIndicatorSourcePrefs, async () => store.readDisabled())
  register(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.setCoreIndicatorSourcePref, async (payload) => {
    const parsed = parseCoreIndicatorSourcePrefWrite(payload)
    await store.setSourceEnabled(parsed.preferenceKey, parsed.enabled)
  })
}

/** 写入参数：`preferenceKey` 必须是非空字符串、`enabled` 必须是布尔；坏参数直接抛，不猜。 */
export function parseCoreIndicatorSourcePrefWrite(payload: unknown): { preferenceKey: string; enabled: boolean } {
  const record = (payload ?? {}) as { preferenceKey?: unknown; enabled?: unknown }
  if (typeof record.preferenceKey !== 'string' || record.preferenceKey.length === 0) {
    throw new Error('core-indicator-sources: preferenceKey must be a non-empty string')
  }
  if (typeof record.enabled !== 'boolean') {
    throw new Error('core-indicator-sources: enabled must be a boolean')
  }
  return { preferenceKey: record.preferenceKey, enabled: record.enabled }
}

let sharedStore: CoreIndicatorSourcePrefs | undefined

export function getCoreIndicatorSourcePrefsStore(): CoreIndicatorSourcePrefs {
  sharedStore ??= createCoreIndicatorSourcePrefsStore(
    join(app.getPath('userData'), 'products', PRODUCT_ID, 'intelligence-core-indicator-sources.json')
  )
  return sharedStore
}
