/**
 * 频道投递面两条只读分页（尝试记录 / 投递审计）。抽出来只为守住管理服务的 500 行硬线：
 * 它们不碰写路径，只做「校验 id → 微信回空 → 夹紧分页」三件事。
 */
import type { ChannelManagementRepository } from './ChannelManagementRepository'
import { assertBoundedInteger } from './ChannelManagementContracts'

type QueryHost = Pick<ChannelManagementRepository, 'channelType' | 'query'>

export function listDeliveryAttemptsFor(host: QueryHost, id: string, input: { limit?: unknown; offset?: unknown }) {
  if (host.channelType(id) === 'wechat') return []
  return host.query.deliveryAttempts(
    id,
    assertBoundedInteger(input.limit, 50, 100) || 1,
    assertBoundedInteger(input.offset, 0, 10_000)
  )
}

export function listDeliveryAuditsFor(host: QueryHost, id: string, input: { limit?: unknown; offset?: unknown }) {
  if (host.channelType(id) === 'wechat') return []
  return host.query.deliveryAudits(
    id,
    assertBoundedInteger(input.limit, 50, 100) || 1,
    assertBoundedInteger(input.offset, 0, 10_000)
  )
}
