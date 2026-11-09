import { app } from 'electron'

/**
 * 同一份 userData 只允许一个进程：崩溃收尾的 `ownerBootId` 判据依赖它
 * （新进程起来 ⇒ 旧 owner 必然不在了）。产品验收档下不抢锁，保持原来的可并行行为。
 */
export function requestRuntimeSingleInstanceLock(productAcceptanceEnabled: boolean): boolean {
  if (productAcceptanceEnabled) return true
  return app.requestSingleInstanceLock()
}
