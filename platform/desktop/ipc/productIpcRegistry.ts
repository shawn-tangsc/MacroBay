/**
 * Platform 层通用 Product IPC 注册表。
 *
 * 设计目标：
 * - Platform 只提供「按 productId + method 分发」的传输能力，不编码任何产品域语义。
 * - 各产品在自己的 `service/bootstrap.ts` 中注册 handler，经生成的
 *   `products/generated/productServices.ts` 汇总后，由 main 进程在启动时注入。
 *
 * 调用链：
 *   Renderer → preload `window.platform.products.invoke(id, method, payload)`
 *          → main `platform:product-ipc-invoke`
 *          → 本 registry 查找 handler
 *          → 产品 handler（例如 sample-product 的 example.get）
 */
export type ProductIpcHandler = (payload: unknown) => unknown | Promise<unknown>

/** 产品注册 IPC 方法时使用的回调签名。 */
export type ProductIpcRegistrar = (productId: string, method: string, handler: ProductIpcHandler) => void

export type ProductIpcMethod = Readonly<{ productId: string; method: string }>

export type ProductIpcRegistryErrorCode = 'product-runtime-booting' | 'product-runtime-unavailable'

export class ProductIpcRegistryError extends Error {
  constructor(readonly code: ProductIpcRegistryErrorCode) {
    super(code)
    this.name = 'ProductIpcRegistryError'
  }
}

export type ProductIpcRegistry = {
  register: ProductIpcRegistrar
  seal: (expectedMethods?: readonly ProductIpcMethod[]) => readonly ProductIpcMethod[]
  markUnavailable: () => void
  invoke: (productId: string, method: string, payload?: unknown) => Promise<unknown>
}

/** 将 productId 与 method 组合为 Map 键，避免不同产品的方法名冲突。 */
function toHandlerKey(productId: string, method: string): string {
  return `${productId}:${method}`
}

export function createProductIpcRegistry(): ProductIpcRegistry {
  const handlers = new Map<string, ProductIpcHandler>()
  const methods: ProductIpcMethod[] = []
  let state: 'booting' | 'active' | 'unavailable' = 'booting'

  return {
    register(productId, method, handler) {
      if (state !== 'booting') throw new Error('Product IPC registry is sealed.')
      const key = toHandlerKey(productId, method)
      if (handlers.has(key)) throw new Error(`Duplicate product IPC method "${productId}.${method}".`)
      handlers.set(key, handler)
      methods.push({ productId, method })
    },
    seal(expectedMethods) {
      if (state !== 'booting') throw new Error('Product IPC registry is sealed.')
      if (expectedMethods && !hasSameMethods(methods, expectedMethods)) {
        throw new Error('product-runtime-method-baseline-mismatch')
      }
      state = 'active'
      return methods
    },
    markUnavailable() {
      if (state === 'active') throw new Error('Product IPC registry is sealed.')
      state = 'unavailable'
    },
    async invoke(productId, method, payload) {
      if (state === 'booting') throw new ProductIpcRegistryError('product-runtime-booting')
      if (state === 'unavailable') throw new ProductIpcRegistryError('product-runtime-unavailable')
      const handler = handlers.get(toHandlerKey(productId, method))
      if (!handler) {
        throw new Error(`Unknown product IPC method "${productId}.${method}".`)
      }
      return handler(payload)
    }
  }
}

function hasSameMethods(
  actualMethods: readonly ProductIpcMethod[],
  expectedMethods: readonly ProductIpcMethod[]
): boolean {
  if (actualMethods.length !== expectedMethods.length) return false
  const expectedKeys = new Set(expectedMethods.map(({ productId, method }) => toHandlerKey(productId, method)))
  return expectedKeys.size === expectedMethods.length
    && actualMethods.every(({ productId, method }) => expectedKeys.has(toHandlerKey(productId, method)))
}
