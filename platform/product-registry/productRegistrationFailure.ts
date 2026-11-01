/**
 * 产品注册失败时，把「哪个产品」带在错误上。
 *
 * 生成的 `products/generated/productServices.ts` 里，每个产品单独包一层：平台层的
 * `registerProductServices(deps)` 是一次聚合调用，抛错时只知道「这次调用失败了」，
 * 不知道是谁失败了。启动失败日志与失败页要显示「产品模块『情报』未能注册」，这个 id
 * 只有注册处知道，所以在这里挂上，不做第二份记录。
 */

export class ProductRegistrationFailure extends Error {
  readonly productId: string

  constructor(productId: string, cause: unknown) {
    super(`product "${productId}" failed to register: ${describeCause(cause)}`, { cause })
    this.name = 'ProductRegistrationFailure'
    this.productId = productId
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message || cause.name
  if (typeof cause === 'string') return cause
  try {
    return JSON.stringify(cause)
  } catch {
    return String(cause)
  }
}

/** 从任意抛出的值里取出产品 id；不是注册失败就返回 `null`，不猜。 */
export function productIdOf(error: unknown): string | null {
  return error instanceof ProductRegistrationFailure ? error.productId : null
}

/** 包住一个产品的注册：失败时抛出带 id 的错误，原始错误留在 `cause` 里。 */
export async function runProductRegistration(
  productId: string,
  register: () => Promise<void> | void
): Promise<void> {
  try {
    await register()
  } catch (error) {
    // 已经带了 id 的错误不再包一层：嵌套会把原始原因埋深，日志里那句话也读不出来。
    throw productIdOf(error) === null ? new ProductRegistrationFailure(productId, error) : error
  }
}
