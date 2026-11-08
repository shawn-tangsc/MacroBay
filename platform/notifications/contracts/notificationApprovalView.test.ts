import { describe, expect, it } from 'vitest'

import { mergeApprovalView } from './notificationApprovalView'
import type { NotificationEventDeclarationSource } from './notificationEventCatalog'

const platform: NotificationEventDeclarationSource = {
  productId: 'platform',
  events: [],
  approval: { 'platform.one': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false } }
}
const product: NotificationEventDeclarationSource = {
  productId: 'acme.demo',
  events: [],
  approval: { 'acme.demo.one': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false } }
}

describe('mergeApprovalView', () => {
  it('merges platform and product approvals into one view', () => {
    const view = mergeApprovalView([platform, product])
    expect(Object.keys(view).sort()).toEqual(['acme.demo.one', 'platform.one'])
  })

  it('leaves an unapproved event out entirely, instead of defaulting it to the centre', () => {
    const view = mergeApprovalView([{ productId: 'acme.demo', events: [] }])
    expect(view['acme.demo.unapproved']).toBeUndefined()
    expect(Object.keys(view)).toEqual([])
  })

  it('throws even when two sources approve the same id identically: a second source has no business approving it', () => {
    const same = { productId: 'acme.demo', events: [], approval: { 'platform.one': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false } } }
    expect(() => mergeApprovalView([platform, same as never])).toThrow('approval-duplicate-source:platform.one')
  })

  it('throws when two sources approve the same id differently, naming both sides and each field', () => {
    // 待架构师确认：不一致时是报错还是取一边。当前写成「遇到即报错」，绝不静默挑一边。
    const conflict: NotificationEventDeclarationSource = {
      productId: 'acme.demo',
      events: [],
      approval: { 'platform.one': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false } }
    }
    expect(() => mergeApprovalView([platform, conflict])).toThrow('approval-conflict:platform.one')
  })
})
