import { describe, expect, it } from 'vitest'

import { canonicalApprovalText, signApprovals, type SignedApprovalDocument } from './approvalCanonical'

/**
 * 反误绿闸：先钉**规范化后的字符串**，再钉哈希。
 *
 * 只钉哈希不够——如果有人改了排序、空白或转义，而基准哈希也跟着重算，两边会一起变绿，
 * 守卫看着在跑，其实谁改都放行。字符串逐字断言先于哈希报错。
 */
const FIXTURE: SignedApprovalDocument = {
  formatVersion: 1,
  signedBy: '情报模块产品经理',
  signedAt: '2026-11-08',
  events: {
    // 输入故意按枚举习惯写（channel 在 center 前），规范化后必须按 ASCII 字典序。
    'market-intelligence.signal.triggered': {
      approvedBypassQuietHours: false,
      approvedDisruptionLevels: ['toast', 'channel', 'center'],
      surfaceGroup: null
    },
    'market-intelligence.analysis.conclusion': {
      approvedBypassQuietHours: false,
      approvedDisruptionLevels: ['channel', 'center'],
      surfaceGroup: null
    }
  }
}

const EXPECTED_CANONICAL = '{"events":{"market-intelligence.analysis.conclusion":{"approvedBypassQuietHours":false,"approvedDisruptionLevels":["center","channel"],"surfaceGroup":null},"market-intelligence.signal.triggered":{"approvedBypassQuietHours":false,"approvedDisruptionLevels":["center","channel","toast"],"surfaceGroup":null}},"formatVersion":1,"signedAt":"2026-11-08","signedBy":"情报模块产品经理"}'
const EXPECTED_SIGNATURE = 'sha256:bd1d4cb59e81468bffa2b6578e03ed998e09d27879c544a763e1647d8636bb50'

/** 一条最小合法文档，按需覆盖单个字段做反向用例。 */
function document(overrides: { events?: unknown; signedBy?: string; signedAt?: string } = {}): SignedApprovalDocument {
  return {
    formatVersion: 1,
    signedBy: overrides.signedBy ?? '情报模块产品经理',
    signedAt: overrides.signedAt ?? '2026-11-08',
    events: (overrides.events ?? {
      'market-intelligence.signal.triggered': {
        approvedBypassQuietHours: false,
        approvedDisruptionLevels: ['center'],
        surfaceGroup: null
      }
    }) as SignedApprovalDocument['events']
  }
}

describe('approval canonicalisation', () => {
  it('pins the exact canonical string before the hash, so a rule change cannot stay green', () => {
    expect(canonicalApprovalText(FIXTURE)).toBe(EXPECTED_CANONICAL)
    expect(signApprovals(FIXTURE)).toBe(EXPECTED_SIGNATURE)
    // 无空白、无换行、无尾随换行：这三个是「字符串断言」里最容易被人放宽的部分。
    expect(EXPECTED_CANONICAL).not.toMatch(/\s/u)
    expect(EXPECTED_CANONICAL.endsWith('}')).toBe(true)
  })

  it('sorts levels by ASCII order, so the input order does not matter', () => {
    const sorted = document({
      events: {
        'market-intelligence.signal.triggered': {
          approvedBypassQuietHours: false,
          approvedDisruptionLevels: ['toast', 'center', 'channel'],
          surfaceGroup: null
        }
      }
    })
    const shuffled = document({
      events: {
        'market-intelligence.signal.triggered': {
          approvedBypassQuietHours: false,
          approvedDisruptionLevels: ['channel', 'toast', 'center'],
          surfaceGroup: null
        }
      }
    })
    expect(canonicalApprovalText(shuffled)).toBe(canonicalApprovalText(sorted))
    expect(signApprovals(shuffled)).toBe(signApprovals(sorted))
  })

  it('rejects a repeated level instead of de-duplicating it', () => {
    const duplicated = document({
      events: {
        'market-intelligence.signal.triggered': {
          approvedBypassQuietHours: false,
          approvedDisruptionLevels: ['center', 'center'],
          surfaceGroup: null
        }
      }
    })
    expect(() => canonicalApprovalText(duplicated)).toThrow('approval-levels-duplicated')
  })

  it('rejects a missing approvedBypassQuietHours instead of reading it as false', () => {
    const missingBypass = document({
      events: {
        'market-intelligence.signal.triggered': {
          approvedDisruptionLevels: ['center'],
          surfaceGroup: null
        }
      }
    })
    expect(() => canonicalApprovalText(missingBypass)).toThrow('approval-bypass-missing')
  })

  it('rejects an entry that omits surfaceGroup, because absent is not null', () => {
    const missingSurface = document({
      events: {
        'market-intelligence.signal.triggered': {
          approvedBypassQuietHours: false,
          approvedDisruptionLevels: ['center']
        }
      }
    })
    expect(() => canonicalApprovalText(missingSurface)).toThrow(/surfaceGroup/u)
  })

  it('rejects an empty events map', () => {
    expect(() => canonicalApprovalText(document({ events: {} }))).toThrow(/events/u)
  })

  it('signs the same value whether signedBy arrives as NFC or NFD', () => {
    const composed = document({ signedBy: '\u00e9' })
    const decomposed = document({ signedBy: 'e\u0301' })
    expect(decomposed.signedBy).not.toBe(composed.signedBy)
    expect(signApprovals(decomposed)).toBe(signApprovals(composed))
  })
})
