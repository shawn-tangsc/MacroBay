/**
 * 允许策略的**入参形状校验**（从 `ChannelManagementService` 抽出来，只为体积门禁）。
 *
 * 三条硬要求，都是为了「存进去的那条策略能被入站判定原样用上」：
 * - `subjectType` 只认 `user` / `conversation`——别的值会让入站匹配根本走不到这一行；
 * - `key` 去空白后必须非空且 ≤512：空串会把「谁都不匹配」写成一条看起来存在的策略；
 * - `conversationKind` 缺省是 `null`（按会话类型不限定），给了就必须是三种之一。
 *
 * 坏形状一律抛 `channel-policy-invalid`，**不做能猜的默认值**：猜一个等于替读者选了一条策略。
 */
export function validatePolicy(value: unknown): {
  subjectType: 'user' | 'conversation'
  key: string
  conversationKind: 'direct' | 'group' | 'channel' | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('channel-policy-invalid')
  const policy = value as Record<string, unknown>
  if (policy.subjectType !== 'user' && policy.subjectType !== 'conversation') throw new Error('channel-policy-invalid')
  if (typeof policy.key !== 'string' || !policy.key.trim() || policy.key.length > 512) throw new Error('channel-policy-invalid')
  const conversationKind = policy.conversationKind ?? null
  if (conversationKind !== null && conversationKind !== 'direct' && conversationKind !== 'group' && conversationKind !== 'channel') {
    throw new Error('channel-policy-invalid')
  }
  return { subjectType: policy.subjectType, key: policy.key.trim(), conversationKind }
}
