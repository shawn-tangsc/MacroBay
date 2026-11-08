import { describe, expect, it } from 'vitest'

import {
  deriveApprovalView,
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
function declaration(id: string, requested: readonly ('toast' | 'desktop' | 'channel')[], policy?: {
  approvedDisruptionLevels: readonly ('center' | 'toast' | 'desktop' | 'channel')[]
  approvedBypassQuietHours: boolean
  surfaceGroup?: string
}): NotificationEventDeclaration {
  return {
    id,
    titleKey: `${id}.title`,
    reasonKey: `${id}.reason`,
    requiresUserAction: false,
    requestedDisruptionLevels: requested,
    category: 'reminder',
    dedupeUnit: 'occurrence',
    ...(policy === undefined ? {} : { policy })
  }
}

describe('notification approval coverage', () => {
  it('derives the approval view from the declarations, never from a second hand-written map', () => {
    const derived = deriveApprovalView([{
      productId: 'acme.demo',
      events: [declaration('acme.demo.ready', ['channel'], {
        approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false
      })]
    }])
    expect(derived[0]!.approval).toEqual({
      'acme.demo.ready': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
    })
  })

  it('reports a declaration that carries no approval at all, by event id', () => {
    const coverage = inspectApprovalCoverage([{
      productId: 'acme.demo',
      events: [declaration('acme.demo.render', ['desktop'])]
    }])
    expect(coverage).toMatchObject({ declared: 1, approved: 0 })
    expect(coverage.gaps).toEqual([{ kind: 'missing', productId: 'acme.demo', eventId: 'acme.demo.render' }])
    // 一行结论要能直接贴进提交说明。
    expect(formatApprovalCoverage(coverage)).toBe(
      'declared=1 approved=0 missing=1 orphaned=0 requested-not-approved=0'
    )
    expect(formatApprovalGaps(coverage)).toEqual(['missing acme.demo.render'])
  })

  it('reports an approval row nobody declares: dead config is a gap, not silence', () => {
    const coverage = inspectApprovalCoverage([{
      productId: 'acme.demo',
      events: [declaration('acme.demo.render', [], {
        approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false
      })],
      approval: {
        'acme.demo.render': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
        'acme.demo.gone': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
      }
    }])
    expect(coverage.gaps).toEqual([{ kind: 'orphaned', productId: 'acme.demo', eventId: 'acme.demo.gone' }])
  })

  it('reports a requested level the approval never granted, including the phone', () => {
    const coverage = inspectApprovalCoverage([{
      productId: 'acme.demo',
      events: [declaration('acme.demo.ready', ['toast', 'channel'], {
        approvedDisruptionLevels: ['center', 'toast'], approvedBypassQuietHours: false
      })]
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
        declaration('acme.demo.ready', ['channel'], {
          approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false
        }),
        declaration('acme.demo.failed', ['desktop'], {
          approvedDisruptionLevels: ['center', 'toast', 'desktop'], approvedBypassQuietHours: false, surfaceGroup: 'alerts'
        })
      ]
    }])
    expect(coverage.gaps).toEqual([])
    expect(formatApprovalCoverage(coverage)).toBe(
      'declared=2 approved=2 missing=0 orphaned=0 requested-not-approved=0'
    )
  })
})
