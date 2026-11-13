import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import type { CoreIndicatorSourcePrefsClient } from '../../../contracts/coreIndicatorSourcePrefs'

const PRODUCT_ID = 'market-intelligence'

function invoke<T>(method: string, payload?: unknown): Promise<T> {
  if (!window.platform?.products?.invoke) {
    // 与其它产品客户端同一条：返回 reject 而不是同步抛，调用方的 .catch 才接得住。
    return Promise.reject(new Error('Core indicator source prefs IPC bridge is unavailable.'))
  }
  return window.platform.products.invoke(PRODUCT_ID, method, payload) as Promise<T>
}

/**
 * 渲染层看到的第二层配置：两个动作。`read()` 只回显式**关掉**的键（缺键由调用方当作开）。
 */
export const coreIndicatorSourcePrefsClient: CoreIndicatorSourcePrefsClient = {
  async read() {
    return await invoke<Record<string, boolean>>(INTELLIGENCE_IPC_METHODS.readCoreIndicatorSourcePrefs)
  },
  async write(preferenceKey, enabled) {
    await invoke<void>(INTELLIGENCE_IPC_METHODS.setCoreIndicatorSourcePref, { preferenceKey, enabled })
  }
}
