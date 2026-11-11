import { describe, expect, it } from 'vitest'

import { MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS as approvals } from './notificationApprovals'

/**
 * **N40⑧：批准文件与产品签署表逐条比值，差异必须为 0。**
 *
 * 为什么需要它：覆盖率型守卫只回答「**有没有**」，不回答「**是不是那个**」。把 `sentiment.alert`
 * 的 `center + channel` 抄成 `center + channel + desktop`，`missing` 与 `orphaned` 两个数照样是 0，
 * 读者却开始在桌面上收到本来只想在手机上看到的东西。这类错在所有「有没有漏」的检查前都是隐形的，
 * 只有逐行比值抓得住。
 *
 * 签署表来源（**不在代码里 import**，否则就是拿同一份数据跟自己比、恒真）：
 * - 契约 §4.1 那十行的档位，由情报模块产品经理签署（`SIGNED_BY` / `SIGNED_AT` 见批准文件）；
 * - 需求 §十四（舆情）、§十六（日历两段与其余情报事件）是这三处「看起来不合理」的依据：
 *   `briefing.ready` 桌面批、提示不批（2026-11-06 用户只说要桌面）；两条日历事件同组同档；
 *   `sentiment.alert` 只有 `center + channel`。
 *
 * 改这里的期望值 = 改产品决定：必须由签署人改并从批准文件一侧同步，两步一起走。
 */
const SIGNED_TABLE: Readonly<Record<string, Readonly<{
  levels: readonly string[]
  bypassQuietHours: boolean
  surfaceGroup?: string
}>>> = Object.freeze({
  'market-intelligence.briefing.failed': { levels: ['center', 'toast', 'desktop'], bypassQuietHours: false },
  // 桌面批、提示不批：2026-11-06 用户只说要桌面通知，提示是另一种打扰，不能顺手留下。
  'market-intelligence.briefing.ready': { levels: ['center', 'channel', 'desktop'], bypassQuietHours: false },
  'market-intelligence.signal.triggered': { levels: ['center', 'toast', 'channel'], bypassQuietHours: false },
  // 两条日历事件同一个组键、且档位必须一致：读者只勾一次，组内可用面取两条的交集。
  'market-intelligence.macro.event-landed': { levels: ['center', 'toast', 'channel'], bypassQuietHours: false, surfaceGroup: 'calendar-events' },
  'market-intelligence.calendar.event-upcoming': { levels: ['center', 'toast', 'channel'], bypassQuietHours: false, surfaceGroup: 'calendar-events' },
  /**
   * 刷新失败（2026-11-11 用户「失败了，要通知」，同日情报模块产品经理签署）：**只有中心 + 桌面**，
   * 没有手机（后台维护事件，读者当场做不了事；持续性失败由 `source.consecutive-failed` 负责），
   * 也不绕过免打扰（凌晨打断没有收益）。
   */
  'market-intelligence.calendar.refresh-failed': { levels: ['center', 'desktop'], bypassQuietHours: false },
  'market-intelligence.source.consecutive-failed': { levels: ['center', 'toast', 'desktop'], bypassQuietHours: false },
  'market-intelligence.source.stale': { levels: ['center', 'toast', 'desktop'], bypassQuietHours: false },
  'market-intelligence.timezone.invalid': { levels: ['center', 'toast', 'desktop'], bypassQuietHours: false },
  // 只批中心与手机：桌面与提示从没签过，补上一格就会在桌面弹舆情。
  'market-intelligence.sentiment.alert': { levels: ['center', 'channel'], bypassQuietHours: false },
  'market-intelligence.analysis.conclusion': { levels: ['center', 'channel'], bypassQuietHours: false }
})

type ApprovalLike = Readonly<Record<string, Readonly<{
  approvedDisruptionLevels: readonly string[]
  approvedBypassQuietHours: boolean
  surfaceGroup?: string
}>>>

/**
 * 逐行比值。**比较集合、不比较顺序**（档位的书写顺序不是语义；规范化另有 `approvalCanonical`），
 * 但重复项照样报——重复意味着这一行本身写坏了。
 * 返回空数组 = 差异 0。
 */
export function diffAgainstSignedTable(table: ApprovalLike): readonly string[] {
  const differences: string[] = []
  const signedIds = Object.keys(SIGNED_TABLE).sort()
  const actualIds = Object.keys(table).sort()
  for (const id of signedIds.filter((id) => !actualIds.includes(id))) differences.push(`missing:${id}`)
  for (const id of actualIds.filter((id) => !signedIds.includes(id))) differences.push(`orphaned:${id}`)

  for (const id of signedIds.filter((id) => actualIds.includes(id))) {
    const expected = SIGNED_TABLE[id]!
    const actual = table[id]!
    const levels = [...actual.approvedDisruptionLevels].sort()
    const expectedLevels = [...expected.levels].sort()
    if (new Set(levels).size !== levels.length) differences.push(`duplicate-level:${id}:${levels.join(',')}`)
    if (levels.join(',') !== expectedLevels.join(',')) {
      differences.push(`levels:${id}:signed=${expectedLevels.join(',')}:actual=${levels.join(',')}`)
    }
    if (actual.approvedBypassQuietHours !== expected.bypassQuietHours) {
      differences.push(`bypass-quiet-hours:${id}:${String(actual.approvedBypassQuietHours)}`)
    }
    if ((actual.surfaceGroup ?? undefined) !== expected.surfaceGroup) {
      differences.push(`surface-group:${id}:${actual.surfaceGroup ?? 'none'}`)
    }
  }
  return differences
}

describe('notification approvals match the signed table', () => {
  it('differs from the signed table nowhere — row by row, values not just counts', () => {
    expect(diffAgainstSignedTable(approvals)).toEqual([])
  })

  it('catches one extra level on a single row (the invisible-to-coverage failure)', () => {
    // 反向验证：`sentiment.alert` 多加一格 `desktop` —— 覆盖率仍会报 0 缺 0 多，只有逐行比值能抓到。
    const mutated: ApprovalLike = {
      ...approvals,
      'market-intelligence.sentiment.alert': {
        ...approvals['market-intelligence.sentiment.alert']!,
        approvedDisruptionLevels: ['center', 'channel', 'desktop']
      }
    }
    expect(diffAgainstSignedTable(mutated)).toEqual([
      'levels:market-intelligence.sentiment.alert:signed=center,channel:actual=center,channel,desktop'
    ])
  })

  it('catches a missing row, an extra row, a changed group and a flipped quiet-hours flag', () => {
    const base: ApprovalLike = approvals
    const withoutOne = Object.fromEntries(Object.entries(base).filter(([id]) => id !== 'market-intelligence.source.stale'))
    expect(diffAgainstSignedTable(withoutOne)).toContain('missing:market-intelligence.source.stale')

    const extraRow: ApprovalLike = {
      ...base,
      'market-intelligence.not-signed': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
    }
    expect(diffAgainstSignedTable(extraRow)).toContain('orphaned:market-intelligence.not-signed')

    const wrongGroup: ApprovalLike = {
      ...base,
      'market-intelligence.calendar.event-upcoming': {
        ...base['market-intelligence.calendar.event-upcoming']!,
        surfaceGroup: 'calendar'
      }
    }
    expect(diffAgainstSignedTable(wrongGroup)).toContain('surface-group:market-intelligence.calendar.event-upcoming:calendar')

    const bypassOn: ApprovalLike = {
      ...base,
      'market-intelligence.briefing.failed': {
        ...base['market-intelligence.briefing.failed']!,
        approvedBypassQuietHours: true
      }
    }
    expect(diffAgainstSignedTable(bypassOn)).toContain('bypass-quiet-hours:market-intelligence.briefing.failed:true')
  })
})
