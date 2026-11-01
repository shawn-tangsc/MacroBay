import { ProductIpcRegistryError, type ProductIpcRegistry } from '../ipc/productIpcRegistry'

/**
 * Renderer 最后一段时间仍会打 product IPC：退出/重启已经开始，产品服务与它们的 SQLite 连接
 * 已经或正在关闭。此时产品 handler 抛出的 `database is not open` 会穿过 `ipcMain.handle`，
 * Electron 把它打成 `Error occurred in handler for 'platform:product-ipc-invoke'` —— 一条
 * 退出期的未处理错误，既不是产品业务失败，也不是 renderer 能处理的响应。
 *
 * 这里只收敛「运行时已不可用」这一种情况，并**resolve** 一个结构化结果：
 * - resolve（而不是 reject）是必须的：`ipcMain.handle` 的 rejection 就会产生上面那条日志。
 * - 产品业务错误（参数非法、模型未配置、handler 的未知异常等）原样抛出，语义与日志行为不变。
 */
export const PRODUCT_IPC_UNAVAILABLE_CODE = 'platform-unavailable' as const

export type ProductIpcUnavailableResult = Readonly<{
  ok: false
  error: Readonly<{ code: typeof PRODUCT_IPC_UNAVAILABLE_CODE }>
}>

export type ProductIpcInvoke = (productId: string, method: string, payload?: unknown) => Promise<unknown>

/** 关闭后 DB 访问的错误文本（node:sqlite 及其它句柄式封装的常见措辞）。 */
const DATABASE_CLOSED_MESSAGES = [
  'database is not open',
  'database is closed',
  'database has been closed',
  'database connection is not open',
  'cannot operate on a closed database',
  'database handle is closed'
] as const

const databaseClosedCodes = new Set(['ERR_INVALID_STATE', 'SQLITE_MISUSE'])

export function createProductIpcUnavailableResult(): ProductIpcUnavailableResult {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code: PRODUCT_IPC_UNAVAILABLE_CODE })
  })
}

/** 已关闭的 DB 抛出的错误：只认关闭语义，避免把产品的业务失败误判为平台不可用。 */
export function isProductDatabaseClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  if (!DATABASE_CLOSED_MESSAGES.some((known) => message.includes(known))) return false
  const code = (error as { code?: unknown }).code
  // node:sqlite 用 ERR_INVALID_STATE，原生 sqlite 封装用 SQLITE_MISUSE；没有 code 时以措辞为准。
  return code === undefined || (typeof code === 'string' && databaseClosedCodes.has(code))
}

/** 运行时已不可用：登记表生命周期（未 seal / 启动失败 / 已关闭）或 DB 已经关闭。 */
export function isProductRuntimeUnavailableError(error: unknown): boolean {
  return error instanceof ProductIpcRegistryError || isProductDatabaseClosedError(error)
}

export type ProductIpcInvokerOptions = Readonly<{
  registry: Pick<ProductIpcRegistry, 'invoke'>
  /**
   * 退出清理一旦开始即为 true：不再触碰产品 handler（它们背后的 DB 正在关闭），
   * 直接把调用收敛成结构化 unavailable。
   */
  isRuntimeClosed?: () => boolean
}>

/**
 * `ipcMain.handle(IpcChannels.productIpcInvoke, ...)` 的包装：
 * 正常调用原样透传（含 undefined/falsy 返回值），只有运行时不可用时改写成结构化结果。
 */
export function createProductIpcInvoker(options: ProductIpcInvokerOptions): ProductIpcInvoke {
  return async (productId, method, payload) => {
    if (options.isRuntimeClosed?.()) return createProductIpcUnavailableResult()
    try {
      return await options.registry.invoke(productId, method, payload)
    } catch (error) {
      if (isProductRuntimeUnavailableError(error)) return createProductIpcUnavailableResult()
      throw error
    }
  }
}
