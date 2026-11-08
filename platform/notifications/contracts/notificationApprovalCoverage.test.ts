import { approvalCoverageCounts } from './notificationApprovalCoverage'
import { describe, expect, it } from 'vitest'

import {
  formatApprovalCoverage,
  formatApprovalGaps,
  inspectApprovalCoverage
} from './notificationApprovalCoverage'
import type { NotificationEventDeclaration } from './notificationEventCatalog'

/**
 * 「0 missing」守卫（契约 §7.1b 第 6 条）。它拦的是一种特别难发现的错：
 * **兜底删了、用例全绿、但有一条没迁**——那一刻一切看起来都对，直到某个产品事件永远不响。
 * 所以每一类缺口都必须能报出来，一条不缺时必须为空。
 */
function declaration(id: string, requested: readonly ('toast' | 'desktop' | 'channel')[]): NotificationEventDeclaration {
  return {
    id,
    titleKey: `${id}.title`,
    reasonKey: `${id}.reason`,
    requiresUserAction: false,
    requestedDisruptionLevels: requested,
    category: 'reminder',
    dedupeUnit: 'occurrence'
  }
}

/** 来源自己的批准行：批准随声明走，这个文件里没有第二个地方能批一条事件。 */
const approved = (
  levels: readonly ('center' | 'toast' | 'desktop' | 'channel')[],
  extra: { surfaceGroup?: string } = {}
) => ({ approvedDisruptionLevels: levels, approvedBypassQuietHours: false, ...extra })

describe('notification approval coverage', () => {
  it('reports a declaration that carries no approval at all, by event id', () => {
    const coverage = inspectApprovalCoverage([{
      productId: 'acme.demo',
      events: [declaration('acme.demo.render', ['desktop'])]
    }])
    expect(coverage).toMatchObject({ declared: 1, approved: 0 })
    expect(coverage.gaps).toEqual([{ kind: 'missing', productId: 'acme.demo', eventId: 'acme.demo.render' }])
    // 断结构，不断一整行文本；单体 id 逐条点名另有用例。
    expect(approvalCoverageCounts(coverage)).toEqual({
      declared: 1, approved: 0, missing: 1, pending: 1, orphaned: 0, requestedNotApproved: 0
    })
    expect(formatApprovalGaps(coverage)).toEqual(['missing acme.demo.render'])
  })

  it('reports an approval row nobody declares: dead config is a gap, not silence', () => {
    const coverage = inspectApprovalCoverage([{
      productId: 'acme.demo',
      events: [declaration('acme.demo.render', [])],
      approval: {
        'acme.demo.render': approved(['center']),
        'acme.demo.gone': approved(['center'])
      }
    }])
    expect(coverage.gaps).toEqual([{ kind: 'orphaned', productId: 'acme.demo', eventId: 'acme.demo.gone' }])
  })

  it('reports a requested level the approval never granted, including the phone', () => {
    const coverage = inspectApprovalCoverage([{
      productId: 'acme.demo',
      events: [declaration('acme.demo.ready', ['toast', 'channel'])],
      approval: { 'acme.demo.ready': approved(['center', 'toast']) }
    }])
    // 手机没批就申请，是迁移里最常见的抄错；`channel` 不再有「没批按未批准处理」的宽容位。
    expect(coverage.gaps).toEqual([
      { kind: 'requested-not-approved', productId: 'acme.demo', eventId: 'acme.demo.ready', level: 'channel' }
    ])
  })

  it('is empty when every declaration carries its approval', () => {
    const coverage = inspectApprovalCoverage([{
      productId: 'acme.demo',
      events: [
        declaration('acme.demo.ready', ['channel']),
        declaration('acme.demo.failed', ['desktop'])
      ],
      approval: {
        'acme.demo.ready': approved(['center', 'channel']),
        'acme.demo.failed': approved(['center', 'toast', 'desktop'], { surfaceGroup: 'alerts' })
      }
    }])
    expect(coverage.gaps).toEqual([])
    expect(approvalCoverageCounts(coverage)).toEqual({
      declared: 2, approved: 2, missing: 0, pending: 0, orphaned: 0, requestedNotApproved: 0
    })
  })
})
