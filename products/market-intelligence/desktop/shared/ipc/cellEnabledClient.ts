import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import type { CellEnabledClient } from '../../../contracts/cellEnabled'

const PRODUCT_ID = 'market-intelligence'

function invoke<T>(method: string, payload?: unknown): Promise<T> {
  if (!window.platform?.products?.invoke) {
    // 与其它产品客户端同一条：返回 reject 而不是同步抛，调用方的 .catch 才接得住。
    return Promise.reject(new Error('Cell-enabled IPC bridge is unavailable.'))
  }
  return window.platform.products.invoke(PRODUCT_ID, method, payload) as Promise<T>
}

/**
 * 渲染层看到的「格级启用」：只有读与写两个动作。
 *
 * `read()` 只回显式写过的格子（缺键由调用方当作启用）；`write()` 只动那一个格子。
 * 读失败**不会被吞**：调用方要按「启用」处理，是它自己显式 catch 的选择。
 */
export const cellEnabledClient: CellEnabledClient = {
  async read() {
    return await invoke<Record<string, boolean>>(INTELLIGENCE_IPC_METHODS.readCellEnabled)
  },
  async write(cellId, enabled) {
    await invoke<void>(INTELLIGENCE_IPC_METHODS.setCellEnabled, { cellId, enabled })
  }
}
