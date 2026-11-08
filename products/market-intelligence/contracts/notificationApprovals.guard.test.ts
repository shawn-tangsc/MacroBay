import { describe, expect, it } from 'vitest'

import { signApprovals } from './approvalCanonical'
import {
  MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS,
  SIGNATURE,
  SIGNED_AT,
  SIGNED_BY
} from './notificationApprovals'

/**
 * **签名守卫**：改任一档而不同时改 `SIGNATURE` → 红。
 *
 * 这里只**调**配置线那份规范化（`signApprovals`），不复制一行逻辑——出现第二份实现，
 * 守卫就会守着一个和签署时不一样的东西。
 */
/**
 * 规范化要求 `surfaceGroup` **显式**（缺失必须是 `null`，不许靠「没这个键」）。数据文件里省略等于没写，
 * 所以在签名/校验的入口一次补齐——这一步是**数据准备**，不是第二份规范化。
 */
const asSignedEvents = () => Object.fromEntries(
  Object.entries(MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS).map(([id, entry]) => [id, { ...entry, surfaceGroup: entry.surfaceGroup ?? null }])
)

describe('signed approvals', () => {
  it('recomputes to the signature stored in the file', () => {
    expect(signApprovals({
      formatVersion: 1,
      events: asSignedEvents(),
      signedBy: SIGNED_BY,
      signedAt: SIGNED_AT
    })).toBe(SIGNATURE)
  })

  it('goes red when one level changes without re-signing', () => {
    // 反向证明：去掉手机档，签名与文件里的不一致——这就是「值漂了没人知道」的那道闸。
    const drifted = {
      ...asSignedEvents(),
      'market-intelligence.sentiment.alert': { approvedDisruptionLevels: ['center' as const], approvedBypassQuietHours: false, surfaceGroup: null }
    }
    expect(signApprovals({ formatVersion: 1, events: drifted, signedBy: SIGNED_BY, signedAt: SIGNED_AT })).not.toBe(SIGNATURE)
  })
})
