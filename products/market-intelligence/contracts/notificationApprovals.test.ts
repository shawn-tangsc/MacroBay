import { describe, expect, it } from 'vitest'

import { surfaceGroupMismatches } from '@platform/notifications/contracts/notificationSurfaceSelection'

import { MARKET_INTELLIGENCE_NOTIFICATION_APPROVALS as approvals } from './notificationApprovals'
import { marketIntelligenceProductManifest as manifest } from '../product.manifest'

/**
 * 情报模块**自己**签过的批准值（契约 §4.1）。这里断的全是本产品的事：
 * 平台侧不再替产品作证（b3-1：平台测试里不出现产品事件字面量），所以「哪几条、批了哪几档」
 * 从平台那张表搬到这里，事实与期望值逐字不变。
 */
const ids = Object.keys(approvals)
const declared = (manifest.notificationEvents ?? []).map((event) => event.id)
const levelsOf = (id: string) => approvals[id]!.approvedDisruptionLevels

describe('market-intelligence approvals', () => {
  it('signs exactly the events it declares, checked in both directions', () => {
    // 双向：签了没声明 = 死配置；声明了没签 = 读者看不见的窟窿（装配期只会退化成「只进中心」）。
    expect({
      signedWithoutDeclaration: ids.filter((id) => !declared.includes(id)),
      declaredWithoutSignature: declared.filter((id) => !ids.includes(id))
    }).toEqual({ signedWithoutDeclaration: [], declaredWithoutSignature: [] })
  })

  it('keeps desktop to the four failure/status events plus the finished briefing', () => {
    // 桌面对「信息类」不开放（用户原话：没打开应用还被轰炸）。2026-11-06 用户追加一条：
    // **日报生成成功**也要能弹；同日摘掉它的 `toast`——用户只说了桌面，「不弹应用内提示」是 11-04 的原话。
    // 顺序即签署文件里的顺序；新增或摘掉一条必须在这里显式改，不靠数字对上蒙过去。
    expect(ids.filter((id) => levelsOf(id).includes('desktop'))).toEqual([
      'market-intelligence.briefing.failed',
      'market-intelligence.briefing.ready',
      'market-intelligence.source.consecutive-failed',
      'market-intelligence.source.stale',
      'market-intelligence.timezone.invalid'
    ])
  })

  it('requests every surface the finished briefing was approved for, so no signed level is dead', () => {
    // 2026-11-04 用户翻案恢复「日报完成推手机」，11-06 又加了桌面档；批准表两档都批了。
    // 声明若仍写 []，运行时只会投中心——提交发生、读者收不到，正是这条要钉住的假实现。
    const ready = (manifest.notificationEvents ?? [])
      .find((event) => event.id === 'market-intelligence.briefing.ready')
    expect(ready?.requestedDisruptionLevels).toEqual(['channel', 'desktop'])
  })

  it('keeps the phone leg to the six events the user approved for it', () => {
    // N2 日报完成、N3 信号、N5 宏观事件、N11 事件开始前、N10 舆情、分析结论。
    // N10 与结论只批 center + channel——桌面与提示两档明确不加。
    expect(ids.filter((id) => levelsOf(id).includes('channel'))).toEqual([
      'market-intelligence.briefing.ready',
      'market-intelligence.signal.triggered',
      'market-intelligence.macro.event-landed',
      'market-intelligence.calendar.event-upcoming',
      'market-intelligence.sentiment.alert',
      'market-intelligence.analysis.conclusion'
    ])
  })

  it('leaves three events without a toast, on purpose', () => {
    // 提示默认开：关掉桌面时它是唯一的本机提醒。不批提示的三条都有理由，不是漏配：
    // - 日报完成：**桌面批准、提示不批**——11-04 用户原话「不弹提示」，11-06 只要求桌面通知，
    //   两格不是一回事，留着提示就是替他多要一次打扰（别顺手补回来）；
    // - N10 舆情：信息类，手机与中心就够；
    // - 分析结论：完成类，用户要的是「结论到了」这一声，反过来只在手机与中心（同向时由调用方收窄到中心）。
    expect(ids.filter((id) => !levelsOf(id).includes('toast'))).toEqual([
      'market-intelligence.briefing.ready',
      'market-intelligence.sentiment.alert',
      'market-intelligence.analysis.conclusion'
    ])
  })

  it('always keeps center and never approves a quiet-hours bypass', () => {
    // 「谁能穿透免打扰」在平台侧是自检那条；产品事件一条都不穿透（多放一条就是替读者多批一次打扰）。
    for (const id of ids) {
      expect(levelsOf(id), `${id} 必须含 center`).toContain('center')
      expect(approvals[id]!.approvedBypassQuietHours, `${id} 不应批准穿透免打扰`).toBe(false)
    }
  })

  it('keeps the calendar group honest: its two members approve the same selectable faces', () => {
    // 组内不一致 = 读者在「日历事件」里勾一次，只对一半生效。这条判据原来在平台测试里读那张共享表，
    // 现在读产品自己的签署文件——同一事实，来源换成它该有的那一份。
    expect(surfaceGroupMismatches(approvals)).toEqual([])
    expect(ids.filter((id) => approvals[id]!.surfaceGroup === 'calendar-events')).toEqual([
      'market-intelligence.macro.event-landed',
      'market-intelligence.calendar.event-upcoming'
    ])
  })

  it('registers neither the withdrawn calibration result nor the skipped interpreted signal', () => {
    // 裁定 A：不登记 signal.interpreted，编号跳过 N4，也不许换号补位。
    expect(declared).not.toContain('market-intelligence.signal.interpreted')
    // N8 calibration.result 2026-11-04 撤回：编号不复用，行也不留（留着就是静默复活的口子）。
    expect(declared).not.toContain('market-intelligence.calibration.result')
    expect(ids).not.toContain('market-intelligence.signal.interpreted')
    expect(ids).not.toContain('market-intelligence.calibration.result')
    // 完成类确实在：读者在情报页可以关掉它的手机推送。
    expect(ids).toContain('market-intelligence.briefing.ready')
  })
})
