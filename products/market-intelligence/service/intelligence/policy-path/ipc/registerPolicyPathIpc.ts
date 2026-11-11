import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import type { PolicyPathQueryService } from '../policyPathQueryService'

const productId = 'market-intelligence'

/** One read method: the block never writes, so nothing else is exposed. */
export const POLICY_PATH_IPC_METHODS = {
  read: 'intelligence.macro.policyPath.read'
} as const

export const policyPathIpcPolicy = {
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
} as const

export function registerPolicyPathIpc(
  register: ProductIpcRegistrar,
  service: Pick<PolicyPathQueryService, 'read'>,
  now: () => string = () => new Date().toISOString()
): void {
  register(productId, POLICY_PATH_IPC_METHODS.read, async (payload) => {
    const asOf = canonicalAsOf(payload) ?? now()
    const result = service.read({ asOf })
    // 失败码是日历那一条读的原始结论，不在这里写死：卡片要靠它分「没有会议 / 查不到 / 请求不合法」。
    return result.state === 'available'
      ? { state: 'available' as const, asOf, reading: result.reading }
      : { state: 'unavailable' as const, failureCode: result.failureCode }
  })
}

function canonicalAsOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const value = (payload as { asOf?: unknown }).asOf
  return typeof value === 'string' && policyPathIpcPolicy.canonicalUtcMillisPattern.test(value) ? value : undefined
}
